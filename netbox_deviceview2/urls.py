from django.urls import path

from .views import DeviceLayoutSaveView, DeviceTypeLayoutSaveView, ModuleTypeLayoutSaveView

app_name = "netbox_deviceview2"

urlpatterns = [
    path(
        "device-types/<int:pk>/layout/save/",
        DeviceTypeLayoutSaveView.as_view(),
        name="devicetype_layout_save",
    ),
    path(
        "module-types/<int:pk>/layout/save/",
        ModuleTypeLayoutSaveView.as_view(),
        name="moduletype_layout_save",
    ),
    path(
        "devices/<int:pk>/layout/save/",
        DeviceLayoutSaveView.as_view(),
        name="device_layout_save",
    ),
]
