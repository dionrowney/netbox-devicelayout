/**
 * main.js — Entry point for Device View 2 (multi-layout edition).
 *
 * Reads context from #dv2-panels-column data attributes, then
 * dynamically creates panel elements and initialises either the
 * read-only renderer or the WYSIWYG editor for each layout.
 */

import { render } from "./renderer.js";
import { LayoutEditor } from "./editor.js";

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch (_) { return fallback; }
}

/** Ensure data is in {"layouts": [...]} format. */
function normalizeLayouts(data) {
  if (!data || typeof data !== "object") return { layouts: [] };
  if (Array.isArray(data.layouts)) return data;
  // Old single-layout format
  return { layouts: [data] };
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function createPanelEl() {
  const panel = document.createElement("div");
  panel.className = "dv2-panel";
  const label = document.createElement("div");
  label.className = "dv2-panel-label";
  panel.appendChild(label);
  const grid = document.createElement("div");
  grid.className = "dv2-grid";
  panel.appendChild(grid);
  return panel;
}

function createLayoutWrapperEl(objectType, objectPk) {
  const wrapper = document.createElement("div");
  wrapper.className = "dv2-layout-wrapper";

  // Per-panel mini-toolbar
  const tb = document.createElement("div");
  tb.className = "dv2-layout-mini-toolbar d-flex align-items-center gap-2 mb-1 flex-wrap";
  tb.innerHTML =
    `<label class="mb-0 fw-semibold small">Rows:</label>` +
    `<input type="number" class="dv2-rows-input form-control form-control-sm" style="width:70px" min="1" max="20" value="2">` +
    `<label class="mb-0 fw-semibold small">Cols:</label>` +
    `<input type="number" class="dv2-cols-input form-control form-control-sm" style="width:70px" min="1" max="48" value="6">` +
    `<button class="dv2-undo-btn btn btn-sm btn-outline-secondary" disabled>&#8630; Undo</button>` +
    `<button class="dv2-clear-btn btn btn-sm btn-outline-danger">Clear</button>` +
    `<button class="dv2-delete-layout-btn btn btn-sm btn-outline-secondary ms-auto">&#128465; Delete Layout</button>`;
  wrapper.appendChild(tb);

  // Panel with label input + grid
  const panel = document.createElement("div");
  panel.className = "dv2-panel";
  const labelInput = document.createElement("input");
  labelInput.className = "dv2-panel-label-input";
  labelInput.type = "text";
  labelInput.placeholder = "PANEL LABEL (e.g. REAR PANEL)";
  panel.appendChild(labelInput);
  const grid = document.createElement("div");
  grid.className = "dv2-grid";
  grid.dataset.objectType = objectType;
  grid.dataset.objectPk   = objectPk;
  panel.appendChild(grid);
  wrapper.appendChild(panel);

  return wrapper;
}

// ---------------------------------------------------------------------------
// View mode
// ---------------------------------------------------------------------------

function initViewMode(col, layouts, subLayouts, connections, deviceBays, highlightPort) {
  if (layouts.length === 0) {
    const msg = document.createElement("div");
    msg.className = "dv2-empty-message";
    msg.textContent = "No layout defined — click 'Edit Layout' to design the panel.";
    col.appendChild(msg);
    return;
  }

  for (const layout of layouts) {
    const panelEl = createPanelEl();
    col.appendChild(panelEl);
    const gridEl = panelEl.querySelector(".dv2-grid");
    render(panelEl, gridEl, layout, { editable: false, connections, subLayouts, deviceBays });

    if (highlightPort) {
      const portEl = gridEl.querySelector(`[data-port-name="${CSS.escape(highlightPort)}"]`);
      if (portEl) portEl.classList.add("dv2-highlight");
    }
  }
}

// ---------------------------------------------------------------------------
// Edit mode
// ---------------------------------------------------------------------------

function initEditMode(col, layouts, subLayouts, objectType, objectPk) {
  const emptyLayout = () => ({ panel_label: "", grid: { rows: 2, cols: 6 }, zones: [] });

  // Ensure at least one panel to start with
  const initialLayouts = layouts.length > 0 ? layouts : [emptyLayout()];
  const editors = [];
  let lastActiveEditor = null;

  function addEditorPanel(layout) {
    const wrapperEl = createLayoutWrapperEl(objectType, objectPk);
    col.appendChild(wrapperEl);

    const panelEl = wrapperEl.querySelector(".dv2-panel");
    const gridEl  = wrapperEl.querySelector(".dv2-grid");
    const ownsSidebar = editors.length === 0; // first editor owns the shared sidebar

    const editor = new LayoutEditor(wrapperEl, panelEl, gridEl, layout, subLayouts, ownsSidebar);
    editor.init();
    editors.push(editor);

    // Track which editor was last interacted with (for Ctrl+Z scoping)
    wrapperEl.addEventListener("pointerdown", () => { lastActiveEditor = editor; }, true);

    // Delete panel button
    wrapperEl.querySelector(".dv2-delete-layout-btn")?.addEventListener("click", () => {
      if (editors.length <= 1) {
        if (!confirm("Remove the last layout?")) return;
      }
      wrapperEl.remove();
      editors.splice(editors.indexOf(editor), 1);
    });

    lastActiveEditor = editor;
    return editor;
  }

  for (const layout of initialLayouts) {
    addEditorPanel(layout);
  }

  // Add panel button (in toolbar)
  document.getElementById("dv2-add-layout-btn")?.addEventListener("click", () => {
    addEditorPanel(emptyLayout());
    // Scroll new panel into view
    col.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Save: collect all layouts and post as multi-layout JSON
  document.getElementById("dv2-save-btn")?.addEventListener("click", () => {
    const allLayouts = { layouts: editors.map((e) => e.getLayout()) };
    document.getElementById("dv2-layout-data").value = JSON.stringify(allLayouts);
    document.getElementById("dv2-save-form").submit();
  });

  // Global Ctrl+Z: undo on the last active editor
  document.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    if (e.ctrlKey && e.key === "z") {
      e.preventDefault();
      lastActiveEditor?._undo();
    }
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  const col = document.getElementById("dv2-panels-column");
  if (!col) return;

  const rawLayouts    = safeParseJSON(col.dataset.layouts, {});
  const layoutsData   = normalizeLayouts(rawLayouts);
  const layouts       = layoutsData.layouts;
  const subLayouts    = safeParseJSON(col.dataset.subLayouts, {});
  const connections   = safeParseJSON(col.dataset.connections, {});
  const deviceBays    = safeParseJSON(col.dataset.deviceBays, {});
  const editMode      = col.dataset.edit === "true";
  const highlightPort = col.dataset.highlightPort || "";
  const objectType    = col.dataset.objectType;
  const objectPk      = col.dataset.objectPk;

  if (editMode) {
    initEditMode(col, layouts, subLayouts, objectType, objectPk);
  } else {
    initViewMode(col, layouts, subLayouts, connections, deviceBays, highlightPort);
  }
});
