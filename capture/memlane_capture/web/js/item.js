// One saved link (source material): verdict, what was extracted, its capture versions, and every
// artifact viewable in the browser.
import { mount, api, el, fmtDate, patch, platformOf, poll, post, projectDot, sec, state, t, toast, verdictChip, loadVocab, suggestInput } from "./core.js";
import { incidentPicker } from "./inbox.js";
import { artifactGrid } from "./viewer.js";

export async function itemPage(view, id) {
  let item = await api(`/v1/items/${id}`);
  let versionId = null;
  let lastKey = "";

  async function render() {
    const caps = item.captures;
    const cap = caps.find((c) => c.id === versionId) || caps.find((c) => c.state === "done") || caps[0] || {};
    const ex = cap.extracted || {};
    const status = cap.state === "done" ? cap.verdict : item.status;
    const blur = !!item.sensitive;
    const arts = cap.artifacts || [];
    const primary = arts.filter((a) => a.role === "primary");
    // Screenshots first among the context files: they are the most useful at a glance.
    const order = { screenshot: 0, image: 1, video: 1, html: 2, text: 3, metadata: 4, link: 5, manifest: 6 };
    const context = arts.filter((a) => a.role !== "primary").sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));

    const kv = el("dl", { class: "kv" });
    const add = (k, v) => { if (v) kv.append(el("dt", {}, k), el("dd", {}, v)); };
    add(t("author"), ex.author);
    add(t("published"), fmtDate(ex.published_at) || ex.upload_date);
    add(t("submittedBy"), item.submitted_by?.name);
    add(t("client"), item.client);
    add("URL", item.resolved_url && item.resolved_url !== item.canonical_url ? `${item.canonical_url} → ${item.resolved_url}` : item.canonical_url);

    // A link can be source material of several incidents: list them, add another, remove one.
    const fileBtn = el("button", { type: "button", id: "file-under", disabled: true }, t("fileAnother"));
    const picker = await incidentPicker({
      placeholder: t("chooseIncident"), allowNew: true,
      onNew: (pid) => { location.hash = `#/new?project=${pid}&url=${encodeURIComponent(item.url)}`; },
      onChange: (v) => { fileBtn.disabled = !v; },
    });
    fileBtn.onclick = async () => {
      if (!picker.value) return;
      try { await post(`/v1/items/${id}/incidents`, { incident_id: picker.value }); toast(t("saved")); await reload(true); }
      catch (e) { toast(e.message, true); }
    };
    const fileRow = el("div", { class: "stack" },
      (item.incidents || []).length ? el("ul", { class: "plain", id: "item-incidents" }, item.incidents.map((x) => el("li", { class: "row" },
        projectDot({ color: x.color }), el("a", { href: `#/incidents/${x.id}` }, `${x.slug} · ${x.description}`),
        el("button", { type: "button", class: "link danger small", "aria-label": t("detach"), onclick: async () => {
          try {
            const r = await api(`/v1/items/${id}/incidents/${x.id}`, { method: "DELETE" });
            if (!r.item) { location.hash = `#/incidents/${x.id}`; return; }   // no longer visible to you
            await reload(true);
          } catch (e) { toast(e.message, true); }
        } }, t("detach"))))) : el("p", { class: "muted" }, t("unfiledHint")),
      el("div", { class: "row" }, picker.node, fileBtn));

    const versions = caps.length > 1 ? el("div", { class: "row versions" }, el("span", { class: "meta" }, t("versions") + ":"),
      caps.map((c, i) => el("button", { type: "button", "aria-pressed": String(c.id === cap.id),
        onclick: () => { versionId = c.id; render(); } },
        `v${caps.length - i} · ${c.state === "done" ? t("status_")[c.verdict] : t("status_").capturing} · ${fmtDate(c.created_at)}`))) : "";

    const note = el("textarea", { rows: "2", value: item.note || "" });
    const tagsIn = suggestInput({ value: item.tags || [], multi: true, suggestions: (await loadVocab()).my_item_tags });
    const tags = tagsIn.input;

    mount(view, 
      el("a", { class: "link", href: item.incidents?.length === 1 ? `#/incidents/${item.incidents[0].id}` : "#/inbox" }, t("back")),
      el("div", { class: "card" },
        el("div", { class: "row" }, verdictChip(status), el("span", { class: "badge" }, platformOf(item.canonical_url) || item.platform),
          (item.incidents || []).map((x) => el("a", { class: "badge inc", href: `#/incidents/${x.id}` }, projectDot({ color: x.color }), x.slug)),
          el("span", { class: "spacer" }),
          !item.can_edit ? "" : el("button", { type: "button", id: "recapture", disabled: ["queued", "capturing"].includes(item.status),
            onclick: async () => {
              try { await post(`/v1/items/${id}/recapture`); versionId = null; await reload(true); } catch (e) { toast(e.message, true); }
            } }, t("recapture"))),
        el("h1", {}, item.title || ex.title || item.canonical_url),
        el("a", { class: "url", href: item.url, target: "_blank", rel: "noopener noreferrer" }, t("openOriginal")),
        cap.verdict_reasons?.length ? [sec(t("reasons")), el("ul", { class: "reasons" }, cap.verdict_reasons.map((r) => el("li", {}, r)))] : "",
        ex.restriction_notice ? el("div", { class: "notice" }, el("strong", {}, t("restrictionNotice")), el("p", {}, ex.restriction_notice)) : "",
        kv,
        ex.text ? [sec(t("text")), el("div", { class: "text" }, ex.text)] : "",
        versions),
      el("div", { class: "card" }, sec(t("fileUnder")), fileRow),
      waybackBlock(),
      primary.length ? [sec(t("content")), artifactGrid(primary, { blur })] : "",
      sec(t("evidence")), artifactGrid(context, { blur }),
      cap.manifest_sha256 ? el("p", { class: "hash" }, `${t("manifest")}: ${cap.manifest_sha256}`) : "",
      el("form", { class: "card", onsubmit: async (e) => {
        e.preventDefault();
        try {
          await patch(`/v1/items/${id}`, { note: note.value.trim() || null,
                                          tags: tags.value.split(",").map((s) => s.trim()).filter(Boolean) });
          toast(t("saved"));
        } catch (err) { toast(err.message, true); }
      } }, sec(t("details")), el("label", {}, t("noteLabel"), note), el("label", {}, t("tagsLabel"), tagsIn.node),
         el("button", { type: "submit" }, t("saveEdits"))));
    lastKey = key();
  }
  // Internet Archive: an independent public copy, submitted after the capture (external.py).
  function waybackBlock() {
    const w = item.wayback;
    const busy = w && ["queued", "running"].includes(w.state);
    return el("div", { class: "card", id: "wayback" }, sec(t("wayback")),
      w ? el("div", { class: "row" }, el("span", { class: `chip wb-${w.state}` }, t("waybackState")[w.state] || w.state),
            w.url ? el("a", { href: w.url, target: "_blank", rel: "noopener noreferrer" }, t("waybackOpen")) : "",
            w.error ? el("span", { class: "muted small" }, w.error) : "")
        : el("p", { class: "muted" }, t("waybackNone")),
      item.can_edit && !busy ? el("button", { type: "button", id: "send-wayback", onclick: async () => {
        // Public and permanent: always ask first.
        if (!confirm(t("confirmWayback"))) return;
        try { item.wayback = await post(`/v1/items/${id}/wayback`); await render(); } catch (e) { toast(e.message, true); }
      } }, t("sendWayback")) : "");
  }
  const key = () => `${item.status}|${item.captures.length}|${item.captures[0]?.state}|${(item.incidents || []).map((x) => x.id).join(",")}|${item.wayback?.state}`;
  async function reload(force) {
    item = await api(`/v1/items/${id}`);
    if (force || key() !== lastKey) await render();
  }
  await render();
  poll(() => {
    if (["queued", "capturing"].includes(item.status) || ["queued", "running"].includes(item.wayback?.state)) reload(false).catch(() => {});
  }, 4000);
}
