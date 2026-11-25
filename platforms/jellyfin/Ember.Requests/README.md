# Ember Requests for Jellyfin 12.4

Build with .NET 10 and place `Ember.Requests.dll` in a dedicated directory under Jellyfin's plugin directory. Create `Ember.Requests.xml` in Jellyfin's plugin configurations directory with the Seerr base URL:

```xml
<RequestsConfiguration>
  <SeerrUrl>https://requests.example.com</SeerrUrl>
</RequestsConfiguration>
```

Restart Jellyfin to load the plugin and use a Jellyfin-linked Seerr server with Quick Connect enabled. The URL must be reachable from Jellyfin and support any security attributes on Seerr's cookies, including HTTPS for Secure cookies. The updated LG and Samsung builds discover the plugin when loading the library list and show **Requests** in the sidebar.

The plugin uses Jellyfin's authenticated user and device identity and verifies that Seerr signed in as that Jellyfin user. Seerr cookies stay in memory on Jellyfin. Restarting Jellyfin or letting the session expire causes Ember to reconnect via Quick Connect. The plugin exposes the browse, search and request routes used by Ember. Seerr applies its existing request permissions and quotas.
