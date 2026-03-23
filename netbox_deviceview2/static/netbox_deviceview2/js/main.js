/**
 * main.js — Entry point for Device View 2.
 *
 * Reads data attributes from #dv2-grid and initialises
 * the read-only renderer or the full WYSIWYG editor.
 */

import { render } from "./renderer.js";
import { LayoutEditor } from "./editor.js";

function safeParseJSON(str, fallback) {
  try {
    return JSON.parse(str);
  } catch (_) {
    return fallback;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const gridEl = document.getElementById("dv2-grid");
  const panelEl = document.getElementById("dv2-panel");
  if (!gridEl || !panelEl) return;

  const layout      = safeParseJSON(gridEl.dataset.layout, {});
  const subLayouts  = safeParseJSON(gridEl.dataset.subLayouts, {});
  const connections = safeParseJSON(gridEl.dataset.connections, {});
  const editMode    = gridEl.dataset.edit === "true";

  if (editMode) {
    const editor = new LayoutEditor(panelEl, gridEl, layout, subLayouts);
    editor.init();
  } else {
    render(panelEl, gridEl, layout, {
      editable: false,
      connections,
      subLayouts,
    });
  }
});
