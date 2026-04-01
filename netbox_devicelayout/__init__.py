from netbox.plugins import PluginConfig


class NetboxDeviceLayoutConfig(PluginConfig):
    name = "netbox_devicelayout"
    verbose_name = "Device Layout"
    description = "Physical layout view and WYSIWYG editor for device types and module types"
    version = "0.1.0"
    author = ""
    author_email = ""
    base_url = "netbox-devicelayout"
    min_version = "4.1.0"
    required_settings = []
    default_settings = {}


    def ready(self):
        super().ready()
        from . import signals  # noqa: F401


config = NetboxDeviceLayoutConfig
