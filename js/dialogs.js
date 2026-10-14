// Facility Planer · Author: Geray S. Karademir

import { esc } from "./report.js";

/**
 * Sheets (forms with Abbrechen / confirm), alerts, confirmations and action menus, all built
 * on <dialog>. They replace SwiftUI's .sheet, .alert and Menu.
 */

function dialog(id) {
  let d = document.getElementById(id);
  if (!d) {
    d = document.createElement("dialog");
    d.id = id;
    document.body.append(d);
  }
  return d;
}

// Clicking the dimmed backdrop closes a dialog, like tapping outside a sheet.
function closeOnBackdrop(d, onClose) {
  d.onclick = (e) => {
    if (e.target === d) {
      d.close();
      onClose?.();
    }
  };
}

/**
 * A form sheet. html holds the fields; valid(form) enables the confirm button; update(form)
 * runs after every edit (e.g. to refresh a hint); onConfirm(form) runs after closing.
 */
export function sheet({ title, html, confirm = "Speichern", valid = () => true, update = () => {}, onConfirm }) {
  const d = dialog("sheet");
  d.className = "sheet";
  d.innerHTML = `
    <form class="sheet-form" novalidate>
      <div class="sheet-bar">
        <button type="button" class="link" data-close>Abbrechen</button>
        <h2>${esc(title)}</h2>
        <button type="submit" class="link strong" data-ok>${esc(confirm)}</button>
      </div>
      <div class="sheet-body">${html}</div>
    </form>`;
  const form = d.querySelector("form");
  const ok = form.querySelector("[data-ok]");
  const refresh = () => {
    ok.disabled = !valid(form);
    update(form);
  };
  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);
  form.querySelector("[data-close]").onclick = () => d.close();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!valid(form)) return;
    d.close();
    onConfirm(form);
  });
  closeOnBackdrop(d);
  refresh();
  d.showModal();
  form.querySelector("[autofocus]")?.focus();
}

/** Resolves true when the confirm button was pressed. */
export function confirmDialog({ title, message, confirm = "OK", destructive = false, cancel = "Abbrechen" }) {
  return new Promise((resolve) => {
    const d = dialog("alert");
    d.className = "alert";
    d.innerHTML = `
      <h2>${esc(title)}</h2>
      ${message ? `<p>${esc(message)}</p>` : ""}
      <div class="alert-buttons">
        ${cancel ? `<button type="button" class="link" data-cancel>${esc(cancel)}</button>` : ""}
        <button type="button" class="link strong ${destructive ? "danger" : ""}" data-ok>${esc(confirm)}</button>
      </div>`;
    const done = (value) => {
      d.close();
      resolve(value);
    };
    d.querySelector("[data-ok]").onclick = () => done(true);
    const c = d.querySelector("[data-cancel]");
    if (c) c.onclick = () => done(false);
    d.oncancel = () => resolve(false);
    closeOnBackdrop(d, () => resolve(false));
    d.showModal();
    d.querySelector("[data-ok]").focus();
  });
}

export function alertDialog(title, message) {
  return confirmDialog({ title, message, confirm: "OK", cancel: null });
}

/** A list of choices (like a SwiftUI Menu). Resolves the chosen value or null. */
export function actionMenu(title, options) {
  return new Promise((resolve) => {
    const d = dialog("menu");
    d.className = "menu";
    d.innerHTML = `
      ${title ? `<h2>${esc(title)}</h2>` : ""}
      ${options.map((o, i) =>
        `<button type="button" class="menu-item ${o.destructive ? "danger" : ""}" data-i="${i}">${esc(o.label)}</button>`).join("")}
      <button type="button" class="menu-item cancel" data-cancel>Abbrechen</button>`;
    const done = (value) => {
      d.close();
      resolve(value);
    };
    d.querySelectorAll("[data-i]").forEach((b) => {
      b.onclick = () => done(options[Number(b.dataset.i)].value);
    });
    d.querySelector("[data-cancel]").onclick = () => done(null);
    d.oncancel = () => resolve(null);
    closeOnBackdrop(d, () => resolve(null));
    d.showModal();
  });
}
