// MemoryLane capture: local test UI.
//
// A plain script, no build step. Everything captured is hostile content, so it
// is only ever inserted with textContent / as blob: media, never as HTML.
// Artifacts need the Authorization header, so they are fetched as blobs.
"use strict";

const STR = {
  vi: {
    brand: "Lưu trữ MemoryLane", logout: "Đăng xuất", connectTitle: "Kết nối", connect: "Kết nối",
    connectHelp: "Dán mã cá nhân (bắt đầu bằng mlc_) mà quản trị viên đã cấp cho bạn. Mã chỉ được lưu trên trình duyệt này.",
    badToken: "Mã không hợp lệ hoặc đã bị thu hồi.", linkLabel: "Liên kết",
    linkPlaceholder: "Dán liên kết hoặc nội dung được chia sẻ…", more: "Thêm chi tiết", casePh: "Hồ sơ (vd. case-phuc-tan)",
    tagsPh: "Chủ đề, cách nhau bằng dấu phẩy", notePh: "Ghi chú", sensitive: "Nội dung nhạy cảm (làm mờ)", save: "Lưu",
    saving: "Đang gửi…", sent: "Đã gửi vào kho lưu trữ. Kết quả sẽ hiện bên dưới.", noLink: "Không tìm thấy liên kết http(s).",
    dupBy: (who, when) => `Liên kết này đã được ${who} lưu ${when}.`, you: "bạn", someone: "người khác",
    view: "Xem", newVersion: "Lưu phiên bản mới", versionQueued: "Đã yêu cầu chụp lại.",
    showAll: "Hiện của mọi người", empty: "Chưa có liên kết nào.", back: "← Quay lại",
    all: "Tất cả", recapture: "Chụp lại", content: "Nội dung đã lưu", evidence: "Bằng chứng khác & tệp",
    reasons: "Vì sao", author: "Tác giả", published: "Ngày đăng", text: "Nội dung chữ", versions: "Các phiên bản",
    manifest: "Mã băm manifest", openOriginal: "Mở liên kết gốc ↗", download: "Tải xuống", details: "Chi tiết",
    noteLabel: "Ghi chú", caseLabel: "Hồ sơ", tagsLabel: "Chủ đề", saveEdits: "Lưu thay đổi", saved: "Đã lưu.",
    submittedBy: "Người gửi", client: "Gửi từ", wayback: "Bản sao Internet Archive ↗",
    status: { queued: "Đang chờ", capturing: "Đang lưu…", complete: "Đã lưu đầy đủ", partial: "Lưu được một phần",
              walled: "Bị chặn đăng nhập", unavailable: "Đã bị gỡ / không khả dụng", failed: "Lỗi" },
    labels: { embed: "Bản nhúng của bài", video: "Video", "post-image": "Ảnh của bài", "post-video": "Video của bài",
              image: "Ảnh", "full-page": "Toàn trang (đã bỏ hộp đăng nhập)", "as-served": "Trang như được hiển thị",
              thumbnail: "Ảnh thu nhỏ", "page-text": "Chữ trên trang", "page-html": "HTML trang",
              "embed-html": "HTML bản nhúng", "media-metadata": "Siêu dữ liệu video", "page-meta": "Siêu dữ liệu trang",
              manifest: "Manifest", wayback: "Internet Archive" },
    ago: (s) => s < 60 ? "vừa xong" : s < 3600 ? `${Math.floor(s / 60)} phút trước` : s < 86400 ? `${Math.floor(s / 3600)} giờ trước` : `${Math.floor(s / 86400)} ngày trước`,
  },
  en: {
    brand: "MemoryLane archive", logout: "Sign out", connectTitle: "Connect", connect: "Connect",
    connectHelp: "Paste the personal token (starts with mlc_) an admin gave you. It is only stored in this browser.",
    badToken: "Invalid or revoked token.", linkLabel: "Link", linkPlaceholder: "Paste a link or shared text…",
    more: "More details", casePh: "Case (e.g. case-phuc-tan)", tagsPh: "Topics, comma-separated", notePh: "Note",
    sensitive: "Sensitive content (blur)", save: "Save", saving: "Sending…",
    sent: "Sent to the archive. The result will appear below.", noLink: "No http(s) link found.",
    dupBy: (who, when) => `Already saved by ${who} ${when}.`, you: "you", someone: "someone else",
    view: "View", newVersion: "Save a new version", versionQueued: "Re-capture requested.",
    showAll: "Show everyone's", empty: "Nothing saved yet.", back: "← Back", all: "All", recapture: "Capture again",
    content: "Captured content", evidence: "Other evidence & files", reasons: "Why", author: "Author",
    published: "Published", text: "Text", versions: "Versions", manifest: "Manifest hash",
    openOriginal: "Open original ↗", download: "Download", details: "Details", noteLabel: "Note", caseLabel: "Case",
    tagsLabel: "Topics", saveEdits: "Save changes", saved: "Saved.", submittedBy: "Submitted by", client: "Sent from",
    wayback: "Internet Archive copy ↗",
    status: { queued: "Queued", capturing: "Capturing…", complete: "Fully saved", partial: "Partly saved",
              walled: "Blocked by login wall", unavailable: "Removed / unavailable", failed: "Failed" },
    labels: { embed: "Post embed", video: "Video", "post-image": "Post image", "post-video": "Post video", image: "Image",
              "full-page": "Full page (login box removed)", "as-served": "Page as served", thumbnail: "Thumbnail",
              "page-text": "Page text", "page-html": "Page HTML", "embed-html": "Embed HTML",
              "media-metadata": "Video metadata", "page-meta": "Page metadata", manifest: "Manifest", wayback: "Internet Archive" },
    ago: (s) => s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`,
  },
};
const FILTERS = ["", "capturing", "complete", "partial", "walled", "unavailable", "failed"];
const PLATFORM = [
  [/(^|\.)(facebook\.com|fb\.watch|fb\.com)$/, "Facebook"], [/threads\.(com|net)$/, "Threads"],
  [/instagram\.com$/, "Instagram"], [/tiktok\.com$/, "TikTok"], [/(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)(x|twitter)\.com$/, "X"],
];

const state = {
  lang: localGet("lang") || "vi", token: localGet("token"), me: null, filter: "", all: false,
  items: [], detail: null, version: null, blobs: [], timer: null,
};
const $ = (id) => document.getElementById(id);
const t = (k) => STR[state.lang][k];

function localGet(k) { try { return localStorage.getItem("mlc." + k); } catch { return null; } }
function localSet(k, v) { try { v == null ? localStorage.removeItem("mlc." + k) : localStorage.setItem("mlc." + k, v); } catch { /* private mode */ } }

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : String(c));
  return n;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { Authorization: "Bearer " + state.token, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (res.status === 401) { logout(); throw new Error(t("badToken")); }
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new Error((body && body.detail && JSON.stringify(body.detail)) || res.statusText);
  return body;
}

async function blobUrl(path) {
  const res = await fetch(path, { headers: { Authorization: "Bearer " + state.token } });
  if (!res.ok) throw new Error(res.statusText);
  const url = URL.createObjectURL(await res.blob());
  state.blobs.push(url);
  return url;
}

function freeBlobs() { state.blobs.forEach(URL.revokeObjectURL); state.blobs = []; }

function ago(iso) { return t("ago")(Math.max(0, (Date.now() - new Date(iso)) / 1000)); }

function platformOf(text) {
  const m = /https?:\/\/[^\s<>"']+/i.exec(text || "");
  if (!m) return null;
  try {
    const host = new URL(m[0]).hostname.toLowerCase();
    return (PLATFORM.find(([re]) => re.test(host)) || [null, "Web"])[1];
  } catch { return null; }
}

function chip(status) { return el("span", { class: `chip s-${status}` }, t("status")[status] || status); }

function applyI18n() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = t(n.dataset.i18n); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((n) => { n.placeholder = t(n.dataset.i18nPlaceholder); });
  $("lang").textContent = state.lang === "vi" ? "EN" : "VI";
  document.title = t("brand");
  renderFilters();
  renderList();
  if (state.detail) renderDetail();
}

// ---- connect --------------------------------------------------------------
async function connect(token) {
  state.token = token;
  try {
    state.me = await api("/v1/me");
  } catch (e) {
    state.token = null;
    throw e;
  }
  localSet("token", token);
  $("who").textContent = state.me.name;
  $("connect").hidden = true;
  $("logout").hidden = false;
  $("save").hidden = false;
  $("list-section").hidden = false;
  $("scope-row").hidden = !["reviewer", "editor", "admin"].includes(state.me.role);
  await refresh();
}

function logout() {
  localSet("token", null);
  state.token = null; state.me = null;
  clearTimeout(state.timer);
  ["save", "list-section", "detail"].forEach((id) => { $(id).hidden = true; });
  $("logout").hidden = true;
  $("who").textContent = "";
  $("connect").hidden = false;
}

// ---- save sheet ----------------------------------------------------------
async function save(evt, newVersion = false) {
  evt?.preventDefault();
  const raw = $("link").value.trim();
  if (!platformOf(raw)) { showResult(el("span", { class: "error" }, t("noLink"))); return; }
  const isUrl = /^https?:\/\/\S+$/i.test(raw);
  const body = {
    [isUrl ? "url" : "text"]: raw, client: "web", new_version: newVersion,
    case_ref: $("case_ref").value.trim() || null, note: $("note").value.trim() || null,
    tags: $("tags").value.split(",").map((s) => s.trim()).filter(Boolean), sensitive: $("sensitive").checked,
  };
  $("save-btn").disabled = true;
  $("save-btn").textContent = t("saving");
  try {
    const r = await api("/v1/inbox", { method: "POST", body: JSON.stringify(body) });
    if (r.created) {
      showResult(el("span", {}, t("sent")));
      $("save-form").reset();
      $("detected").hidden = true;
    } else if (r.new_version) {
      showResult(el("span", {}, t("versionQueued")));
    } else {
      const it = r.item;
      const who = it.submitted_by?.id === state.me.id ? t("you") : (it.submitted_by?.name || t("someone"));
      showResult(
        el("span", {}, t("dupBy")(who, ago(it.created_at)), " ", it.latest_capture?.verdict ? chip(it.latest_capture.verdict) : ""),
        el("div", { class: "row" },
          el("button", { type: "button", onclick: () => openDetail(it.id) }, t("view")),
          el("button", { type: "button", onclick: () => save(null, true) }, t("newVersion"))),
      );
    }
    await refresh();
  } catch (e) {
    showResult(el("span", { class: "error" }, e.message));
  } finally {
    $("save-btn").disabled = false;
    $("save-btn").textContent = t("save");
  }
}

function showResult(...nodes) { $("result").replaceChildren(...nodes); $("result").hidden = false; }

// ---- list ----------------------------------------------------------------
function renderFilters() {
  $("filters").replaceChildren(...FILTERS.map((f) => el("button", {
    type: "button", "aria-pressed": String(state.filter === f),
    onclick: () => { state.filter = f; renderFilters(); refresh(); },
  }, f ? t("status")[f] : t("all"))));
}

async function refresh() {
  clearTimeout(state.timer);
  if (!state.token) return;
  const q = new URLSearchParams({ limit: "100", mine: String(!state.all) });
  if (state.filter) q.set("status", state.filter);
  try {
    state.items = (await api("/v1/items?" + q)).items;
  } catch { /* keep the last list on a transient error */ }
  renderList();
  if (state.detail) await loadDetail(state.detail.id, false);
  const busy = state.items.some((i) => ["queued", "capturing"].includes(i.status)) ||
    (state.detail && ["queued", "capturing"].includes(state.detail.status));
  state.timer = setTimeout(refresh, busy ? 4000 : 20000);
}

function renderList() {
  if (!$("items")) return;
  $("items").replaceChildren(...state.items.map((it) => {
    const ex = it.latest_capture?.extracted || {};
    const title = it.title || ex.title || it.canonical_url;
    const snippet = ex.text || (ex.author ? ex.author : "") || it.canonical_url;
    return el("li", { tabindex: "0", "data-id": it.id, onclick: () => openDetail(it.id),
                      onkeydown: (e) => { if (e.key === "Enter") openDetail(it.id); } },
      el("div", { class: "row" }, chip(it.status), el("span", { class: "badge" }, platformOf(it.canonical_url) || it.platform),
         el("span", { class: "spacer" }), el("span", { class: "meta" }, ago(it.created_at))),
      el("div", { class: "title" }, title),
      el("div", { class: "snippet" }, snippet));
  }));
  $("empty").hidden = state.items.length > 0;
}

// ---- detail --------------------------------------------------------------
async function openDetail(id) {
  state.version = null;
  await loadDetail(id, true);
  $("list-section").hidden = true;
  $("save").hidden = true;
  $("detail").hidden = false;
  window.scrollTo(0, 0);
}

async function loadDetail(id, force) {
  const item = await api(`/v1/items/${id}`);
  const prev = state.detail;
  const changed = !prev || prev.id !== item.id || prev.status !== item.status || prev.captures.length !== item.captures.length;
  state.detail = item;
  if (force || changed) renderDetail();
}

function closeDetail() {
  freeBlobs();
  state.detail = null;
  $("detail").hidden = true;
  $("save").hidden = false;
  $("list-section").hidden = false;
  refresh();
}

function fmtBytes(n) { return n == null ? "" : n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB"; }

function fmtDate(v) {
  if (v == null || v === "") return null;
  const d = typeof v === "number" ? new Date(v * 1000) : new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleString(state.lang === "vi" ? "vi-VN" : "en-GB");
}

function renderDetail() {
  freeBlobs();
  const it = state.detail;
  const caps = it.captures;
  const cap = caps.find((c) => c.id === state.version) || caps.find((c) => c.state === "done") || caps[0] || {};
  const ex = cap.extracted || it.latest_capture?.extracted || {};
  const status = cap.state === "done" ? cap.verdict : it.status;

  const primary = (cap.artifacts || []).filter((a) => a.role === "primary");
  const context = (cap.artifacts || []).filter((a) => a.role !== "primary");
  const label = (a) => t("labels")[a.label] || a.label;

  const gallery = el("div", { class: "gallery" + (it.sensitive ? " blur" : "") });
  for (const a of [...primary, ...context.filter((a) => a.kind === "screenshot")]) {
    if (!["image", "screenshot", "video"].includes(a.kind)) continue;
    const fig = el("figure", {}, el("figcaption", {}, `${label(a)} · ${fmtBytes(a.bytes)}${a.duration_s ? ` · ${Math.round(a.duration_s)} s` : ""}`));
    gallery.append(fig);
    blobUrl(a.url).then((u) => {
      const media = a.kind === "video"
        ? el("video", { src: u, controls: true, preload: "metadata" })
        : el("img", { src: u, alt: label(a), class: a.label === "full-page" ? "tall" : null, loading: "lazy" });
      fig.prepend(media);
    }).catch(() => fig.prepend(el("p", { class: "error" }, "✕")));
  }

  const files = el("ul", { class: "files" }, ...(cap.artifacts || []).map((a) => el("li", {},
    el("span", {}, label(a)), el("span", { class: "meta" }, `${a.kind} · ${fmtBytes(a.bytes)}`),
    a.kind === "link"
      ? el("a", { href: a.source_url, target: "_blank", rel: "noopener noreferrer" }, t("wayback"))
      : el("button", { type: "button", class: "link", onclick: () => downloadArtifact(a) }, t("download")),
    a.sha256 ? el("code", { title: "SHA-256" }, a.sha256.slice(0, 16) + "…") : "")));

  const kv = el("dl", { class: "kv" });
  const addKv = (k, v) => { if (v) kv.append(el("dt", {}, k), el("dd", {}, v)); };
  addKv(t("author"), ex.author);
  addKv(t("published"), fmtDate(ex.published_at) || ex.upload_date);
  addKv(t("submittedBy"), it.submitted_by?.name);
  addKv(t("client"), it.client);
  addKv("URL", it.resolved_url && it.resolved_url !== it.canonical_url ? `${it.canonical_url} → ${it.resolved_url}` : it.canonical_url);

  const versions = el("div", { class: "row versions" }, el("span", { class: "meta" }, t("versions") + ":"),
    ...caps.map((c, i) => el("button", {
      type: "button", "aria-pressed": String(c.id === cap.id),
      onclick: () => { state.version = c.id; renderDetail(); },
    }, `v${caps.length - i} · ${c.state === "done" ? (t("status")[c.verdict] || c.verdict) : t("status").capturing}`)));

  const edit = el("form", { class: "card", onsubmit: (e) => saveEdits(e, it.id) },
    el("label", {}, t("noteLabel"), el("textarea", { id: "e-note", rows: "2" })),
    el("label", {}, t("caseLabel"), el("input", { id: "e-case" })),
    el("label", {}, t("tagsLabel"), el("input", { id: "e-tags" })),
    el("button", { type: "submit" }, t("saveEdits")), el("span", { id: "e-msg", class: "meta" }));

  $("detail-body").replaceChildren(
    el("div", { class: "card" },
      el("div", { class: "row" }, chip(status), el("span", { class: "spacer" }),
         el("button", { type: "button", id: "recapture", onclick: () => recapture(it.id),
                        disabled: ["queued", "capturing"].includes(it.status) }, t("recapture"))),
      el("h1", {}, it.title || ex.title || it.canonical_url),
      el("a", { class: "url", href: it.url, target: "_blank", rel: "noopener noreferrer" }, t("openOriginal")),
      cap.verdict_reasons?.length ? el("div", {}, el("h2", {}, t("reasons")),
        el("ul", { class: "reasons" }, ...cap.verdict_reasons.map((r) => el("li", {}, r)))) : "",
      kv,
      ex.text ? el("div", {}, el("h2", {}, t("text")), el("div", { class: "text" }, ex.text)) : "",
      caps.length > 1 ? versions : ""),
    el("h2", {}, t("content")), gallery,
    el("h2", {}, t("evidence")), files,
    cap.manifest_sha256 ? el("p", { class: "hash" }, `${t("manifest")}: ${cap.manifest_sha256}`) : "",
    el("h2", {}, t("details")), edit);
  $("e-note").value = it.note || "";
  $("e-case").value = it.case_ref || "";
  $("e-tags").value = (it.tags || []).join(", ");
}

async function downloadArtifact(a) {
  const u = await blobUrl(a.url);
  const ext = { "image/png": ".png", "image/jpeg": ".jpg", "video/mp4": ".mp4", "application/json": ".json",
                "text/html": ".html", "text/plain": ".txt", "image/webp": ".webp" }[(a.mime || "").split(";")[0]] || "";
  el("a", { href: u, download: `${a.label}-${(a.sha256 || "").slice(0, 12)}${ext}` }).click();
}

async function recapture(id) {
  try { await api(`/v1/items/${id}/recapture`, { method: "POST" }); } catch (e) { alert(e.message); }
  state.version = null;
  await loadDetail(id, true);
  refresh();
}

async function saveEdits(e, id) {
  e.preventDefault();
  try {
    await api(`/v1/items/${id}`, { method: "PATCH", body: JSON.stringify({
      note: $("e-note").value.trim() || null, case_ref: $("e-case").value.trim() || null,
      tags: $("e-tags").value.split(",").map((s) => s.trim()).filter(Boolean),
    }) });
    $("e-msg").textContent = t("saved");
  } catch (err) { $("e-msg").textContent = err.message; }
}

// ---- boot ----------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  $("lang").onclick = () => { state.lang = state.lang === "vi" ? "en" : "vi"; localSet("lang", state.lang); applyI18n(); };
  $("logout").onclick = logout;
  $("back").onclick = closeDetail;
  $("more-toggle").onclick = () => { $("more").hidden = !$("more").hidden; };
  $("all").onchange = (e) => { state.all = e.target.checked; refresh(); };
  $("save-form").addEventListener("submit", save);
  $("link").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save(e); });
  $("link").addEventListener("input", () => {
    const p = platformOf($("link").value);
    $("detected").hidden = !p;
    $("detected").textContent = p || "";
  });
  $("connect-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("connect-error").hidden = true;
    try { await connect($("token").value.trim()); } catch (err) {
      $("connect-error").textContent = err.message; $("connect-error").hidden = false;
    }
  });

  // Share-target style entry: /app/?url=... or ?text=... prefills the save sheet.
  const q = new URLSearchParams(location.search);
  const shared = q.get("url") || q.get("text") || "";
  if (shared) { $("link").value = shared; $("link").dispatchEvent(new Event("input")); }

  applyI18n();
  if (state.token) connect(state.token).catch(() => logout());
  else logout();
});
