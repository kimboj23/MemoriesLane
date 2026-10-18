// The save sheet (same one the share button / extension will open), the project→incident picker,
// and the inbox: everything you saved, filed or not.
import { mount, ago, api, atLeast, el, loadProjects, platformOf, poll, post, projectDot, state, t, toast, verdictChip, VERDICTS,
} from "./core.js";

// Project → incident dropdowns. Calls onChange(incidentId|null). `allowNew` adds "+ create incident".
export async function incidentPicker({ value = null, projectId = null, allowNew = false, onNew = null, onChange = () => {} } = {}) {
  const projects = (await loadProjects()).filter((p) => !p.archived && atLeast(p.my_role, "editor"));
  const pSel = el("select", { "aria-label": t("project") },
    el("option", { value: "" }, t("chooseProject")),
    projects.map((p) => el("option", { value: p.id, selected: p.id === projectId }, `${p.code} · ${p.name}`)));
  const iSel = el("select", { "aria-label": t("incident"), disabled: true });
  const fill = async (keep) => {
    const pid = pSel.value;
    iSel.replaceChildren(el("option", { value: "" }, t("noIncident")));
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
  const tags = el("input", { placeholder: t("tagsPh") });
  const sens = el("input", { type: "checkbox" });
  const more = el("div", { hidden: true }, note, tags, el("label", { class: "check" }, sens, t("sensitiveItem")));
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
    el("div", { class: "row" }, verdictChip(it.status), el("span", { class: "badge" }, platformOf(it.canonical_url) || it.platform),
      (it.incidents || []).map((x) => el("span", { class: "badge inc" }, projectDot({ color: x.color }), x.slug)),
      el("span", { class: "spacer" }), el("span", { class: "meta" }, ago(it.created_at))),
    el("div", { class: "title" }, it.title || ex.title || it.canonical_url),
    el("div", { class: "snippet" }, ex.text || ex.author || it.canonical_url));
}

export async function inboxPage(view, params) {
  const filter = { status: params.get("status") || "", unfiled: params.get("unfiled") === "1", all: params.get("all") === "1" };
  const list = el("ul", { class: "items", id: "items" });
  const empty = el("p", { class: "muted center", hidden: true }, t("empty"));
  const go = (patch) => {
    const q = new URLSearchParams({ ...(filter.status && { status: filter.status }), ...(filter.unfiled && { unfiled: "1" }),
                                    ...(filter.all && { all: "1" }), ...patch });
    for (const [k, v] of [...q]) if (!v || v === "0") q.delete(k);
    location.hash = "#/inbox" + (q.toString() ? "?" + q : "");
  };
  const chips = el("div", { class: "row filters" },
    ["", ...VERDICTS].map((v) => el("button", { type: "button", "aria-pressed": String(filter.status === v), onclick: () => go({ status: v }) },
      v ? t("status_")[v] : t("all"))),
    el("button", { type: "button", "aria-pressed": String(filter.unfiled), onclick: () => go({ unfiled: filter.unfiled ? "" : "1" }) }, t("unfiled")),
    ["reviewer", "editor", "admin"].includes(state.me.role)
      ? el("button", { type: "button", "aria-pressed": String(filter.all), onclick: () => go({ all: filter.all ? "" : "1" }) }, t("everyone")) : "");

  async function refresh() {
    const q = new URLSearchParams({ limit: "100", mine: String(!filter.all) });
    if (filter.status) q.set("status", filter.status);
    if (filter.unfiled) q.set("unfiled", "true");
    const { items } = await api("/v1/items?" + q);
    list.replaceChildren(...items.map(itemRow));
    empty.hidden = items.length > 0;
    return items.some((i) => ["queued", "capturing"].includes(i.status));
  }
  const sheet = await saveSheet({ prefill: params.get("url") || params.get("text") || "", onSaved: refresh });
  mount(view, el("h1", {}, t("navInbox")), sheet, chips, list, empty);
  await refresh();
  poll(() => refresh().catch(() => {}), 5000);
}
