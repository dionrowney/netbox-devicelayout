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

/** Wrap a view-mode panel with a small per-panel toolbar (Fit + Export buttons). */
function createViewPanelWrapper(panelEl, layout) {
  const wrapper = document.createElement("div");
  wrapper.className = "dv2-view-panel-wrapper";

  const ptb = document.createElement("div");
  ptb.className = "dv2-view-panel-toolbar";

  const fitBtn = document.createElement("button");
  fitBtn.className = "dv2-fit-btn btn btn-sm btn-outline-secondary";
  fitBtn.textContent = "Fit";
  fitBtn.title = "Zoom to fit window width";
  ptb.appendChild(fitBtn);

  fitBtn.addEventListener("click", () => {
    if (panelEl.dataset.fitted === "true") {
      panelEl.style.zoom = "";
      panelEl.dataset.fitted = "false";
      fitBtn.textContent = "Fit";
      fitBtn.classList.remove("active");
    } else {
      panelEl.style.zoom = "";
      const available = panelEl.clientWidth;
      const natural   = panelEl.scrollWidth;
      if (natural > available && available > 0) {
        panelEl.style.zoom = available / natural;
        panelEl.dataset.fitted = "true";
        fitBtn.textContent = "1:1";
        fitBtn.classList.add("active");
      }
    }
  });

  // Export buttons — download this panel's layout as JSON or YAML
  if (layout) {
    const slug = (layout.panel_label || "layout")
      .toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "layout";
    const data = { layouts: [layout] };

    function _download(content, filename, mime) {
      const blob = new Blob([content], { type: mime });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    }

    const exportJsonBtn = document.createElement("button");
    exportJsonBtn.className = "btn btn-sm btn-outline-secondary ms-auto";
    exportJsonBtn.textContent = "Export JSON";
    exportJsonBtn.title = "Download as JSON";
    exportJsonBtn.addEventListener("click", () =>
      _download(JSON.stringify(data, null, 2), `${slug}.json`, "application/json"));
    ptb.appendChild(exportJsonBtn);

    const exportYamlBtn = document.createElement("button");
    exportYamlBtn.className = "btn btn-sm btn-outline-secondary";
    exportYamlBtn.textContent = "Export YAML";
    exportYamlBtn.title = "Download as YAML";
    exportYamlBtn.addEventListener("click", () => {
      const yaml = window.jsyaml ? window.jsyaml.dump(data, { lineWidth: -1 }) : JSON.stringify(data, null, 2);
      _download(yaml, `${slug}.yaml`, "text/yaml");
    });
    ptb.appendChild(exportYamlBtn);
  }

  wrapper.appendChild(ptb);
  wrapper.appendChild(panelEl);
  return wrapper;
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
    `<label class="mb-0 fw-semibold small">Col&nbsp;W:</label>` +
    `<input type="number" class="dv2-col-width-input form-control form-control-sm" style="width:70px" min="20" max="300" value="80" title="Minimum column width (px)">` +
    `<label class="mb-0 fw-semibold small">Row&nbsp;H:</label>` +
    `<input type="number" class="dv2-row-height-input form-control form-control-sm" style="width:70px" min="20" max="300" value="88" title="Minimum row height (px)">` +
    `<button class="dv2-fit-btn btn btn-sm btn-outline-secondary" title="Zoom to fit window width">Fit</button>` +
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

  function viewOptsFor(layout) {
    return {
      editable: false,
      connections,
      subLayouts,
      deviceBays,
      colMinWidth:  layout.grid?.col_min_width  ?? 80,
      rowMinHeight: layout.grid?.row_min_height ?? 88,
    };
  }

  function applyHighlight(gridEl) {
    if (!highlightPort) return;
    const portEl = gridEl.querySelector(`[data-port-name="${CSS.escape(highlightPort)}"]`);
    if (portEl) portEl.classList.add("dv2-highlight");
  }

  for (const layout of layouts) {
    const panelEl = createPanelEl();
    const wrapper = createViewPanelWrapper(panelEl, layout);
    col.appendChild(wrapper);
    const gridEl = panelEl.querySelector(".dv2-grid");
    render(panelEl, gridEl, layout, viewOptsFor(layout));
    applyHighlight(gridEl);
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

    // Fit button — zoom panel to fit available width
    const fitBtn = wrapperEl.querySelector(".dv2-fit-btn");
    if (fitBtn) {
      fitBtn.addEventListener("click", () => {
        if (panelEl.dataset.fitted === "true") {
          panelEl.style.zoom = "";
          panelEl.dataset.fitted = "false";
          fitBtn.textContent = "Fit";
          fitBtn.classList.remove("active");
        } else {
          panelEl.style.zoom = "";
          const available = panelEl.clientWidth;
          const natural   = panelEl.scrollWidth;
          if (natural > available && available > 0) {
            panelEl.style.zoom = available / natural;
            panelEl.dataset.fitted = "true";
            fitBtn.textContent = "1:1";
            fitBtn.classList.add("active");
          }
        }
      });
    }

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

  // ---------------------------------------------------------------------------
  // Clone modal
  // ---------------------------------------------------------------------------

  const cloneModalEl    = document.getElementById("dv2-clone-modal");
  const cloneSourceEl   = document.getElementById("dv2-clone-source-type");
  const cloneListEl     = document.getElementById("dv2-clone-list");
  const cloneApplyBtn   = document.getElementById("dv2-clone-apply-btn");

  let _cloneSelectedId   = null;
  let _cloneSelectedType = null;

  function _openCloneModal() {
    if (!cloneModalEl) return;
    _cloneSelectedId = null;
    _cloneSelectedType = null;
    if (cloneApplyBtn) cloneApplyBtn.disabled = true;
    cloneModalEl.classList.add("dv2-modal-open");
    _fetchCloneSources(cloneSourceEl.value);
  }

  function _closeCloneModal() {
    cloneModalEl?.classList.remove("dv2-modal-open");
  }

  async function _fetchCloneSources(sourceType) {
    if (!cloneListEl) return;
    cloneListEl.innerHTML = '<div class="dv2-sidebar-loading">Loading\u2026</div>';
    _cloneSelectedId = null;
    _cloneSelectedType = null;
    if (cloneApplyBtn) cloneApplyBtn.disabled = true;

    const excludePk = (sourceType === objectType) ? objectPk : "";
    const url = `/plugins/netbox-deviceview2/clone-sources/?object_type=${sourceType}&exclude_pk=${excludePk}`;
    try {
      const resp = await fetch(url);
      const data = await resp.json();
      const sources = data.results || [];
      cloneListEl.innerHTML = "";
      if (sources.length === 0) {
        cloneListEl.innerHTML = '<div class="dv2-sidebar-empty">No layouts found.</div>';
        return;
      }
      for (const src of sources) {
        const item = document.createElement("div");
        item.className = "dv2-clone-item";
        item.textContent = src.name;
        item.dataset.id = src.id;
        item.addEventListener("click", () => {
          cloneListEl.querySelectorAll(".dv2-clone-item").forEach((el) => el.classList.remove("selected"));
          item.classList.add("selected");
          _cloneSelectedId = src.id;
          _cloneSelectedType = sourceType;
          if (cloneApplyBtn) cloneApplyBtn.disabled = false;
        });
        cloneListEl.appendChild(item);
      }
    } catch (_) {
      cloneListEl.innerHTML = '<div class="dv2-sidebar-empty">Failed to load sources.</div>';
    }
  }

  document.getElementById("dv2-clone-btn")?.addEventListener("click", _openCloneModal);
  document.getElementById("dv2-clone-close-btn")?.addEventListener("click", _closeCloneModal);
  document.getElementById("dv2-clone-cancel-btn")?.addEventListener("click", _closeCloneModal);

  cloneSourceEl?.addEventListener("change", () => {
    _cloneSelectedId = null;
    if (cloneApplyBtn) cloneApplyBtn.disabled = true;
    _fetchCloneSources(cloneSourceEl.value);
  });

  cloneApplyBtn?.addEventListener("click", async () => {
    if (!_cloneSelectedId) return;
    const url = `/plugins/netbox-deviceview2/clone-layout/?object_type=${_cloneSelectedType}&pk=${_cloneSelectedId}`;
    try {
      const resp = await fetch(url);
      const data = await resp.json();
      const srcLayouts = data.layout?.layouts || [];
      if (srcLayouts.length === 0) {
        alert("The selected source has no layouts to clone.");
        return;
      }
      for (const layout of srcLayouts) {
        addEditorPanel(layout);
      }
      col.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "start" });
      _closeCloneModal();
    } catch (_) {
      alert("Failed to fetch clone source layout.");
    }
  });

  // ---------------------------------------------------------------------------
  // Import modal
  // ---------------------------------------------------------------------------

  const importModalEl  = document.getElementById("dv2-import-modal");
  const importFileEl   = document.getElementById("dv2-import-file");
  const importTextEl   = document.getElementById("dv2-import-text");
  const importErrorEl  = document.getElementById("dv2-import-error");
  const importApplyBtn = document.getElementById("dv2-import-apply-btn");

  function _openImportModal() {
    if (!importModalEl) return;
    if (importTextEl)  importTextEl.value = "";
    if (importFileEl)  importFileEl.value = "";
    if (importErrorEl) { importErrorEl.style.display = "none"; importErrorEl.textContent = ""; }
    importModalEl.classList.add("dv2-modal-open");
  }

  function _closeImportModal() {
    importModalEl?.classList.remove("dv2-modal-open");
  }

  // When a file is selected, read it into the textarea
  importFileEl?.addEventListener("change", () => {
    const file = importFileEl.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (importTextEl) importTextEl.value = e.target.result;
      if (importErrorEl) { importErrorEl.style.display = "none"; importErrorEl.textContent = ""; }
    };
    reader.readAsText(file);
  });

  document.getElementById("dv2-import-btn")?.addEventListener("click", _openImportModal);
  document.getElementById("dv2-import-close-btn")?.addEventListener("click", _closeImportModal);
  document.getElementById("dv2-import-cancel-btn")?.addEventListener("click", _closeImportModal);

  importApplyBtn?.addEventListener("click", () => {
    const raw = importTextEl?.value?.trim();
    if (!raw) {
      if (importErrorEl) { importErrorEl.textContent = "No content provided."; importErrorEl.style.display = ""; }
      return;
    }
    let parsed;
    // Try JSON first; fall back to YAML if js-yaml is available
    try {
      parsed = JSON.parse(raw);
    } catch (_jsonErr) {
      if (window.jsyaml) {
        try {
          parsed = window.jsyaml.load(raw);
        } catch (yamlErr) {
          if (importErrorEl) { importErrorEl.textContent = `Could not parse as JSON or YAML: ${yamlErr.message}`; importErrorEl.style.display = ""; }
          return;
        }
      } else {
        if (importErrorEl) { importErrorEl.textContent = `Invalid JSON: ${_jsonErr.message}`; importErrorEl.style.display = ""; }
        return;
      }
    }
    // Normalise: accept {"layouts":[...]} or a single layout object
    const imported = normalizeLayouts(parsed);
    if (!imported.layouts.length) {
      if (importErrorEl) { importErrorEl.textContent = "No layouts found in the imported content."; importErrorEl.style.display = ""; }
      return;
    }
    for (const layout of imported.layouts) {
      addEditorPanel(layout);
    }
    col.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "start" });
    _closeImportModal();
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
