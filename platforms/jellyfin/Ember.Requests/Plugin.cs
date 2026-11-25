using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Ember.Requests;

public sealed class Plugin : BasePlugin<RequestsConfiguration>
{
    public static Plugin? Instance { get; private set; }

    public Plugin(IApplicationPaths paths, IXmlSerializer serializer) : base(paths, serializer)
    {
        Instance = this;
    }

    public override string Name => "Ember Requests";
    public override Guid Id => new("be8a15a1-f11f-45bf-9e90-68fd1a6e41ed");
}

public sealed class RequestsConfiguration : BasePluginConfiguration
{
    public string SeerrUrl { get; set; } = "";
}
