// The save sheet (same one the share button / extension will open), the project→incident picker,
// and the inbox: everything that came in, from the team (saved links) or the community (submissions from the
// public sites), filtered by source.
import { mount, ago, api, atLeast, el, isAdmin, loadProjects, loadVocab, modal, onLeave, platformOf, poll, post, projectDot, state,
         suggestInput, t, toast, verdictChip, VERDICTS } from "./core.js";
import { INTAKE_STATES, intakeRow } from "./intake.js";

// Project → incident dropdowns. Calls onChange(incidentId|null). `allowNew` adds "+ create incident".
// `placeholder` labels the empty incident choice (default: "not filed", which suits the save sheet).
export async function incidentPicker({ value = null, projectId = null, allowNew = false, onNew = null, onChange = () => {},
                                       placeholder = null } = {}) {
  const projects = (await loadProjects()).filter((p) => !p.archived && atLeast(p.my_role, "editor"));
  const pSel = el("select", { "aria-label": t("project") },
    el("option", { value: "" }, t("chooseProject")),
    projects.map((p) => el("option", { value: p.id, selected: p.id === projectId }, `${p.code} · ${p.name}`)));
  const iSel = el("select", { "aria-label": t("incident"), disabled: true });
  const fill = async (keep) => {
    const pid = pSel.value;
    iSel.replaceChildren(el("option", { value: "" }, placeholder || t("noIncident")));
    iSel.disabled = !pid;
    if (!pid) { onChange(null); return; }
    const { incidents } = await api(`/v1/incidents?project_id=${pid}&sort=number&limit=500`);
    for (const inc of incidents) iSel.append(el("option", { value: inc.id, selected: inc.id === keep }, `${inc.slug} · ${inc.description}`));
    if (allowNew) iSel.append(el("option", { value: "__new" }, t("createIncidentWith")));
    onChange(iSel.value || null);
  };
  pSel.onchange = () => fill(null);
  iSel.onchange = () => {
    if (iSel.value === "__new") { onNew?.(pSel.value); iSel.value = ""; return; }
    onChange(iSel.value || null);
  };
  if (projectId) await fill(value);
  return { node: el("div", { class: "picker" }, pSel, iSel), get value() { return iSel.value && iSel.value !== "__new" ? iSel.value : null; } };
}

// The save sheet. `prefill` is shared text/URL (from ?url= / ?text=, i.e. the share target).
export async function saveSheet({ prefill = "", projectId = null, incidentId = null, onSaved = () => {} } = {}) {
  const link = el("textarea", { rows: "2", placeholder: t("linkPlaceholder"), required: true, value: prefill, "aria-label": "link" });
  const detected = el("span", { class: "badge", hidden: !platformOf(prefill) }, platformOf(prefill) || "");
  link.addEventListener("input", () => { const p = platformOf(link.value); detected.hidden = !p; detected.textContent = p || ""; });
  const note = el("textarea", { rows: "2", placeholder: t("notePh") });
  const tagsIn = suggestInput({ multi: true, placeholder: t("tagsPh"), suggestions: (await loadVocab()).my_item_tags });
  const tags = tagsIn.input;
  const sens = el("input", { type: "checkbox" });
  const more = el("div", { hidden: true }, note, tagsIn.node, el("label", { class: "check" }, sens, t("sensitiveItem")));
  const result = el("div", { class: "result", hidden: true });
  const btn = el("button", { type: "submit", class: "primary wide" }, t("save"));
  const picker = await incidentPicker({
    projectId, value: incidentId, allowNew: true,
    onNew: (pid) => { location.hash = `#/new?project=${pid}&url=${encodeURIComponent(link.value.trim())}`; },
  });

  const show = (...n) => { result.replaceChildren(...n); result.hidden = false; };
  async function save(newVersion = false) {
    const raw = link.value.trim();
    if (!platformOf(raw)) { show(el("span", { class: "error" }, t("noLink"))); return; }
    const isUrl = /^https?:\/\/\S+$/i.test(raw);
    btn.disabled = true; btn.textContent = t("saving");
    try {
      const r = await post("/v1/inbox", {
        [isUrl ? "url" : "text"]: raw, client: "web", new_version: newVersion, note: note.value.trim() || null,
        tags: tags.value.split(",").map((s) => s.trim()).filter(Boolean), sensitive: sens.checked,
        incident_id: picker.value,
      });
      if (r.created) {
        show(el("span", {}, t("sent"), " "), el("a", { href: `#/items/${r.item.id}` }, t("view")));
        link.value = ""; note.value = ""; tags.value = ""; detected.hidden = true;
      } else if (r.new_version) {
        show(el("span", {}, t("versionQueued")));
      } else {
        const it = r.item;
        const who = it.submitted_by?.id === state.me.id ? t("you") : (it.submitted_by?.name || t("someone"));
        show(el("span", {}, t("dupBy")(who, ago(it.created_at)), " ", it.latest_capture?.verdict ? verdictChip(it.latest_capture.verdict) : ""),
          (it.incidents || []).length ? el("span", { class: "muted" }, " · ", it.incidents.map((x) => x.slug).join(", ")) : "",
          el("div", { class: "row" },
            el("a", { class: "btn", href: `#/items/${it.id}` }, t("view")),
            el("button", { type: "button", onclick: () => save(true) }, t("newVersion"))));
      }
      onSaved(r);
    } catch (e) {
      show(el("span", { class: "error" }, e.message));
    } finally {
      btn.disabled = false; btn.textContent = t("save");
    }
  }
  link.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } });
  return el("form", { class: "card save-sheet", id: "save-form", onsubmit: (e) => { e.preventDefault(); save(); } },
    link,
    el("div", { class: "row" }, detected, el("span", { class: "spacer" }),
      el("button", { type: "button", class: "link", onclick: () => { more.hidden = !more.hidden; } }, t("more"))),
    picker.node, more, btn, result);
}

export function itemRow(it) {
  const ex = it.latest_capture?.extracted || {};
  return el("li", { class: "item", tabindex: "0", "data-id": it.id,
                    onclick: () => { location.hash = `#/items/${it.id}`; },
                    onkeydown: (e) => { if (e.key === "Enter") location.hash = `#/items/${it.id}`; } },
    el("div", { class: "row" }, el("span", { class: "chip src-internal" }, t("srcInternal")), verdictChip(it.status),
      el("span", { class: "badge" }, platformOf(it.canonical_url) || it.platform),
      (it.incidents || []).map((x) => el("span", { class: "badge inc" }, projectDot({ color: x.color }), x.slug)),
      el("span", { class: "spacer" }), el("span", { class: "meta" }, ago(it.created_at))),
    el("div", { class: "title" }, it.title || ex.title || it.canonical_url),
    el("div", { class: "snippet" }, ex.text || ex.author || it.canonical_url));
}

const SOURCES = ["all", "internal", "community"];

export async function inboxPage(view, params) {
  const f = {
    source: SOURCES.includes(params.get("source")) ? params.get("source") : "all",
    todo: params.get("todo") === "1",                                  // needs action: unfiled links, new submissions
    status: params.get("status") || "", unfiled: params.get("unfiled") === "1", all: params.get("all") === "1",
    project: params.get("project") || "", state: params.get("state") || "new",
  };
  const showInternal = f.source !== "community";
  const showCommunity = f.source !== "internal";
  const go = (patch) => {
    const v = { ...f, ...patch };
    const q = new URLSearchParams();
    if (v.source !== "all") q.set("source", v.source);
    if (v.todo) q.set("todo", "1");
    if (v.source === "internal") {
      if (v.status) q.set("status", v.status);
      if (v.unfiled) q.set("unfiled", "1");
      if (v.all) q.set("all", "1");
    }
    if (v.source === "community") {
      if (v.project) q.set("project", v.project);
      if (v.state && v.state !== "new") q.set("state", v.state);
    }
    location.hash = "#/inbox" + (q.toString() ? "?" + q : "");
  };
  const reviewer = ["reviewer", "editor", "admin"].includes(state.me.role);
  const projects = (await loadProjects()).filter((p) => !p.archived && atLeast(p.my_role, "viewer"));
  let newCount = 0;
  try { newCount = Object.values((await api("/v1/intake?state=new&limit=1")).new_by_project).reduce((a, b) => a + b, 0); } catch { /* none */ }

  // The source filter: the main control of the page.
  const sourceBar = el("div", { class: "source-bar", role: "group", "aria-label": t("srcLabel") },
    el("span", { class: "label" }, t("srcLabel")),
    el("div", { class: "seg big" }, SOURCES.map((s) => el("button", { type: "button", "aria-pressed": String(f.source === s),
      "data-source": s, onclick: () => go({ source: s }) },
      t({ all: "srcAll", internal: "srcInternal", community: "srcCommunity" }[s]),
      s === "community" && newCount ? el("span", { class: "count" }, String(newCount)) : ""))),
    el("button", { type: "button", class: "todo", "aria-pressed": String(f.todo), onclick: () => go({ todo: !f.todo }) }, t("needsAction")));
  const srcHelp = el("p", { class: "meta" }, t({ all: "srcAllHelp", internal: "srcInternalHelp", community: "intakeHelp" }[f.source]));

  // Secondary filters for one source at a time.
  let secondary = "";
  if (f.source === "internal") {
    secondary = el("div", { class: "row filters" },
      ["", ...VERDICTS].map((v) => el("button", { type: "button", "aria-pressed": String(f.status === v), onclick: () => go({ status: v }) },
        v ? t("status_")[v] : t("all"))),
      f.todo ? "" : el("button", { type: "button", "aria-pressed": String(f.unfiled), onclick: () => go({ unfiled: !f.unfiled }) }, t("unfiled")),
      reviewer ? el("button", { type: "button", "aria-pressed": String(f.all), onclick: () => go({ all: !f.all }) }, t("everyone")) : "");
  } else if (f.source === "community") {
    secondary = el("div", { class: "row filters" },
      el("select", { "aria-label": t("project"), onchange: (e) => go({ project: e.target.value }) },
        el("option", { value: "" }, t("allProjects")),
        projects.map((p) => el("option", { value: p.id, selected: p.id === f.project }, `${p.code} · ${p.name}`)),
        isAdmin() ? el("option", { value: "none", selected: f.project === "none" }, t("unrouted")) : ""),
      f.todo ? "" : INTAKE_STATES.map((s) => el("button", { type: "button", "aria-pressed": String(f.state === s), onclick: () => go({ state: s }) },
        t("intakeStates")[s])));
  }

  const list = el("ul", { class: "items", id: "items" });
  const empty = el("p", { class: "muted center", hidden: true }, t("empty"));
  async function refresh() {
    const rows = [];
    let busy = false;
    if (showInternal) {
      const q = new URLSearchParams({ limit: "100", mine: String(!(f.source === "internal" && f.all)) });
      if (f.source === "internal" && f.status) q.set("status", f.status);
      if (f.todo || (f.source === "internal" && f.unfiled)) q.set("unfiled", "true");
      const { items } = await api("/v1/items?" + q);
      // Links the community sent arrive as the source's own saves; they are listed with their submission instead.
      for (const it of items.filter((i) => i.client !== "intake")) rows.push({ at: it.created_at, node: itemRow(it) });
      busy = items.some((i) => ["queued", "capturing"].includes(i.status));
    }
    if (showCommunity) {
      const q = new URLSearchParams({ limit: "100", state: f.todo || f.source !== "community" ? "new" : f.state });
      if (f.source === "community" && f.project) q.set("project_id", f.project);
      const { intake } = await api("/v1/intake?" + q);
      for (const k of intake) rows.push({ at: k.received_at, node: intakeRow(k) });
    }
    rows.sort((a, b) => new Date(b.at) - new Date(a.at));
    list.replaceChildren(...rows.map((r) => r.node));
    empty.hidden = rows.length > 0;
    return busy;
  }
  // Saving is the "+ Lưu liên kết" button in the bar (main.js); the list refreshes when something is saved.
  const onSaved = () => refresh().catch(() => {});
  window.addEventListener("mlc:saved", onSaved);
  onLeave(() => window.removeEventListener("mlc:saved", onSaved));
  mount(view, el("h1", {}, t("navInbox")), sourceBar, srcHelp, secondary, list, empty);
  await refresh();
  // A share target / bookmarklet (?url= or ?text=) opens the same save dialog, prefilled, once.
  const shared = params.get("url") || params.get("text");
  if (shared) {
    history.replaceState(null, "", location.pathname + location.hash.replace(/([?&])(url|text)=[^&]*&?/, "$1").replace(/[?&]$/, ""));
    modal(t("saveLink"), await saveSheet({ prefill: shared, onSaved }));
  }
  poll(() => refresh().catch(() => {}), 5000);
}
