// Projects, modelled on Atlos: a list, and a Manage page (general settings, suggested tags,
// custom attributes, archive). Editors configure; everyone else can browse.
import { mount, api, canEdit, el, loadProjects, PALETTE, patch, post, sec, state, t, toast } from "./core.js";

export async function projectsPage(view) {
  const projects = await loadProjects(true);
  mount(view, 
    el("div", { class: "row" }, el("h1", {}, t("projects")), el("span", { class: "spacer" }),
      canEdit() ? el("a", { class: "btn primary", href: "#/projects/new" }, "+ " + t("newProject")) : ""),
    projects.length ? el("div", { class: "proj-cards" }, projects.map((p) => el("div", { class: "proj-card" + (p.archived ? " archived" : ""), style: { borderTopColor: p.color } },
      el("div", { class: "row" }, el("span", { class: "slug" }, p.code), el("strong", {}, p.name), p.archived ? el("span", { class: "chip" }, t("archived")) : ""),
      p.description ? el("p", { class: "muted" }, p.description) : "",
      el("p", { class: "meta" }, t("openIncidents")(p.open_count || 0, p.incident_count || 0)),
      el("div", { class: "row" }, el("a", { href: `#/incidents?project=${p.id}` }, t("viewIncidents")), el("span", { class: "spacer" }),
        el("a", { href: `/v1/incidents.csv?project_id=${p.id}`, onclick: (e) => { e.preventDefault(); downloadCsv(p); } }, t("exportCsv")),
        el("a", { href: `#/projects/${p.id}` }, t("manage"))))))
      : el("p", { class: "muted center" }, t("noProjects")));
}

async function downloadCsv(p) {
  const res = await fetch(`/v1/incidents.csv?project_id=${p.id}`, { headers: { Authorization: "Bearer " + state.token } });
  if (!res.ok) { toast(res.statusText, true); return; }
  const url = URL.createObjectURL(await res.blob());
  el("a", { href: url, download: `${p.code}-incidents.csv` }).click();
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

export async function projectManagePage(view, id) {
  const isNew = id === "new";
  if (!canEdit()) { mount(view, el("p", { class: "muted" }, t("editorsOnly"))); return; }
  const p = isNew ? { code: "", name: "", description: "", color: PALETTE[0], tag_options: [], attributes: [], archived: false }
    : await api(`/v1/projects/${id}`);
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
  const attrs = attrEditor(p.attributes);
  const btn = el("button", { type: "submit", class: "primary" }, isNew ? t("create") : t("saveEdits"));

  const save = async (extra = {}) => {
    const body = { name: name.value.trim(), description: desc.value.trim() || null, color,
                   tag_options: tags.value.split("\n").map((s) => s.trim()).filter(Boolean), attributes: attrs.value(), ...extra };
    if (isNew) body.code = code.value.trim();
    const saved = isNew ? await post("/v1/projects", body) : await patch(`/v1/projects/${id}`, body);
    await loadProjects(true);
    return saved;
  };

  mount(view, 
    el("a", { class: "link", href: "#/projects" }, t("back")),
    el("h1", {}, isNew ? t("newProject") : `${p.code} · ${p.name}`),
    el("form", { class: "stack", onsubmit: async (e) => {
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
      btn),
    isNew ? "" : el("section", { class: "card danger-zone" },
      el("button", { type: "button", onclick: async () => {
        try { await save({ archived: !p.archived }); toast(t("saved")); location.hash = "#/projects"; } catch (err) { toast(err.message, true); }
      } }, p.archived ? t("unarchive") : t("archive"))));
}
