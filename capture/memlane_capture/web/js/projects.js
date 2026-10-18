// Projects, modelled on Atlos: a list, and a project page with tabs:
//   Overview | Access (members, roles, invite links) | Manage (settings, attributes, Internet Archive, archive)
//   | Import (bulk CSV). What each tab allows follows the project role (access.py).
import { api, atLeast, canEdit, el, loadProjects, mount, PALETTE, patch, post, sec, state, t, toast } from "./core.js";
import { publicationsPanel } from "./publish.js";
import { accessPanel } from "./people.js";

export async function projectsPage(view) {
  const projects = await loadProjects(true);
  mount(view,
    el("div", { class: "row" }, el("h1", {}, t("projects")), el("span", { class: "spacer" }),
      canEdit() ? el("a", { class: "btn primary", href: "#/projects/new" }, "+ " + t("newProject")) : ""),
    projects.length ? el("div", { class: "proj-cards" }, projects.map((p) => el("div", { class: "proj-card" + (p.archived ? " archived" : ""), style: { borderTopColor: p.color } },
      el("div", { class: "row" }, el("span", { class: "slug" }, p.code), el("strong", {}, p.name), p.archived ? el("span", { class: "chip" }, t("archived")) : "",
        el("span", { class: "spacer" }), el("span", { class: "badge" }, t("roles")[p.my_role] || "")),
      p.description ? el("p", { class: "muted" }, p.description) : "",
      el("p", { class: "meta" }, t("openIncidents")(p.open_count || 0, p.incident_count || 0)),
      el("div", { class: "row" }, el("a", { href: `#/incidents?project=${p.id}` }, t("viewIncidents")), el("span", { class: "spacer" }),
        el("a", { href: `#/projects/${p.id}` }, t("overview"))))))
      : el("p", { class: "muted center" }, t("noProjects")));
}

async function downloadCsv(p) {
  const res = await fetch(`/v1/incidents.csv?project_id=${p.id}`, { headers: { Authorization: "Bearer " + state.token } });
  if (!res.ok) { toast(res.statusText, true); return; }
  saveBlob(await res.blob(), `${p.code}-incidents.csv`);
}
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  el("a", { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Custom attribute rows (Atlos "Attributes" pane of the Manage page).
function attrEditor(attrs) {
  const rows = el("div", { class: "attr-rows" });
  const addRow = (a = { name: "", type: "select", options: [], description: "" }) => {
    const name = el("input", { value: a.name, placeholder: t("attrName"), required: true });
    const type = el("select", {}, ["text", "select", "multi_select", "date"].map((ty) => el("option", { value: ty, selected: ty === a.type }, t("types")[ty])));
    const opts = el("textarea", { rows: "3", value: (a.options || []).join("\n"), placeholder: t("attrOptions") });
    const desc = el("input", { value: a.description || "", placeholder: t("description") });
    const syncOpts = () => { opts.hidden = !["select", "multi_select"].includes(type.value); };
    type.onchange = syncOpts;
    syncOpts();
    const row = el("div", { class: "attr-row card" }, el("div", { class: "row two" }, name, type), desc, opts,
      el("button", { type: "button", class: "link danger", onclick: () => row.remove() }, t("remove")));
    row._value = () => ({ id: a.id || null, name: name.value.trim(), type: type.value, description: desc.value.trim() || null,
                          options: opts.value.split("\n").map((s) => s.trim()).filter(Boolean) });
    rows.append(row);
  };
  (attrs || []).forEach(addRow);
  return { node: el("div", {}, rows, el("button", { type: "button", class: "link", onclick: () => addRow() }, t("addAttr"))),
           value: () => [...rows.children].map((r) => r._value()).filter((a) => a.name) };
}

// The settings form, used for a new project and the Manage tab.
function settingsForm(p, isNew) {
  const name = el("input", { value: p.name, required: true });
  const code = el("input", { value: p.code, required: true, maxlength: "6", pattern: "[A-Za-z0-9]{2,6}", disabled: !isNew,
    oninput: (e) => { e.target.value = e.target.value.toUpperCase(); } });
  const desc = el("textarea", { rows: "3", value: p.description || "" });
  let color = p.color;
  const swatches = el("div", { class: "swatches" });
  const drawSwatches = () => swatches.replaceChildren(...PALETTE.map((c) => el("button", { type: "button", class: "swatch", "aria-pressed": String(c === color),
    "aria-label": c, style: { background: c }, onclick: () => { color = c; drawSwatches(); } })));
  drawSwatches();
  const tags = el("textarea", { rows: "4", value: (p.tag_options || []).join("\n"), placeholder: t("tagsOnePerLine") });
  const wayback = el("input", { type: "checkbox", checked: p.wayback_enabled, id: "wayback-toggle" });
  const attrs = attrEditor(p.attributes);
  const btn = el("button", { type: "submit", class: "primary" }, isNew ? t("create") : t("saveEdits"));
  const save = async (extra = {}) => {
    const body = { name: name.value.trim(), description: desc.value.trim() || null, color, wayback_enabled: wayback.checked,
                   tag_options: tags.value.split("\n").map((s) => s.trim()).filter(Boolean), attributes: attrs.value(), ...extra };
    if (isNew) body.code = code.value.trim();
    const saved = isNew ? await post("/v1/projects", body) : await patch(`/v1/projects/${p.id}`, body);
    await loadProjects(true);
    return saved;
  };
  const form = el("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try { const s = await save(); toast(t("saved")); if (isNew) location.hash = `#/projects/${s.id}`; }
    catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
  } },
    el("section", { class: "card stack" }, sec(t("general")),
      el("label", {}, t("name"), name), el("label", {}, t("code"), code), el("label", {}, t("description"), desc),
      el("div", {}, el("div", { class: "label" }, t("color")), swatches)),
    el("section", { class: "card stack" }, sec(t("tagVocab")), tags),
    el("section", { class: "card stack" }, sec(t("customAttrs")), attrs.node),
    el("section", { class: "card stack" }, sec(t("wayback")),
      el("label", { class: "check" }, wayback, t("waybackShare")), el("p", { class: "muted small" }, t("waybackHelp"))),
    btn);
  return { form, save };
}

// ---- bulk import (Atlos) ---------------------------------------------------------------------
function templateCsv(p) {
  const cols = ["description", "status", "sensitive", "tags", "date", "place", "lat", "lng", "precision", "urls",
                ...(p.attributes || []).map((a) => a.name)];
  const example = ["Thông báo thu hồi đất phường X", "to_do", "not_sensitive", "cưỡng chế|tái định cư", "2026-08-20",
                   "Phường Hồng Hà, Hà Nội", "21.04", "105.86", "locality", "https://example.org/thong-bao",
                   ...(p.attributes || []).map((a) => (a.options || [])[0] || "")];
  const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + [cols, example].map((r) => r.map(q).join(",")).join("\n") + "\n";
}

function importPanel(p) {
  const file = el("input", { type: "file", accept: ".csv,text/csv" });
  const text = el("textarea", { rows: "6", placeholder: "description,status,…" });
  const out = el("div");
  file.onchange = async () => { if (file.files[0]) text.value = await file.files[0].text(); };
  const run = async (commit) => {
    try {
      const r = await post(`/v1/projects/${p.id}/import`, { csv: text.value, commit });
      if (commit && r.created.length) {
        mount(out, el("p", { class: "notice" }, t("imported")(r.created.length), " ",
          el("a", { href: `#/incidents?project=${p.id}` }, t("viewIncidents"))));
        return;
      }
      const ok = !r.invalid && r.rows.length && !r.file_errors.some((e) => !e.startsWith("unknown column") && !e.startsWith("only the first"));
      mount(out,
        r.file_errors.map((e) => el("p", { class: "error" }, e)),
        el("p", {}, t("rowsValid")(r.valid, r.invalid)),
        el("div", { class: "table-wrap" }, el("table", { class: "inc-table" },
          el("thead", {}, el("tr", {}, [t("line"), t("description"), t("status"), t("place"), t("sourceMaterial"), t("errors")].map((h) => el("th", {}, h)))),
          el("tbody", {}, r.rows.map((row) => el("tr", { class: row.errors.length ? "row-error" : "" },
            el("td", { class: "num" }, String(row.line)), el("td", {}, row.values.description || ""),
            el("td", {}, row.values.status ? t("incStatus")[row.values.status] : ""), el("td", {}, row.values.place || ""),
            el("td", { class: "num" }, String(row.urls.length)), el("td", { class: "error small" }, row.errors.join("; "))))))),
        ok ? el("button", { type: "button", class: "primary", onclick: () => run(true) }, t("doImport")(r.valid))
           : el("p", { class: "muted" }, t("fixErrors")));
    } catch (e) { toast(e.message, true); }
  };
  return el("section", { class: "card stack" }, sec(t("bulkImport")), el("p", { class: "muted small" }, t("importHelp")),
    el("p", { class: "muted small" }, t("exportCsvHint")),
    el("div", { class: "row" }, el("button", { type: "button", onclick: () => saveBlob(new Blob([templateCsv(p)], { type: "text/csv" }), `${p.code}-template.csv`) }, t("downloadTemplate")),
      el("label", { class: "btn" }, t("chooseFile"), file)),
    text, el("button", { type: "button", onclick: () => run(false) }, t("preview")), out);
}

// ---- project page ---------------------------------------------------------------------------
export async function projectManagePage(view, id, params) {
  if (id === "new") {
    if (!canEdit()) { mount(view, el("p", { class: "muted" }, t("editorsOnly"))); return; }
    const { form } = settingsForm({ code: "", name: "", description: "", color: PALETTE[0], tag_options: [], attributes: [], wayback_enabled: false }, true);
    mount(view, el("a", { class: "link", href: "#/projects" }, t("back")), el("h1", {}, t("newProject")), form);
    return;
  }
  const p = await api(`/v1/projects/${id}`);
  const role = p.my_role;
  const tabs = [["overview", t("overview"), true], ["access", t("access"), atLeast(role, "viewer")],
                ["publications", t("publications"), atLeast(role, "viewer")],
                ["manage", t("manage"), atLeast(role, "manager")], ["import", t("bulkImport"), atLeast(role, "manager") && !p.archived]]
    .filter(([, , ok]) => ok);
  const tab = tabs.some(([k]) => k === params.get("tab")) ? params.get("tab") : "overview";
  let body;
  if (tab === "overview") {
    body = el("section", { class: "card stack" },
      p.description ? el("p", {}, p.description) : "",
      el("dl", { class: "kv" }, el("dt", {}, t("roleCol")), el("dd", {}, t("roles")[role]),
        el("dt", {}, t("wayback")), el("dd", {}, p.wayback_enabled ? "✓ " + t("waybackShare") : "—")),
      el("div", { class: "row" }, el("a", { class: "btn", href: `#/incidents?project=${p.id}` }, t("viewIncidents")),
        el("a", { class: "btn", href: `#/incidents?project=${p.id}&display=map` }, t("map")),
        atLeast(role, "viewer") ? el("button", { type: "button", onclick: () => downloadCsv(p) }, t("exportCsv")) : ""));
  } else if (tab === "access") {
    body = await accessPanel(p);
  } else if (tab === "publications") {
    body = await publicationsPanel(p);
  } else if (tab === "manage") {
    const { form, save } = settingsForm(p, false);
    body = el("div", {}, form, atLeast(role, "owner") ? el("section", { class: "card danger-zone" },
      el("button", { type: "button", onclick: async () => {
        try { await save({ archived: !p.archived }); toast(t("saved")); location.hash = "#/projects"; } catch (err) { toast(err.message, true); }
      } }, p.archived ? t("unarchive") : t("archive"))) : "");
  } else {
    body = importPanel(p);
  }
  mount(view,
    el("a", { class: "link", href: "#/projects" }, t("back")),
    el("div", { class: "project-bar", style: { borderColor: p.color } }, el("span", { class: "slug" }, p.code), el("strong", {}, p.name),
      p.archived ? el("span", { class: "chip" }, t("archived")) : "", el("span", { class: "spacer" }), el("span", { class: "badge" }, t("roles")[role])),
    el("nav", { class: "tabs" }, tabs.map(([k, label]) => el("a", { href: `#/projects/${p.id}?tab=${k}`, "aria-current": String(k === tab) }, label))),
    body);
}
