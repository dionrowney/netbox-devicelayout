/**
 * renderer.js
 *
 * Renders the layout grid from a layout JSON object.
 *
 * Layout JSON schema:
 * {
 *   "panel_label": "REAR PANEL",
 *   "grid": { "rows": 2, "cols": 6 },
 *   "zones": [
 *     {
 *       "id": "zone-abc",
 *       "label": "ModuleBay1",
 *       "type": "module_bay",           // module_bay | port_group | power | custom
 *       "grid_position": {
 *         "row": 1, "col": 1,           // 1-based
 *         "row_span": 1, "col_span": 1
 *       },
 *       "ports": [                      // optional, for port_group zones
 *         { "id": "1", "label": "1" }
 *       ]
 *     }
 *   ]
 * }
 */

/**
 * Return true if grid cell (row, col) — both 1-based — falls inside any zone.
 */
export function isOccupied(zones, row, col) {
  return zones.some((z) => {
    const p = z.grid_position;
    return (
      row >= p.row &&
      row < p.row + (p.row_span || 1) &&
      col >= p.col &&
      col < p.col + (p.col_span || 1)
    );
  });
}

/**
 * Create a dashed empty-cell element for a given grid position.
 */
export function createEmptyCellEl(row, col) {
  const el = document.createElement("div");
  el.className = "dv2-empty-cell";
  el.dataset.row = row;
  el.dataset.col = col;
  el.style.gridColumn = `${col} / span 1`;
  el.style.gridRow = `${row} / span 1`;
  return el;
}

// Shared tooltip element — created once, appended to body.
let _tooltipEl = null;
function _getTooltip() {
  if (!_tooltipEl) {
    _tooltipEl = document.createElement("div");
    _tooltipEl.className = "dv2-port-tooltip";
    _tooltipEl.style.display = "none";
    document.body.appendChild(_tooltipEl);
  }
  return _tooltipEl;
}

function _showTooltip(e, port, portData) {
  const tt = _getTooltip();
  const name = portData?.name || port.name || port.label || port.id;
  const cable = portData?.cable || "";
  const peers = portData?.peers || [];
  const remote = portData?.remote || [];
  const connected = portData?.connected ?? false;

  let html = `<div class="dv2-tt-row"><span class="dv2-tt-key">Port</span><span class="dv2-tt-val">${_esc(name)}</span></div>`;
  if (connected) {
    if (cable) {
      html += `<div class="dv2-tt-row"><span class="dv2-tt-key">Cable</span><span class="dv2-tt-val">${_esc(cable)}</span></div>`;
    }
    if (peers.length) {
      html += `<div class="dv2-tt-row"><span class="dv2-tt-key">Link Peer</span><span class="dv2-tt-val">${peers.map(_esc).join("<br>")}</span></div>`;
    }
    if (remote.length) {
      html += `<div class="dv2-tt-row"><span class="dv2-tt-key">Connection</span><span class="dv2-tt-val">${remote.map(_esc).join("<br>")}</span></div>`;
    }
  } else {
    html += `<div class="dv2-tt-row"><span class="dv2-tt-key">Status</span><span class="dv2-tt-val dv2-tt-unconnected">Not connected</span></div>`;
  }

  tt.innerHTML = html;
  tt.style.display = "block";
  _positionTooltip(e);
}

function _positionTooltip(e) {
  const tt = _getTooltip();
  const x = e.clientX + 12;
  const y = e.clientY + 12;
  const rect = tt.getBoundingClientRect();
  // Flip left if would overflow viewport right
  const left = x + rect.width > window.innerWidth ? e.clientX - rect.width - 8 : x;
  const top  = y + rect.height > window.innerHeight ? e.clientY - rect.height - 8 : y;
  tt.style.left = `${left}px`;
  tt.style.top  = `${top}px`;
}

function _hideTooltip() {
  const tt = _getTooltip();
  tt.style.display = "none";
}

function _esc(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Create a port indicator element.
 * @param {object} port        - { id, label }
 * @param {object|boolean} portData  - connection object {connected, name, cable, peers} or boolean (view mode)
 * @param {boolean} editable   - if true, neutral colour used, no tooltip
 */
export function createPortEl(port, portData, editable) {
  const el = document.createElement("div");
  el.className = "dv2-port";
  el.dataset.portId = port.id;
  el.textContent = port.label;

  const connected = typeof portData === "object" ? portData?.connected : !!portData;

  // Store resolved name as data attribute so highlight can find this element by name
  const resolvedName = (typeof portData === "object" ? portData?.name : null) || port.name || "";
  if (resolvedName) el.dataset.portName = resolvedName;

  if (!editable) {
    el.classList.add(connected ? "dv2-connected" : "dv2-unconnected");

    el.addEventListener("mouseenter", (e) => _showTooltip(e, port, typeof portData === "object" ? portData : null));
    el.addEventListener("mousemove", _positionTooltip);
    el.addEventListener("mouseleave", _hideTooltip);
  }
  return el;
}

/**
 * Create a zone element.
 * @param {object} zone
 * @param {object} opts
 * @param {boolean} opts.editable
 * @param {object}  opts.connections  - { "zone_id:port_id": true } for connected ports
 * @param {object}  opts.subLayouts   - { zone_id: layoutObj } for nested module layouts
 */
export function createZoneEl(zone, opts = {}) {
  const { editable = false, connections = {}, subLayouts = {}, deviceBays = {} } = opts;
  const p = zone.grid_position;

  const el = document.createElement("div");
  el.className = "dv2-zone";
  el.dataset.zoneId = zone.id;
  el.dataset.type = zone.type || "custom";

  // CSS Grid placement (1-based, matching JSON schema)
  el.style.gridColumn = `${p.col} / span ${p.col_span || 1}`;
  el.style.gridRow = `${p.row} / span ${p.row_span || 1}`;

  // Custom appearance overrides (override type-based CSS rules)
  if (zone.bg_color === "none") {
    el.style.background = "transparent";
  } else if (zone.bg_color) {
    el.style.background = zone.bg_color;
  }
  if (zone.no_border) {
    el.style.border = "none";
  }

  if (editable) {
    el.draggable = true;
  }

  // Label
  const labelEl = document.createElement("div");
  labelEl.className = "dv2-zone-label";
  labelEl.textContent = zone.label || "";
  el.appendChild(labelEl);

  // Ports (if any)
  if (zone.ports && zone.ports.length > 0) {
    const portsEl = document.createElement("div");
    portsEl.className = "dv2-ports";
    for (const port of zone.ports) {
      const portData = connections[`${zone.id}:${port.id}`] ?? false;
      portsEl.appendChild(createPortEl(port, portData, editable));
    }
    el.appendChild(portsEl);
  }

  // Nested sub-layout (for module bays with installed modules)
  if (!editable && zone.type === "module_bay" && subLayouts[zone.id]) {
    _renderSubLayout(el, subLayouts[zone.id], opts, zone.id);
  }

  // Device bay: show installed device name with link (view mode only)
  if (!editable && zone.type === "device_bay") {
    const bayInfo = deviceBays[zone.id];
    if (bayInfo) {
      const link = document.createElement("a");
      link.className = "dv2-device-bay-link";
      link.href = bayInfo.device_url;
      link.textContent = bayInfo.device_name;
      link.title = `Go to device: ${bayInfo.device_name}`;
      el.appendChild(link);
    }
  }

  // Edit-mode controls
  if (editable) {
    const actions = document.createElement("div");
    actions.className = "dv2-zone-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "dv2-zone-btn dv2-zone-btn-edit";
    editBtn.title = "Edit zone";
    editBtn.innerHTML = "✎";
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "dv2-zone-btn dv2-zone-btn-delete";
    deleteBtn.title = "Delete zone";
    deleteBtn.innerHTML = "×";
    actions.appendChild(deleteBtn);

    el.appendChild(actions);

    const resizeHandle = document.createElement("div");
    resizeHandle.className = "dv2-resize-handle";
    resizeHandle.title = "Drag to resize";
    resizeHandle.innerHTML = "⇲";
    el.appendChild(resizeHandle);
  }

  return el;
}

/**
 * Render a sub-layout (installed module's ports) inside a module bay zone.
 * @param {HTMLElement} parentEl
 * @param {object}      subLayout
 * @param {object}      opts
 * @param {string}      parentZoneId  - the module-bay zone id, used to scope connections
 */
function _renderSubLayout(parentEl, subLayout, opts, parentZoneId) {
  if (!subLayout || !subLayout.zones || subLayout.zones.length === 0) return;

  const rows = subLayout.grid?.rows || 1;
  const cols = subLayout.grid?.cols || 4;

  // Build a scoped connections dict: strip the "parentZoneId/" prefix so
  // createZoneEl can look up keys as "{sub_zone_id}:{port_id}" normally.
  const prefix = parentZoneId ? `${parentZoneId}/` : "";
  const allConns = opts.connections || {};
  const subConns = {};
  if (prefix) {
    for (const [k, v] of Object.entries(allConns)) {
      if (k.startsWith(prefix)) {
        subConns[k.slice(prefix.length)] = v;
      }
    }
  }

  const subOpts = { ...opts, editable: false, connections: subConns };

  const subGrid = document.createElement("div");
  subGrid.className = "dv2-sub-grid";
  subGrid.style.cssText =
    `display:grid;` +
    `grid-template-columns:repeat(${cols},1fr);` +
    `grid-template-rows:repeat(${rows},1fr);` +
    `gap:3px;width:100%;transform-origin:top left;`;

  for (const zone of subLayout.zones) {
    const zoneEl = createZoneEl(zone, subOpts);
    zoneEl.style.fontSize = "0.65rem";
    subGrid.appendChild(zoneEl);
  }

  // Prevent overflow while zoom settles
  parentEl.style.overflow = "hidden";
  parentEl.appendChild(subGrid);

  // Scale sub-layout to fit the parent zone whenever its width changes
  function applySubZoom() {
    subGrid.style.zoom = "";
    const available = subGrid.clientWidth;
    const natural   = subGrid.scrollWidth;
    if (natural > available && available > 0) {
      subGrid.style.zoom = available / natural;
    }
  }

  requestAnimationFrame(applySubZoom);
  const ro = new ResizeObserver(applySubZoom);
  ro.observe(parentEl);
}

/**
 * Main render function.
 *
 * @param {HTMLElement} panelEl    - The .dv2-panel element (wraps label + grid)
 * @param {HTMLElement} gridEl    - The .dv2-grid element
 * @param {object}      layoutData - Parsed layout JSON (may be {})
 * @param {object}      opts
 * @param {boolean}     opts.editable
 * @param {object}      opts.connections
 * @param {object}      opts.subLayouts
 */
export function render(panelEl, gridEl, layoutData, opts = {}) {
  // Update panel label
  const labelEl = panelEl.querySelector(".dv2-panel-label, .dv2-panel-label-input");
  if (labelEl) {
    const panelLabel = layoutData.panel_label || "";
    if (labelEl.tagName === "INPUT") {
      labelEl.value = panelLabel;
    } else {
      labelEl.textContent = panelLabel || (opts.editable ? "" : "");
    }
  }

  gridEl.innerHTML = "";

  const grid = layoutData.grid || { rows: 2, cols: 6 };
  const rows = grid.rows || 2;
  const cols = grid.cols || 6;
  const zones = layoutData.zones || [];

  // Apply grid CSS — min sizes are configurable via opts
  const colMinWidth  = opts.colMinWidth  ?? 80;
  const rowMinHeight = opts.rowMinHeight ?? 88;
  gridEl.style.gridTemplateColumns = `repeat(${cols}, minmax(${colMinWidth}px, 1fr))`;
  gridEl.style.gridTemplateRows    = `repeat(${rows}, minmax(${rowMinHeight}px, 1fr))`;

  // Render empty cells for unoccupied positions
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      if (!isOccupied(zones, r, c)) {
        gridEl.appendChild(createEmptyCellEl(r, c));
      }
    }
  }

  // Show message if no zones defined (view mode only)
  if (zones.length === 0 && !opts.editable) {
    const msg = document.createElement("div");
    msg.className = "dv2-empty-message";
    msg.textContent = "No layout defined — click 'Edit Layout' to design the panel.";
    gridEl.appendChild(msg);
    return;
  }

  // Render zones
  for (const zone of zones) {
    gridEl.appendChild(createZoneEl(zone, opts));
  }
}
