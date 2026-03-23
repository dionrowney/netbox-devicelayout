import json

from django.contrib import messages
from django.contrib.auth.mixins import LoginRequiredMixin
from django.http import HttpResponseForbidden
from django.shortcuts import get_object_or_404, redirect
from django.urls import reverse
from django.views import View
from netbox.views.generic import ObjectView
from utilities.views import ViewTab, register_model_view

from dcim.models import Device, DeviceType, Module, ModuleType

from .models import DeviceLayout, DeviceTypeLayout, ModuleTypeLayout


# ---------------------------------------------------------------------------
# Tab definitions
# ---------------------------------------------------------------------------

device_type_layout_tab = ViewTab(
    label="Layout",
    permission="dcim.view_devicetype",
    weight=5000,
)

module_type_layout_tab = ViewTab(
    label="Layout",
    permission="dcim.view_moduletype",
    weight=5000,
)

device_layout_tab = ViewTab(
    label="Layout",
    permission="dcim.view_device",
    weight=5000,
)


# ---------------------------------------------------------------------------
# Device Type layout tab
# ---------------------------------------------------------------------------

@register_model_view(DeviceType, "layout", path="layout")
class DeviceTypeLayoutView(ObjectView):
    queryset = DeviceType.objects.all()
    tab = device_type_layout_tab
    template_name = "netbox_deviceview2/devicetype_layout.html"

    def get_extra_context(self, request, instance):
        layout, _ = DeviceTypeLayout.objects.get_or_create(device_type=instance)
        save_url = reverse(
            "plugins:netbox_deviceview2:devicetype_layout_save",
            kwargs={"pk": instance.pk},
        )
        return {
            "layout_json": json.dumps(layout.layout),
            "sub_layouts_json": json.dumps({}),
            "edit_mode": request.GET.get("edit") == "1",
            "can_edit": request.user.has_perm("dcim.change_devicetype"),
            "save_url": save_url,
            "object_type": "device_type",
            "object_pk": instance.pk,
        }


# ---------------------------------------------------------------------------
# Module Type layout tab
# ---------------------------------------------------------------------------

@register_model_view(ModuleType, "layout", path="layout")
class ModuleTypeLayoutView(ObjectView):
    queryset = ModuleType.objects.all()
    tab = module_type_layout_tab
    template_name = "netbox_deviceview2/moduletype_layout.html"

    def get_extra_context(self, request, instance):
        layout, _ = ModuleTypeLayout.objects.get_or_create(module_type=instance)
        save_url = reverse(
            "plugins:netbox_deviceview2:moduletype_layout_save",
            kwargs={"pk": instance.pk},
        )
        return {
            "layout_json": json.dumps(layout.layout),
            "sub_layouts_json": json.dumps({}),
            "edit_mode": request.GET.get("edit") == "1",
            "can_edit": request.user.has_perm("dcim.change_moduletype"),
            "save_url": save_url,
            "object_type": "module_type",
            "object_pk": instance.pk,
        }


# ---------------------------------------------------------------------------
# Device layout tab
# ---------------------------------------------------------------------------

@register_model_view(Device, "layout", path="layout")
class DeviceLayoutView(ObjectView):
    queryset = Device.objects.all()
    tab = device_layout_tab
    template_name = "netbox_deviceview2/device_layout.html"

    def get_extra_context(self, request, instance):
        layout, _ = DeviceLayout.objects.get_or_create(device=instance)

        # Build sub_layouts: for each module bay zone that has a module installed,
        # fetch the module type's layout and pass it keyed by zone ID so the
        # renderer can nest it inside the bay.
        sub_layouts = {}
        zones = layout.layout.get("zones", []) if layout.layout else []

        # Map module bay NetBox ID → zone ID
        bay_zone_map = {
            str(zone["netbox_id"]): zone["id"]
            for zone in zones
            if zone.get("type") == "module_bay" and zone.get("netbox_id")
        }

        if bay_zone_map:
            installed = Module.objects.filter(
                module_bay__device=instance,
            ).select_related("module_type", "module_bay")

            for module in installed:
                zone_id = bay_zone_map.get(str(module.module_bay_id))
                if not zone_id:
                    continue
                try:
                    mt_layout = ModuleTypeLayout.objects.get(module_type=module.module_type)
                    if mt_layout.layout:
                        sub_layouts[zone_id] = mt_layout.layout
                except ModuleTypeLayout.DoesNotExist:
                    pass

        save_url = reverse(
            "plugins:netbox_deviceview2:device_layout_save",
            kwargs={"pk": instance.pk},
        )
        return {
            "layout_json": json.dumps(layout.layout),
            "sub_layouts_json": json.dumps(sub_layouts),
            "edit_mode": request.GET.get("edit") == "1",
            "can_edit": request.user.has_perm("dcim.change_device"),
            "save_url": save_url,
            "object_type": "device",
            "object_pk": instance.pk,
        }


# ---------------------------------------------------------------------------
# Save views
# ---------------------------------------------------------------------------

class _LayoutSaveBase(LoginRequiredMixin, View):

    required_perm = None
    redirect_view_name = None

    def get_layout_obj(self, pk):
        raise NotImplementedError

    def post(self, request, pk):
        if not request.user.has_perm(self.required_perm):
            return HttpResponseForbidden()

        layout = self.get_layout_obj(pk)
        raw = request.POST.get("layout_data", "")

        if not raw:
            messages.error(request, "No layout data received.")
            return redirect(
                reverse(self.redirect_view_name, kwargs={"pk": pk}) + "?edit=1"
            )

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            messages.error(request, "Layout data is not valid JSON.")
            return redirect(
                reverse(self.redirect_view_name, kwargs={"pk": pk}) + "?edit=1"
            )

        layout.layout = data
        layout.save()
        messages.success(request, "Layout saved successfully.")
        return redirect(reverse(self.redirect_view_name, kwargs={"pk": pk}))


class DeviceTypeLayoutSaveView(_LayoutSaveBase):
    required_perm = "dcim.change_devicetype"
    redirect_view_name = "dcim:devicetype_layout"

    def get_layout_obj(self, pk):
        device_type = get_object_or_404(DeviceType, pk=pk)
        layout, _ = DeviceTypeLayout.objects.get_or_create(device_type=device_type)
        return layout


class ModuleTypeLayoutSaveView(_LayoutSaveBase):
    required_perm = "dcim.change_moduletype"
    redirect_view_name = "dcim:moduletype_layout"

    def get_layout_obj(self, pk):
        module_type = get_object_or_404(ModuleType, pk=pk)
        layout, _ = ModuleTypeLayout.objects.get_or_create(module_type=module_type)
        return layout


class DeviceLayoutSaveView(_LayoutSaveBase):
    required_perm = "dcim.change_device"
    redirect_view_name = "dcim:device_layout"

    def get_layout_obj(self, pk):
        device = get_object_or_404(Device, pk=pk)
        layout, _ = DeviceLayout.objects.get_or_create(device=device)
        return layout
