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
    Device, DeviceType, FrontPort, FrontPortTemplate, Interface,
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
# Shared helper: build device layout context data
# ---------------------------------------------------------------------------

def _build_device_layout_data(device):
    """
    Returns (layout_obj, sub_layouts, connections) for a device.

    connections is keyed by "{zone_id}:{port_id}" for device-level ports and
    "{parent_zone_id}/{sub_zone_id}:{port_id}" for sub-layout ports.
    Every port that appears in a zone is included (connected: False when no cable).
    """
    layout_obj, _ = DeviceLayout.objects.get_or_create(device=device)
    zones = layout_obj.layout.get("zones", []) if layout_obj.layout else []

    # Sub-layouts: installed modules matched by bay name
    sub_layouts = {}
    installed_by_bay_name = {
        module.module_bay.name: module
        for module in Module.objects.filter(
            module_bay__device=device
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

    # Port info: cable + peers for every port on the device
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
    for iface in device.interfaces.select_related("cable").all():
        port_info[iface.name] = _port_info(iface)
    for fp in device.frontports.select_related("cable").all():
        port_info[fp.name] = _port_info(fp)
    for rp in device.rearports.select_related("cable").all():
        port_info[rp.name] = _port_info(rp)

    _empty = {"connected": False, "cable": "", "peers": []}
    connections = {}

    # Device-level zone ports
    for zone in zones:
        for port in zone.get("ports", []):
            port_name = port.get("name")
            if port_name:
                info = port_info.get(port_name, _empty)
                connections[f"{zone['id']}:{port['id']}"] = {
                    "connected": info["connected"],
                    "name": port_name,
                    "cable": info["cable"],
                    "peers": info["peers"],
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
                    info = port_info.get(actual_name, _empty)
                    # Prefix with parent bay zone id to avoid key collisions when
                    # multiple bays use the same module type (identical zone/port IDs).
                    connections[f"{zone['id']}/{sub_zone['id']}:{port['id']}"] = {
                        "connected": info["connected"],
                        "name": actual_name,
                        "cable": info["cable"],
                        "peers": info["peers"],
                    }

    return layout_obj, sub_layouts, connections


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
        save_url = reverse(
            "plugins:netbox_deviceview2:moduletype_layout_save",
            kwargs={"pk": instance.pk},
        )
        return {
            "layout_json": json.dumps(layout.layout),
            "sub_layouts_json": json.dumps({}),
            "connections_json": json.dumps({}),
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
        layout_obj, sub_layouts, connections = _build_device_layout_data(instance)
        save_url = reverse(
            "plugins:netbox_deviceview2:device_layout_save",
            kwargs={"pk": instance.pk},
        )
        return {
            "layout_json": json.dumps(layout_obj.layout),
            "sub_layouts_json": json.dumps(sub_layouts),
            "connections_json": json.dumps(connections),
            "highlight_port": "",
            "edit_mode": request.GET.get("edit") == "1",
            "can_edit": request.user.has_perm("dcim.change_device"),
            "save_url": save_url,
            "object_type": "device",
            "object_pk": instance.pk,
        }


# ---------------------------------------------------------------------------
# Port layout tabs (Interface / FrontPort / RearPort)
# Shows the parent device layout with the specific port flashing yellow.
# ---------------------------------------------------------------------------

class _PortLayoutViewBase(ObjectView):
    template_name = "netbox_deviceview2/port_layout.html"

    def _get_device(self, instance):
        return instance.device

    def get_extra_context(self, request, instance):
        device = self._get_device(instance)
        if not device:
            return {
                "layout_json": json.dumps({}),
                "sub_layouts_json": json.dumps({}),
                "connections_json": json.dumps({}),
                "highlight_port": "",
                "edit_mode": False,
                "can_edit": False,
                "save_url": "",
                "object_type": "device",
                "object_pk": 0,
            }
        layout_obj, sub_layouts, connections = _build_device_layout_data(device)
        return {
            "layout_json": json.dumps(layout_obj.layout),
            "sub_layouts_json": json.dumps(sub_layouts),
            "connections_json": json.dumps(connections),
            "highlight_port": instance.name,
            "edit_mode": False,
            "can_edit": False,
            "save_url": "",
            "object_type": "device",
            "object_pk": device.pk,
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
