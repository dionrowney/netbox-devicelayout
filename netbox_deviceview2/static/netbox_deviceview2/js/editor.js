/**
 * editor.js — Sidebar drag-and-drop layout editor.
 *
 * Supports multiple stacked LayoutEditor instances on one page.
 * Module-level _drag state is shared across all instances so that
 * a sidebar item dragged from the shared sidebar can be dropped onto
 * any panel's grid.
 *
 * The first editor created (ownsSidebar=true) owns the shared sidebar,
 * modal, and resize bar.  Subsequent editors just manage their own
 * panel/grid and per-panel controls (rows, cols, undo, clear).
 */

import { render, isOccupied } from "./renderer.js";

let _uid = Date.now();
function uid() { return "zone-" + (++_uid).toString(36); }

// Shared drag state — set by sidebar items or zone drag-starts,
// consumed by any editor's drop handler.
let _drag = null;

// Shared modal editor — whichever editor most recently opened the modal.
let _activeModalEditor = null;

// Maps sidebar dropdown value → API config
const SIDEBAR_TYPES = {
  "module-bay":  { apiSlug: "module-bay-templates",  zoneType: "module_bay",  dotClass: "dv2-dot-module-bay"  },
  "interface":   { apiSlug: "interface-templates",   zoneType: "port_group",  dotClass: "dv2-dot-interface"   },
  "front-port":  { apiSlug: "front-port-templates",  zoneType: "port_group",  dotClass: "dv2-dot-front-port"  },
  "rear-port":   { apiSlug: "rear-port-templates",   zoneType: "port_group",  dotClass: "dv2-dot-rear-port"   },
  "device-bay":  { apiSlug: "device-bay-templates",  zoneType: "device_bay",  dotClass: "dv2-dot-device-bay"  },
};

const DEVICE_SIDEBAR_TYPES = {
  "module-bay":          { apiSlug: "module-bays",               zoneType: "module_bay",  dotClass: "dv2-dot-module-bay"          },
  "interface":           { apiSlug: "interfaces",                zoneType: "port_group",  dotClass: "dv2-dot-interface"           },
  "front-port":          { apiSlug: "front-ports",               zoneType: "port_group",  dotClass: "dv2-dot-front-port"          },
  "rear-port":           { apiSlug: "rear-ports",                zoneType: "port_group",  dotClass: "dv2-dot-rear-port"           },
  "device-bay":          { apiSlug: "device-bays",               zoneType: "device_bay",  dotClass: "dv2-dot-device-bay"          },
  "console-port":        { apiSlug: "console-ports",             zoneType: "port_group",  dotClass: "dv2-dot-console-port"        },
  "console-server-port": { apiSlug: "console-server-ports",      zoneType: "port_group",  dotClass: "dv2-dot-console-server-port" },
  "power-port":          { apiSlug: "power-ports",               zoneType: "port_group",  dotClass: "dv2-dot-power-port"          },
  "power-outlet":        { apiSlug: "power-outlets",             zoneType: "port_group",  dotClass: "dv2-dot-power-outlet"        },
};

export class LayoutEditor {
  /**
   * @param {HTMLElement} wrapperEl   - .dv2-layout-wrapper (scope for per-panel controls)
   * @param {HTMLElement} panelEl     - .dv2-panel
   * @param {HTMLElement} gridEl      - .dv2-grid
   * @param {object}      initialLayout
   * @param {object}      subLayouts
   * @param {boolean}     ownsSidebar - true for the first editor; manages shared sidebar/modal
   */
  constructor(wrapperEl, panelEl, gridEl, initialLayout, subLayouts, ownsSidebar = false) {
    this.wrapperEl    = wrapperEl;
    this.panelEl      = panelEl;
    this.gridEl       = gridEl;
    this.subLayouts   = subLayouts;
    this._ownsSidebar = ownsSidebar;
    this.objectType   = gridEl.dataset.objectType;
    this.objectPk     = gridEl.dataset.objectPk;

    this.layout = this._clone(
      Object.keys(initialLayout).length
        ? initialLayout
        : { panel_label: "", grid: { rows: 2, cols: 6 }, zones: [] }
    );

    this.history   = [];
    this._resize   = null;
    this._apiCache = {};
    this._modalZone = null;
  }

  init() {
    this._renderAll();
    this._bindDimInputs();
    this._bindPanelLabelInput();
    this._bindUndoClear();
    if (this._ownsSidebar) {
      this._bindSidebar();
      this._bindModalEvents();
      this._bindResizeBar();
    }
    this._wrapGridWithControls();
    // Note: global Ctrl+Z is handled in main.js; per-editor _undo() is public.
  }

  /** Return a deep copy of the current layout for saving. */
  getLayout() {
    return this._clone(this.layout);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  _renderAll() {
    const colMinWidth  = this.layout.grid.col_min_width  ?? 80;
    const rowMinHeight = this.layout.grid.row_min_height ?? 88;
    render(this.panelEl, this.gridEl, this.layout, {
      editable: true,
      subLayouts: this.subLayouts,
      colMinWidth,
      rowMinHeight,
    });
    this._bindGridEvents();
    this._bindZoneEvents();
    this._updateUndoBtn();
    this._syncDimInputs();
    if (this._ownsSidebar) this._refreshSidebar();
    if (this._colControlsEl) this._renderGridControls();
  }

  // -------------------------------------------------------------------------
  // Sidebar (owned by first editor only)
  // -------------------------------------------------------------------------

  _bindSidebar() {
    const typeEl   = document.getElementById("dv2-sidebar-type");
    const filterEl = document.getElementById("dv2-sidebar-filter");
    if (!typeEl) return;

    typeEl.addEventListener("change", () => {
      if (filterEl) filterEl.value = "";
      this._refreshSidebar();
    });
    filterEl?.addEventListener("input", () => this._applyFilter());
    this._refreshSidebar();
  }

  _applyFilter() {
    const filterEl = document.getElementById("dv2-sidebar-filter");
    const term = (filterEl?.value || "").toLowerCase().trim();
    document.querySelectorAll("#dv2-sidebar-list .dv2-sidebar-item").forEach((el) => {
      const name = (el.dataset.itemName || "").toLowerCase();
      el.style.display = name.includes(term) ? "" : "none";
    });
    const listEl = document.getElementById("dv2-sidebar-list");
    if (!listEl) return;
    const anyVisible = [...listEl.querySelectorAll(".dv2-sidebar-item")]
      .some((el) => el.style.display !== "none");
    let noMatch = listEl.querySelector(".dv2-sidebar-no-match");
    if (!anyVisible && term) {
      if (!noMatch) {
        noMatch = document.createElement("div");
        noMatch.className = "dv2-sidebar-empty dv2-sidebar-no-match";
        noMatch.textContent = "No matches.";
        listEl.appendChild(noMatch);
      }
    } else if (noMatch) {
      noMatch.remove();
    }
  }

  async _refreshSidebar() {
    const typeEl = document.getElementById("dv2-sidebar-type");
    const listEl = document.getElementById("dv2-sidebar-list");
    if (!typeEl || !listEl) return;

    const sidebarType = typeEl.value;
    const types = this.objectType === "device" ? DEVICE_SIDEBAR_TYPES : SIDEBAR_TYPES;
    const config = types[sidebarType];
    if (!config) return;

    listEl.innerHTML = '<div class="dv2-sidebar-loading">Loading…</div>';
    const items = await this._fetchItems(config.apiSlug);
    const placedIds = this._getPlacedIds(sidebarType);
    const available = items.filter((item) => !placedIds.has(String(item.id)));

    listEl.innerHTML = "";
    if (available.length === 0) {
      listEl.innerHTML = '<div class="dv2-sidebar-empty">All items placed.</div>';
      return;
    }
    for (const item of available) {
      listEl.appendChild(this._sidebarItemEl(item, sidebarType, config));
    }
  }

  _getPlacedIds(sidebarType) {
    const ids = new Set();
    for (const zone of this.layout.zones) {
      if (sidebarType === "module-bay" && zone.type === "module_bay" && zone.netbox_id) {
        ids.add(String(zone.netbox_id));
      } else if (sidebarType === "device-bay" && zone.type === "device_bay" && zone.netbox_id) {
        ids.add(String(zone.netbox_id));
      } else if (
        (sidebarType === "interface" || sidebarType === "front-port" || sidebarType === "rear-port" ||
         sidebarType === "console-port" || sidebarType === "console-server-port" ||
         sidebarType === "power-port" || sidebarType === "power-outlet") &&
        zone.type === "port_group"
      ) {
        for (const p of zone.ports || []) ids.add(String(p.id));
      }
    }
    return ids;
  }

  _sidebarItemEl(item, sidebarType, config) {
    const el = document.createElement("div");
    el.className = "dv2-sidebar-item";
    const itemName    = item.name || String(item.id);
    const itemDisplay = (item.label && item.label.trim()) ? item.label : (item.display || itemName);

    el.draggable = true;
    el.dataset.itemId       = item.id;
    el.dataset.itemName     = itemName;
    el.dataset.itemDisplay  = itemDisplay;
    el.dataset.sidebarType  = sidebarType;

    const dot = document.createElement("span");
    dot.className = `dv2-sidebar-item-dot ${config.dotClass}`;
    el.appendChild(dot);

    const nameEl = document.createElement("span");
    nameEl.className = "dv2-sidebar-item-name";
    nameEl.textContent = itemName;
    nameEl.title = itemName;
    el.appendChild(nameEl);

    el.addEventListener("dragstart", (e) => {
      _drag = {
        source:      "sidebar",
        itemId:      item.id,
        itemName,
        itemDisplay,
        sidebarType,
        zoneType:    config.zoneType,
      };
      el.classList.add("dv2-dragging");
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("text/plain", String(item.id));
    });
    el.addEventListener("dragend", () => {
      el.classList.remove("dv2-dragging");
      _drag = null;
    });

    return el;
  }

  // -------------------------------------------------------------------------
  // NetBox API
  // -------------------------------------------------------------------------

  _apiParam() {
    if (this.objectType === "device")      return "device_id";
    if (this.objectType === "module_type") return "module_type_id";
    return "device_type_id";
  }

  async _fetchItems(apiSlug) {
    if (this._apiCache[apiSlug]) return this._apiCache[apiSlug];
    const url = `/api/dcim/${apiSlug}/?${this._apiParam()}=${this.objectPk}&limit=1000`;
    try {
      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      if (!resp.ok) throw new Error(resp.statusText);
      const data = await resp.json();
      this._apiCache[apiSlug] = data.results || [];
    } catch (e) {
      console.warn("dv2: API fetch failed for", apiSlug, e);
      this._apiCache[apiSlug] = [];
    }
    return this._apiCache[apiSlug];
  }

  // -------------------------------------------------------------------------
  // Grid events
  // -------------------------------------------------------------------------

  _bindGridEvents() {
    this.gridEl.querySelectorAll(".dv2-empty-cell").forEach((cell) => {

      cell.addEventListener("dragover", (e) => {
        if (!_drag) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = _drag.source === "sidebar" ? "copy" : "move";
        this.gridEl.querySelectorAll(".dv2-drag-over")
          .forEach((el) => el.classList.remove("dv2-drag-over"));
        cell.classList.add("dv2-drag-over");
      });

      cell.addEventListener("dragleave", () => cell.classList.remove("dv2-drag-over"));

      cell.addEventListener("drop", (e) => {
        e.preventDefault();
        cell.classList.remove("dv2-drag-over");
        if (!_drag) return;

        const targetRow = parseInt(cell.dataset.row, 10);
        const targetCol = parseInt(cell.dataset.col, 10);

        if (_drag.source === "sidebar") {
          this._createZoneFromSidebar(_drag, targetRow, targetCol);
        } else if (_drag.source === "grid") {
          // Only allow moving zones that belong to this editor's layout
          if (this.layout.zones.some((z) => z.id === _drag.zone.id)) {
            this._moveZone(_drag.zone, targetRow, targetCol);
          }
        }
        _drag = null;
      });
    });
  }

  _createZoneFromSidebar(drag, row, col) {
    this._pushHistory();
    const zoneLabel = (drag.zoneType === "module_bay" || drag.zoneType === "device_bay") ? drag.itemName : "";
    const zone = {
      id:           uid(),
      label:        zoneLabel,
      type:         drag.zoneType,
      netbox_id:    (drag.zoneType === "module_bay" || drag.zoneType === "device_bay") ? drag.itemId : null,
      netbox_name:  drag.itemName,
      grid_position: { row, col, row_span: 1, col_span: 1 },
      ports: drag.zoneType === "port_group"
        ? [{ id: String(drag.itemId), label: drag.itemDisplay, name: drag.itemName }]
        : [],
    };
    this.layout.zones.push(zone);
    this._renderAll();
  }

  // -------------------------------------------------------------------------
  // Zone events
  // -------------------------------------------------------------------------

  _bindZoneEvents() {
    this.gridEl.querySelectorAll(".dv2-zone").forEach((zoneEl) => {
      const zone = this.layout.zones.find((z) => z.id === zoneEl.dataset.zoneId);
      if (!zone) return;

      zoneEl.querySelector(".dv2-zone-btn-edit")?.addEventListener("click", (e) => {
        e.stopPropagation();
        this._openEditModal(zone);
      });

      zoneEl.querySelector(".dv2-zone-btn-delete")?.addEventListener("click", (e) => {
        e.stopPropagation();
        this._deleteZone(zone);
      });

      zoneEl.addEventListener("dblclick", (e) => {
        if (e.target.closest(".dv2-zone-btn")) return;
        this._openEditModal(zone);
      });

      zoneEl.addEventListener("dragstart", (e) => {
        if (e.target.classList.contains("dv2-resize-handle")) { e.preventDefault(); return; }
        e.stopPropagation();
        _drag = { source: "grid", zone };
        zoneEl.classList.add("dv2-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", zone.id);
      });

      zoneEl.addEventListener("dragend", () => {
        zoneEl.classList.remove("dv2-dragging");
        _drag = null;
        this.gridEl.querySelectorAll(".dv2-drag-over")
          .forEach((el) => el.classList.remove("dv2-drag-over"));
      });

      zoneEl.querySelector(".dv2-resize-handle")?.addEventListener("mousedown", (e) => {
        e.stopPropagation(); e.preventDefault();
        this._resizeStart(e, zone);
      });

      // Allow additional sidebar ports to be dropped onto an existing port_group zone
      zoneEl.addEventListener("dragover", (e) => {
        if (!_drag || _drag.source !== "sidebar") return;
        if (_drag.zoneType !== "port_group" || zone.type !== "port_group") return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        zoneEl.classList.add("dv2-drag-over");
      });

      zoneEl.addEventListener("dragleave", (e) => {
        if (!zoneEl.contains(e.relatedTarget)) zoneEl.classList.remove("dv2-drag-over");
      });

      zoneEl.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        zoneEl.classList.remove("dv2-drag-over");
        if (!_drag || _drag.source !== "sidebar") return;
        if (_drag.zoneType !== "port_group" || zone.type !== "port_group") return;
        this._addPortToZone(zone, _drag);
        _drag = null;
      });
    });
  }

  _addPortToZone(zone, drag) {
    this._pushHistory();
    zone.ports = zone.ports || [];
    zone.ports.push({ id: String(drag.itemId), label: drag.itemDisplay, name: drag.itemName });
    this._renderAll();
  }

  // -------------------------------------------------------------------------
  // Zone operations
  // -------------------------------------------------------------------------

  _moveZone(zone, targetRow, targetCol) {
    const others = this.layout.zones.filter((z) => z.id !== zone.id);
    const rs = zone.grid_position.row_span || 1;
    const cs = zone.grid_position.col_span || 1;
    for (let r = targetRow; r < targetRow + rs; r++)
      for (let c = targetCol; c < targetCol + cs; c++)
        if (isOccupied(others, r, c)) return;
    if (targetRow < 1 || targetRow > this.layout.grid.rows - rs + 1) return;
    if (targetCol < 1 || targetCol > this.layout.grid.cols - cs + 1) return;
    this._pushHistory();
    zone.grid_position.row = targetRow;
    zone.grid_position.col = targetCol;
    this._renderAll();
  }

  _deleteZone(zone) {
    this._pushHistory();
    this.layout.zones = this.layout.zones.filter((z) => z.id !== zone.id);
    this._renderAll();
  }

  // -------------------------------------------------------------------------
  // Resize
  // -------------------------------------------------------------------------

  _resizeStart(e, zone) {
    const cw = this._cellWidth(), ch = this._cellHeight();
    this._resize = {
      zone,
      startX: e.clientX, startY: e.clientY,
      startCS: zone.grid_position.col_span || 1,
      startRS: zone.grid_position.row_span || 1,
      cw, ch,
    };
    const onMove = (ev) => {
      const { zone, startX, startY, startCS, startRS, cw, ch } = this._resize;
      const maxC = this.layout.grid.cols - zone.grid_position.col + 1;
      const maxR = this.layout.grid.rows - zone.grid_position.row + 1;
      zone.grid_position.col_span = Math.max(1, Math.min(maxC, startCS + Math.round((ev.clientX - startX) / cw)));
      zone.grid_position.row_span = Math.max(1, Math.min(maxR, startRS + Math.round((ev.clientY - startY) / ch)));
      const el = this.gridEl.querySelector(`[data-zone-id="${zone.id}"]`);
      if (el) {
        el.style.gridColumn = `${zone.grid_position.col} / span ${zone.grid_position.col_span}`;
        el.style.gridRow    = `${zone.grid_position.row} / span ${zone.grid_position.row_span}`;
      }
    };
    const onUp = () => {
      if (this._resize) { this._pushHistory(); this._resize = null; this._renderAll(); }
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  _cellWidth()  { return this.gridEl.getBoundingClientRect().width  / this.layout.grid.cols; }
  _cellHeight() { return this.gridEl.getBoundingClientRect().height / this.layout.grid.rows; }

  // -------------------------------------------------------------------------
  // Grid col/row insert+delete controls
  // -------------------------------------------------------------------------

  _wrapGridWithControls() {
    // Wrap gridEl in a positioned container so col/row controls can be
    // positioned absolutely relative to it — guaranteeing exact alignment.
    const wrapper = document.createElement("div");
    wrapper.className = "dv2-grid-ctrl-wrapper";
    this.panelEl.insertBefore(wrapper, this.gridEl);
    wrapper.appendChild(this.gridEl);

    this._colControlsEl = document.createElement("div");
    this._colControlsEl.className = "dv2-col-controls";
    wrapper.appendChild(this._colControlsEl);

    this._rowControlsEl = document.createElement("div");
    this._rowControlsEl.className = "dv2-row-controls";
    wrapper.appendChild(this._rowControlsEl);

    this._renderGridControls();
  }

  _renderGridControls() {
    const { cols, rows } = this.layout.grid;
    // Must match renderer.js render() exactly so controls align with grid cells.
    const colMinWidth  = this.layout.grid.col_min_width  ?? 80;
    const rowMinHeight = this.layout.grid.row_min_height ?? 88;
    const colTemplate = `repeat(${cols}, minmax(${colMinWidth}px, 1fr))`;
    const rowTemplate = `repeat(${rows}, minmax(${rowMinHeight}px, 1fr))`;

    // Col controls — same CSS Grid template as the main grid
    this._colControlsEl.innerHTML = "";
    this._colControlsEl.style.gridTemplateColumns = colTemplate;
    this._colControlsEl.style.gap = "5px";
    for (let c = 1; c <= cols; c++) {
      const cell = document.createElement("div");
      cell.className = "dv2-col-ctrl-cell";
      // + at left boundary (in the gap to the left of this column)
      cell.appendChild(this._makeGridCtrlBtn("insert", "col", c));
      // × centred in this column
      cell.appendChild(this._makeGridCtrlBtn("delete", "col", c));
      // Last column: trailing + at right boundary
      if (c === cols) {
        const t = this._makeGridCtrlBtn("insert", "col", c + 1);
        t.classList.add("dv2-gridctrl-trailing");
        cell.appendChild(t);
      }
      this._colControlsEl.appendChild(cell);
    }

    // Row controls — same CSS Grid template as the main grid
    this._rowControlsEl.innerHTML = "";
    this._rowControlsEl.style.gridTemplateRows = rowTemplate;
    this._rowControlsEl.style.gap = "5px";
    for (let r = 1; r <= rows; r++) {
      const cell = document.createElement("div");
      cell.className = "dv2-row-ctrl-cell";
      // + at top boundary
      cell.appendChild(this._makeGridCtrlBtn("insert", "row", r));
      // × centred in this row
      cell.appendChild(this._makeGridCtrlBtn("delete", "row", r));
      // Last row: trailing + at bottom boundary
      if (r === rows) {
        const t = this._makeGridCtrlBtn("insert", "row", r + 1);
        t.classList.add("dv2-gridctrl-trailing");
        cell.appendChild(t);
      }
      this._rowControlsEl.appendChild(cell);
    }
  }

  _makeGridCtrlBtn(action, axis, index) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `dv2-gridctrl-${action} dv2-gridctrl-${action}-${axis}`;
    btn.textContent = action === "insert" ? "+" : "×";
    btn.title = action === "insert"
      ? `Insert ${axis} here`
      : `Delete ${axis} ${index}`;
    btn.addEventListener("click", () => {
      if (action === "insert") { if (axis === "col") this._insertCol(index); else this._insertRow(index); }
      else                     { if (axis === "col") this._deleteCol(index); else this._deleteRow(index); }
    });
    return btn;
  }

  _insertCol(before) {
    this._pushHistory();
    this.layout.grid.cols = Math.min(48, this.layout.grid.cols + 1);
    for (const z of this.layout.zones) {
      const p = z.grid_position;
      if (p.col >= before) {
        p.col++;
      } else if (p.col < before && p.col + (p.col_span || 1) > before) {
        p.col_span = (p.col_span || 1) + 1;
      }
    }
    this._renderAll();
  }

  _deleteCol(col) {
    if (this.layout.grid.cols <= 1) return;
    this._pushHistory();
    this.layout.zones = this.layout.zones.filter((z) => {
      const p = z.grid_position;
      const cs = p.col_span || 1;
      if (p.col <= col && p.col + cs - 1 >= col) {
        p.col_span = cs - 1;
        if (p.col_span < 1) return false;
      }
      if (p.col > col) p.col--;
      return true;
    });
    this.layout.grid.cols--;
    this._renderAll();
  }

  _insertRow(before) {
    this._pushHistory();
    this.layout.grid.rows = Math.min(20, this.layout.grid.rows + 1);
    for (const z of this.layout.zones) {
      const p = z.grid_position;
      if (p.row >= before) {
        p.row++;
      } else if (p.row < before && p.row + (p.row_span || 1) > before) {
        p.row_span = (p.row_span || 1) + 1;
      }
    }
    this._renderAll();
  }

  _deleteRow(row) {
    if (this.layout.grid.rows <= 1) return;
    this._pushHistory();
    this.layout.zones = this.layout.zones.filter((z) => {
      const p = z.grid_position;
      const rs = p.row_span || 1;
      if (p.row <= row && p.row + rs - 1 >= row) {
        p.row_span = rs - 1;
        if (p.row_span < 1) return false;
      }
      if (p.row > row) p.row--;
      return true;
    });
    this.layout.grid.rows--;
    this._renderAll();
  }

  // -------------------------------------------------------------------------
  // Edit modal (shared; _activeModalEditor tracks which editor opened it)
  // -------------------------------------------------------------------------

  async _openEditModal(zone) {
    _activeModalEditor = this;
    this._modalZone = zone;

    document.getElementById("dv2-modal-label").value   = zone.label || "";
    document.getElementById("dv2-modal-type").value    = zone.type  || "custom";
    document.getElementById("dv2-modal-colspan").value = zone.grid_position.col_span || 1;
    document.getElementById("dv2-modal-rowspan").value = zone.grid_position.row_span || 1;

    const portsList = document.getElementById("dv2-modal-ports-list");
    portsList.innerHTML = "";
    for (const p of zone.ports || []) {
      portsList.appendChild(this._portRow(p.id, p.label, p.name));
    }

    this._modalUpdatePortsSection();
    document.getElementById("dv2-zone-modal").classList.add("dv2-modal-open");
  }

  _modalUpdatePortsSection() {
    const type = document.getElementById("dv2-modal-type").value;
    document.getElementById("dv2-modal-ports-section").style.display =
      type === "port_group" ? "" : "none";
  }

  _portRow(id, label, name) {
    const row = document.createElement("div");
    row.className = "dv2-modal-port-row";
    row.dataset.portId = id;

    const nameEl = document.createElement("span");
    nameEl.style.cssText = "flex:1;font-size:0.85rem;color:#c0d4e8";
    nameEl.textContent = label;
    row.appendChild(nameEl);

    const hidId  = document.createElement("input");
    hidId.type = "hidden"; hidId.className = "port-id-val"; hidId.value = id;
    const hidLbl = document.createElement("input");
    hidLbl.type = "hidden"; hidLbl.className = "port-lbl-val"; hidLbl.value = label;
    const hidName = document.createElement("input");
    hidName.type = "hidden"; hidName.className = "port-name-val"; hidName.value = name || label;
    row.appendChild(hidId);
    row.appendChild(hidLbl);
    row.appendChild(hidName);

    const rm = document.createElement("button");
    rm.type = "button"; rm.className = "dv2-modal-port-remove"; rm.innerHTML = "×";
    rm.addEventListener("click", () => row.remove());
    row.appendChild(rm);
    return row;
  }

  // Modal event binding — called once by the sidebar-owning editor.
  // Delegates to _activeModalEditor for operations so any editor's zone can be edited.
  _bindModalEvents() {
    document.getElementById("dv2-modal-close-btn")
      ?.addEventListener("click", () => _activeModalEditor?._closeModal());
    document.getElementById("dv2-modal-cancel-btn")
      ?.addEventListener("click", () => _activeModalEditor?._closeModal());
    document.getElementById("dv2-zone-modal")
      ?.addEventListener("click", (e) => {
        if (e.target === e.currentTarget) _activeModalEditor?._closeModal();
      });
    document.getElementById("dv2-modal-type")
      ?.addEventListener("change", () => _activeModalEditor?._modalUpdatePortsSection());
    document.getElementById("dv2-modal-save-btn")
      ?.addEventListener("click", () => _activeModalEditor?._saveModal());
    document.getElementById("dv2-modal-delete-btn")
      ?.addEventListener("click", () => {
        if (_activeModalEditor?._modalZone) _activeModalEditor._deleteZone(_activeModalEditor._modalZone);
        _activeModalEditor?._closeModal();
      });
  }

  _saveModal() {
    const zone = this._modalZone;
    if (!zone) return;
    this._pushHistory();
    zone.label = document.getElementById("dv2-modal-label").value.trim();
    zone.type  = document.getElementById("dv2-modal-type").value;
    zone.grid_position.col_span = Math.max(1, parseInt(document.getElementById("dv2-modal-colspan").value, 10) || 1);
    zone.grid_position.row_span = Math.max(1, parseInt(document.getElementById("dv2-modal-rowspan").value, 10) || 1);

    const ports = [];
    document.querySelectorAll("#dv2-modal-ports-list .dv2-modal-port-row").forEach((row) => {
      const id   = row.querySelector(".port-id-val")?.value;
      const lbl  = row.querySelector(".port-lbl-val")?.value;
      const name = row.querySelector(".port-name-val")?.value;
      if (id) ports.push({ id, label: lbl || id, name: name || lbl || id });
    });
    zone.ports = zone.type === "port_group" ? ports : [];
    this._closeModal();
    this._renderAll();
  }

  _closeModal() {
    document.getElementById("dv2-zone-modal")?.classList.remove("dv2-modal-open");
    this._modalZone = null;
  }

  // -------------------------------------------------------------------------
  // Grid dimensions (scoped to this panel's wrapper)
  // -------------------------------------------------------------------------

  _bindDimInputs() {
    const ri  = this.wrapperEl.querySelector(".dv2-rows-input");
    const ci  = this.wrapperEl.querySelector(".dv2-cols-input");
    const cwi = this.wrapperEl.querySelector(".dv2-col-width-input");
    const rhi = this.wrapperEl.querySelector(".dv2-row-height-input");
    if (!ri || !ci) return;
    const apply = () => {
      const nr = Math.max(1, Math.min(20, parseInt(ri.value, 10) || 2));
      const nc = Math.max(1, Math.min(48, parseInt(ci.value, 10) || 6));
      if (nr === this.layout.grid.rows && nc === this.layout.grid.cols) return;
      this._pushHistory();
      this.layout.grid.rows = nr;
      this.layout.grid.cols = nc;
      this.layout.zones = this.layout.zones
        .map((z) => ({
          ...z,
          grid_position: {
            ...z.grid_position,
            row: Math.min(z.grid_position.row, nr),
            col: Math.min(z.grid_position.col, nc),
            row_span: Math.min(z.grid_position.row_span || 1, nr - z.grid_position.row + 1),
            col_span: Math.min(z.grid_position.col_span || 1, nc - z.grid_position.col + 1),
          },
        }))
        .filter((z) => z.grid_position.row <= nr && z.grid_position.col <= nc);
      this._renderAll();
    };
    ri.addEventListener("change", apply);
    ci.addEventListener("change", apply);
    // Size inputs persist in layout.grid so they are saved and used in view mode
    cwi?.addEventListener("change", () => {
      const v = Math.max(20, Math.min(300, parseInt(cwi.value, 10) || 80));
      cwi.value = v;
      this.layout.grid.col_min_width = v;
      this._renderAll();
    });
    rhi?.addEventListener("change", () => {
      const v = Math.max(20, Math.min(300, parseInt(rhi.value, 10) || 88));
      rhi.value = v;
      this.layout.grid.row_min_height = v;
      this._renderAll();
    });
  }

  _syncDimInputs() {
    const ri  = this.wrapperEl.querySelector(".dv2-rows-input");
    const ci  = this.wrapperEl.querySelector(".dv2-cols-input");
    const cwi = this.wrapperEl.querySelector(".dv2-col-width-input");
    const rhi = this.wrapperEl.querySelector(".dv2-row-height-input");
    if (ri)  ri.value  = this.layout.grid.rows;
    if (ci)  ci.value  = this.layout.grid.cols;
    if (cwi) cwi.value = this.layout.grid.col_min_width  ?? 80;
    if (rhi) rhi.value = this.layout.grid.row_min_height ?? 88;
  }

  // -------------------------------------------------------------------------
  // Panel label (scoped to this panel)
  // -------------------------------------------------------------------------

  _bindPanelLabelInput() {
    const input = this.panelEl.querySelector(".dv2-panel-label-input");
    if (!input) return;
    input.value = this.layout.panel_label || "";
    input.addEventListener("input", () => { this.layout.panel_label = input.value; });
  }

  // -------------------------------------------------------------------------
  // Undo / Clear (scoped to this panel's wrapper)
  // -------------------------------------------------------------------------

  _pushHistory() {
    this.history.push(this._clone(this.layout));
    if (this.history.length > 30) this.history.shift();
    this._updateUndoBtn();
  }

  _undo() {
    if (!this.history.length) return;
    this.layout = this.history.pop();
    this._apiCache = {};
    this._updateUndoBtn();
    this._renderAll();
  }

  _updateUndoBtn() {
    const btn = this.wrapperEl.querySelector(".dv2-undo-btn");
    if (btn) btn.disabled = !this.history.length;
  }

  _bindUndoClear() {
    this.wrapperEl.querySelector(".dv2-undo-btn")
      ?.addEventListener("click", () => this._undo());
    this.wrapperEl.querySelector(".dv2-clear-btn")
      ?.addEventListener("click", () => {
        if (!confirm("Remove all zones from this layout?")) return;
        this._pushHistory();
        this.layout.zones = [];
        this._renderAll();
      });
  }

  // -------------------------------------------------------------------------
  // Resize bar (sidebar ↔ panels column)
  // -------------------------------------------------------------------------

  _bindResizeBar() {
    const bar     = document.getElementById("dv2-resize-bar");
    const sidebar = document.getElementById("dv2-sidebar");
    if (!bar || !sidebar) return;

    bar.addEventListener("mousedown", (e) => {
      e.preventDefault();
      bar.classList.add("dv2-resizing");
      const startX     = e.clientX;
      const startWidth = sidebar.offsetWidth;

      const onMove = (ev) => {
        const newWidth = Math.max(140, Math.min(420, startWidth + ev.clientX - startX));
        sidebar.style.width = newWidth + "px";
      };
      const onUp = () => {
        bar.classList.remove("dv2-resizing");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup",   onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup",   onUp);
    });
  }

  _clone(obj) { return JSON.parse(JSON.stringify(obj)); }
}
