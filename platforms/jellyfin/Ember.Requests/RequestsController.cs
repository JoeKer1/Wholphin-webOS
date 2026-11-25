using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;

namespace Ember.Requests;

[ApiController]
[Authorize]
[Route("Ember/Requests")]
public sealed class RequestsController : ControllerBase
{
    private static readonly MemoryCache Sessions = new(new MemoryCacheOptions { SizeLimit = 256 });
    private static readonly HttpClient Client = new(new HttpClientHandler
    {
        AllowAutoRedirect = false,
        UseCookies = false
    })
    {
        Timeout = TimeSpan.FromSeconds(10),
        MaxResponseContentBufferSize = 2 * 1024 * 1024
    };

    private static readonly HashSet<string> RequestFields = new(StringComparer.Ordinal)
    {
        "mediaType", "mediaId", "is4k", "seasons"
    };

    private static readonly Regex ReadRoutes = new(
        @"\A(?:auth/me|discover/(?:trending|movies(?:/upcoming)?|tv)|search|request|(?:movie|tv)/[0-9]+)\z",
        RegexOptions.CultureInvariant);

    [HttpGet("status")]
    public IActionResult Status() => TryGetProfile(out _, out _) && GetSeerrUri() is not null
        ? Ok(new { enabled = true })
        : NotFound();

    [HttpGet("api/{**path}")]
    public Task<IActionResult> Read(string path, CancellationToken cancellationToken)
        => ReadRoutes.IsMatch(path)
            ? Forward(path, null, cancellationToken)
            : Task.FromResult<IActionResult>(NotFound());

    [HttpPost("api/{**path}")]
    [RequestSizeLimit(16384)]
    public Task<IActionResult> Write(string path, [FromBody] JsonElement body, CancellationToken cancellationToken)
        => body.ValueKind == JsonValueKind.Object && path is "request" or "auth/logout" or
            "auth/jellyfin/quickconnect/initiate" or "auth/jellyfin/quickconnect/authenticate"
            ? Forward(path, body, cancellationToken)
            : Task.FromResult<IActionResult>(NotFound());

    private bool TryGetProfile(out Guid user, out string device)
    {
        device = User.FindFirst("Jellyfin-DeviceId")?.Value ?? "";
        return Guid.TryParse(User.FindFirst("Jellyfin-UserId")?.Value, out user) && user != Guid.Empty &&
            device.Length is > 0 and <= 256 &&
            !string.Equals(User.FindFirst("Jellyfin-IsApiKey")?.Value, "true", StringComparison.OrdinalIgnoreCase);
    }

    private static Uri? GetSeerrUri()
    {
        var configured = Plugin.Instance?.Configuration.SeerrUrl.Trim().TrimEnd('/');
        return Uri.TryCreate(configured + "/", UriKind.Absolute, out var uri) &&
            uri.Scheme is "http" or "https" && uri.UserInfo.Length == 0 &&
            uri.Query.Length == 0 && uri.Fragment.Length == 0 ? uri : null;
    }

    private async Task<IActionResult> Forward(string path, JsonElement? body, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        if (!TryGetProfile(out var user, out var device)) return Forbid();
        var server = GetSeerrUri();
        if (server is null) return StatusCode(503);

        var key = (user, device, server);
        ProfileSession profile;
        // Create exactly one lock and cookie jar for concurrent requests for this device and profile.
        lock (Sessions)
        {
            profile = Sessions.GetOrCreate(key, entry =>
            {
                entry.SetSize(1).SetSlidingExpiration(TimeSpan.FromHours(12));
                return new ProfileSession();
            })!;
        }

        await profile.Gate.WaitAsync(cancellationToken);
        try
        {
            if (path == "auth/logout")
            {
                profile.Clear();
                return NoContent();
            }

            if (path == "auth/jellyfin/quickconnect/initiate")
            {
                profile.Clear();
                var initiated = await Send(server, profile.PendingCookies, path, body, cancellationToken);
                if (initiated.Status == 200 &&
                    initiated.Data.ValueKind == JsonValueKind.Object &&
                    initiated.Data.TryGetProperty("secret", out var secret) &&
                    secret.ValueKind == JsonValueKind.String)
                {
                    profile.PendingSecret = secret.GetString();
                    profile.PendingUntil = DateTimeOffset.UtcNow.AddMinutes(5);
                }

                return Relay(initiated);
            }

            if (path == "auth/jellyfin/quickconnect/authenticate")
            {
                if (profile.PendingSecret is null || DateTimeOffset.UtcNow >= profile.PendingUntil ||
                    !body!.Value.TryGetProperty("secret", out var secret) || secret.ValueKind != JsonValueKind.String ||
                    secret.GetString() != profile.PendingSecret) return Unauthorized();

                profile.PendingSecret = null;
                var pendingCookies = profile.PendingCookies;
                profile.PendingCookies = new CookieContainer();
                var login = await Send(server, pendingCookies, path, body, cancellationToken);
                if (login.Status is < 200 or >= 300) return Relay(login);

                var identity = await Send(server, pendingCookies, "auth/me", null, cancellationToken);
                if (!MatchesProfile(identity, user) || !identity.Data.TryGetProperty("id", out var id) ||
                    id.ValueKind != JsonValueKind.Number || !id.TryGetInt32(out var seerrUserId) || seerrUserId <= 0)
                    return Unauthorized();

                profile.SeerrUserId = seerrUserId;
                profile.AuthenticatedCookies = pendingCookies;
                // The client reads auth/me separately. Never return the upstream login payload.
                return NoContent();
            }

            if (profile.AuthenticatedCookies is not { } cookies) return Unauthorized();
            if (path == "request" && body is { } requestBody &&
                requestBody.EnumerateObject().Any(property => !RequestFields.Contains(property.Name)))
                return BadRequest();

            var query = body is null ? Request.QueryString.Value : "";
            if (query?.Length > 2048) return BadRequest();
            if (path == "request" && body is null)
            {
                if (!int.TryParse(Request.Query["skip"], out var skip) || skip < 0) skip = 0;
                query = FormattableString.Invariant($"?requestedBy={profile.SeerrUserId}&take=20&skip={skip}");
            }

            var result = await Send(server, cookies, path + query, body, cancellationToken);
            if (result.Status == 401 || (path == "auth/me" && result.Status == 200 && !MatchesProfile(result, user)))
            {
                profile.Clear();
                return Unauthorized();
            }

            return Relay(result);
        }
        catch (Exception error) when (error is HttpRequestException or JsonException or CookieException ||
            error is OperationCanceledException && !cancellationToken.IsCancellationRequested)
        {
            return StatusCode(502);
        }
        finally
        {
            profile.Gate.Release();
        }
    }

    private static bool MatchesProfile(SeerrResult response, Guid user)
        => response.Status == 200 && response.Data.ValueKind == JsonValueKind.Object &&
            response.Data.TryGetProperty("jellyfinUserId", out var id) &&
            id.ValueKind == JsonValueKind.String && Guid.TryParse(id.GetString(), out var actual) && actual == user;

    private IActionResult Relay(SeerrResult response)
        => response.Status == 204 ? NoContent() : response.Status is >= 200 and < 300
            ? StatusCode(response.Status, response.Data)
            : StatusCode(response.Status is >= 400 and < 500 ? response.Status : 502);

    private static async Task<SeerrResult> Send(Uri server, CookieContainer cookies, string path,
        JsonElement? body, CancellationToken cancellationToken)
    {
        if (body is not null)
        {
            var status = await Send(server, cookies, "status", null, cancellationToken);
            if (status.Status != 200) return status;
        }

        var target = new Uri(server, "api/v1/" + path);
        using var request = new HttpRequestMessage(body is null ? HttpMethod.Get : HttpMethod.Post, target);
        request.Headers.TryAddWithoutValidation("Accept", "application/json");
        var cookieHeader = cookies.GetCookieHeader(target);
        if (cookieHeader.Length > 0) request.Headers.TryAddWithoutValidation("Cookie", cookieHeader);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body.Value);
            request.Headers.TryAddWithoutValidation("Origin", server.GetLeftPart(UriPartial.Authority));
            request.Headers.Referrer = server;
            if (cookies.GetCookies(target)["XSRF-TOKEN"] is { } csrf)
                request.Headers.TryAddWithoutValidation("X-XSRF-TOKEN", Uri.UnescapeDataString(csrf.Value));
        }

        using var response = await Client.SendAsync(request, cancellationToken);
        if (response.Headers.TryGetValues("Set-Cookie", out var values))
            foreach (var value in values) cookies.SetCookies(target, value);

        var statusCode = (int)response.StatusCode;
        if (!response.IsSuccessStatusCode || statusCode == 204)
            return new SeerrResult(statusCode, default);

        await using var content = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var json = await JsonDocument.ParseAsync(content, cancellationToken: cancellationToken);
        return new SeerrResult(statusCode, json.RootElement.Clone());
    }

    private readonly record struct SeerrResult(int Status, JsonElement Data);

    private sealed class ProfileSession
    {
        public SemaphoreSlim Gate { get; } = new(1);
        public int SeerrUserId { get; set; }
        public CookieContainer? AuthenticatedCookies { get; set; }
        public CookieContainer PendingCookies { get; set; } = new();
        public string? PendingSecret { get; set; }
        public DateTimeOffset PendingUntil { get; set; }

        public void Clear()
        {
            AuthenticatedCookies = null;
            PendingCookies = new();
            PendingSecret = null;
        }
    }
}
