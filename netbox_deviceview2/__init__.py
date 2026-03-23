from netbox.plugins import PluginConfig


class NetboxDeviceview2Config(PluginConfig):
    name = "netbox_deviceview2"
    verbose_name = "Device View 2"
    description = "Physical layout view and WYSIWYG editor for device types and module types"
    version = "0.1.0"
    author = ""
    author_email = ""
    base_url = "netbox-deviceview2"
    min_version = "4.1.0"
    required_settings = []
    default_settings = {}


config = NetboxDeviceview2Config
