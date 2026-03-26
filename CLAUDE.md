# netbox_deviceview2 — Claude Code Guide

## What this is

A NetBox 4.x plugin that adds a **Layout** tab to Device Type, Module Type, Device, Interface, FrontPort, and RearPort detail pages. The tab shows a physical panel view (grid of zones representing module bays, device bays, interfaces, front/rear ports, console/power ports) with a WYSIWYG drag-and-drop editor.

## Environment

- NetBox version: **4.2.9** running in Docker container `netbox-stack-netbox-1` on `localhost:8000`
- Python: 3.12 inside container at `/opt/netbox/venv`
- Plugin installed at: `/opt/netbox/venv/lib/python3.12/site-packages/netbox_deviceview2/`
- Static files served from: `/opt/netbox/netbox/static/`

## Deploy workflow

Use `deploy.sh` for a full deploy (copies all files + collectstatic):
```bash
bash deploy.sh
```

Or manually for targeted updates:

```bash
# Copy a single file
docker cp "netbox_deviceview2/views.py" netbox-stack-netbox-1:/opt/netbox/venv/lib/python3.12/site-packages/netbox_deviceview2/views.py

# After changing templates or Python files — restart required
docker restart netbox-stack-netbox-1

# After changing JS/CSS only — no restart needed, just collectstatic
docker exec -u root netbox-stack-netbox-1 sh -c \
  "cd /opt/netbox && python netbox/manage.py collectstatic --no-input --clear 2>&1 | tail -3"
```

Always hard-refresh the browser (Ctrl+Shift+R) after deploying static files.

## File structure

```
netbox_deviceview2/
  __init__.py               PluginConfig — base_url="netbox-deviceview2", min_version="4.1.0"
  models.py                 DeviceTypeLayout, ModuleTypeLayout (OneToOne + JSONField)
  views.py                  Tab views (GET) + save views (POST)
  urls.py                   Plugin-namespace save endpoints
  migrations/
    0001_initial.py         Depends on ("dcim", "0001_squashed") — confirmed for NetBox 4.2.9
  templates/netbox_deviceview2/
    devicetype_layout.html  Extends NetBox base, includes _layout_grid.html
    moduletype_layout.html  Same for module types
    device_layout.html      Same for devices
    port_layout.html        Same for Interface/FrontPort/RearPort (view-only, highlights port)
    _layout_grid.html       Shared grid/editor HTML (toolbar, sidebar, panel, modal)
  static/netbox_deviceview2/
    css/layout.css          All styles (theme-aware via CSS custom properties)
    js/main.js              Entry point — reads data attrs, delegates to renderer or editor
    js/renderer.js          Renders layout JSON into CSS Grid DOM
    js/editor.js            LayoutEditor class — drag-drop, sidebar, resize, undo, save
```

## Layout JSON schema (current)

```json
{
  "panel_label": "REAR PANEL",
  "grid": { "rows": 2, "cols": 6 },
  "zones": [
    {
      "id": "zone-abc123",
      "label": "display label shown on panel",
      "type": "module_bay",
      "netbox_id": 42,
      "netbox_name": "internal name (not displayed)",
      "grid_position": { "row": 1, "col": 1, "row_span": 1, "col_span": 2 },
      "ports": []
    },
    {
      "id": "zone-def456",
      "label": "eth0",
      "type": "port_group",
      "netbox_id": null,
      "netbox_name": "eth0",
      "grid_position": { "row": 1, "col": 3, "row_span": 1, "col_span": 1 },
      "ports": [
        { "id": "7", "label": "eth0", "name": "eth0" }
      ]
    }
  ]
}
```

Zone types: `module_bay`, `device_bay`, `port_group`, `power`, `custom`

## URL patterns

| URL | View | Method |
|-----|------|--------|
| `/dcim/device-types/<pk>/layout/` | `DeviceTypeLayoutView` | GET (tab) |
| `/dcim/module-types/<pk>/layout/` | `ModuleTypeLayoutView` | GET (tab) |
| `/dcim/devices/<pk>/layout/` | `DeviceLayoutView` | GET (tab) |
| `/dcim/interfaces/<pk>/layout/` | `InterfaceLayoutView` | GET (tab, view-only) |
| `/dcim/front-ports/<pk>/layout/` | `FrontPortLayoutView` | GET (tab, view-only) |
| `/dcim/rear-ports/<pk>/layout/` | `RearPortLayoutView` | GET (tab, view-only) |
| `/plugins/netbox-deviceview2/device-types/<pk>/layout/save/` | `DeviceTypeLayoutSaveView` | POST |
| `/plugins/netbox-deviceview2/module-types/<pk>/layout/save/` | `ModuleTypeLayoutSaveView` | POST |
| `/plugins/netbox-deviceview2/devices/<pk>/layout/save/` | `DeviceLayoutSaveView` | POST |

Tab views are registered with `@register_model_view` and land in the `dcim:` URL namespace.
Save views are in `urls.py` and land in the `plugins:netbox_deviceview2:` namespace.

## Permissions

- View layout tab: `dcim.view_devicetype` / `dcim.view_moduletype` / `dcim.view_device` / `dcim.view_interface` etc.
- Show Edit button: `dcim.change_devicetype` / `dcim.change_moduletype` / `dcim.change_device`
- POST to save view: same change permissions — do NOT use `netbox_deviceview2.change_*` (those are never assigned)
- Port layout tabs (Interface/FrontPort/RearPort) are always view-only — no edit mode

## NetBox API — sidebar items

The editor fetches templates via the NetBox REST API:

| Sidebar type | API endpoint (template) | API endpoint (device) | Device type | Module type | Device |
|---|---|---|---|---|---|
| Module Bays | `module-bay-templates/` | `module-bays/` | ✓ | ✓ | ✓ |
| Interfaces | `interface-templates/` | `interfaces/` | ✓ | ✓ | ✓ |
| Front Ports | `front-port-templates/` | `front-ports/` | ✓ | ✓ | ✓ |
| Rear Ports | `rear-port-templates/` | `rear-ports/` | ✓ | ✓ | ✓ |
| Device Bays | `device-bay-templates/` | `device-bays/` | ✓ | — | ✓ |
| Console Ports | `console-port-templates/` | `console-ports/` | ✓ | — | ✓ |
| Console Server Ports | `console-server-port-templates/` | `console-server-ports/` | ✓ | — | ✓ |
| Power Ports | `power-port-templates/` | `power-ports/` | ✓ | — | ✓ |
| Power Outlets | `power-outlet-templates/` | `power-outlets/` | ✓ | — | ✓ |

All under `/api/dcim/`. Filter param: `device_type_id=<pk>` for device types, `module_type_id=<pk>` for module types, `device_id=<pk>` for devices.

Device Bays, Console/Power types not shown in sidebar for module types (`object_type == "module_type"`).

**Display logic for items:**
- Sidebar list always shows `item.name`
- On drop → module bay / device bay label = `item.name`
- On drop → interface/port label blank by default (user fills it in via edit modal)
- `item.display` from the API is formatted as `"name (label)"` when a label exists — avoid using it directly when a label is set

## Data flow — device view

`_build_device_layout_data(device)` returns 4 values:
1. `layouts_data` — multi-layout format `{"layouts": [...]}`
2. `sub_layouts` — `{ zone_id: layout_obj }` for module bays with installed modules (matched by `module_bay.name == zone.netbox_name`)
3. `connections` — `{ "zone_id:port_id": {connected, name, cable, peers} }` for device ports; `"parent_zone_id/sub_zone_id:port_id"` for module ports
4. `device_bays_info` — `{ zone_id: {device_name, device_url} }` for device bays with installed devices (matched by `device_bay.name == zone.netbox_name`)

All four are JSON-serialised and passed via `data-*` attributes on `#dv2-panels-column` to JS.

## CSS — theme support

All colours are CSS custom properties. NetBox sets `data-bs-theme="dark"` on `<html>` for dark mode.

- Light theme values defined on `:root`
- Dark theme values defined on `[data-bs-theme="dark"]`

Zone colours, panel background, sidebar, and modal all adapt to theme. Port boxes (`#4a6a9a`) are constant in both themes.

## JS conventions

- Vanilla ES modules (`type="module"`) — no build step, no npm
- `main.js` reads `data-layouts`, `data-sub-layouts`, `data-connections`, `data-device-bays`, `data-edit`, `data-object-type`, `data-object-pk` from `#dv2-panels-column`
- Layout JSON is passed from Django to JS via `data-layouts="{{ layout_json }}"` — use Django auto-escaping (NOT `|escapejs`, which breaks JSON in HTML attributes)
- Bootstrap is NOT accessible as `window.bootstrap` in ES modules — use the custom CSS modal (`#dv2-zone-modal` with `dv2-modal-open` class)
- NetBox's TomSelect hijacks `<select class="form-select">` — always use `class="dv2-select"` instead
- `render()` in renderer.js accepts opts: `{ editable, connections, subLayouts, deviceBays }`
- Port objects in zones: `{ id, label, name }` — all three fields must survive the modal edit cycle (`name` stored in hidden `.port-name-val` input)

## Known gotchas

- `|escapejs` in HTML data attributes breaks JSON (escapes `"` to `\"` which closes the attribute). Use plain `{{ layout_json }}`.
- `docker cp <dir>` does not overwrite existing files — always copy individual files or use `deploy.sh`.
- After changing templates or Python: must restart the container. After JS/CSS only: collectstatic is enough.
- `DeviceType` in NetBox 4.2 uses `modulebaytemplates` (not `modulebays`) as the related manager name.
- Migration dependency must be `("dcim", "0001_squashed")` for NetBox 4.2.9.
- Col/row insert+delete controls use absolute positioning on a `position:relative` wrapper — never a separate flex/grid container (alignment drifts at high column counts otherwise).
- Interface/FrontPort/RearPort layout tabs show the parent device layout with the specific port highlighted in yellow (flashing) — they have no edit mode.
