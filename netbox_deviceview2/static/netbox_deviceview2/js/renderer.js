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

/**
 * Create a port indicator element.
 * @param {object} port        - { id, label }
 * @param {boolean} connected  - true = green, false = grey (view mode)
 * @param {boolean} editable   - if true, neutral colour used
 */
export function createPortEl(port, connected, editable) {
  const el = document.createElement("div");
  el.className = "dv2-port";
  el.dataset.portId = port.id;
  el.title = port.label;
  el.textContent = port.label;

  if (!editable) {
    el.classList.add(connected ? "dv2-connected" : "dv2-unconnected");
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
  const { editable = false, connections = {}, subLayouts = {} } = opts;
  const p = zone.grid_position;

  const el = document.createElement("div");
  el.className = "dv2-zone";
  el.dataset.zoneId = zone.id;
  el.dataset.type = zone.type || "custom";

  // CSS Grid placement (1-based, matching JSON schema)
  el.style.gridColumn = `${p.col} / span ${p.col_span || 1}`;
  el.style.gridRow = `${p.row} / span ${p.row_span || 1}`;

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
      const connected = !!connections[`${zone.id}:${port.id}`];
      portsEl.appendChild(createPortEl(port, connected, editable));
    }
    el.appendChild(portsEl);
  }

  // Nested sub-layout (for module bays with installed modules)
  if (!editable && zone.type === "module_bay" && subLayouts[zone.id]) {
    _renderSubLayout(el, subLayouts[zone.id], opts);
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
 */
function _renderSubLayout(parentEl, subLayout, opts) {
  if (!subLayout || !subLayout.zones || subLayout.zones.length === 0) return;

  const rows = subLayout.grid?.rows || 1;
  const cols = subLayout.grid?.cols || 4;

  const subGrid = document.createElement("div");
  subGrid.style.cssText =
    `display:grid;` +
    `grid-template-columns:repeat(${cols},1fr);` +
    `grid-template-rows:repeat(${rows},1fr);` +
    `gap:3px;width:100%;`;

  for (const zone of subLayout.zones) {
    const zoneEl = createZoneEl(zone, { ...opts, editable: false });
    zoneEl.style.fontSize = "0.65rem";
    subGrid.appendChild(zoneEl);
  }

  parentEl.appendChild(subGrid);
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

  // Apply grid CSS
  gridEl.style.gridTemplateColumns = `repeat(${cols}, minmax(80px, 1fr))`;
  gridEl.style.gridTemplateRows = `repeat(${rows}, minmax(88px, 1fr))`;

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
