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
    Device, DeviceBay, DeviceBayTemplate, DeviceType,
    FrontPort, FrontPortTemplate, Interface,
    InterfaceTemplate, Module, ModuleType, RearPort, RearPortTemplate,
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

interface_layout_tab = ViewTab(
    label="Layout",
    permission="dcim.view_interface",
    weight=5000,
)

front_port_layout_tab = ViewTab(
    label="Layout",
    permission="dcim.view_frontport",
    weight=5000,
)

rear_port_layout_tab = ViewTab(
    label="Layout",
    permission="dcim.view_rearport",
    weight=5000,
)


# ---------------------------------------------------------------------------
# Layout JSON format helpers
# ---------------------------------------------------------------------------

def _normalize_layouts(data):
    """
    Ensure layout data is in multi-layout format: {"layouts": [...]}.
    Old single-layout format ({"zones": [...], "grid": {...}}) is auto-wrapped.
    """
    if not data:
        return {"layouts": []}
    if "layouts" in data:
        return data
    return {"layouts": [data]}


def _first_sub_layout(data):
    """
    Given a module type layout (may be old or new format), return a single
    layout object for use as a sub-layout inside a device panel.
    """
    if not data:
        return None
    if "layouts" in data:
        return data["layouts"][0] if data["layouts"] else None
    return data


# ---------------------------------------------------------------------------
# Shared helper: build device layout context data
# ---------------------------------------------------------------------------

def _has_zones(layouts_data):
    """Return True if any layout in layouts_data contains at least one zone."""
    return any(
        zone
        for layout in layouts_data.get("layouts", [])
        for zone in layout.get("zones", [])
    )


def _build_device_layout_data(device):
    """
    Returns (layouts_data, sub_layouts, connections, device_bays_info, layout_source).

    layouts_data is always in multi-layout format {"layouts": [...]}.
    connections is populated for every port that appears in any layout zone.
    layout_source is "device" or "device_type" — falls back to device type when
    the device has no layout of its own.
    """
    layout_obj, _ = DeviceLayout.objects.get_or_create(device=device)
    layouts_data = _normalize_layouts(layout_obj.layout)

    layout_source = "device"
    if not _has_zones(layouts_data):
        try:
            dt_layout = DeviceTypeLayout.objects.get(device_type=device.device_type)
            dt_data = _normalize_layouts(dt_layout.layout)
            if _has_zones(dt_data):
                layouts_data = dt_data
                layout_source = "device_type"
        except DeviceTypeLayout.DoesNotExist:
            pass

    # Collect all zones across all layouts for sub-layout and connection building
    all_zones = [
        zone
        for layout in layouts_data["layouts"]
        for zone in layout.get("zones", [])
    ]

    # Sub-layouts: installed modules matched by bay name
    sub_layouts = {}
    installed_by_bay_name = {
        module.module_bay.name: module
        for module in Module.objects.filter(
            module_bay__device=device
        ).select_related("module_type", "module_bay")
    }

    for zone in all_zones:
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
            sub_layout = _first_sub_layout(mt_layout.layout)
            if sub_layout:
                sub_layouts[zone["id"]] = sub_layout
        except ModuleTypeLayout.DoesNotExist:
            pass

    # Port info: cable + peers for every port on the device
    def _fmt_endpoint(ep):
        if hasattr(ep, "device") and hasattr(ep, "name"):
            return f"{ep.device} / {ep.name}"
        if hasattr(ep, "circuit"):
            return f"Circuit {ep.circuit.cid}"
        return str(ep)

    def _port_info(obj):
        cable_label = ""
        if obj.cable:
            cable_label = obj.cable.label or f"#{obj.cable.pk}"
        peers = []
        try:
            for peer in (obj.link_peers or []):
                peers.append(_fmt_endpoint(peer))
        except Exception:
            pass
        remote = []
        try:
            for ep in (obj.connected_endpoints or []):
                r = _fmt_endpoint(ep)
                if r not in peers:
                    remote.append(r)
        except Exception:
            pass
        return {"connected": obj.cable_id is not None, "cable": cable_label, "peers": peers, "remote": remote}

    port_info = {}
    port_id_by_name = {}
    port_type_by_name = {}
    for iface in device.interfaces.select_related("cable").all():
        port_info[iface.name] = _port_info(iface)
        port_id_by_name[iface.name] = iface.pk
        port_type_by_name[iface.name] = "interface"
    for fp in device.frontports.select_related("cable").all():
        port_info[fp.name] = _port_info(fp)
        port_id_by_name[fp.name] = fp.pk
        port_type_by_name[fp.name] = "front-port"
    for rp in device.rearports.select_related("cable").all():
        port_info[rp.name] = _port_info(rp)
        port_id_by_name[rp.name] = rp.pk
        port_type_by_name[rp.name] = "rear-port"

    _empty = {"connected": False, "cable": "", "peers": [], "remote": []}
    connections = {}

    # Device-level zone ports
    for zone in all_zones:
        for port in zone.get("ports", []):
            port_name = port.get("name")
            if port_name:
                info = port_info.get(port_name, _empty)
                connections[f"{zone['id']}:{port['id']}"] = {
                    "connected": info["connected"],
                    "name": port_name,
                    "cable": info["cable"],
                    "peers": info["peers"],
                    "remote": info["remote"],
                }

    # Sub-layout zone ports: template ID → {module} substitution
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

        for zone in all_zones:
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
                    info = port_info.get(actual_name, _empty)
                    actual_port_id = port_id_by_name.get(actual_name)
                    actual_port_type = port_type_by_name.get(actual_name)
                    # Prefix with parent bay zone id to avoid key collisions when
                    # multiple bays use the same module type (identical zone/port IDs).
                    entry = {
                        "connected": info["connected"],
                        "name": actual_name,
                        "cable": info["cable"],
                        "peers": info["peers"],
                        "remote": info["remote"],
                    }
                    if actual_port_id:
                        entry["port_id"] = actual_port_id
                        entry["netbox_type"] = actual_port_type
                    connections[f"{zone['id']}/{sub_zone['id']}:{port['id']}"] = entry

    # Device bays: installed device name + URL, keyed by zone ID
    device_bays_info = {}
    installed_by_device_bay_name = {
        bay.name: bay
        for bay in DeviceBay.objects.filter(
            device=device
        ).select_related("installed_device")
    }
    for zone in all_zones:
        if zone.get("type") != "device_bay":
            continue
        bay_name = zone.get("netbox_name") or zone.get("label")
        if not bay_name:
            continue
        bay = installed_by_device_bay_name.get(bay_name)
        if not bay or not bay.installed_device:
            continue
        dev = bay.installed_device
        device_bays_info[zone["id"]] = {
            "device_name": dev.name,
            "device_url": dev.get_absolute_url(),
        }

    return layouts_data, sub_layouts, connections, device_bays_info, layout_source


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
        layouts_data = _normalize_layouts(layout.layout)
        save_url = reverse(
            "plugins:netbox_deviceview2:devicetype_layout_save",
            kwargs={"pk": instance.pk},
        )
        return {
            "layout_json": json.dumps(layouts_data),
            "sub_layouts_json": json.dumps({}),
            "connections_json": json.dumps({}),
            "device_bays_json": json.dumps({}),
            "highlight_port": "",
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
        layouts_data = _normalize_layouts(layout.layout)
        save_url = reverse(
            "plugins:netbox_deviceview2:moduletype_layout_save",
            kwargs={"pk": instance.pk},
        )
        return {
            "layout_json": json.dumps(layouts_data),
            "sub_layouts_json": json.dumps({}),
            "connections_json": json.dumps({}),
            "device_bays_json": json.dumps({}),
            "highlight_port": "",
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
        layouts_data, sub_layouts, connections, device_bays_info, layout_source = _build_device_layout_data(instance)
        save_url = reverse(
            "plugins:netbox_deviceview2:device_layout_save",
            kwargs={"pk": instance.pk},
        )
        return {
            "layout_json": json.dumps(layouts_data),
            "sub_layouts_json": json.dumps(sub_layouts),
            "connections_json": json.dumps(connections),
            "device_bays_json": json.dumps(device_bays_info),
            "highlight_port": "",
            "edit_mode": request.GET.get("edit") == "1",
            "can_edit": request.user.has_perm("dcim.change_device"),
            "save_url": save_url,
            "object_type": "device",
            "object_pk": instance.pk,
            "layout_source": layout_source,
        }


# ---------------------------------------------------------------------------
# Port layout tabs (Interface / FrontPort / RearPort)
# Shows the parent device layout with the specific port flashing yellow.
# ---------------------------------------------------------------------------

class _PortLayoutViewBase(ObjectView):
    template_name = "netbox_deviceview2/port_layout.html"

    def get_extra_context(self, request, instance):
        device = instance.device
        if not device:
            return {
                "layout_json": json.dumps({"layouts": []}),
                "sub_layouts_json": json.dumps({}),
                "connections_json": json.dumps({}),
                "device_bays_json": json.dumps({}),
                "highlight_port": "",
                "edit_mode": False,
                "can_edit": False,
                "save_url": "",
                "object_type": "device",
                "object_pk": 0,
            }
        layouts_data, sub_layouts, connections, device_bays_info, layout_source = _build_device_layout_data(device)
        return {
            "layout_json": json.dumps(layouts_data),
            "sub_layouts_json": json.dumps(sub_layouts),
            "connections_json": json.dumps(connections),
            "device_bays_json": json.dumps(device_bays_info),
            "highlight_port": instance.name,
            "edit_mode": False,
            "can_edit": False,
            "save_url": "",
            "object_type": "device",
            "object_pk": device.pk,
            "layout_source": layout_source,
        }


@register_model_view(Interface, "layout", path="layout")
class InterfaceLayoutView(_PortLayoutViewBase):
    queryset = Interface.objects.select_related("device").all()
    tab = interface_layout_tab


@register_model_view(FrontPort, "layout", path="layout")
class FrontPortLayoutView(_PortLayoutViewBase):
    queryset = FrontPort.objects.select_related("device").all()
    tab = front_port_layout_tab


@register_model_view(RearPort, "layout", path="layout")
class RearPortLayoutView(_PortLayoutViewBase):
    queryset = RearPort.objects.select_related("device").all()
    tab = rear_port_layout_tab


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
