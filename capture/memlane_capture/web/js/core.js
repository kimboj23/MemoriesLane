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
  unfiledHint: "Chưa gán vào vụ việc nào, nên liên kết vẫn ở mục “Cần xử lý” trong Hộp thư. Chọn dự án và vụ việc (hoặc tạo vụ việc mới) để dùng nó làm tư liệu nguồn.",
  dupBy: (who, when) => `Liên kết này đã được ${who} lưu ${when}.`, you: "bạn", someone: "người khác",
  view: "Xem", newVersion: "Lưu phiên bản mới", versionQueued: "Đã yêu cầu chụp lại.",
  mine: "Của tôi", everyone: "Của mọi người", unfiled: "Chưa gán vụ việc", all: "Tất cả", empty: "Chưa có gì ở đây.",
  back: "← Quay lại", recapture: "Chụp lại", content: "Nội dung đã lưu", evidence: "Bằng chứng khác & tệp gốc",
  reasons: "Vì sao", author: "Tác giả", published: "Ngày đăng", text: "Nội dung chữ", versions: "Các phiên bản",
  manifest: "Mã băm manifest", openOriginal: "Mở liên kết gốc ↗", download: "Tải xuống", openTab: "Mở tab mới ↗",
  details: "Chi tiết", noteLabel: "Ghi chú", tagsLabel: "Chủ đề", saveEdits: "Lưu thay đổi", saved: "Đã lưu.",
  submittedBy: "Người gửi", client: "Gửi từ", fileUnder: "Thuộc các vụ việc", attach: "Gán", detach: "Bỏ gán",
  restrictionNotice: "Thông báo hạn chế của nền tảng", reveal: "Hiện nội dung nhạy cảm",
  fit: "Vừa khung", actual: "Kích thước thật", close: "Đóng", moreInfo: "Giải thích", prev: "‹", next: "›", loading: "Đang tải…",
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
  why: { subscribed: "bạn theo dõi", mentioned: "bạn được nhắc đến", assigned: "bạn được giao", review_requested: "bạn được xin ý kiến" },
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
  rateLimitedNote: (platform, at) => `${platform} đang tạm từ chối yêu cầu từ máy chủ lưu trữ (HTTP 429, thường do quá nhiều yêu cầu từ địa chỉ máy chủ, không phải do liên kết). Hệ thống sẽ tự thử lại${at ? " lúc " + at : ""}; không cần làm gì.`,
  waybackState: { queued: "Đang chờ gửi", running: "Đang gửi…", done: "Đã có bản sao", error: "Lỗi", skipped: "Bỏ qua" },
  waybackNone: "Chưa gửi lên Internet Archive.",
  confirmWayback: "Gửi liên kết này lên Internet Archive? Bản lưu trên Wayback Machine là CÔNG KHAI và không thể rút lại.",
  alreadyHere: "đã có trong vụ việc này.", alsoIn: "Cũng thuộc:", fileAnother: "Thêm vào vụ việc",
  status_: { queued: "Đang chờ", capturing: "Đang lưu…", rate_limited: "Tạm bị giới hạn · sẽ thử lại", complete: "Đã lưu đầy đủ", partial: "Lưu được một phần",
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
  // community intake, publication, feed
  feedIntake: "đã gán một bài gửi từ cộng đồng",
  feedPub: { review_requested: "đã xin ý kiến thứ hai về bản công khai", drafted: "đã soạn bản công khai", approved_manager: "đã duyệt (quản lý) bản công khai", approved_publisher: "đã duyệt (quyền công bố) bản công khai", published: "đã công bố", withdrawn: "đã rút lại bản công khai" },
  correct: "Sửa thông tin", correctTip: "Sửa trạng thái hoặc thông tin (tác giả, ngày đăng, tiêu đề…) khi máy nhận sai",
  correctHelp: "Bản lưu đã niêm phong không bị thay đổi: phần sửa được lưu bên cạnh, ghi rõ ai sửa, lúc nào và vì sao. Để trống một ô để trở về giá trị máy tìm được.",
  statusByMachine: (v) => `— Theo máy (${v}) —`, statusHelp: "Ví dụ: máy ghi “Đã bị gỡ” nhưng bài vẫn còn khi xem bằng tài khoản đã đăng nhập.",
  correctReason: "Lý do", correctReasonPh: "Bạn đã kiểm tra thế nào? (bắt buộc khi sửa trạng thái)", correctReasonNeeded: "Cần ghi lý do khi sửa trạng thái.",
  corrField: { status: "Trạng thái", title: "Tiêu đề", author: "Tác giả", published_at: "Ngày đăng", text: "Nội dung bài" },
  statusCorrected: (m, by, at) => `Sửa tay bởi ${by || "—"} (${at}); máy ghi: ${m}`, correctedTip: (by, at) => `Sửa tay bởi ${by || "—"}, ${at}`,
  textCorrected: "Nội dung đã sửa tay", correctionsLog: "Lịch sử sửa", feedMaterialCorrected: "đã sửa thông tin một tư liệu",
  filters: "Bộ lọc", filtersTip: "Chọn nguồn, trạng thái và các bộ lọc khác", newSubs: (n) => `${n} bài gửi mới`,
  srcLabel: "Nguồn", srcAll: "Tất cả", srcInternal: "Nội bộ", srcCommunity: "Cộng đồng", needsAction: "Cần xử lý",
  srcAllHelp: "Mọi thứ đã vào: liên kết đội ngũ lưu, và bài gửi từ các trang cộng đồng.",
  srcInternalHelp: "Liên kết do đội ngũ lưu (nút chia sẻ, tiện ích, trang này).",
  approvePublish: "Duyệt và công bố", requestReview: "Xin ý kiến thứ hai", cancelReview: "Huỷ yêu cầu",
  reviewAsk: "Hỏi ai?", reviewNote: "Cần xem điều gì? (không bắt buộc)", sendRequest: "Gửi yêu cầu",
  reviewOpen: (who, when) => `${who} đã xin ý kiến thứ hai ${when}`, reviewWaiting: "Người xin ý kiến không tự công bố được cho đến khi có người khác duyệt hoặc yêu cầu được huỷ.",
  publishedBy: (who) => `Công bố bởi ${who}`, reviewRequestedChip: "Đang xin ý kiến",
  pubHelp1: "Bản công khai là một bản riêng, viết cho công chúng: vị trí được làm mờ theo chính sách, chỉ các tệp được chọn (đã xoá siêu dữ liệu). Một người có quyền (quản lý hoặc có quyền công bố) duyệt là đủ; khi cần, hãy xin ý kiến thứ hai.",
  roleTagHelp: { reviewer: "người có thể duyệt công bố", manager: "quản lý và chủ sở hữu", editor: "biên tập trở lên", owner: "chủ sở hữu", all: "mọi thành viên" },
  mentionHint: "Gõ @ để nhắc tên một người hoặc một nhóm: @reviewer, @manager, @editor, @owner, @all.",
  rolesGroup: "Theo vai trò", peopleGroup: "Từng người",
  fromInbox: "Chọn từ hộp thư", newLinks: "Hoặc dán liên kết mới", filterPh: "Lọc…", noInboxItems: "Không có liên kết nào trong hộp thư.",
  submissionsHere: "Bài gửi cộng đồng trong dự án này", addSelected: (n) => `Thêm ${n} mục`, existingValues: "Giá trị đã dùng:",
  feedReviewRequested: "đã xin ý kiến thứ hai về bản công khai",
  internalLoc: "Vị trí nội bộ (không công bố):", fromIncident: "lấy từ vụ việc, luôn là bản mới nhất", fromSubmission: "điểm người gửi đã ghim",
  noLocationNote: "Chưa có vị trí: bản công khai sẽ được đăng mà không có điểm trên bản đồ.", addLocationOnIncident: "Thêm vị trí cho vụ việc →",
  defaultWord: "mặc định", needsReasonWord: "cần lý do",
  problemCodes: { needs_reason: "Hãy ghi lý do vì sao hiện chi tiết hơn mặc định.", title_required: "Hãy nhập tiêu đề công khai (VI).",
    text_required: "Hãy nhập nội dung ký ức (VI).", not_allowed: "Độ chính xác này không được phép cho loại địa điểm đã chọn.",
    submitter_ceiling: "Người gửi muốn hiện không chi tiết hơn mức đã chọn.", needs_consent: "Người gửi chưa cho phép hiện vị trí chính xác.",
    unknown_kind: "Hãy chọn loại địa điểm.", unknown_precision: "Hãy chọn độ chính xác." },
  noticeCodes: { no_location: "Chưa có vị trí: sẽ đăng mà không có điểm trên bản đồ." },
  noteAddedToPublished: "Vụ việc này đã được công bố: bài gửi đã được thêm vào bản công khai như một ghi chú mới, chờ duyệt để hiện trên bản đồ.",
  communityNotes: "Ghi chú cộng đồng (chấm trên bản đồ)", showNote: "Hiện ghi chú này", fromSubmission2: "bài gửi gốc ↗",
  communityNotesHelp: "Lời của người gửi, hiện như một chấm trên bản đồ cộng đồng; bấm vào sẽ mở hồ sơ vụ việc với các tư liệu nguồn. Có thể sửa lời (ví dụ bỏ tên người) hoặc bỏ chọn để không hiện.",
  noCommunityNotes: "Không có bài gửi cộng đồng nào gán vào vụ việc này: hồ sơ vẫn được công bố (trong danh sách), nhưng không có chấm trên bản đồ.",
  srcIntro: "Trang cộng đồng là các trang công khai mà người dân dùng để gửi ký ức, trình báo và tài liệu, ví dụ bản đồ cộng đồng và Hồ sơ Nhân quyền. Mỗi trang được đăng ký ở đây như một “nguồn”: nó nhận một khoá riêng, chỉ dùng được để GỬI bài vào nền tảng, không đọc được gì khác. Những gì trang đó hiển thị là phần đã được duyệt công bố.",
  srcFlowLabel: "Dữ liệu đi như thế nào",
  srcFlow: [["Người dân gửi", "trên trang công khai (ẩn danh được); nhận mã biên nhận"], ["Trang chuyển tiếp", "ký bằng khoá của nguồn; liên kết được lưu ngay"],
            ["Hộp thư · Cộng đồng", "vào dự án theo định tuyến bên dưới; nhóm xem xét"], ["Duyệt và công bố", "bản công khai, vị trí đã làm mờ"],
            ["Trang hiển thị", "đọc nguồn dữ liệu có chữ ký, chỉ những gì đã công bố"]],
  srcMoreTitle: "Định tuyến, khoá và an toàn",
  srcMore: ["Định tuyến: chọn dự án nhận từng loại bài gửi của trang. Người trong dự án đó sẽ thấy bài trong Hộp thư (nguồn: Cộng đồng). Để trống: bài chờ quản trị định tuyến.",
            "Khoá chỉ hiện một lần khi tạo hoặc đổi. Đặt nó trong máy chủ của trang (biến HUB_INTAKE_KEY), không bao giờ trên trình duyệt hay trong mã nguồn.",
            "Nghi khoá bị lộ: bấm “Đổi khoá”, khoá cũ ngừng ngay; cập nhật khoá mới cho trang. “Vô hiệu hoá” chặn trang gửi bài mà không xoá gì.",
            "Mỗi trang bị giới hạn số bài mỗi giờ; bài trùng (cùng mã của trang) không bị nhận hai lần."],
  srcSite: "Trang", srcSiteHelp: "Tên và mã định danh (slug) của trang công khai",
  routingHelp: "Mỗi loại bài gửi từ trang này vào Hộp thư của dự án nào", submissionsHelp: "Số bài trang đã gửi, và lần gần nhất",
  notRoutedShort: "chờ định tuyến", srcRouteSentence: (kinds, proj) => `Bài gửi (${kinds}) vào Hộp thư của ${proj}.`,
  kindHelp: { memory: "Ký ức kể lại, ghim trên bản đồ", case_report: "Đề nghị mở hồ sơ một vụ việc", document: "Tài liệu, ảnh, video gửi kèm hồ sơ", link: "Một liên kết cần lưu" },
  newSourceHelp: "Đăng ký một trang công khai mới. Sau khi thêm, khoá của trang hiện một lần ở trên: đặt nó vào máy chủ của trang.",
  slugHelp: "Mã cố định, viết thường, gạch ngang (ví dụ ho-so-nhan-quyen). Trang gửi kèm mã này với mỗi bài.", srcNameHelp: "Tên hiển thị trong Hộp thư, ví dụ “Hồ sơ Nhân quyền”.",
  navIntake: "Tiếp nhận", intakeTitle: "Hộp tiếp nhận", intakeHelp: "Bài gửi từ các trang cộng đồng. Liên kết trong bài đã được lưu ngay; chúng chỉ hiện với thành viên dự án cho đến khi được gán vào vụ việc.",
  intakeKinds: { memory: "Ký ức", case_report: "Báo cáo vụ việc", document: "Tài liệu", link: "Liên kết" },
  intakeStates: { new: "Mới", attached: "Đã gán", created: "Đã tạo vụ việc", published: "Đã công bố", rejected: "Từ chối", all: "Tất cả" },
  groups: { violation: "Vi phạm", proceeding: "Tố tụng", platform_restriction: "Hạn chế mạng xã hội", movement: "Phong trào xã hội" },
  source: "Nguồn", received: "Nhận lúc", unrouted: "Chưa định tuyến", submission: "Bài gửi", submittedText: "Nội dung gửi (chỉ hiển thị dạng chữ)",
  capturedLinks: "Liên kết đã lưu", communityFiles: "Tệp do cộng đồng gửi", providedByContributor: "Do người đóng góp cung cấp — không phải bản chụp của chúng tôi",
  consents: "Đồng ý của người gửi", contact: "Liên hệ", contactSealed: "Có liên hệ (đã niêm phong). Chỉ quản lý dự án mở được; mỗi lần mở đều được ghi lại.",
  openContact: "Mở liên hệ", confirmContact: "Mở thông tin liên hệ? Việc này được ghi lại.", contactOpened: (n) => `Đã mở (${n} lần).`,
  attachTo: "Gán vào vụ việc có sẵn", chooseIncident: "— Chọn vụ việc —", createFromIt: "Tạo vụ việc mới từ bài gửi", rejectIt: "Từ chối",
  rejectReason: "Lý do (không bắt buộc, chỉ nội bộ)", reopen: "Mở lại", routeTo: "Chuyển sang dự án", reviewedBy: (who, when) => `${who} · ${when}`,
  publishMemory: "Chuẩn bị bản công khai ký ức", legacyPublic: "Đã công khai trên trang cũ", fromCommunity: "Từ cộng đồng",
  publication: "Bản công khai", startPublication: "Chuẩn bị bản công khai", openPublication: "Mở bản công khai →",
  pubStates: { draft: "Bản nháp", published: "Đã công bố", withdrawn: "Đã rút lại" },
  approvals: (n) => `${n}/2 phê duyệt`, unpublishedChanges: "Có thay đổi chưa công bố",
  publications: "Bản công khai", pubHelp: "Bản công khai là một bản riêng, viết cho công chúng: vị trí được làm mờ theo chính sách, chỉ các tệp được chọn (đã xoá siêu dữ liệu). Cần hai người duyệt: một quản lý dự án và một người có quyền công bố.",
  titleVi: "Tiêu đề công khai (VI)", titleEn: "Tiêu đề (EN)", summaryVi: "Tóm tắt công khai (VI)", summaryEn: "Tóm tắt (EN)",
  textVi: "Nội dung ký ức (VI)", textEn: "Nội dung (EN)", category: "Loại", publicStatus: "Trạng thái công khai",
  pubStatus: { reported: "Được báo cáo", being_verified: "Đang xác minh", verified: "Đã xác minh" },
  cats: { personal: "Cá nhân", news: "Tin tức", community: "Cộng đồng", event: "Sự kiện" },
  group: "Nhóm hồ sơ", publicDate: "Ngày (công khai)", datePrecision: "Độ chi tiết của ngày", datePrec: { day: "Ngày", month: "Tháng", year: "Năm" },
  placeKind: "Loại địa điểm", placeKinds: { public_institution: "Cơ quan công quyền / địa danh", public_gathering: "Tụ họp ở nơi công cộng",
    private_city: "Nhà riêng / nơi làm việc (thành phố)", private_rural: "Nhà riêng / nơi làm việc (nông thôn)", memory: "Ký ức cá nhân",
    legacy_memory: "Ký ức đã công khai trước đây", online: "Chỉ trên mạng" },
  publicPrecision: "Độ chính xác công khai", levels: { exact: "Chính xác", street: "Đường phố (~250 m)", ward: "Phường/xã (~2–3 km)", province: "Tỉnh/thành (~40 km)", none: "Không hiện trên bản đồ" },
  precisionReason: "Lý do (bắt buộc khi chi tiết hơn mặc định)", placeLabel: "Tên khu vực công khai", placeLabelHelp: "Ví dụ “Quận 1, TP.HCM”. Đừng ghi địa chỉ.",
  refreshLocation: "Lấy lại vị trí nội bộ từ vụ việc", credit: "Ghi công (bí danh, không bắt buộc)", publicTags: "Chủ đề công khai",
  materialsToShow: "Tư liệu công bố", showOriginal: "Hiện liên kết gốc", publicSummary: "Tóm tắt", filesToShow: "Tệp công bố (bản đã làm sạch)",
  noPublishable: "Chưa có tệp công bố được.", saveDraft: "Lưu bản nháp", draftSaved: "Đã lưu. Các phê duyệt cũ (nếu có) đã bị xoá.",
  approveManager: "Duyệt (quản lý)", approvePublisher: "Duyệt (quyền công bố)", approvedBy: (r, n) => `${r}: ${n}`, waiting: "chưa có",
  problems: "Cần sửa trước khi duyệt", previewTitle: "Xem trước bản công khai (đúng như sẽ đăng)", withdrawIt: "Rút lại ngay",
  withdrawReason: "Lý do rút lại (ghi trong bảng tin)", confirmWithdraw: "Rút bản công khai này? Trang công khai và các bản sao sẽ xoá nó.",
  backToDraft: "Đưa về bản nháp", publishedV: (v, when) => `Đã công bố phiên bản ${v} · ${when}`, withdrawnAt: (when, why) => `Đã rút lại ${when}: ${why}`,
  publishGrant: "Quyền công bố", publishGrantHelp: "Người có quyền công bố (cùng quản lý và chủ sở hữu) có thể tự duyệt và công bố, và rút bản công khai.",
  policyNote: "Danh sách chỉ gồm các mức chính sách cho phép với loại địa điểm này (§12.4); chi tiết hơn mặc định thì cần ghi lý do.",
  legacyBatch: "Ký ức đã công khai trên trang cũ", legacyWaiting: (n) => `${n} ký ức đang chờ`, makeBatch: "Tạo lô công bố",
  batchApprove: "Duyệt lô", batchPublished: "Đã công bố lô",
  sources: "Trang cộng đồng (nguồn tiếp nhận)", newSource: "Thêm nguồn", slug: "Mã (chữ thường, gạch ngang)", routing: "Định tuyến bài gửi",
  keyShownOnce: "Khoá của nguồn (chỉ hiện một lần; đặt vào backend của trang, không bao giờ vào trình duyệt):", rotateKey: "Đổi khoá",
  confirmRotate: "Đổi khoá? Khoá cũ ngừng hoạt động ngay.", submissionsCount: "Bài gửi", lastReceived: "Gần nhất", notRouted: "— Không định tuyến —",
  intakeNotConfigured: "Chưa cấu hình INTAKE_KEY_SECRET: API tiếp nhận đang tắt.",
  feedTitle: "Nguồn dữ liệu công khai (feed)", feedConfigured: "Đã cấu hình ký", feedNotConfigured: "Chưa cấu hình khoá ký (FEED_ONLINE_KEY, FEED_DELEGATION)",
  feedBuilt: "Lần dựng gần nhất", feedLive: "Đang công bố", feedWithdrawn: "Đã rút", rebuild: "Dựng lại", feedUrl: "Địa chỉ công khai",
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
  unfiledHint: "Not filed under any incident yet, so it stays in the Inbox under “Needs action”. Choose a project and an incident (or create one) to use it as source material.",
  dupBy: (who, when) => `Already saved by ${who} ${when}.`, you: "you", someone: "someone else",
  view: "View", newVersion: "Save a new version", versionQueued: "Re-capture requested.",
  mine: "Mine", everyone: "Everyone's", unfiled: "Not filed", all: "All", empty: "Nothing here yet.", back: "← Back",
  recapture: "Capture again", content: "Captured content", evidence: "Other evidence & raw files", reasons: "Why",
  author: "Author", published: "Published", text: "Text", versions: "Versions", manifest: "Manifest hash",
  openOriginal: "Open original ↗", download: "Download", openTab: "Open in new tab ↗", details: "Details",
  noteLabel: "Note", tagsLabel: "Topics", saveEdits: "Save changes", saved: "Saved.", submittedBy: "Submitted by",
  client: "Sent from", fileUnder: "Incidents using this link", attach: "File", detach: "Unfile",
  restrictionNotice: "Platform restriction notice", reveal: "Show sensitive content", fit: "Fit", actual: "Actual size",
  close: "Close", moreInfo: "Explanation", prev: "‹", next: "›", loading: "Loading…",
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
  why: { subscribed: "you follow it", mentioned: "you were mentioned", assigned: "you were assigned", review_requested: "your opinion was asked" },
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
  rateLimitedNote: (platform, at) => `${platform} is temporarily refusing requests from the archive server (HTTP 429, usually too many requests from the server's address, not a problem with the link). It will be tried again automatically${at ? " at " + at : ""}; nothing to do.`,
  waybackState: { queued: "Queued", running: "Submitting…", done: "Copy available", error: "Error", skipped: "Skipped" },
  waybackNone: "Not sent to the Internet Archive.",
  confirmWayback: "Send this link to the Internet Archive? Wayback Machine copies are PUBLIC and cannot be withdrawn.",
  alreadyHere: "is already in this incident.", alsoIn: "Also in:", fileAnother: "Add to incident",
  status_: { queued: "Queued", capturing: "Capturing…", rate_limited: "Rate-limited · will retry", complete: "Fully saved", partial: "Partly saved",
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
  feedIntake: "attached a community submission",
  feedPub: { review_requested: "asked for a second opinion on the public version", drafted: "drafted the public version", approved_manager: "approved (manager) the public version", approved_publisher: "approved (publication access) the public version", published: "published", withdrawn: "withdrew the public version" },
  correct: "Correct", correctTip: "Correct the status or the details (author, post date, title…) when the machine got them wrong",
  correctHelp: "The sealed capture isn't changed: the correction is kept beside it, with who, when and why. Leave a field empty to go back to what the machine found.",
  statusByMachine: (v) => `— As the machine found (${v}) —`, statusHelp: "E.g. the machine says “Removed” but the post is still there when viewed logged in.",
  correctReason: "Reason", correctReasonPh: "How did you check? (required when correcting the status)", correctReasonNeeded: "Give a reason when correcting the status.",
  corrField: { status: "Status", title: "Title", author: "Author", published_at: "Post date", text: "Post text" },
  statusCorrected: (m, by, at) => `Corrected by ${by || "—"} (${at}); the machine found: ${m}`, correctedTip: (by, at) => `Corrected by ${by || "—"}, ${at}`,
  textCorrected: "Text corrected by hand", correctionsLog: "Corrections", feedMaterialCorrected: "corrected a source material",
  filters: "Filters", filtersTip: "Choose the source, status and other filters", newSubs: (n) => `${n} new submission${n === 1 ? "" : "s"}`,
  srcLabel: "Source", srcAll: "All", srcInternal: "Internal", srcCommunity: "Community", needsAction: "Needs action",
  srcAllHelp: "Everything that came in: links the team saved, and submissions from the community sites.",
  srcInternalHelp: "Links the team saved (share button, extension, this page).",
  approvePublish: "Approve and publish", requestReview: "Ask for a second opinion", cancelReview: "Cancel request",
  reviewAsk: "Ask whom?", reviewNote: "What should they look at? (optional)", sendRequest: "Send request",
  reviewOpen: (who, when) => `${who} asked for a second opinion ${when}`, reviewWaiting: "The person who asked can't publish alone until someone else approves or the request is cancelled.",
  publishedBy: (who) => `Published by ${who}`, reviewRequestedChip: "Second opinion asked",
  pubHelp1: "A public version is a separate record written for the public: the location is generalised per the policy, and only the chosen files are shown (metadata removed). One approval by someone entitled (a manager, or a member with publication access) is enough; ask for a second opinion when in doubt.",
  roleTagHelp: { reviewer: "people who can approve publication", manager: "managers and owners", editor: "editors and up", owner: "owners", all: "every member" },
  mentionHint: "Type @ to mention a person or a group: @reviewer, @manager, @editor, @owner, @all.",
  rolesGroup: "By role", peopleGroup: "People",
  fromInbox: "Pick from the inbox", newLinks: "Or paste new links", filterPh: "Filter…", noInboxItems: "No links in the inbox.",
  submissionsHere: "Community submissions in this project", addSelected: (n) => `Add ${n}`, existingValues: "Already used:",
  feedReviewRequested: "asked for a second opinion on the public version",
  internalLoc: "Internal location (not published):", fromIncident: "from the incident, always current", fromSubmission: "the point the submitter pinned",
  noLocationNote: "No location yet: the public version will be published without a map point.", addLocationOnIncident: "Add a location on the incident →",
  defaultWord: "default", needsReasonWord: "needs a reason",
  problemCodes: { needs_reason: "Write why it is shown more precisely than the default.", title_required: "Enter a public title (VI).",
    text_required: "Enter the memory text (VI).", not_allowed: "This precision isn't allowed for the chosen kind of place.",
    submitter_ceiling: "The submitter asked for no more precision than this.", needs_consent: "The submitter didn't allow an exact location.",
    unknown_kind: "Choose a kind of place.", unknown_precision: "Choose a precision." },
  noticeCodes: { no_location: "No location yet: it will be published without a map point." },
  noteAddedToPublished: "This incident is already published: the submission was added to its public version as a new note, waiting for approval to appear on the map.",
  communityNotes: "Community notes (dots on the map)", showNote: "Show this note", fromSubmission2: "original submission ↗",
  communityNotesHelp: "The submitters' own words, shown as dots on the community map; clicking one opens the case with its source material. Edit the wording (e.g. to remove a name) or untick to leave one out.",
  noCommunityNotes: "No community submission is filed under this incident: the case is still published (in the list), but has no dot on the map.",
  srcIntro: "Community sites are the public websites people use to send memories, reports and documents, such as the community map and Hồ sơ Nhân quyền. Each is registered here as a “source”: it gets its own key, which can only SEND submissions into the platform and can't read anything. What the site shows is only what was approved for publication.",
  srcFlowLabel: "How data flows",
  srcFlow: [["People submit", "on the public site (anonymously if they want); they get a receipt code"], ["The site forwards", "signed with the source's key; links are captured at once"],
            ["Inbox · Community", "into the project set by the routing below; the team reviews"], ["Approve and publish", "a public version, location generalised"],
            ["The site shows", "reads the signed feed: only what was published"]],
  srcMoreTitle: "Routing, keys and safety",
  srcMore: ["Routing: choose which project receives each kind of submission from the site. That project's members see it in the Inbox (source: Community). Left empty: it waits for an admin to route it.",
            "The key is shown once, when created or rotated. Put it on the site's server (HUB_INTAKE_KEY), never in a browser or in source code.",
            "Key possibly exposed: press “Rotate key”; the old key stops at once; give the site the new one. “Disable” stops a site sending without deleting anything.",
            "Each site has an hourly limit; a repeat (same site id) is never received twice."],
  srcSite: "Site", srcSiteHelp: "The public site's name and identifier (slug)",
  routingHelp: "Which project's Inbox receives each kind of submission from this site", submissionsHelp: "How many submissions the site has sent, and the latest",
  notRoutedShort: "waiting for routing", srcRouteSentence: (kinds, proj) => `Submissions (${kinds}) go to the Inbox of ${proj}.`,
  kindHelp: { memory: "A remembered story, pinned on the map", case_report: "A request to open a case", document: "A document, photo or video for a case", link: "A link to preserve" },
  newSourceHelp: "Register a new public site. After adding it, its key is shown once above: put it on the site's server.",
  slugHelp: "Fixed id, lowercase with dashes (e.g. ho-so-nhan-quyen). The site sends it with every submission.", srcNameHelp: "Name shown in the Inbox, e.g. “Hồ sơ Nhân quyền”.",
  navIntake: "Intake", intakeTitle: "Intake inbox", intakeHelp: "Submissions from the community sites. Their links were captured at once; they stay visible only to project members until filed under an incident.",
  intakeKinds: { memory: "Memory", case_report: "Case report", document: "Document", link: "Link" },
  intakeStates: { new: "New", attached: "Attached", created: "Incident created", published: "Published", rejected: "Rejected", all: "All" },
  groups: { violation: "Violation", proceeding: "Proceeding", platform_restriction: "Platform restriction", movement: "Social movement" },
  source: "Source", received: "Received", unrouted: "Not routed", submission: "Submission", submittedText: "Submitted content (shown as text only)",
  capturedLinks: "Captured links", communityFiles: "Files sent by the community", providedByContributor: "Provided by a contributor — not our own capture",
  consents: "Submitter's consents", contact: "Contact", contactSealed: "A contact was given (sealed). Only project managers can open it; every opening is logged.",
  openContact: "Open contact", confirmContact: "Open the contact details? This is logged.", contactOpened: (n) => `Opened (${n} time${n === 1 ? "" : "s"}).`,
  attachTo: "Attach to an existing incident", chooseIncident: "— Choose an incident —", createFromIt: "Create a new incident from it", rejectIt: "Reject",
  rejectReason: "Reason (optional, internal only)", reopen: "Reopen", routeTo: "Move to project", reviewedBy: (who, when) => `${who} · ${when}`,
  publishMemory: "Prepare the public version of this memory", legacyPublic: "Already public on the old site", fromCommunity: "From the community",
  publication: "Public version", startPublication: "Prepare a public version", openPublication: "Open the public version →",
  pubStates: { draft: "Draft", published: "Published", withdrawn: "Withdrawn" },
  approvals: (n) => `${n}/2 approvals`, unpublishedChanges: "Unpublished changes",
  publications: "Public versions", pubHelp: "A public version is a separate record written for the public: the location is generalised per the policy, and only the chosen files are shown (metadata removed). Two people approve: a project manager and a member with publication access.",
  titleVi: "Public title (VI)", titleEn: "Title (EN)", summaryVi: "Public summary (VI)", summaryEn: "Summary (EN)",
  textVi: "Memory text (VI)", textEn: "Text (EN)", category: "Category", publicStatus: "Public status",
  pubStatus: { reported: "Reported", being_verified: "Being verified", verified: "Verified" },
  cats: { personal: "Personal", news: "News", community: "Community", event: "Event" },
  group: "Case group", publicDate: "Date (public)", datePrecision: "Date detail", datePrec: { day: "Day", month: "Month", year: "Year" },
  placeKind: "Kind of place", placeKinds: { public_institution: "Public institution / landmark", public_gathering: "Gathering in public space",
    private_city: "Private home / workplace (city)", private_rural: "Private home / workplace (rural)", memory: "Personal memory",
    legacy_memory: "Memory already public", online: "Online only" },
  publicPrecision: "Public precision", levels: { exact: "Exact", street: "Street (~250 m)", ward: "Ward/commune (~2–3 km)", province: "Province (~40 km)", none: "Not on the map" },
  precisionReason: "Reason (required when finer than the default)", placeLabel: "Public area name", placeLabelHelp: "E.g. “District 1, HCMC”. Never an address.",
  refreshLocation: "Re-copy the internal location from the incident", credit: "Credit (pseudonym, optional)", publicTags: "Public tags",
  materialsToShow: "Material to publish", showOriginal: "Show original link", publicSummary: "Summary", filesToShow: "Files to publish (cleaned copies)",
  noPublishable: "No publishable files.", saveDraft: "Save draft", draftSaved: "Saved. Any earlier approvals were cleared.",
  approveManager: "Approve (manager)", approvePublisher: "Approve (publication access)", approvedBy: (r, n) => `${r}: ${n}`, waiting: "waiting",
  problems: "Fix before approving", previewTitle: "Preview of the public record (exactly as it will be published)", withdrawIt: "Withdraw now",
  withdrawReason: "Reason for withdrawing (shown in the feed)", confirmWithdraw: "Withdraw this public version? The public sites and mirrors will delete it.",
  backToDraft: "Back to draft", publishedV: (v, when) => `Published version ${v} · ${when}`, withdrawnAt: (when, why) => `Withdrawn ${when}: ${why}`,
  publishGrant: "Publication access", publishGrantHelp: "Members with publication access (like managers and owners) can approve and publish on their own, and withdraw public versions.",
  policyNote: "The list only offers what the policy allows for this kind of place (§12.4); finer than the default needs a reason.",
  legacyBatch: "Memories already public on the old site", legacyWaiting: (n) => `${n} memories waiting`, makeBatch: "Create a publication batch",
  batchApprove: "Approve batch", batchPublished: "Batch published",
  sources: "Community sites (sources)", newSource: "Add a source", slug: "Slug (lowercase, dashes)", routing: "Route submissions",
  keyShownOnce: "The source's key (shown once; put it in the site's backend, never in a browser):", rotateKey: "Rotate key",
  confirmRotate: "Rotate the key? The old key stops working at once.", submissionsCount: "Submissions", lastReceived: "Last", notRouted: "— Not routed —",
  intakeNotConfigured: "INTAKE_KEY_SECRET is not set: the Intake API is off.",
  feedTitle: "Public feed", feedConfigured: "Signing configured", feedNotConfigured: "Signing keys not configured (FEED_ONLINE_KEY, FEED_DELEGATION)",
  feedBuilt: "Last built", feedLive: "Published", feedWithdrawn: "Withdrawn", rebuild: "Rebuild", feedUrl: "Public address",
  ago: (s) => s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`,
};
const STR = { vi: VI, en: EN };
export const t = (k) => STR[state.lang][k] ?? k;
export const STATUSES = ["to_do", "in_progress", "help_needed", "ready_for_review", "completed", "cancelled"];
export const SENSITIVE = ["not_sensitive", "personal_info", "graphic_violence", "deleted_by_source", "deceptive"];
export const VERDICTS = ["capturing", "rate_limited", "complete", "partial", "walled", "restricted", "unavailable", "failed"];
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
  if ((tag === "button" || (tag === "a" && /\bbtn\b/.test(attrs?.class || ""))) && !n.title) {
    const tip = tipFor(n.textContent);
    if (tip) n.title = tip;
  }
  return n;
}

// ---- tooltips ----------------------------------------------------------------
// Keyed by the string key of a button's label, so a button gets its tooltip wherever it appears.
const TIPS = {
  vi: {
    update: "Đổi giá trị này; có thể ghi lý do, sẽ hiện trong bảng tin", follow: "Nhận thông báo khi vụ việc này thay đổi",
    following: "Bạn đang nhận thông báo về vụ việc này. Bấm để bỏ theo dõi", recapture: "Chụp lại liên kết; bản cũ vẫn được giữ như một phiên bản",
    sendWayback: "Gửi lên Wayback Machine của Internet Archive: bản sao CÔNG KHAI, không rút lại được",
    newVersion: "Chụp lại liên kết đã lưu thành một phiên bản mới", attach: "Gán liên kết này vào vụ việc đã chọn",
    detach: "Bỏ liên kết khỏi vụ việc này (bản lưu vẫn còn)", fileAnother: "Dùng cùng liên kết này làm tư liệu cho vụ việc khác",
    exportCsv: "Tải bảng tính các vụ việc của dự án", saveDraft: "Lưu bản nháp; chưa công bố gì",
    approvePublish: "Công bố bản này lên nguồn dữ liệu công khai (các trang cộng đồng sẽ hiển thị nó)",
    requestReview: "Nhờ người khác xem trước khi công bố; họ nhận thông báo, và bạn không tự công bố được cho đến khi xong",
    cancelReview: "Đóng yêu cầu xin ý kiến", withdrawIt: "Gỡ ngay khỏi nguồn công khai; các trang cộng đồng sẽ xoá nó",
    backToDraft: "Mở lại bản đã rút để sửa và công bố lại", rotateKey: "Tạo khoá mới cho trang này; khoá cũ ngừng hoạt động ngay",
    rebuild: "Dựng lại toàn bộ nguồn dữ liệu công khai", needsAction: "Chỉ hiện liên kết chưa gán vào vụ việc và bài gửi mới",
    srcAll: "Mọi thứ đã vào, từ đội ngũ và cộng đồng", srcInternal: "Liên kết do đội ngũ lưu",
    srcCommunity: "Bài gửi từ các trang cộng đồng (bản đồ, Hồ sơ Nhân quyền)",
    createFromIt: "Tạo vụ việc mới, điền sẵn từ bài gửi; các liên kết được gán vào", rejectIt: "Không dùng bài gửi này (lý do chỉ lưu nội bộ)",
    reopen: "Đưa bài gửi về trạng thái Mới", openContact: "Mở thông tin liên hệ đã niêm phong (được ghi lại)",
    makeBatch: "Gom các ký ức đã công khai trên trang cũ thành một lô để duyệt một lần", batchApprove: "Công bố tất cả ký ức trong lô",
    revoke: "Vô hiệu hoá liên kết mời này", newToken: "Cấp một mã đăng nhập mới (hiện một lần)",
    revokeTokens: "Đăng xuất người này khỏi mọi thiết bị", disable: "Chặn tài khoản này đăng nhập",
    startPublication: "Soạn bản công khai riêng cho vụ việc (chưa công bố gì)", publishMemory: "Soạn bản công khai cho ký ức này",
    addMaterial: "Thêm tư liệu: chọn từ hộp thư hoặc dán liên kết mới", markAllRead: "Đánh dấu mọi thông báo là đã đọc",
    unreadOnly: "Chỉ hiện thông báo chưa đọc", newInvite: "Tạo liên kết để người khác tham gia dự án với vai trò đã chọn",
    leave: "Rời khỏi dự án này", saveLink: "Lưu một liên kết vào kho (từ bất kỳ trang nào)", copy: "Sao chép vào bộ nhớ tạm",
    everyone: "Hiện liên kết của mọi người, không chỉ của bạn", unfiled: "Chỉ liên kết chưa gán vào vụ việc nào",
    preview: "Kiểm tra tệp trước khi nhập; chưa tạo gì", downloadTemplate: "Tải tệp CSV mẫu với đúng tên cột",
    refreshLocation: "Chép lại vị trí nội bộ hiện tại của vụ việc vào bản nháp",
  },
  en: {
    update: "Change this value; you can add a reason, shown in the feed", follow: "Get notified when this incident changes",
    following: "You get notifications about this incident. Click to unfollow", recapture: "Capture the link again; the old capture is kept as a version",
    sendWayback: "Send to the Internet Archive's Wayback Machine: a PUBLIC copy that can't be withdrawn",
    newVersion: "Capture the saved link again as a new version", attach: "File this link under the chosen incident",
    detach: "Remove the link from this incident (its captures stay)", fileAnother: "Use the same link as material of another incident",
    exportCsv: "Download a spreadsheet of the project's incidents", saveDraft: "Save the draft; nothing is published",
    approvePublish: "Publish this version to the public feed (the community sites will show it)",
    requestReview: "Ask someone to look before it's published; they get notified, and you can't publish alone until it's closed",
    cancelReview: "Close the second-opinion request", withdrawIt: "Remove it from the public feed now; the community sites delete it",
    backToDraft: "Reopen a withdrawn version to edit and publish again", rotateKey: "Make a new key for this site; the old one stops at once",
    rebuild: "Rebuild the whole public feed", needsAction: "Only links not yet filed and new submissions",
    srcAll: "Everything that came in, from the team and the community", srcInternal: "Links the team saved",
    srcCommunity: "Submissions from the community sites (map, Hồ sơ Nhân quyền)",
    createFromIt: "Create an incident prefilled from the submission; its links are filed under it", rejectIt: "Don't use this submission (the reason stays internal)",
    reopen: "Set the submission back to New", openContact: "Open the sealed contact details (logged)",
    makeBatch: "Group the memories already public on the old site into one batch to approve once", batchApprove: "Publish every memory in the batch",
    revoke: "Disable this invite link", newToken: "Issue a new sign-in token (shown once)",
    revokeTokens: "Sign this person out on every device", disable: "Stop this account from signing in",
    startPublication: "Draft a separate public version of this incident (nothing is published yet)", publishMemory: "Draft the public version of this memory",
    addMaterial: "Add material: pick from the inbox or paste new links", markAllRead: "Mark every notification as read",
    unreadOnly: "Only unread notifications", newInvite: "Make a link to join the project with the chosen role",
    leave: "Leave this project", saveLink: "Save a link to the archive (from any page)", copy: "Copy to the clipboard",
    everyone: "Show everyone's links, not only yours", unfiled: "Only links not filed under any incident",
    preview: "Check the file before importing; nothing is created yet", downloadTemplate: "Download a CSV template with the right columns",
    refreshLocation: "Copy the incident's current internal location into the draft",
  },
};
let tipIndex = { lang: null, map: null };
function tipFor(label) {
  const text = (label || "").replace(/\s+/g, " ").trim().replace(/^\+\s*/, "").replace(/\s*\(\d+\)$/, "");
  if (!text || text.length > 60) return null;
  if (tipIndex.lang !== state.lang) {
    const map = new Map();
    for (const [k, tip] of Object.entries(TIPS[state.lang])) {
      const lbl = STR[state.lang][k];
      if (typeof lbl === "string") map.set(lbl.replace(/^\+\s*/, "").trim(), tip);
    }
    tipIndex = { lang: state.lang, map };
  }
  return tipIndex.map.get(text) || null;
}

// ---- suggestions: pick values already used instead of retyping them -------------------------------------
// `multi`: comma-separated list (tags); suggestions are offered for the part being typed.
export function suggestInput({ value = "", suggestions = [], multi = false, placeholder = "", label = null, required = false } = {}) {
  const input = el("input", { value: Array.isArray(value) ? value.join(", ") : value || "", placeholder, autocomplete: "off",
    "aria-label": label, required, "aria-autocomplete": "list" });
  const box = el("div", { class: "suggest-box", role: "listbox", hidden: true });
  const parts = () => input.value.split(",").map((x) => x.trim());
  const current = () => (multi ? parts().pop() : input.value.trim()).toLowerCase();
  const show = () => {
    const q = current();
    const have = new Set(multi ? parts().slice(0, -1).map((x) => x.toLowerCase()) : []);
    const list = [...new Set(suggestions)].filter((x) => x && !have.has(x.toLowerCase()) && (!q || x.toLowerCase().includes(q))
      && x.toLowerCase() !== q).slice(0, 12);
    box.replaceChildren(...list.map((x) => el("div", { class: "suggest-opt", role: "option", onmousedown: (e) => { e.preventDefault(); pick(x); } }, x)));
    box.hidden = !list.length;
  };
  const pick = (x) => {
    if (multi) { const ps = parts(); ps[ps.length - 1] = x; input.value = ps.filter(Boolean).join(", ") + ", "; }
    else input.value = x;
    input.dispatchEvent(new Event("change"));
    show();
  };
  input.addEventListener("focus", show);
  input.addEventListener("click", show);
  input.addEventListener("input", show);
  input.addEventListener("blur", () => setTimeout(() => { box.hidden = true; }, 120));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") box.hidden = true;
    if (e.key === "Enter" && !box.hidden && box.firstChild && e.target === input && current()) { e.preventDefault(); pick(box.firstChild.textContent); }
  });
  return { node: el("div", { class: "suggest" }, input, box), input,
           get value() { return multi ? parts().filter(Boolean) : input.value.trim(); } };
}

// Values already used (tags, custom attribute values), cached briefly per project.
const vocabCache = new Map();
export async function loadVocab(projectId = "") {
  const hit = vocabCache.get(projectId);
  if (hit && Date.now() - hit.at < 60000) return hit.v;
  let v = { tags: [], custom: {}, my_item_tags: [], public_tags: [] };
  try { v = await api("/v1/vocab" + (projectId ? `?project_id=${projectId}` : "")); } catch { /* suggestions are optional */ }
  vocabCache.set(projectId, { at: Date.now(), v });
  return v;
}

// ---- @mentions: people and role tags, offered while typing "@" in a comment ----------------------------------
export const ROLE_TAGS = ["reviewer", "manager", "editor", "owner", "all"];
export function mentionAssist(textarea, projectId) {
  let people = null;
  const box = el("div", { class: "suggest-box mention-box", role: "listbox", hidden: true });
  const wrap = el("div", { class: "suggest" });
  textarea.replaceWith?.(wrap);
  wrap.append(textarea, box);
  const token = () => {
    const before = textarea.value.slice(0, textarea.selectionStart);
    const m = /(^|\s)@([^\s@]*)$/u.exec(before);
    return m ? { q: m[2].toLowerCase(), start: before.length - m[2].length - 1 } : null;
  };
  const insert = (text, tk) => {
    const end = textarea.selectionStart;
    textarea.value = textarea.value.slice(0, tk.start) + "@" + text + " " + textarea.value.slice(end);
    const pos = tk.start + text.length + 2;
    textarea.setSelectionRange(pos, pos);
    box.hidden = true;
    textarea.focus();
  };
  const show = async () => {
    const tk = token();
    if (!tk) { box.hidden = true; return; }
    if (!people) { try { people = await loadContributors(projectId); } catch { people = []; } }
    const roles = ROLE_TAGS.filter((r) => r.startsWith(tk.q)).map((r) => ({ text: r, label: `@${r} — ${t("roleTagHelp")[r]}` }));
    const names = people.filter((p) => p.name.toLowerCase().includes(tk.q)).slice(0, 8).map((p) => ({ text: p.name, label: "@" + p.name }));
    const opts = [...roles, ...names];
    box.replaceChildren(...opts.map((o) => el("div", { class: "suggest-opt", role: "option",
      onmousedown: (e) => { e.preventDefault(); insert(o.text, tk); } }, o.label)));
    box.hidden = !opts.length;
  };
  textarea.addEventListener("input", show);
  textarea.addEventListener("keydown", (e) => { if (e.key === "Escape") box.hidden = true; });
  textarea.addEventListener("blur", () => setTimeout(() => { box.hidden = true; }, 120));
  return wrap;
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
  // 204 / empty bodies (unfollow, deletes) have no JSON to parse.
  const text = res.status === 204 ? "" : await res.text();
  let body = null;
  if (text && res.headers.get("content-type")?.includes("json")) { try { body = JSON.parse(text); } catch { body = null; } }
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

// A small ⓘ beside a section title: longer explanations open in a popup instead of filling the page.
export function infoButton(title, body) {
  return el("button", { type: "button", class: "info-btn", title: t("moreInfo"), "aria-label": `${t("moreInfo")}: ${title}`,
    onclick: () => modal(title, el("div", { class: "info-body" }, typeof body === "function" ? body() : body), { wide: true }) }, "i");
}
