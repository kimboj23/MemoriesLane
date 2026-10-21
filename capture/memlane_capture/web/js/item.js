// One saved link (source material): verdict, what was extracted, its capture versions, and every
// artifact viewable in the browser.
import { mount, api, el, fmtDate, modal, patch, platformOf, poll, post, projectDot, sec, similarBlock, state, t, toast, verdictChip, loadVocab, suggestInput,
         VERDICTS } from "./core.js";
import { incidentPicker } from "./inbox.js";
import { artifactGrid } from "./viewer.js";

// The interactive copy: the capture's WACZ in the replay viewer, on its own origin (replay.py). The fragment
// carries the signed artifact URL, so it never reaches a server log.
function replayLink(cap, replayUrl) {
  const w = (cap.artifacts || []).find((a) => a.kind === "wacz" && a.url);
  if (!w || !replayUrl) return "";
  const src = w.url.replace(/^\/v1\/artifacts\//, "");
  const page = (cap.final_url || "").startsWith("http") ? cap.final_url : "";
  return el("a", { class: "url", href: `${replayUrl}/#src=${encodeURIComponent(src)}&url=${encodeURIComponent(page)}`,
    target: "_blank", rel: "noopener noreferrer", title: t("replayTip") }, t("openReplay"));
}

export async function itemPage(view, id) {
  const replayUrl = (await api("/v1/config").catch(() => ({}))).replay_url || "";
  let item = await api(`/v1/items/${id}`);
  let versionId = null;
  let lastKey = "";

  async function render() {
    const caps = item.captures;
    const cap = caps.find((c) => c.id === versionId) || caps.find((c) => c.state === "done") || caps[0] || {};
    const ex = cap.extracted || {};
    const machine = cap.state === "done" ? cap.verdict : item.machine_status;
    // A person's correction (status and metadata) wins; the machine's result stays visible beside it.
    const corr = item.correction || {};
    const cf = corr.fields || {};
    const status = corr.status || machine;
    const mark = (v) => (v ? [v, " ", el("span", { class: "corr-mark", title: t("correctedTip")(corr.by, fmtDate(corr.at)) }, "✎")] : "");
    const blur = !!item.sensitive;
    const arts = cap.artifacts || [];
    const primary = arts.filter((a) => a.role === "primary");
    // Screenshots first among the context files: they are the most useful at a glance.
    const order = { screenshot: 0, image: 1, video: 1, html: 2, text: 3, metadata: 4, link: 5, manifest: 6 };
    const context = arts.filter((a) => a.role !== "primary").sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));

    const kv = el("dl", { class: "kv" });
    const add = (k, v) => { if (v) kv.append(el("dt", {}, k), el("dd", {}, v)); };
    add(t("author"), cf.author ? mark(cf.author) : ex.author);
    add(t("published"), cf.published_at ? mark(cf.published_at) : fmtDate(ex.published_at) || ex.upload_date);
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
          !item.can_edit ? "" : el("button", { type: "button", id: "correct", title: t("correctTip"), onclick: () => correctForm(item, ex, machine, async (next) => { item = { ...item, ...next }; await render(); }) }, t("correct")),
          !item.can_edit ? "" : el("button", { type: "button", id: "recapture", disabled: ["queued", "capturing"].includes(item.status),
            onclick: async () => {
              try { await post(`/v1/items/${id}/recapture`); versionId = null; await reload(true); } catch (e) { toast(e.message, true); }
            } }, t("recapture"))),
        corr.status ? el("p", { class: "meta" }, t("statusCorrected")(t("status_")[machine] || machine || "—", corr.by, fmtDate(corr.at)),
          corr.reason ? [" · ", el("em", {}, corr.reason)] : "") : "",
        el("h1", {}, item.title || ex.title || item.canonical_url),
        el("div", { class: "row" },
          el("a", { class: "url", href: item.url, target: "_blank", rel: "noopener noreferrer" }, t("openOriginal")),
          replayLink(cap, replayUrl)),
        item.status === "rate_limited" ? el("p", { class: "notice" },
          t("rateLimitedNote")(platformOf(item.canonical_url) || item.platform, fmtDate(item.latest_capture?.retry_at))) : "",
        cap.verdict_reasons?.length ? [sec(t("reasons")), el("ul", { class: "reasons" }, cap.verdict_reasons.map((r) => el("li", {}, r)))] : "",
        ex.restriction_notice ? el("div", { class: "notice" }, el("strong", {}, t("restrictionNotice")), el("p", {}, ex.restriction_notice)) : "",
        kv,
        cf.text || ex.text ? [sec(t("text")), el("div", { class: "text" }, cf.text || ex.text), cf.text ? el("p", { class: "meta" }, mark(t("textCorrected"))) : ""] : "",
        versions),
      el("div", { class: "card" }, sec(t("fileUnder")), fileRow),
      (item.corrections_log || []).length ? el("details", { class: "card" }, el("summary", {}, t("correctionsLog"), ` (${item.corrections_log.length})`),
        el("ul", { class: "plain" }, item.corrections_log.map((h) => el("li", {}, el("span", { class: "meta" }, `${fmtDate(h.at)} · ${h.by || "—"}: `),
          Object.entries(h.changes).map(([k, v]) => `${t("corrField")[k] || k}: ${fieldVal(k, v.old)} → ${fieldVal(k, v.new)}`).join("; "),
          h.reason ? [" · ", el("em", {}, h.reason)] : "")))) : "",
      waybackBlock(),
      primary.length ? [sec(t("content")), artifactGrid(primary, { blur })] : "",
      sec(t("evidence")), artifactGrid(context, { blur }),
      cap.manifest_sha256 ? el("p", { class: "hash" }, `${t("manifest")}: ${cap.manifest_sha256}`) : "",
      timestampsLine(cap),
      similarBlock(`item_id=${id}`),
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

// When the sealed capture provably existed: RFC 3161 timestamps of its manifest hash (upkeep.py, tsa.py).
function timestampsLine(cap) {
  const ts = cap.timestamps || [];
  if (!cap.manifest_sha256 || !ts.length) return "";
  const done = ts.filter((x) => x.state === "done");
  return el("p", { class: "meta", title: t("timestampTip") }, "⏱ ",
    done.length ? [t("timestamped"), " ", done.map((x, i) => [i ? " · " : "", fmtDate(x.time), " ",
      el("a", { href: x.url, title: t("timestampDownload") }, x.authority)])]
      : t("timestampPending"));
}

const fieldVal = (k, v) => (k === "status" ? t("status_")[v] || v : v) || "—";

// Correct what the machine got wrong. The sealed capture is never changed; this sits beside it, logged.
function correctForm(item, ex, machine, onDone) {
  const cf = item.correction?.fields || {};
  const title = el("input", { maxlength: "500", value: cf.title || "", placeholder: item.title && !cf.title ? item.title : ex.title || "" });
  const author = el("input", { maxlength: "300", value: cf.author || "", placeholder: ex.author || "" });
  const date = el("input", { type: "date", value: cf.published_at || "" });
  const text = el("textarea", { rows: "4", maxlength: "10000", placeholder: (ex.text || "").slice(0, 200) }, cf.text || "");
  const status = el("select", {},
    el("option", { value: "" }, t("statusByMachine")(t("status_")[machine] || machine || "—")),
    VERDICTS.filter((v) => !["capturing", "rate_limited"].includes(v)).map((v) =>
      el("option", { value: v, selected: item.correction?.status === v }, t("status_")[v])));
  const reason = el("textarea", { rows: "2", maxlength: "2000", placeholder: t("correctReasonPh") });
  const close = modal(t("correct"), el("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault();
    if (status.value && status.value !== (item.correction?.status || "") && !reason.value.trim()) { reason.focus(); toast(t("correctReasonNeeded"), true); return; }
    try {
      const next = await patch(`/v1/items/${item.id}/corrections`, {
        title: title.value, author: author.value, published_at: date.value, text: text.value, status: status.value, reason: reason.value });
      toast(t("saved")); close(); await onDone(next);
    } catch (err) { toast(err.message, true); }
  } },
    el("p", { class: "meta" }, t("correctHelp")),
    el("label", {}, t("corrField").status, status, el("span", { class: "meta" }, t("statusHelp"))),
    el("label", {}, t("corrField").title, title),
    el("div", { class: "row two" }, el("label", {}, t("corrField").author, author), el("label", {}, t("corrField").published_at, date)),
    el("label", {}, t("corrField").text, text),
    el("label", {}, t("correctReason"), reason),
    el("button", { type: "submit", class: "primary" }, t("save"))), { wide: true });
}
