from django.urls import path

from .views import DeviceTypeLayoutSaveView, ModuleTypeLayoutSaveView

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
]
