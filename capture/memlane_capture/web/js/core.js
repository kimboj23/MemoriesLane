// Shared state, API client, i18n and small DOM helpers.
// Captured content is hostile: only ever insert it with textContent (el() does that), never as HTML.

export const state = {
  lang: localGet("lang") || "vi",
  token: localGet("token"),
  me: null,
  projects: [],
  contributors: [],
  cleanups: [],
  routeSeq: 0,
};

export function localGet(k) { try { return localStorage.getItem("mlc." + k); } catch { return null; } }
export function localSet(k, v) {
  try { v == null ? localStorage.removeItem("mlc." + k) : localStorage.setItem("mlc." + k, v); } catch { /* private mode */ }
}

// ---- i18n ------------------------------------------------------------------
const VI = {
  brand: "Lưu trữ MemoryLane", logout: "Đăng xuất", connectTitle: "Kết nối", connect: "Kết nối",
  connectHelp: "Dán mã cá nhân (bắt đầu bằng mlc_) mà quản trị viên đã cấp cho bạn. Mã chỉ được lưu trên trình duyệt này.",
  badToken: "Mã không hợp lệ hoặc đã bị thu hồi.",
  navIncidents: "Vụ việc", navInbox: "Hộp thư", navProjects: "Dự án", newIncident: "Vụ việc mới", saveLink: "Lưu liên kết",
  linkPlaceholder: "Dán liên kết hoặc nội dung được chia sẻ…", more: "Thêm chi tiết", notePh: "Ghi chú",
  tagsPh: "Chủ đề, cách nhau bằng dấu phẩy", sensitiveItem: "Nội dung nhạy cảm (làm mờ)", save: "Lưu", saving: "Đang gửi…",
  sent: "Đã gửi vào kho lưu trữ.", noLink: "Không tìm thấy liên kết http(s).", project: "Dự án", incident: "Vụ việc",
  noIncident: "— Chưa gán (để trong hộp thư) —", chooseProject: "— Chọn dự án —", createIncidentWith: "+ Tạo vụ việc mới với liên kết này",
  dupBy: (who, when) => `Liên kết này đã được ${who} lưu ${when}.`, you: "bạn", someone: "người khác",
  view: "Xem", newVersion: "Lưu phiên bản mới", versionQueued: "Đã yêu cầu chụp lại.",
  mine: "Của tôi", everyone: "Của mọi người", unfiled: "Chưa gán vụ việc", all: "Tất cả", empty: "Chưa có gì ở đây.",
  back: "← Quay lại", recapture: "Chụp lại", content: "Nội dung đã lưu", evidence: "Bằng chứng khác & tệp gốc",
  reasons: "Vì sao", author: "Tác giả", published: "Ngày đăng", text: "Nội dung chữ", versions: "Các phiên bản",
  manifest: "Mã băm manifest", openOriginal: "Mở liên kết gốc ↗", download: "Tải xuống", openTab: "Mở tab mới ↗",
  details: "Chi tiết", noteLabel: "Ghi chú", tagsLabel: "Chủ đề", saveEdits: "Lưu thay đổi", saved: "Đã lưu.",
  submittedBy: "Người gửi", client: "Gửi từ", fileUnder: "Gán vào vụ việc", attach: "Gán", detach: "Bỏ gán",
  restrictionNotice: "Thông báo hạn chế của nền tảng", reveal: "Hiện nội dung nhạy cảm",
  fit: "Vừa khung", actual: "Kích thước thật", close: "Đóng", prev: "‹", next: "›", loading: "Đang tải…",
  htmlNote: "HTML đã lưu, hiển thị không tải tài nguyên bên ngoài (không chạy script).",
  // incidents (Atlos-style)
  attributes: "Thuộc tính", feed: "Bảng tin", metadata: "Siêu dữ liệu", sourceMaterial: "Tư liệu nguồn",
  addMaterial: "+ Thêm tư liệu", location: "Vị trí", update: "Cập nhật", reasonPh: "Giải thích thay đổi (không bắt buộc)",
  postUpdate: "Đăng cập nhật", comment: "Bình luận", commentPh: "Viết bình luận…", description: "Mô tả", status: "Trạng thái",
  sensitivity: "Mức độ nhạy cảm", tags: "Chủ đề", date: "Ngày", place: "Gần địa điểm", lat: "Vĩ độ", lng: "Kinh độ",
  precision: "Độ chính xác", assignees: "Người phụ trách", none: "—", createdBy: "Người tạo", created: "Tạo lúc",
  updated: "Cập nhật lúc", search: "Tìm mô tả, mã, địa điểm, liên kết…", cards: "Thẻ", table: "Bảng", allStatuses: "Mọi trạng thái",
  allProjects: "Mọi dự án", materialCount: (n) => `${n} tư liệu`, openMap: "Xem bản đồ ↗", noProjects: "Chưa có dự án nào.",
  createProjectFirst: "Hãy tạo một dự án trước (trang Dự án).", sourceUrlsPh: "Mỗi dòng một liên kết…", create: "Tạo",
  exportCsv: "Xuất CSV", privilegedHint: "Chỉ người duyệt mới đặt được “Hoàn tất” / “Đã huỷ”.",
  // projects (Atlos-style)
  projects: "Dự án", newProject: "Dự án mới", manage: "Quản lý", overview: "Tổng quan", general: "Thông tin chung",
  name: "Tên", code: "Mã (2–6 ký tự, dùng trong mã vụ việc)", color: "Màu", tagVocab: "Bộ chủ đề gợi ý", tagsOnePerLine: "Mỗi dòng một chủ đề",
  customAttrs: "Thuộc tính tuỳ chỉnh", addAttr: "+ Thêm thuộc tính", attrName: "Tên thuộc tính", attrType: "Kiểu",
  attrOptions: "Các lựa chọn (mỗi dòng một lựa chọn)", remove: "Xoá", archive: "Lưu trữ dự án (chỉ đọc)",
  unarchive: "Mở lại dự án", archived: "Đã lưu trữ", openIncidents: (n, t) => `${n} đang mở / ${t} vụ việc`,
  viewIncidents: "Xem vụ việc →", editorsOnly: "Chỉ biên tập viên mới chỉnh được dự án.",
  types: { text: "Chữ", select: "Chọn một", multi_select: "Chọn nhiều", date: "Ngày" },
  feedCreated: "đã tạo vụ việc", feedComment: "đã bình luận", feedMaterialAdded: "đã thêm tư liệu",
  feedMaterialRemoved: "đã bỏ tư liệu", feedCapture: "Hệ thống lưu trữ", feedCaptureVerb: "đã chụp tư liệu",
  feedChanged: (f) => `đã đổi ${f}`, system: "Hệ thống",
  status_: { queued: "Đang chờ", capturing: "Đang lưu…", complete: "Đã lưu đầy đủ", partial: "Lưu được một phần",
             walled: "Bị chặn đăng nhập", restricted: "Bị hạn chế truy cập", unavailable: "Đã bị gỡ / không khả dụng",
             failed: "Lỗi" },
  incStatus: { to_do: "Cần làm", in_progress: "Đang làm", help_needed: "Cần hỗ trợ", ready_for_review: "Chờ duyệt",
               completed: "Hoàn tất", cancelled: "Đã huỷ" },
  sens: { not_sensitive: "Không nhạy cảm", personal_info: "Lộ thông tin cá nhân", graphic_violence: "Bạo lực / hình ảnh gây sốc",
          deleted_by_source: "Đã bị nguồn xoá", deceptive: "Sai lệch / gây hiểu lầm" },
  prec: { exact: "Chính xác (±10 m)", vicinity: "Lân cận (±100 m)", locality: "Khu vực (±1 km)" },
  labels: { embed: "Bản nhúng của bài", video: "Video", "post-image": "Ảnh của bài", "post-video": "Video của bài",
            image: "Ảnh", "full-page": "Toàn trang (đã bỏ hộp đăng nhập)", "as-served": "Trang như được hiển thị",
            thumbnail: "Ảnh thu nhỏ", "page-text": "Chữ trên trang", "page-html": "HTML trang", "embed-html": "HTML bản nhúng",
            "media-metadata": "Siêu dữ liệu video", "page-meta": "Siêu dữ liệu trang", manifest: "Manifest",
            wayback: "Internet Archive", "restriction-notice": "Thông báo hạn chế", "restriction-notice-text": "Chữ thông báo hạn chế",
            "subtitles.vi": "Phụ đề (vi)", "subtitles.en": "Phụ đề (en)" },
  ago: (s) => s < 60 ? "vừa xong" : s < 3600 ? `${Math.floor(s / 60)} phút trước` : s < 86400 ? `${Math.floor(s / 3600)} giờ trước` : `${Math.floor(s / 86400)} ngày trước`,
};
const EN = {
  brand: "MemoryLane archive", logout: "Sign out", connectTitle: "Connect", connect: "Connect",
  connectHelp: "Paste the personal token (starts with mlc_) an admin gave you. It is only stored in this browser.",
  badToken: "Invalid or revoked token.",
  navIncidents: "Incidents", navInbox: "Inbox", navProjects: "Projects", newIncident: "New incident", saveLink: "Save link",
  linkPlaceholder: "Paste a link or shared text…", more: "More details", notePh: "Note", tagsPh: "Topics, comma-separated",
  sensitiveItem: "Sensitive content (blur)", save: "Save", saving: "Sending…", sent: "Sent to the archive.",
  noLink: "No http(s) link found.", project: "Project", incident: "Incident", noIncident: "— Not filed (stays in the inbox) —",
  chooseProject: "— Choose a project —", createIncidentWith: "+ Create a new incident with this link",
  dupBy: (who, when) => `Already saved by ${who} ${when}.`, you: "you", someone: "someone else",
  view: "View", newVersion: "Save a new version", versionQueued: "Re-capture requested.",
  mine: "Mine", everyone: "Everyone's", unfiled: "Not filed", all: "All", empty: "Nothing here yet.", back: "← Back",
  recapture: "Capture again", content: "Captured content", evidence: "Other evidence & raw files", reasons: "Why",
  author: "Author", published: "Published", text: "Text", versions: "Versions", manifest: "Manifest hash",
  openOriginal: "Open original ↗", download: "Download", openTab: "Open in new tab ↗", details: "Details",
  noteLabel: "Note", tagsLabel: "Topics", saveEdits: "Save changes", saved: "Saved.", submittedBy: "Submitted by",
  client: "Sent from", fileUnder: "File under incident", attach: "File", detach: "Unfile",
  restrictionNotice: "Platform restriction notice", reveal: "Show sensitive content", fit: "Fit", actual: "Actual size",
  close: "Close", prev: "‹", next: "›", loading: "Loading…",
  htmlNote: "Saved HTML, shown without loading anything external (no scripts).",
  attributes: "Attributes", feed: "Feed", metadata: "Metadata", sourceMaterial: "Source material", addMaterial: "+ Add material",
  location: "Location", update: "Update", reasonPh: "Explain the change (optional)", postUpdate: "Post update",
  comment: "Comment", commentPh: "Write a comment…", description: "Description", status: "Status", sensitivity: "Sensitivity",
  tags: "Tags", date: "Date", place: "Reported near", lat: "Latitude", lng: "Longitude", precision: "Precision",
  assignees: "Assignees", none: "—", createdBy: "Created by", created: "Created", updated: "Updated",
  search: "Search description, ID, place, link…", cards: "Cards", table: "Table", allStatuses: "All statuses",
  allProjects: "All projects", materialCount: (n) => `${n} source${n === 1 ? "" : "s"}`, openMap: "Open map ↗",
  noProjects: "No projects yet.", createProjectFirst: "Create a project first (Projects page).",
  sourceUrlsPh: "One link per line…", create: "Create", exportCsv: "Export CSV",
  privilegedHint: "Only reviewers can set Completed / Cancelled.",
  projects: "Projects", newProject: "New project", manage: "Manage", overview: "Overview", general: "General",
  name: "Name", code: "Code (2–6 characters, used in incident IDs)", color: "Color", tagVocab: "Suggested tags", tagsOnePerLine: "One tag per line",
  customAttrs: "Custom attributes", addAttr: "+ Add attribute", attrName: "Attribute name", attrType: "Type",
  attrOptions: "Options (one per line)", remove: "Remove", archive: "Archive project (read-only)",
  unarchive: "Unarchive project", archived: "Archived", openIncidents: (n, t) => `${n} open / ${t} incidents`,
  viewIncidents: "View incidents →", editorsOnly: "Only editors can change projects.",
  types: { text: "Text", select: "Single select", multi_select: "Multiple select", date: "Date" },
  feedCreated: "created the incident", feedComment: "commented", feedMaterialAdded: "added source material",
  feedMaterialRemoved: "removed source material", feedCapture: "Archive", feedCaptureVerb: "captured source material",
  feedChanged: (f) => `changed ${f}`, system: "System",
  status_: { queued: "Queued", capturing: "Capturing…", complete: "Fully saved", partial: "Partly saved",
             walled: "Blocked by login wall", restricted: "Restricted", unavailable: "Removed / unavailable", failed: "Failed" },
  incStatus: { to_do: "To Do", in_progress: "In Progress", help_needed: "Help Needed", ready_for_review: "Ready for Review",
               completed: "Completed", cancelled: "Cancelled" },
  sens: { not_sensitive: "Not Sensitive", personal_info: "Personal Information Visible", graphic_violence: "Graphic Violence",
          deleted_by_source: "Deleted by Source", deceptive: "Deceptive or Misleading" },
  prec: { exact: "Exact (±10 m)", vicinity: "Vicinity (±100 m)", locality: "Locality (±1 km)" },
  labels: { embed: "Post embed", video: "Video", "post-image": "Post image", "post-video": "Post video", image: "Image",
            "full-page": "Full page (login box removed)", "as-served": "Page as served", thumbnail: "Thumbnail",
            "page-text": "Page text", "page-html": "Page HTML", "embed-html": "Embed HTML", "media-metadata": "Video metadata",
            "page-meta": "Page metadata", manifest: "Manifest", wayback: "Internet Archive",
            "restriction-notice": "Restriction notice", "restriction-notice-text": "Restriction notice text",
            "subtitles.vi": "Subtitles (vi)", "subtitles.en": "Subtitles (en)" },
  ago: (s) => s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`,
};
const STR = { vi: VI, en: EN };
export const t = (k) => STR[state.lang][k] ?? k;
export const STATUSES = ["to_do", "in_progress", "help_needed", "ready_for_review", "completed", "cancelled"];
export const SENSITIVE = ["not_sensitive", "personal_info", "graphic_violence", "deleted_by_source", "deceptive"];
export const VERDICTS = ["capturing", "complete", "partial", "walled", "restricted", "unavailable", "failed"];
export const PALETTE = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0d9488", "#0891b2", "#475569"];

// ---- DOM -------------------------------------------------------------------
export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "style") Object.assign(n.style, v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "value") n.value = v;
    else if (k === "checked") n.checked = !!v;
    else if (k === "selected") n.selected = !!v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false && c !== "") n.append(c instanceof Node ? c : String(c));
  return n;
}
export const $ = (id) => document.getElementById(id);
// Replace a container's children; nested arrays and empty values are flattened away
// (Element.replaceChildren would turn an array into the text "[object HTMLDivElement]").
export function mount(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false && c !== ""));
}

export function ago(iso) { return t("ago")(Math.max(0, (Date.now() - new Date(iso)) / 1000)); }
export function fmtDate(v, withTime = true) {
  if (v == null || v === "") return null;
  const d = typeof v === "number" ? new Date(v * 1000) : new Date(v);
  if (isNaN(d)) return String(v);
  const loc = state.lang === "vi" ? "vi-VN" : "en-GB";
  return withTime ? d.toLocaleString(loc) : d.toLocaleDateString(loc);
}
export function fmtBytes(n) { return n == null ? "" : n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB"; }

// Verdict of a capture, and status of an incident (Atlos colour scheme).
export function verdictChip(v) { return el("span", { class: `chip v-${v}` }, t("status_")[v] || v); }
export function statusChip(s, onclick) {
  return el(onclick ? "button" : "span", { class: `chip s-${s}`, type: onclick ? "button" : null, onclick }, t("incStatus")[s] || s);
}
export function sensChips(list) {
  return (list || []).filter((s) => s !== "not_sensitive").map((s) => el("span", { class: "chip sens" }, "⚠ " + (t("sens")[s] || s)));
}
export function projectDot(p) { return el("span", { class: "dot", style: { background: p?.color || "#94a3b8" } }); }
export function avatar(name) {
  const initials = (name || "?").split(/\s+/).map((w) => w[0]).slice(-2).join("").toUpperCase();
  return el("span", { class: "avatar", title: name || "" }, initials);
}
export function isSensitive(list) { return (list || []).some((s) => s !== "not_sensitive"); }

const PLATFORM = [
  [/(^|\.)(facebook\.com|fb\.watch|fb\.com)$/, "Facebook"], [/threads\.(com|net)$/, "Threads"],
  [/instagram\.com$/, "Instagram"], [/tiktok\.com$/, "TikTok"], [/(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)(x|twitter)\.com$/, "X"],
];
export function platformOf(text) {
  const m = /https?:\/\/[^\s<>"']+/i.exec(text || "");
  if (!m) return null;
  try {
    const host = new URL(m[0]).hostname.toLowerCase();
    return (PLATFORM.find(([re]) => re.test(host)) || [null, "Web"])[1];
  } catch { return null; }
}

export function toast(msg, isError = false) {
  const n = el("div", { class: "toast" + (isError ? " error" : ""), role: "status" }, msg);
  document.body.append(n);
  setTimeout(() => n.remove(), isError ? 6000 : 3000);
}

// ---- API -------------------------------------------------------------------
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { Authorization: "Bearer " + state.token, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (res.status === 401) { window.dispatchEvent(new Event("mlc:logout")); throw new Error(t("badToken")); }
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) {
    const d = body && body.detail;
    throw new Error(typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg).join("; ") : res.statusText);
  }
  return body;
}
export const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body || {}) });
export const patch = (path, body) => api(path, { method: "PATCH", body: JSON.stringify(body || {}) });

export async function loadProjects(force = false) {
  if (force || !state.projects.length) state.projects = (await api("/v1/projects?include_archived=true")).projects;
  return state.projects;
}
export async function loadContributors() {
  if (!state.contributors.length) state.contributors = (await api("/v1/contributors")).contributors;
  return state.contributors;
}
export const canEdit = () => ["editor", "admin"].includes(state.me?.role);
export const canReview = () => ["reviewer", "editor", "admin"].includes(state.me?.role);

// Pages register cleanups (timers) here; the router runs them on navigation.
export function onLeave(fn) { state.cleanups.push(fn); }
// A poll belongs to the page that was current when it started; if the user has navigated on
// (a slow page finishing late), it stops itself instead of running forever.
export function poll(fn, ms) {
  const seq = state.routeSeq;
  const id = setInterval(() => { if (state.routeSeq !== seq) clearInterval(id); else fn(); }, ms);
  onLeave(() => clearInterval(id));
}

// Simple modal dialog (Atlos opens an "Update" window per attribute).
export function modal(title, body, { wide = false } = {}) {
  const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const wrap = el("div", { class: "modal-wrap", onclick: (e) => { if (e.target === wrap) close(); } },
    el("div", { class: "modal" + (wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": title },
      el("div", { class: "modal-head" }, el("h2", {}, title),
        el("button", { type: "button", class: "icon", "aria-label": t("close"), onclick: close }, "✕")),
      body));
  document.addEventListener("keydown", onKey);
  document.body.append(wrap);
  return close;
}

export function sec(title, ...right) { return el("div", { class: "sec-row" }, el("h3", { class: "sec-head" }, title), ...right); }
