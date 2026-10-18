// The public version of an incident or a memory (publish.py): edit the draft, see exactly what will be
// published, collect the two approvals (a manager + a member with publication access), withdraw.
// Also the admin's feed status panel.
import { ago, api, atLeast, el, fmtDate, isAdmin, mount, patch, post, sec, t, toast, verdictChip } from "./core.js";
import { artifactGrid } from "./viewer.js";

const PLACE_KINDS = ["public_institution", "public_gathering", "private_city", "private_rural", "memory", "legacy_memory", "online"];
const LEVELS = ["exact", "street", "ward", "province", "none"];
const PUBLISHABLE = ["image", "screenshot", "video", "audio"];

const opts = (list, cur, label) => list.map((v) => el("option", { value: v, selected: v === cur }, label(v)));
const field = (label, input, help) => el("label", {}, label, input, help ? el("span", { class: "meta" }, help) : "");

export async function publicationPage(view, id) {
  let pub = await api(`/v1/publications/${id}`);
  // What can be chosen: each material's publishable artifacts, and the community files.
  const items = {};
  let communityFiles = [];
  if (pub.type === "incident") {
    const inc = await api(`/v1/incidents/${pub.incident_id}`);
    await Promise.all(inc.material.map(async (m) => { try { items[m.id] = await api(`/v1/items/${m.id}`); } catch { /* hidden */ } }));
    communityFiles = (inc.intake || []).flatMap((k) => k.files.filter((f) => f.url && ["image", "video"].includes(f.kind)));
  } else {
    const k = await api(`/v1/intake/${pub.intake_id}`);
    communityFiles = k.files.filter((f) => f.url && ["image", "video"].includes(f.kind));
  }

  async function render() {
    const d = pub.draft;
    const role = pub.my_role;
    const editor = atLeast(role, "editor") && pub.state !== "withdrawn";
    const isInc = pub.type === "incident";
    const f = {};   // form controls by draft key
    const text = (k, rows) => (f[k] = rows ? el("textarea", { rows: String(rows), value: d[k] || "", disabled: !editor })
      : el("input", { value: d[k] || "", disabled: !editor }));
    const select = (k, list, label) => (f[k] = el("select", { disabled: !editor }, opts(list, d[k], label)));
    const refresh = el("input", { type: "checkbox" });

    // materials: include?, show original link?, summary, files
    const mats = (d.materials || []).map((m) => {
      const item = items[m.item_id];
      const cap = item?.captures?.find((c) => c.state === "done");
      const arts = (cap?.artifacts || []).filter((a) => a.role === "primary" && PUBLISHABLE.includes(a.kind) && a.sha256);
      const row = { m, include: el("input", { type: "checkbox", checked: true, disabled: !editor }),
        orig: el("input", { type: "checkbox", checked: m.show_original_url !== false, disabled: !editor }),
        summary: el("input", { value: m.summary_vi || "", disabled: !editor, placeholder: t("publicSummary") }),
        files: arts.map((a) => ({ a, box: el("input", { type: "checkbox", checked: (m.files || []).includes(a.id), disabled: !editor }) })) };
      row.node = el("div", { class: "material" },
        el("div", { class: "row" }, el("label", { class: "check" }, row.include, " ", item ? verdictChip(item.status) : "", " ",
          item?.title || item?.canonical_url || m.item_id)),
        el("label", { class: "check" }, row.orig, " ", t("showOriginal"), item ? el("span", { class: "meta" }, " ", item.canonical_url) : ""),
        row.summary,
        arts.length ? el("div", { class: "pick-files" }, row.files.map(({ a, box }) => el("label", { class: "pick" }, box, artifactGrid([a], {}))))
          : el("p", { class: "meta" }, t("noPublishable")));
      return row;
    });
    const chosenCommunity = new Set(isInc ? d.community_files || [] : d.files || []);
    const cfs = communityFiles.map((cf) => ({ cf, box: el("input", { type: "checkbox", checked: chosenCommunity.has(cf.id), disabled: !editor }) }));

    const collect = () => {
      const out = {};
      for (const [k, n] of Object.entries(f)) out[k] = n.value.trim() === "" ? null : n.value.trim();
      if (out.tags !== undefined) out.tags = (out.tags || "").split(",").map((x) => x.trim()).filter(Boolean);
      if (isInc) {
        out.materials = mats.filter((r) => r.include.checked).map((r) => ({ item_id: r.m.item_id, public_id: r.m.public_id,
          show_original_url: r.orig.checked, summary_vi: r.summary.value.trim() || null, summary_en: r.m.summary_en || null,
          files: r.files.filter((x) => x.box.checked).map((x) => x.a.id) }));
        out.community_files = cfs.filter((x) => x.box.checked).map((x) => x.cf.id);
        out.refresh_location = refresh.checked;
      } else {
        out.files = cfs.filter((x) => x.box.checked).map((x) => x.cf.id);
      }
      return out;
    };
    const act = (fn) => async (e) => {
      if (e?.type === "submit") e.preventDefault();
      try { pub = await fn(); await render(); } catch (err) { toast(err.message, true); }
    };

    const form = el("form", { class: "card stack", onsubmit: act(async () => { const r = await patch(`/v1/publications/${id}`, collect()); toast(t("draftSaved")); return r; }) },
      sec(t("publication")), el("p", { class: "meta" }, t("pubHelp")),
      isInc ? [field(t("titleVi"), text("title_vi")), field(t("titleEn"), text("title_en")),
               field(t("summaryVi"), text("summary_vi", 6)), field(t("summaryEn"), text("summary_en", 4)),
               el("div", { class: "row two" }, field(t("group"), text("group")),
                 field(t("publicStatus"), select("public_status", ["reported", "being_verified", "verified"], (v) => t("pubStatus")[v]))),
               field(t("publicTags"), (f.tags = el("input", { value: (d.tags || []).join(", "), disabled: !editor })))]
        : [field(t("textVi"), text("text_vi", 6)), field(t("textEn"), text("text_en", 4)),
           field(t("category"), select("category", ["personal", "news", "community", "event"], (v) => t("cats")[v]))],
      el("div", { class: "row two" }, field(t("publicDate"), (f.date = el("input", { value: d.date || "", placeholder: "YYYY-MM-DD", disabled: !editor }))),
        field(t("datePrecision"), select("date_precision", ["day", "month", "year"], (v) => t("datePrec")[v]))),
      el("h4", {}, t("location")), el("p", { class: "meta" }, t("policyNote")),
      el("div", { class: "row two" }, field(t("placeKind"), select("place_kind", PLACE_KINDS, (v) => t("placeKinds")[v])),
        field(t("publicPrecision"), select("precision", LEVELS, (v) => t("levels")[v]))),
      field(t("precisionReason"), text("precision_reason")),
      field(t("placeLabel"), text("place_label"), t("placeLabelHelp")),
      isInc && editor ? el("label", { class: "check" }, refresh, " ", t("refreshLocation")) : "",
      field(t("credit"), text("credit")),
      isInc ? [el("h4", {}, t("materialsToShow")), mats.length ? mats.map((r) => r.node) : el("p", { class: "muted" }, t("empty"))] : "",
      cfs.length ? [el("h4", {}, t("communityFiles")), el("p", { class: "meta" }, t("providedByContributor")),
        el("div", { class: "pick-files" }, cfs.map(({ cf, box }) => el("label", { class: "pick" }, box,
          artifactGrid([{ ...cf, role: "primary", label: t("providedByContributor") }], {}))))] : "",
      editor ? el("button", { type: "submit", class: "primary" }, t("saveDraft")) : "");

    const approved = (who) => who || el("span", { class: "muted" }, t("waiting"));
    const canWithdraw = pub.state === "published" && (atLeast(role, "manager") || pub.can_publish);
    const side = el("aside", { class: "inc-side" },
      el("section", { class: "card stack" }, sec(t("approvals")(Number(!!pub.approved_by_manager) + Number(!!pub.approved_by_publisher))),
        el("p", {}, el("span", { class: "chip" }, t("pubStates")[pub.state]), " ", el("code", {}, pub.public_id),
          pub.dirty && pub.state === "published" ? el("span", { class: "chip sens" }, t("unpublishedChanges")) : ""),
        pub.published_at && pub.state === "published" ? el("p", { class: "meta" }, t("publishedV")(pub.version, fmtDate(pub.published_at))) : "",
        pub.state === "withdrawn" ? el("p", { class: "notice" }, t("withdrawnAt")(fmtDate(pub.withdrawn_at), pub.withdrawn_reason)) : "",
        el("dl", { class: "kv" }, el("dt", {}, t("roles").manager), el("dd", {}, approved(pub.approved_by_manager)),
          el("dt", {}, t("publishGrant")), el("dd", {}, approved(pub.approved_by_publisher))),
        pub.problems.length ? el("div", { class: "notice" }, el("strong", {}, t("problems")), el("ul", {}, pub.problems.map((p) => el("li", {}, p)))) : "",
        pub.state !== "withdrawn" && (pub.dirty || pub.state === "draft") && !pub.batch_id ? el("div", { class: "row" },
          atLeast(role, "manager") && !pub.approved_by_manager ? el("button", { type: "button", class: "primary", disabled: pub.problems.length > 0,
            onclick: act(() => post(`/v1/publications/${id}/approve`, { role: "manager" })) }, t("approveManager")) : "",
          pub.can_publish && !pub.approved_by_publisher ? el("button", { type: "button", class: "primary", disabled: pub.problems.length > 0,
            onclick: act(() => post(`/v1/publications/${id}/approve`, { role: "publisher" })) }, t("approvePublisher")) : "") : "",
        canWithdraw ? el("button", { type: "button", class: "danger", onclick: act(async () => {
          if (!confirm(t("confirmWithdraw"))) return pub;
          const reason = prompt(t("withdrawReason"));
          if (!reason || !reason.trim()) return pub;
          return post(`/v1/publications/${id}/withdraw`, { reason });
        }) }, t("withdrawIt")) : "",
        pub.state === "withdrawn" && atLeast(role, "editor") ? el("button", { type: "button", onclick: act(() => post(`/v1/publications/${id}/republish`)) }, t("backToDraft")) : "",
        pub.feed_url && pub.state === "published" ? el("a", { href: `${pub.feed_url}/records/${pub.public_id}.json`, target: "_blank", rel: "noopener noreferrer" }, "feed ↗") : ""),
      el("section", { class: "card" }, sec(t("previewTitle")), previewView(pub.preview)));

    mount(view,
      el("p", {}, pub.incident_id ? el("a", { href: `#/incidents/${pub.incident_id}` }, t("back")) : el("a", { href: `#/intake/${pub.intake_id}` }, t("back"))),
      el("div", { class: "inc-grid" }, el("div", { class: "inc-main" }, form), side));
  }
  await render();
}

// The public record as readers of the community sites will see it (text only).
function previewView(r) {
  const loc = r.location;
  return el("div", { class: "stack small" },
    r.title ? el("h3", {}, r.title.vi || "—") : el("p", { class: "pre" }, r.text?.vi || "—"),
    r.summary?.vi ? el("p", { class: "pre" }, r.summary.vi) : "",
    el("dl", { class: "kv" },
      el("dt", {}, t("publicDate")), el("dd", {}, r.date ? `${r.date.value} (${t("datePrec")[r.date.precision]})` : "—"),
      el("dt", {}, t("location")), el("dd", {}, !loc ? t("levels").none
        : [loc.label || "", loc.lat != null ? ` ${loc.lat}, ${loc.lng}` : "", ` · ${t("levels")[loc.precision] || loc.precision}`]),
      r.group ? [el("dt", {}, t("group")), el("dd", {}, r.group)] : "",
      r.public_status ? [el("dt", {}, t("publicStatus")), el("dd", {}, t("pubStatus")[r.public_status] || r.public_status)] : "",
      el("dt", {}, t("credit")), el("dd", {}, r.credit || "—")),
    (r.materials || []).length ? el("ul", {}, r.materials.map((m) => el("li", {}, `${m.platform} · ${m.public_status} · ${m.files.length} 📎 · `,
      m.original_url ? el("span", { class: "meta" }, m.original_url) : el("span", { class: "muted" }, "—")))) : "",
    el("details", {}, el("summary", {}, "JSON"), el("pre", { class: "json" }, JSON.stringify(r, null, 2))));
}

// ---- admin: feed status -------------------------------------------------------------------------
export async function feedPanel() {
  const box = el("section", { class: "card stack" });
  async function draw() {
    const s = await api("/v1/feed/status");
    mount(box, sec(t("feedTitle")),
      el("p", { class: s.configured ? "" : "notice" }, s.configured ? "✓ " + t("feedConfigured") : t("feedNotConfigured")),
      s.error ? el("p", { class: "error" }, s.error) : "",
      el("dl", { class: "kv" },
        el("dt", {}, t("feedUrl")), el("dd", {}, s.public_url ? el("a", { href: s.public_url + "/index.json", target: "_blank", rel: "noopener noreferrer" }, s.public_url) : "—"),
        el("dt", {}, t("feedBuilt")), el("dd", {}, s.built_at ? `${fmtDate(s.built_at)} (${ago(s.built_at)})` : "—"),
        el("dt", {}, t("feedLive")), el("dd", {}, String(s.live)),
        el("dt", {}, t("feedWithdrawn")), el("dd", {}, String(s.withdrawn)),
        el("dt", {}, "index.json sha256"), el("dd", { class: "small" }, s.index_sha256 || "—")),
      isAdmin() ? el("button", { type: "button", onclick: async () => { await post("/v1/feed/rebuild"); toast(t("saved")); setTimeout(draw, 4000); } }, t("rebuild")) : "");
  }
  await draw();
  return box;
}

// ---- project tab: public versions and legacy batches ------------------------------------------------------
export async function publicationsPanel(project) {
  const box = el("div", { class: "stack" });
  async function draw() {
    const [{ publications }, b] = await Promise.all([api(`/v1/publications?project_id=${project.id}`),
      api(`/v1/projects/${project.id}/publication-batches`)]);
    const manager = atLeast(project.my_role, "manager");
    mount(box,
      el("p", { class: "meta" }, t("pubHelp")),
      publications.filter((x) => !x.batch_id).length ? el("div", { class: "table-wrap" }, el("table", { class: "inc-table" },
        el("tbody", {}, publications.filter((x) => !x.batch_id).map((x) => el("tr", {},
          el("td", {}, el("a", { href: `#/publications/${x.id}` }, x.title || x.public_id), el("div", { class: "meta" }, `${x.public_id}${x.incident ? " · " + x.incident : ""}`)),
          el("td", {}, el("span", { class: "chip" }, t("pubStates")[x.state]), x.dirty && x.state === "published" ? el("span", { class: "chip sens" }, t("unpublishedChanges")) : ""),
          el("td", { class: "small" }, t("approvals")(x.approvals)),
          el("td", { class: "small nowrap" }, ago(x.updated_at))))))) : el("p", { class: "muted" }, t("empty")),
      el("section", { class: "card stack" }, sec(t("legacyBatch")),
        b.legacy_waiting ? el("p", {}, t("legacyWaiting")(b.legacy_waiting)) : "",
        b.legacy_waiting && atLeast(project.my_role, "editor") ? el("button", { type: "button", onclick: async () => {
          try { await post(`/v1/projects/${project.id}/publication-batches`); await draw(); } catch (e) { toast(e.message, true); } } }, t("makeBatch")) : "",
        b.batches.map((x) => el("div", { class: "row" }, el("strong", {}, x.label),
          x.published_at ? el("span", { class: "chip" }, t("batchPublished")) : [
            el("span", { class: "meta" }, `${t("roles").manager}: ${x.approved_by_manager ? "✓" : "—"} · ${t("publishGrant")}: ${x.approved_by_publisher ? "✓" : "—"}`),
            manager && !x.approved_by_manager ? el("button", { type: "button", onclick: async () => {
              try { await post(`/v1/publication-batches/${x.id}/approve`, { role: "manager" }); await draw(); } catch (e) { toast(e.message, true); } } }, t("approveManager")) : "",
            b.can_publish && !x.approved_by_publisher ? el("button", { type: "button", onclick: async () => {
              try { await post(`/v1/publication-batches/${x.id}/approve`, { role: "publisher" }); await draw(); } catch (e) { toast(e.message, true); } } }, t("approvePublisher")) : ""]))));
  }
  await draw();
  return box;
}
