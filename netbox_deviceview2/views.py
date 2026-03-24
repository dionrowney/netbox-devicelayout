import json

from django.contrib import messages
from django.contrib.auth.mixins import LoginRequiredMixin
from django.http import HttpResponseForbidden
from django.shortcuts import get_object_or_404, redirect
from django.urls import reverse
from django.views import View
from netbox.views.generic import ObjectView
from utilities.views import ViewTab, register_model_view

from dcim.models import (
    Device, DeviceType, FrontPortTemplate, InterfaceTemplate,
    Module, ModuleType, RearPortTemplate,
)

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
            "connections_json": json.dumps({}),
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
            "connections_json": json.dumps({}),
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
        zones = layout.layout.get("zones", []) if layout.layout else []

        # --- Sub-layouts: installed modules nested in module bay zones --------
        # Match by bay NAME (not stored ID) so this works regardless of whether
        # the layout was copied from a device type (template IDs) or edited
        # directly on the device (actual bay IDs). NetBox always gives actual
        # bays the same name as their originating template.
        sub_layouts = {}
        installed_by_bay_name = {
            module.module_bay.name: module
            for module in Module.objects.filter(
                module_bay__device=instance
            ).select_related("module_type", "module_bay")
        }

        for zone in zones:
            if zone.get("type") != "module_bay":
                continue
            bay_name = zone.get("netbox_name") or zone.get("label")
            if not bay_name:
                continue
            module = installed_by_bay_name.get(bay_name)
            if not module:
                continue
            try:
                mt_layout = ModuleTypeLayout.objects.get(module_type=module.module_type)
                if mt_layout.layout:
                    sub_layouts[zone["id"]] = mt_layout.layout
            except ModuleTypeLayout.DoesNotExist:
                pass

        # --- Connections: live cable status + tooltip data ---------------------
        # Build device-wide name → port info dict for all port types.
        def _port_info(obj):
            cable_label = ""
            if obj.cable:
                cable_label = obj.cable.label or f"#{obj.cable.pk}"
            peers = []
            try:
                for peer in (obj.link_peers or []):
                    if hasattr(peer, "device") and hasattr(peer, "name"):
                        peers.append(f"{peer.device} / {peer.name}")
                    elif hasattr(peer, "circuit"):
                        peers.append(f"Circuit {peer.circuit.cid}")
                    else:
                        peers.append(str(peer))
            except Exception:
                pass
            return {"connected": obj.cable_id is not None, "cable": cable_label, "peers": peers}

        port_info = {}
        for iface in instance.interfaces.select_related("cable").all():
            port_info[iface.name] = _port_info(iface)
        for fp in instance.frontports.select_related("cable").all():
            port_info[fp.name] = _port_info(fp)
        for rp in instance.rearports.select_related("cable").all():
            port_info[rp.name] = _port_info(rp)

        connections = {}

        # Device-level zone ports: matched by stored port name.
        for zone in zones:
            for port in zone.get("ports", []):
                port_name = port.get("name")
                if port_name and port_name in port_info:
                    info = port_info[port_name]
                    connections[f"{zone['id']}:{port['id']}"] = {
                        "connected": info["connected"],
                        "name": port_name,
                        "cable": info["cable"],
                        "peers": info["peers"],
                    }

        # Sub-layout zone ports: stored with template ID + label only (no name).
        # Resolve by fetching the template name and substituting {module} with
        # the bay's position (e.g. "{module}/1" + position "PCIe-1" → "PCIe-1/1").
        all_template_ids = set()
        for sub_layout in sub_layouts.values():
            for sub_zone in sub_layout.get("zones", []):
                for port in sub_zone.get("ports", []):
                    try:
                        all_template_ids.add(int(port["id"]))
                    except (KeyError, ValueError, TypeError):
                        pass

        if all_template_ids:
            template_name_map = {}
            for t in InterfaceTemplate.objects.filter(pk__in=all_template_ids):
                template_name_map[str(t.pk)] = t.name
            for t in FrontPortTemplate.objects.filter(pk__in=all_template_ids):
                template_name_map[str(t.pk)] = t.name
            for t in RearPortTemplate.objects.filter(pk__in=all_template_ids):
                template_name_map[str(t.pk)] = t.name

            for zone in zones:
                if zone.get("type") != "module_bay":
                    continue
                bay_name = zone.get("netbox_name") or zone.get("label")
                module = installed_by_bay_name.get(bay_name)
                if not module:
                    continue
                bay_position = module.module_bay.position or module.module_bay.name
                sub_layout = sub_layouts.get(zone["id"])
                if not sub_layout:
                    continue
                for sub_zone in sub_layout.get("zones", []):
                    for port in sub_zone.get("ports", []):
                        template_name = template_name_map.get(str(port.get("id", "")))
                        if not template_name:
                            continue
                        actual_name = template_name.replace("{module}", bay_position)
                        if actual_name in port_info:
                            info = port_info[actual_name]
                            # Key is prefixed with the parent module-bay zone id so that
                            # multiple bays using the same module type don't collide
                            # (sub-layout zone/port IDs are identical across instances).
                            connections[f"{zone['id']}/{sub_zone['id']}:{port['id']}"] = {
                                "connected": info["connected"],
                                "name": actual_name,
                                "cable": info["cable"],
                                "peers": info["peers"],
                            }

        save_url = reverse(
            "plugins:netbox_deviceview2:device_layout_save",
            kwargs={"pk": instance.pk},
        )
        return {
            "layout_json": json.dumps(layout.layout),
            "sub_layouts_json": json.dumps(sub_layouts),
            "connections_json": json.dumps(connections),
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
