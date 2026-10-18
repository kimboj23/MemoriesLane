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
  submittedBy: "Người gửi", client: "Gửi từ", fileUnder: "Thuộc các vụ việc", attach: "Gán", detach: "Bỏ gán",
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
  exportCsv: "Xuất CSV", privilegedHint: "Chỉ người quản lý dự án mới đặt được “Hoàn tất” / “Đã huỷ”.",
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
  // access, invites, notifications, admin, map, import, Internet Archive
  roles: { data_only_viewer: "Chỉ xem dữ liệu", viewer: "Người xem", editor: "Biên tập", manager: "Quản lý", owner: "Chủ sở hữu" },
  roleHelp: { data_only_viewer: "Chỉ xem vụ việc và tư liệu; không thấy bảng tin, bình luận hay tên thành viên.",
              viewer: "Xem và bình luận, xem thành viên, xuất CSV.", editor: "Tạo và sửa vụ việc (trừ vụ đã hoàn tất), thêm tư liệu.",
              manager: "Hoàn tất/huỷ vụ việc, xoá vụ việc, chỉnh dự án, nhập hàng loạt.", owner: "Quản lý thành viên, vai trò và liên kết mời." },
  globalRoles: { contributor: "Cộng tác viên", reviewer: "Người duyệt", editor: "Biên tập (tạo dự án)", admin: "Quản trị" },
  members: "Thành viên", access: "Quyền truy cập", roleCol: "Vai trò", since: "Tham gia", whatRoles: "Các vai trò làm được gì?", addMember: "Thêm người đã có tài khoản", add: "Thêm",
  choosePerson: "— Chọn người —", invites: "Liên kết mời", newInvite: "Tạo liên kết mời", inviteRole: "Vai trò khi tham gia",
  expiresDays: "Hết hạn sau (ngày)", maxUses: "Số lần dùng tối đa (để trống = không giới hạn)", note: "Ghi chú",
  inviteCreated: "Liên kết mời (chỉ hiện một lần, hãy sao chép ngay):", copy: "Sao chép", copied: "Đã sao chép",
  revoke: "Thu hồi", revoked: "Đã thu hồi", expired: "Hết hạn / hết lượt", uses: (u, m) => `${u}${m ? "/" + m : ""} lượt`,
  expires: "Hết hạn", leave: "Rời dự án", lastOwner: "Dự án cần ít nhất một chủ sở hữu.",
  inviteTitle: "Lời mời tham gia", invitedAs: (p, r) => `Bạn được mời tham gia dự án ${p} với vai trò ${r}.`,
  yourName: "Tên hiển thị (có thể là bí danh)", joinNew: "Tạo tài khoản và tham gia", joinAs: (n) => `Tham gia với tài khoản ${n}`,
  inviteInvalid: "Liên kết mời không hợp lệ, đã hết hạn hoặc đã dùng hết.",
  yourToken: "Mã cá nhân của bạn. Lưu nó ở nơi an toàn (trình quản lý mật khẩu) để đăng nhập trên thiết bị khác; mã sẽ không hiện lại.",
  continueBtn: "Tiếp tục",
  notifications: "Thông báo", markAllRead: "Đánh dấu đã đọc tất cả", markUnread: "Đánh dấu chưa đọc", noNotifications: "Không có thông báo.",
  unreadOnly: "Chỉ chưa đọc", subscriptions: "Vụ việc đang theo dõi", follow: "Theo dõi", following: "Đang theo dõi ✓",
  why: { subscribed: "bạn theo dõi", mentioned: "bạn được nhắc đến", assigned: "bạn được giao" },
  admin: "Quản trị", people: "Người dùng", newPerson: "Thêm người dùng", email: "Email (không bắt buộc)",
  globalRole: "Vai trò toàn hệ thống", disabled: "Vô hiệu hoá", enable: "Kích hoạt lại", disable: "Vô hiệu hoá",
  newToken: "Cấp mã mới", revokeTokens: "Thu hồi mọi mã", lastSeen: "Lần cuối", tokens: "Mã", projectsCol: "Dự án",
  tokenFor: (n) => `Mã mới cho ${n} (chỉ hiện một lần):`, confirmRevoke: "Thu hồi mọi mã của người này? Họ sẽ bị đăng xuất trên mọi thiết bị.",
  map: "Bản đồ", noLocation: "Chưa có vụ việc nào có toạ độ.", pickOnMap: "Bấm vào bản đồ để đặt vị trí.",
  bulkImport: "Nhập hàng loạt (CSV)", importHelp: "Một dòng một vụ việc. Cột bắt buộc: mô tả (description). Các cột khác: trạng thái, nhạy cảm, chủ đề, ngày (YYYY-MM-DD), địa điểm, vĩ độ, kinh độ, độ chính xác, liên kết, và tên các thuộc tính tuỳ chỉnh. Nhiều giá trị: phân cách bằng |.",
  chooseFile: "Chọn tệp CSV", preview: "Kiểm tra", doImport: (n) => `Nhập ${n} vụ việc`, imported: (n) => `Đã nhập ${n} vụ việc.`,
  rowsValid: (v, i) => `${v} dòng hợp lệ, ${i} dòng lỗi`, line: "Dòng", errors: "Lỗi", fixErrors: "Hãy sửa các lỗi rồi kiểm tra lại.",
  downloadTemplate: "Tải tệp mẫu", exportCsvHint: "Tệp xuất CSV dùng cùng tên cột, nên có thể sửa rồi nhập lại.",
  wayback: "Internet Archive", waybackShare: "Chia sẻ với Internet Archive",
  waybackHelp: "Tự động gửi các liên kết của dự án lên Wayback Machine (bản sao công khai, độc lập). Tắt cho các dự án nhạy cảm: bản gửi là công khai.",
  sendWayback: "Gửi lên Internet Archive", waybackOpen: "Bản sao Internet Archive ↗",
  waybackState: { queued: "Đang chờ gửi", running: "Đang gửi…", done: "Đã có bản sao", error: "Lỗi", skipped: "Bỏ qua" },
  waybackNone: "Chưa gửi lên Internet Archive.",
  confirmWayback: "Gửi liên kết này lên Internet Archive? Bản lưu trên Wayback Machine là CÔNG KHAI và không thể rút lại.",
  alreadyHere: "đã có trong vụ việc này.", alsoIn: "Cũng thuộc:", fileAnother: "Thêm vào vụ việc",
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
  client: "Sent from", fileUnder: "Incidents using this link", attach: "File", detach: "Unfile",
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
  privilegedHint: "Only project managers can set Completed / Cancelled.",
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
  roles: { data_only_viewer: "Data-only viewer", viewer: "Viewer", editor: "Editor", manager: "Manager", owner: "Owner" },
  roleHelp: { data_only_viewer: "Incidents and material only; no feed, comments or member names.",
              viewer: "View and comment, see members, export CSV.", editor: "Create and edit incidents (not completed ones), add material.",
              manager: "Complete/cancel and delete incidents, project settings, bulk import.", owner: "Members, roles and invite links." },
  globalRoles: { contributor: "Contributor", reviewer: "Reviewer", editor: "Editor (creates projects)", admin: "Admin" },
  members: "Members", access: "Access", roleCol: "Role", since: "Joined", whatRoles: "What can each role do?", addMember: "Add someone who has an account", add: "Add",
  choosePerson: "— Choose a person —", invites: "Invite links", newInvite: "Create invite link", inviteRole: "Role on joining",
  expiresDays: "Expires after (days)", maxUses: "Maximum uses (empty = unlimited)", note: "Note",
  inviteCreated: "Invite link (shown once, copy it now):", copy: "Copy", copied: "Copied", revoke: "Revoke",
  revoked: "Revoked", expired: "Expired / used up", uses: (u, m) => `${u}${m ? "/" + m : ""} uses`, expires: "Expires",
  leave: "Leave project", lastOwner: "A project needs at least one owner.",
  inviteTitle: "Invitation", invitedAs: (p, r) => `You're invited to join ${p} as ${r}.`,
  yourName: "Display name (a pseudonym is fine)", joinNew: "Create account and join", joinAs: (n) => `Join as ${n}`,
  inviteInvalid: "This invite link is invalid, expired or used up.",
  yourToken: "Your personal token. Keep it somewhere safe (a password manager) to sign in on other devices; it won't be shown again.",
  continueBtn: "Continue",
  notifications: "Notifications", markAllRead: "Mark all read", markUnread: "Mark unread", noNotifications: "No notifications.",
  unreadOnly: "Unread only", subscriptions: "Incidents you follow", follow: "Follow", following: "Following ✓",
  why: { subscribed: "you follow it", mentioned: "you were mentioned", assigned: "you were assigned" },
  admin: "Admin", people: "People", newPerson: "Add person", email: "Email (optional)", globalRole: "Instance role",
  disabled: "Disabled", enable: "Re-enable", disable: "Disable", newToken: "Issue token", revokeTokens: "Revoke all tokens",
  lastSeen: "Last seen", tokens: "Tokens", projectsCol: "Projects", tokenFor: (n) => `New token for ${n} (shown once):`,
  confirmRevoke: "Revoke all of this person's tokens? They will be signed out everywhere.",
  map: "Map", noLocation: "No incident has coordinates yet.", pickOnMap: "Click the map to set the location.",
  bulkImport: "Bulk import (CSV)", importHelp: "One row per incident. Required column: description. Others: status, sensitive, tags, date (YYYY-MM-DD), place, lat, lng, precision, urls, and the names of custom attributes. Several values: separate with |.",
  chooseFile: "Choose a CSV file", preview: "Check", doImport: (n) => `Import ${n} incidents`, imported: (n) => `Imported ${n} incidents.`,
  rowsValid: (v, i) => `${v} valid rows, ${i} with errors`, line: "Line", errors: "Errors", fixErrors: "Fix the errors and check again.",
  downloadTemplate: "Download template", exportCsvHint: "The CSV export uses the same columns, so it can be edited and imported again.",
  wayback: "Internet Archive", waybackShare: "Share with the Internet Archive",
  waybackHelp: "Automatically send this project's links to the Wayback Machine (an independent public copy). Leave off for sensitive projects: submissions are public.",
  sendWayback: "Send to the Internet Archive", waybackOpen: "Internet Archive copy ↗",
  waybackState: { queued: "Queued", running: "Submitting…", done: "Copy available", error: "Error", skipped: "Skipped" },
  waybackNone: "Not sent to the Internet Archive.",
  confirmWayback: "Send this link to the Internet Archive? Wayback Machine copies are PUBLIC and cannot be withdrawn.",
  alreadyHere: "is already in this incident.", alsoIn: "Also in:", fileAnother: "Add to incident",
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
export async function loadContributors(projectId) {
  return (await api("/v1/contributors" + (projectId ? `?project_id=${projectId}` : ""))).contributors;
}
export function copyText(text) {
  return navigator.clipboard?.writeText(text).then(() => toast(t("copied"))).catch(() => {});
}
export const canEdit = () => ["editor", "admin"].includes(state.me?.role);   // may create projects
export const isAdmin = () => state.me?.role === "admin";
const RANK = { data_only_viewer: 0, viewer: 1, editor: 2, manager: 3, owner: 4 };
// Project role checks, mirroring access.py (the server enforces them; this only hides buttons).
export const atLeast = (role, min) => role != null && RANK[role] >= RANK[min];
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
