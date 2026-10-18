// Incidents, modelled on Atlos: a list (cards or table), the "New incident" form, and the incident page
// (Attributes + Feed on the left; Source material, Location, Metadata on the right).
import { mount, ago, api, avatar, canReview, el, fmtDate, isSensitive, loadContributors, loadProjects, modal, patch, platformOf, poll,
  post, projectDot, sec, sensChips, SENSITIVE, state, STATUSES, statusChip, t, toast, verdictChip,
} from "./core.js";
import { artifactGrid } from "./viewer.js";

const slugEl = (inc) => el("span", { class: "slug" }, inc.slug);

// ---- list ----------------------------------------------------------------------------
export async function incidentsPage(view, params) {
  const projects = await loadProjects();
  const f = { project_id: params.get("project") || "", status: params.get("status") || "", q: params.get("q") || "",
              display: params.get("display") || "cards" };
  const go = (patchQ) => {
    const s = { ...f, ...patchQ };
    const q = new URLSearchParams();
    if (s.project_id) q.set("project", s.project_id);
    if (s.status) q.set("status", s.status);
    if (s.q) q.set("q", s.q);
    if (s.display && s.display !== "cards") q.set("display", s.display);
    location.hash = "#/incidents" + (q.toString() ? "?" + q : "");
  };
  const search = el("input", { type: "search", placeholder: t("search"), value: f.q, "aria-label": t("search"),
    onkeydown: (e) => { if (e.key === "Enter") go({ q: search.value.trim() }); } });
  const bar = el("div", { class: "toolbar" },
    el("select", { "aria-label": t("project"), onchange: (e) => go({ project_id: e.target.value }) },
      el("option", { value: "" }, t("allProjects")),
      projects.filter((p) => !p.archived || p.id === f.project_id).map((p) => el("option", { value: p.id, selected: p.id === f.project_id }, `${p.code} · ${p.name}`))),
    el("select", { "aria-label": t("status"), onchange: (e) => go({ status: e.target.value }) },
      el("option", { value: "" }, t("allStatuses")),
      STATUSES.map((s) => el("option", { value: s, selected: s === f.status }, t("incStatus")[s]))),
    search,
    el("div", { class: "seg" }, ["cards", "table"].map((d) => el("button", { type: "button", "aria-pressed": String(f.display === d),
      onclick: () => go({ display: d }) }, t(d)))));

  const q = new URLSearchParams({ limit: "200" });
  for (const k of ["project_id", "status", "q"]) if (f[k]) q.set(k, f[k]);
  const { incidents } = await api("/v1/incidents?" + q);
  const head = el("div", { class: "row" }, el("h1", {}, t("navIncidents")), el("span", { class: "spacer" }),
    el("a", { class: "btn primary", href: "#/new" + (f.project_id ? `?project=${f.project_id}` : "") }, "+ " + t("newIncident")));

  let body;
  if (!projects.length) body = el("p", { class: "muted center" }, t("noProjects"), " ", t("createProjectFirst"));
  else if (!incidents.length) body = el("p", { class: "muted center" }, t("empty"));
  else if (f.display === "table") body = incidentTable(incidents);
  else body = el("div", { class: "inc-cards" }, incidents.map(incidentCard));
  mount(view, head, bar, body);
}

function incidentCard(inc) {
  const blur = isSensitive(inc.sensitive);
  return el("a", { class: "inc-card", href: `#/incidents/${inc.id}` },
    el("div", { class: "inc-thumb" + (blur ? " blurred" : "") },
      inc.thumbnail_url ? el("img", { src: inc.thumbnail_url, alt: "", loading: "lazy" }) : el("span", { class: "muted" }, "—")),
    el("div", { class: "inc-body" },
      el("div", { class: "row" }, projectDot(inc.project), slugEl(inc), statusChip(inc.status), sensChips(inc.sensitive)),
      el("div", { class: "title" }, inc.description),
      el("div", { class: "row meta" }, t("materialCount")(inc.material_count || 0), " · ", ago(inc.updated_at),
        inc.place ? ` · ${inc.place}` : "", el("span", { class: "spacer" }), inc.assignees.map((a) => avatar(a.name))),
      inc.tags.length ? el("div", { class: "row" }, inc.tags.map((tg) => el("span", { class: "tag" }, tg))) : ""));
}

function incidentTable(list) {
  return el("div", { class: "table-wrap" }, el("table", { class: "inc-table" },
    el("thead", {}, el("tr", {}, ["ID", t("description"), t("status"), t("sensitivity"), t("tags"), t("assignees"),
      t("sourceMaterial"), t("updated")].map((h) => el("th", {}, h)))),
    el("tbody", {}, list.map((inc) => el("tr", { onclick: () => { location.hash = `#/incidents/${inc.id}`; } },
      el("td", {}, projectDot(inc.project), " ", el("a", { href: `#/incidents/${inc.id}` }, inc.slug)),
      el("td", { class: "desc" }, inc.description),
      el("td", {}, statusChip(inc.status)),
      el("td", {}, inc.sensitive.map((s) => t("sens")[s]).join(", ")),
      el("td", {}, inc.tags.join(", ")),
      el("td", {}, inc.assignees.map((a) => a.name).join(", ")),
      el("td", { class: "num" }, String(inc.material_count || 0)),
      el("td", { class: "nowrap" }, ago(inc.updated_at)))))));
}

// ---- attribute editors (shared by New incident and the Update window) -------------------------
function multiCheck(options, selected, labelOf) {
  const boxes = options.map((o) => el("label", { class: "check" },
    el("input", { type: "checkbox", value: o, checked: (selected || []).includes(o) }), labelOf(o)));
  return { node: el("div", { class: "checks" }, boxes), get value() { return boxes.map((b) => b.firstChild).filter((c) => c.checked).map((c) => c.value); } };
}

function tagInput(value, suggestions) {
  const id = "tags-" + Math.random().toString(36).slice(2);
  const input = el("input", { value: (value || []).join(", "), list: id, placeholder: t("tagsPh") });
  return { node: el("div", {}, input, el("datalist", { id }, (suggestions || []).map((s) => el("option", { value: s })))),
           get value() { return input.value.split(",").map((s) => s.trim()).filter(Boolean); } };
}

// Editor for one attribute: returns {node, value()} where value() is the PATCH body fragment.
async function editorFor(field, inc, project) {
  if (field === "description") {
    const ta = el("textarea", { rows: "3", value: inc.description || "", required: true });
    return { node: ta, value: () => ({ description: ta.value.trim() }) };
  }
  if (field === "status") {
    const sel = el("select", {}, STATUSES.map((s) => el("option", { value: s, selected: s === inc.status,
      disabled: !canReview() && ["completed", "cancelled"].includes(s) && s !== inc.status }, t("incStatus")[s])));
    return { node: el("div", {}, sel, canReview() ? "" : el("p", { class: "muted small" }, t("privilegedHint"))),
             value: () => ({ status: sel.value }) };
  }
  if (field === "sensitive") {
    const m = multiCheck(SENSITIVE, inc.sensitive || ["not_sensitive"], (s) => t("sens")[s]);
    return { node: m.node, value: () => ({ sensitive: m.value }) };
  }
  if (field === "tags") {
    const ti = tagInput(inc.tags, project?.tag_options);
    return { node: ti.node, value: () => ({ tags: ti.value }) };
  }
  if (field === "event_date") {
    const d = el("input", { type: "date", value: inc.event_date || "" });
    return { node: d, value: () => ({ event_date: d.value || null }) };
  }
  if (field === "location") {
    const place = el("input", { value: inc.place || "", placeholder: t("place") });
    const lat = el("input", { type: "number", step: "any", value: inc.lat ?? "", placeholder: t("lat") });
    const lng = el("input", { type: "number", step: "any", value: inc.lng ?? "", placeholder: t("lng") });
    const prec = el("select", {}, el("option", { value: "" }, t("none")),
      ["exact", "vicinity", "locality"].map((p) => el("option", { value: p, selected: p === inc.geo_precision }, t("prec")[p])));
    return { node: el("div", { class: "stack" }, el("label", {}, t("place"), place), el("div", { class: "row two" },
      el("label", {}, t("lat"), lat), el("label", {}, t("lng"), lng)), el("label", {}, t("precision"), prec)),
      value: () => ({ place: place.value.trim() || null, lat: lat.value === "" ? null : Number(lat.value),
                      lng: lng.value === "" ? null : Number(lng.value), geo_precision: prec.value || null }) };
  }
  if (field === "assignees") {
    const people = await loadContributors();
    const m = multiCheck(people.map((p) => p.id), (inc.assignees || []).map((a) => a.id),
      (id) => people.find((p) => p.id === id)?.name || id);
    return { node: m.node, value: () => ({ assignees: m.value }) };
  }
  if (field.startsWith("custom:")) {
    const attr = (project?.attributes || []).find((a) => a.id === field.slice(7));
    const cur = (inc.custom || {})[attr.id];
    if (attr.type === "select") {
      const sel = el("select", {}, el("option", { value: "" }, t("none")), attr.options.map((o) => el("option", { value: o, selected: o === cur }, o)));
      return { node: sel, value: () => ({ custom: { [attr.id]: sel.value || null } }) };
    }
    if (attr.type === "multi_select") {
      const m = multiCheck(attr.options, cur || [], (o) => o);
      return { node: m.node, value: () => ({ custom: { [attr.id]: m.value } }) };
    }
    if (attr.type === "date") {
      const d = el("input", { type: "date", value: cur || "" });
      return { node: d, value: () => ({ custom: { [attr.id]: d.value || null } }) };
    }
    const ta = el("textarea", { rows: "3", value: cur || "" });
    return { node: ta, value: () => ({ custom: { [attr.id]: ta.value.trim() || null } }) };
  }
  throw new Error("unknown field " + field);
}

function fieldLabel(field, project) {
  if (field.startsWith("custom:")) return (project?.attributes || []).find((a) => a.id === field.slice(7))?.name || field;
  return { description: t("description"), status: t("status"), sensitive: t("sensitivity"), tags: t("tags"),
           event_date: t("date"), location: t("location"), assignees: t("assignees"), place: t("place"),
           lat: t("lat"), lng: t("lng"), geo_precision: t("precision"), custom: t("attributes") }[field] || field;
}

// Atlos "Update" window: change one attribute, optionally explain why; posted to the feed.
async function openUpdate(field, inc, project, onDone) {
  const ed = await editorFor(field, inc, project);
  const reason = el("textarea", { rows: "2", placeholder: t("reasonPh") });
  const btn = el("button", { type: "submit", class: "primary" }, t("postUpdate"));
  const close = modal(`${t("update")}: ${fieldLabel(field, project)}`, el("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try {
      const updated = await patch(`/v1/incidents/${inc.id}`, { ...ed.value(), reason: reason.value.trim() || null });
      close(); onDone(updated);
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  } }, ed.node, reason, btn));
}

function attrValue(field, inc, project) {
  const v = (x) => (x == null || x === "" || (Array.isArray(x) && !x.length) ? el("span", { class: "muted" }, t("none")) : x);
  switch (field) {
    case "status": return statusChip(inc.status);
    case "sensitive": return el("span", {}, inc.sensitive.map((s) => t("sens")[s]).join(", "));
    case "tags": return v(inc.tags.length ? el("span", {}, inc.tags.map((tg) => el("span", { class: "tag" }, tg))) : null);
    case "event_date": return v(fmtDate(inc.event_date, false));
    case "location": return v([inc.place, inc.lat != null ? `${inc.lat}, ${inc.lng}` : null, inc.geo_precision ? t("prec")[inc.geo_precision] : null].filter(Boolean).join(" · "));
    case "assignees": return v(inc.assignees.length ? el("span", { class: "row" }, inc.assignees.map((a) => el("span", { class: "row" }, avatar(a.name), a.name))) : null);
    default: {
      const attr = (project?.attributes || []).find((a) => a.id === field.slice(7));
      const cur = (inc.custom || {})[attr?.id];
      return v(Array.isArray(cur) ? cur.join(", ") : attr?.type === "date" ? fmtDate(cur, false) : cur);
    }
  }
}

// ---- new incident ------------------------------------------------------------------------
export async function newIncidentPage(view, params) {
  const projects = (await loadProjects(true)).filter((p) => !p.archived);
  if (!projects.length) { mount(view, el("h1", {}, t("newIncident")), el("p", { class: "muted" }, t("createProjectFirst"))); return; }
  const pSel = el("select", { required: true }, projects.map((p) => el("option", { value: p.id, selected: p.id === params.get("project") }, `${p.code} · ${p.name}`)));
  const desc = el("textarea", { rows: "3", required: true, placeholder: t("description") });
  const urls = el("textarea", { rows: "3", placeholder: t("sourceUrlsPh"), value: params.get("url") || "" });
  const sens = multiCheck(SENSITIVE, ["not_sensitive"], (s) => t("sens")[s]);
  const status = el("select", {}, STATUSES.filter((s) => canReview() || !["completed", "cancelled"].includes(s))
    .map((s) => el("option", { value: s }, t("incStatus")[s])));
  const date = el("input", { type: "date" });
  const place = el("input", { placeholder: t("place") });
  const tagsBox = el("div");
  const customBox = el("div", { class: "stack" });
  let tagsIn, customEds = [];
  const renderProjectFields = async () => {
    const project = projects.find((p) => p.id === pSel.value);
    tagsIn = tagInput([], project?.tag_options);
    tagsBox.replaceChildren(tagsIn.node);
    customEds = [];
    customBox.replaceChildren();
    for (const a of project?.attributes || []) {
      const ed = await editorFor("custom:" + a.id, { custom: {} }, project);
      customEds.push(ed);
      customBox.append(el("label", {}, a.name, a.description ? el("span", { class: "muted small" }, " — " + a.description) : "", ed.node));
    }
  };
  pSel.onchange = renderProjectFields;
  await renderProjectFields();
  const btn = el("button", { type: "submit", class: "primary wide" }, t("create"));
  mount(view, el("h1", {}, t("newIncident")), el("form", { class: "card stack", onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try {
      const custom = Object.assign({}, ...customEds.map((ed) => ed.value().custom));
      const inc = await post("/v1/incidents", {
        project_id: pSel.value, description: desc.value.trim(), status: status.value, sensitive: sens.value,
        tags: tagsIn.value, event_date: date.value || null, place: place.value.trim() || null, custom,
        urls: urls.value.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      location.hash = `#/incidents/${inc.id}`;
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  } },
    el("label", {}, t("project"), pSel),
    el("label", {}, t("description"), desc),
    el("label", {}, t("sourceMaterial"), urls),
    el("fieldset", {}, el("legend", {}, t("sensitivity")), sens.node),
    el("div", { class: "row two" }, el("label", {}, t("status"), status), el("label", {}, t("date"), date)),
    el("label", {}, t("place"), place),
    el("label", {}, t("tags"), tagsBox),
    customBox, btn));
}

// ---- incident page -------------------------------------------------------------------------
function feedEntry(u, inc, project, names) {
  const who = u.by?.name || (u.kind === "capture" ? t("feedCapture") : t("system"));
  let action;
  if (u.kind === "created") action = t("feedCreated");
  else if (u.kind === "comment") action = t("feedComment");
  else if (u.kind === "material_added") action = t("feedMaterialAdded");
  else if (u.kind === "material_removed") action = t("feedMaterialRemoved");
  else if (u.kind === "capture") action = t("feedCaptureVerb");
  else action = t("feedChanged")(fieldLabel(u.field, project));

  const show = (field, val) => {
    if (val == null || (Array.isArray(val) && !val.length)) return t("none");
    if (field === "status") return t("incStatus")[val] || val;
    if (field === "sensitive") return val.map((s) => t("sens")[s] || s).join(", ");
    if (field === "assignees") return val.map((id) => names[id] || "?").join(", ");
    if (field === "geo_precision") return t("prec")[val] || val;
    if (field === "custom") return Object.entries(val).map(([k, v]) => `${(project.attributes.find((a) => a.id === k) || {}).name || k}: ${Array.isArray(v) ? v.join(", ") : v}`).join("; ");
    return Array.isArray(val) ? val.join(", ") : String(val);
  };
  const item = u.item_id ? inc.material.find((m) => m.id === u.item_id) : null;
  return el("li", { class: "feed-item" + (u.kind === "comment" ? " comment" : "") },
    u.by?.name ? avatar(u.by.name) : el("span", { class: "avatar sys" }, "⚙"),
    el("div", { class: "feed-body" },
      el("div", {}, el("strong", {}, who), " ", action, " ", el("span", { class: "meta" }, ago(u.created_at))),
      u.kind === "attribute" ? el("div", { class: "change" }, el("del", {}, show(u.field, u.old)), " → ", el("ins", {}, show(u.field, u.new))) : "",
      item ? el("div", {}, el("a", { href: `#/items/${item.id}` }, item.title || item.canonical_url),
        u.kind === "capture" && u.new?.verdict ? [" ", verdictChip(u.new.verdict)] : "") : "",
      u.body ? el("div", { class: u.kind === "comment" ? "comment-text" : "reason" }, u.body) : ""));
}

export async function incidentPage(view, id) {
  let inc = await api(`/v1/incidents/${id}`);
  const details = {};   // item id -> full item (artifacts), fetched lazily
  let lastKey = "";

  const loadDetails = async () => {
    await Promise.all(inc.material.map(async (m) => {
      if (!details[m.id] || details[m.id].status !== m.status) {
        try { details[m.id] = await api(`/v1/items/${m.id}`); } catch { /* not visible */ }
      }
    }));
  };

  async function render() {
    const project = inc.project;
    const archived = project.archived;
    const upd = (field) => archived ? "" : el("button", { type: "button", class: "link small", onclick: () => openUpdate(field, inc, project, async (u) => { inc = u; await render(); }) }, t("update"));
    const attrs = ["status", "sensitive", "tags", "event_date", "location", "assignees", ...project.attributes.map((a) => "custom:" + a.id)];
    const blur = isSensitive(inc.sensitive);

    const commentBox = el("textarea", { rows: "3", placeholder: t("commentPh") });
    const material = inc.material.map((m) => {
      const d = details[m.id];
      const cap = d?.captures?.find((c) => c.state === "done") || d?.captures?.[0];
      const prim = (cap?.artifacts || []).filter((a) => a.role === "primary");
      const ex = m.latest_capture?.extracted || {};
      return el("div", { class: "material" },
        el("div", { class: "row" }, verdictChip(m.status), el("span", { class: "badge" }, platformOf(m.canonical_url) || m.platform),
          el("span", { class: "spacer" }), el("span", { class: "meta" }, ago(m.created_at))),
        el("a", { class: "title", href: `#/items/${m.id}` }, m.title || ex.title || m.canonical_url),
        ex.restriction_notice ? el("p", { class: "notice small" }, ex.restriction_notice.slice(0, 220) + (ex.restriction_notice.length > 220 ? "…" : "")) : "",
        prim.length ? artifactGrid(prim, { blur }) : "",
        el("div", { class: "row meta" }, el("a", { href: m.url, target: "_blank", rel: "noopener noreferrer" }, t("openOriginal")),
          el("span", { class: "spacer" }), el("a", { href: `#/items/${m.id}` }, t("view") + " →")));
    });

    mount(view, 
      el("div", { class: "project-bar", style: { borderColor: project.color } },
        projectDot(project), el("a", { href: `#/incidents?project=${project.id}` }, `${project.code} · ${project.name}`),
        archived ? el("span", { class: "chip" }, t("archived")) : ""),
      el("header", { class: "inc-head" },
        el("div", { class: "row" }, statusChip(inc.status, archived ? null : () => openUpdate("status", inc, project, async (u) => { inc = u; await render(); })),
          sensChips(inc.sensitive)),
        el("h1", {}, slugEl(inc), " ",
          el(archived ? "span" : "button", { type: "button", class: "desc-btn", onclick: archived ? null : () => openUpdate("description", inc, project, async (u) => { inc = u; await render(); }) }, inc.description))),
      el("div", { class: "inc-grid" },
        el("div", { class: "inc-main" },
          el("section", { class: "card" }, sec(t("attributes")),
            el("dl", { class: "attrs" }, attrs.map((f) => [el("dt", {}, fieldLabel(f, project)),
              el("dd", {}, attrValue(f, inc, project), upd(f))]))),
          el("section", { class: "card" }, sec(t("feed")),
            el("ul", { class: "feed" }, inc.feed.map((u) => feedEntry(u, inc, project, inc.names || {}))),
            archived ? "" : el("form", { class: "stack", onsubmit: async (e) => {
              e.preventDefault();
              if (!commentBox.value.trim()) return;
              try { await post(`/v1/incidents/${id}/comments`, { body: commentBox.value }); await reload(true); }
              catch (err) { toast(err.message, true); }
            } }, commentBox, el("button", { type: "submit" }, t("comment"))))),
        el("aside", { class: "inc-side" },
          el("section", { class: "card" }, sec(t("sourceMaterial"),
            archived ? "" : el("button", { type: "button", class: "link", onclick: () => addMaterial(id, reload) }, t("addMaterial"))),
            material.length ? material : el("p", { class: "muted" }, t("empty"))),
          el("section", { class: "card" }, sec(t("location")),
            el("p", {}, inc.place || el("span", { class: "muted" }, t("none"))),
            inc.lat != null ? el("p", { class: "meta" }, `${inc.lat}, ${inc.lng}`, inc.geo_precision ? ` · ${t("prec")[inc.geo_precision]}` : "", " ",
              el("a", { href: `https://www.openstreetmap.org/?mlat=${inc.lat}&mlon=${inc.lng}#map=17/${inc.lat}/${inc.lng}`, target: "_blank", rel: "noopener noreferrer" }, t("openMap"))) : ""),
          el("section", { class: "card" }, sec(t("metadata")),
            el("dl", { class: "kv" }, el("dt", {}, t("createdBy")), el("dd", {}, inc.created_by?.name || t("none")),
              el("dt", {}, t("created")), el("dd", {}, fmtDate(inc.created_at)),
              el("dt", {}, t("updated")), el("dd", {}, fmtDate(inc.updated_at)))))));
    lastKey = key();
  }
  const key = () => `${inc.updated_at}|${inc.feed.length}|${inc.material.map((m) => m.status).join(",")}`;
  async function reload(force) {
    inc = await api(`/v1/incidents/${id}`);
    if (force || key() !== lastKey) { await loadDetails(); await render(); }
  }
  await loadDetails();
  await render();
  poll(() => reload(false).catch(() => {}), 5000);
}

function addMaterial(incidentId, reload) {
  const input = el("textarea", { rows: "3", placeholder: t("sourceUrlsPh") });
  const btn = el("button", { type: "submit", class: "primary" }, t("save"));
  const close = modal(t("addMaterial").replace("+ ", ""), el("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try {
      for (const line of input.value.split("\n").map((s) => s.trim()).filter(Boolean)) {
        await post(`/v1/incidents/${incidentId}/material`, { text: line });
      }
      close(); await reload(true);
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  } }, input, btn));
}
