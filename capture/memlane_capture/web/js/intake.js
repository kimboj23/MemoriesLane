// Community submissions forwarded by the public sites (intake.py): their rows in the inbox, the detail page
// (triage), and the admin's Sources panel.
// Everything a submitter wrote is hostile text: it is inserted only with el() (textContent), never as HTML.
import { ago, api, atLeast, copyText, el, fmtDate, isAdmin, loadProjects, modal, mount, patch, post, projectDot, sec, t, toast,
         verdictChip } from "./core.js";
import { artifactGrid } from "./viewer.js";

const KINDS = ["memory", "case_report", "document", "link"];

function kindChip(k) { return el("span", { class: "badge" }, t("intakeKinds")[k.kind] || k.kind); }

// One community submission in the inbox list (same look as a saved link, with its source).
export function intakeRow(k) {
  const open = () => { location.hash = `#/intake/${k.id}`; };
  return el("li", { class: "item community", tabindex: "0", "data-intake": k.id, onclick: open,
                    onkeydown: (e) => { if (e.key === "Enter") open(); } },
    el("div", { class: "row" }, el("span", { class: "chip src-community" }, t("srcCommunity")), kindChip(k),
      el("span", { class: "chip" }, t("intakeStates")[k.state]), k.legacy_public ? el("span", { class: "chip" }, t("legacyPublic")) : "",
      k.project ? el("span", { class: "badge inc" }, projectDot(k.project), k.project.code) : el("span", { class: "badge" }, t("unrouted")),
      k.incident ? el("span", { class: "badge inc" }, "→ ", k.incident.slug) : "",
      el("span", { class: "spacer" }), el("span", { class: "meta" }, ago(k.received_at))),
    el("div", { class: "title" }, k.summary || t("submission")),
    el("div", { class: "snippet" }, [k.source.name, k.item_count ? `🔗 ${k.item_count}` : "", k.file_count ? `📎 ${k.file_count}` : "",
      k.has_contact ? "✉" : ""].filter(Boolean).join(" · ")));
}

export const INTAKE_STATES = ["new", "attached", "created", "published", "rejected", "all"];

// Old links (#/intake?…) land on the merged inbox, filtered to the community.
export function intakeRedirect(params) {
  const q = new URLSearchParams(params);
  q.set("source", "community");
  location.replace("#/inbox?" + q);
}

// Every payload field, as text. Nested objects (date, location, fields) are flattened to "key: value" lines.
function payloadList(payload) {
  const rows = [];
  const add = (k, v) => {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return;
    if (typeof v === "object" && !Array.isArray(v)) { for (const [k2, v2] of Object.entries(v)) add(`${k} · ${k2}`, v2); return; }
    rows.push([el("dt", {}, k), el("dd", { class: "pre" }, k === "group" ? (t("groups")[v] || v) : String(v))]);
  };
  for (const [k, v] of Object.entries(payload || {})) add(k, v);
  return el("dl", { class: "kv" }, rows);
}

function fileCards(files) {
  const ok = files.filter((f) => f.url).map((f) => ({ ...f, kind: f.kind === "pdf" ? "pdf" : f.kind, role: "primary",
    label: t("providedByContributor") }));
  const bad = files.filter((f) => !f.url);
  return [ok.length ? artifactGrid(ok, {}) : "",
    bad.map((f) => el("p", { class: "meta" }, `#${f.n} · ${f.mime || ""} · ${f.state}${f.error ? ": " + f.error : ""}`))];
}

export async function intakeDetailPage(view, id) {
  let k = await api(`/v1/intake/${id}`);
  const projects = await loadProjects();
  async function render() {
    const role = k.my_role;
    const editor = atLeast(role, "editor");
    const manager = atLeast(role, "manager");
    const open = k.state === "new";
    let incidents = [];
    if (editor && open && k.project) {
      try { incidents = (await api(`/v1/incidents?project_id=${k.project.id}&limit=300&sort=updated`)).incidents; } catch { /* none */ }
    }
    const pick = el("select", {}, el("option", { value: "" }, t("chooseIncident")),
      incidents.map((i) => el("option", { value: i.id }, `${i.slug} · ${i.description.slice(0, 80)}`)));
    const reason = el("input", { maxlength: "2000", placeholder: t("rejectReason") });
    const act = (fn) => async (e) => {
      if (e?.type === "submit") e.preventDefault();
      try { k = await fn(e); await render(); } catch (err) { toast(err.message, true); }
    };
    mount(view,
      el("p", {}, el("a", { href: "#/inbox?source=community" }, t("back"))),
      el("header", { class: "inc-head" },
        el("div", { class: "row" }, kindChip(k), el("span", { class: "chip" }, t("intakeStates")[k.state]),
          k.legacy_public ? el("span", { class: "chip" }, t("legacyPublic")) : "",
          el("span", { class: "spacer" }), el("span", { class: "meta" }, `${k.source.name} · ${fmtDate(k.received_at)}`)),
        el("h1", {}, k.summary || t("submission"))),
      el("div", { class: "inc-grid" },
        el("div", { class: "inc-main" },
          el("section", { class: "card" }, sec(t("submittedText")), payloadList(k.payload),
            Object.keys(k.consents || {}).length ? [el("h4", {}, t("consents")),
              el("p", { class: "meta" }, Object.entries(k.consents).map(([c, v]) => `${c}: ${v ? "✓" : "✗"}`).join(" · "))] : ""),
          k.files.length ? el("section", { class: "card" }, sec(t("communityFiles")),
            el("p", { class: "meta" }, t("providedByContributor")), fileCards(k.files)) : "",
          el("section", { class: "card" }, sec(t("capturedLinks")),
            k.items.length ? k.items.map((it) => el("div", { class: "material" },
              el("div", { class: "row" }, verdictChip(it.status), el("span", { class: "badge" }, it.platform)),
              el("a", { class: "title", href: `#/items/${it.id}` }, it.title || it.canonical_url))) : el("p", { class: "muted" }, t("empty")))),
        el("aside", { class: "inc-side" },
          el("section", { class: "card stack" }, sec(t("project")),
            k.project ? el("p", {}, projectDot(k.project), " ", `${k.project.code} · ${k.project.name}`) : el("p", { class: "muted" }, t("unrouted")),
            manager ? el("label", {}, t("routeTo"), el("select", { onchange: act((e) => post(`/v1/intake/${id}/route`, { project_id: e.target.value })) },
              el("option", { value: "" }, "—"),
              projects.filter((p) => !p.archived && atLeast(p.my_role, "editor") && p.id !== k.project?.id)
                .map((p) => el("option", { value: p.id }, `${p.code} · ${p.name}`)))) : ""),
          k.incident ? el("section", { class: "card" }, sec(t("incident")), el("a", { href: `#/incidents/${k.incident.id}` }, k.incident.slug),
            k.reviewed_by ? el("p", { class: "meta" }, t("reviewedBy")(k.reviewed_by, ago(k.reviewed_at))) : "",
            manager && k.state !== "published" ? el("button", { type: "button", class: "link", onclick: act(() => post(`/v1/intake/${id}/reopen`)) }, t("reopen")) : "") : "",
          k.state === "rejected" ? el("section", { class: "card" }, el("p", {}, t("intakeStates").rejected, k.reason ? ": " + k.reason : ""),
            el("p", { class: "meta" }, t("reviewedBy")(k.reviewed_by || "", ago(k.reviewed_at))),
            manager ? el("button", { type: "button", class: "link", onclick: act(() => post(`/v1/intake/${id}/reopen`)) }, t("reopen")) : "") : "",
          editor && open && k.project ? el("section", { class: "card stack" },
            el("form", { class: "stack", onsubmit: act(() => { if (!pick.value) throw new Error(t("chooseIncident")); return post(`/v1/intake/${id}/attach`, { incident_id: pick.value }); }) },
              el("label", {}, t("attachTo"), pick), el("button", { type: "submit" }, t("attach"))),
            el("button", { type: "button", class: "primary", onclick: act(async () => {
              const r = await post(`/v1/intake/${id}/create`, {});
              location.hash = `#/incidents/${r.created_incident_id}`;
              return r;
            }) }, t("createFromIt")),
            el("form", { class: "stack", onsubmit: act(() => post(`/v1/intake/${id}/reject`, { reason: reason.value })) },
              reason, el("button", { type: "submit", class: "danger" }, t("rejectIt")))) : "",

          k.kind === "memory" && editor && k.project ? el("section", { class: "card stack" }, sec(t("publication")),
            k.publication ? el("a", { href: `#/publications/${k.publication.id}` }, `${t("pubStates")[k.publication.state]} · ${k.publication.public_id} →`)
              : el("button", { type: "button", onclick: act(async () => {
                const r = await post(`/v1/intake/${id}/publication`);
                location.hash = `#/publications/${r.id}`;
                return k;
              }) }, t("publishMemory"))) : "",
          k.has_contact ? el("section", { class: "card stack" }, sec(t("contact")), el("p", { class: "meta" }, t("contactSealed")),
            manager ? el("button", { type: "button", onclick: async () => {
              if (!confirm(t("confirmContact"))) return;
              try {
                const r = await post(`/v1/intake/${id}/contact`);
                modal(t("contact"), el("div", { class: "stack" }, el("p", { class: "pre" }, r.contact), el("p", { class: "meta" }, t("contactOpened")(r.reveals))));
              } catch (err) { toast(err.message, true); }
            } }, t("openContact")) : "") : "")));
  }
  await render();
}

// ---- admin: sources -------------------------------------------------------------------------------
export async function sourcesPanel() {
  const box = el("section", { class: "card stack" });
  const keyBox = el("div");
  const showKey = (key) => mount(keyBox, el("div", { class: "notice" }, el("p", {}, t("keyShownOnce")),
    el("code", { class: "linkbox" }, key), el("button", { type: "button", onclick: () => copyText(key) }, t("copy"))));
  const projects = (await loadProjects()).filter((p) => !p.archived);
  const routingSelects = (routing = {}) => Object.fromEntries(KINDS.map((kd) => [kd, el("select", { "aria-label": t("intakeKinds")[kd] },
    el("option", { value: "" }, t("notRouted")), projects.map((p) => el("option", { value: p.id, selected: routing[kd] === p.id }, `${p.code} · ${p.name}`)))]));
  async function draw() {
    const { sources, configured } = await api("/v1/admin/sources");
    const slug = el("input", { required: true, pattern: "[a-z0-9][a-z0-9-]{1,40}", placeholder: "memorylane-map" });
    const name = el("input", { required: true, maxlength: "120" });
    const sel = routingSelects();
    const routingOf = (s) => Object.fromEntries(Object.entries(s).map(([kd, n]) => [kd, n.value || null]));
    mount(box, sec(t("sources")), configured ? "" : el("p", { class: "notice" }, t("intakeNotConfigured")), keyBox,
      sources.length ? el("div", { class: "table-wrap" }, el("table", { class: "inc-table" },
        el("thead", {}, el("tr", {}, [t("name"), t("routing"), t("submissionsCount"), ""].map((h) => el("th", {}, h)))),
        el("tbody", {}, sources.map((s) => {
          const rs = routingSelects(s.routing);
          for (const n of Object.values(rs)) n.onchange = async () => {
            try { await patch(`/v1/admin/sources/${s.id}`, { routing: routingOf(rs) }); toast(t("saved")); } catch (err) { toast(err.message, true); }
          };
          return el("tr", { class: s.disabled ? "muted" : "" },
            el("td", {}, s.name, el("div", { class: "meta" }, s.slug)),
            el("td", {}, el("dl", { class: "kv" }, KINDS.map((kd) => [el("dt", {}, t("intakeKinds")[kd]), el("dd", {}, rs[kd])]))),
            el("td", { class: "small" }, String(s.submissions), s.last_received_at ? el("div", { class: "meta" }, ago(s.last_received_at)) : ""),
            el("td", { class: "row" },
              el("button", { type: "button", class: "link", onclick: async () => {
                if (!confirm(t("confirmRotate"))) return;
                try { showKey((await post(`/v1/admin/sources/${s.id}/rotate`)).key); } catch (err) { toast(err.message, true); }
              } }, t("rotateKey")),
              el("button", { type: "button", class: "link", onclick: async () => { await patch(`/v1/admin/sources/${s.id}`, { disabled: !s.disabled }); await draw(); } },
                s.disabled ? t("enable") : t("disable"))));
        })))) : "",
      el("form", { class: "stack", onsubmit: async (e) => {
        e.preventDefault();
        try { const r = await post("/v1/admin/sources", { slug: slug.value, name: name.value, routing: routingOf(sel) }); await draw(); showKey(r.key); }
        catch (err) { toast(err.message, true); }
      } }, el("h4", {}, t("newSource")), el("div", { class: "row two" }, el("label", {}, t("slug"), slug), el("label", {}, t("name"), name)),
        el("dl", { class: "kv" }, KINDS.map((kd) => [el("dt", {}, t("intakeKinds")[kd]), el("dd", {}, sel[kd])])),
        el("button", { type: "submit" }, t("add"))));
  }
  await draw();
  return box;
}

