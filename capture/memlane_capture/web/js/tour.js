// Onboarding: a step-by-step introduction for someone new to the platform. Opens once after the first sign-in
// (remembered in this browser), and again from the ⓘ button in the top bar. Where a step is about something on
// screen, that element is highlighted.
import { $, el, localGet, localSet, state } from "./core.js";

const STEPS = {
  vi: [
    { icon: "◈", title: "Chào mừng đến Lưu trữ MemoryLane",
      body: ["Đây là nền tảng nội bộ của nhóm: nơi lưu trữ bằng chứng từ mạng xã hội và web, sắp xếp thành vụ việc, và chuẩn bị những gì sẽ được công bố.",
             "Mọi thứ ở đây là riêng tư. Không có gì ra công chúng nếu chưa có người có quyền duyệt."] },
    { icon: "+", target: "#quick-save", title: "1 · Lưu một liên kết",
      body: ["Bấm “+ Lưu liên kết” (ở mọi trang) và dán đường dẫn bài đăng, video hay trang web.",
             "Hệ thống chụp lại ngay: ảnh toàn trang, video, chữ, kèm mã băm SHA-256 và một “manifest” niêm phong, để sau này chứng minh bản lưu không bị sửa. Lưu lại lần nữa sẽ tạo phiên bản mới, không ghi đè."] },
    { icon: "✓", title: "2 · Đọc kết quả lưu",
      body: ["Mỗi liên kết có một nhãn: “Đã lưu đầy đủ”, “Lưu được một phần”, “Bị chặn đăng nhập”, “Bị hạn chế truy cập” (nền tảng ẩn nội dung; thông báo của họ được lưu làm bằng chứng) hoặc “Đã bị gỡ”.",
             "Nội dung đã lưu có thể độc hại: luôn mở qua trình xem của nền tảng, không mở tệp tải về trên máy cá nhân."] },
    { icon: "✉", target: 'nav a[href="#/inbox"]', title: "3 · Hộp thư",
      body: ["Mọi thứ mới vào đều ở đây. Lọc theo nguồn: “Nội bộ” (liên kết nhóm lưu) hoặc “Cộng đồng” (bài gửi từ bản đồ cộng đồng và trang Hồ sơ Nhân quyền).",
             "“Cần xử lý” chỉ hiện những gì chưa gán vào vụ việc. Với bài gửi cộng đồng: gán vào vụ việc có sẵn, tạo vụ việc mới, hoặc từ chối."] },
    { icon: "▤", target: 'nav a[href="#/incidents"]', title: "4 · Vụ việc và dự án",
      body: ["Dự án gom các vụ việc theo chủ đề; mỗi người có vai trò riêng trong từng dự án (xem, biên tập, quản lý…).",
             "Một vụ việc có thuộc tính (trạng thái, ngày, vị trí, chủ đề…), tư liệu nguồn và bảng tin. Mọi thay đổi được ghi lại, có thể kèm lý do. Trong bình luận, gõ @ để nhắc một người hoặc một nhóm, ví dụ @reviewer."] },
    { icon: "◎", title: "5 · Bản công khai",
      body: ["Muốn đưa một vụ việc ra công chúng? Mở “Chuẩn bị bản công khai” trên trang vụ việc. Đó là một bản riêng, viết lại cho công chúng: vị trí được làm mờ theo chính sách (nhà riêng không bao giờ hiện chính xác), chỉ những tệp bạn chọn, và ảnh được xoá siêu dữ liệu (GPS, máy chụp).",
             "Một người có quyền (quản lý hoặc có “quyền công bố”) bấm “Duyệt và công bố”. Khi chưa chắc, dùng “Xin ý kiến thứ hai”. Có thể rút lại bất cứ lúc nào."] },
    { icon: "⇄", title: "6 · Trang cộng đồng",
      body: ["Các trang công khai (bản đồ cộng đồng, Hồ sơ Nhân quyền) chỉ làm hai việc: chuyển bài người dân gửi vào Hộp thư ở đây, và hiển thị những gì đã được duyệt công bố.",
             "Những gì đã công bố được ký số trong một nguồn dữ liệu công khai; các trang kiểm tra chữ ký trước khi hiển thị, nên không ai giả mạo được nội dung. Bài gửi mới hoặc tư liệu mới vào một vụ việc đã công bố sẽ chờ duyệt lại rồi mới hiện."] },
    { icon: "⚿", title: "7 · An toàn",
      body: ["Mã cá nhân (mlc_…) là chìa khoá của bạn: không chia sẻ, mỗi thiết bị một mã. Mất máy? Báo quản trị để thu hồi.",
             "Gửi lên Internet Archive là công khai và vĩnh viễn: chỉ làm khi chắc chắn. Liên hệ của người gửi được niêm phong; chỉ quản lý mở được và mỗi lần mở đều được ghi lại."] },
    { icon: "ⓘ", target: "#tour-btn", title: "Xong!",
      body: ["Bấm nút ⓘ ở góc trên bên phải để xem lại phần hướng dẫn này bất cứ lúc nào.",
             "Di chuột lên các nút để xem giải thích ngắn."] },
  ],
  en: [
    { icon: "◈", title: "Welcome to the MemoryLane archive",
      body: ["This is the team's internal platform: it preserves evidence from social media and the web, organises it into incidents, and prepares what will be published.",
             "Everything here is private. Nothing reaches the public until someone entitled approves it."] },
    { icon: "+", target: "#quick-save", title: "1 · Save a link",
      body: ["Press “+ Save link” (on any page) and paste a post, video or web page address.",
             "It is captured at once: full-page screenshot, video, text, with SHA-256 hashes and a sealed “manifest”, so you can later prove the copy wasn't altered. Saving again makes a new version; nothing is overwritten."] },
    { icon: "✓", title: "2 · Read the capture result",
      body: ["Each link gets a label: “Fully saved”, “Partly saved”, “Blocked by login wall”, “Restricted” (the platform withholds it; its notice is kept as evidence) or “Removed”.",
             "Captured content can be hostile: always open it through the platform's viewer, not downloaded on a personal device."] },
    { icon: "✉", target: 'nav a[href="#/inbox"]', title: "3 · Inbox",
      body: ["Everything new arrives here. Filter by source: “Internal” (links the team saved) or “Community” (submissions from the community map and Hồ sơ Nhân quyền).",
             "“Needs action” shows only what isn't filed yet. For a community submission: attach it to an incident, create a new one, or reject it."] },
    { icon: "▤", target: 'nav a[href="#/incidents"]', title: "4 · Incidents and projects",
      body: ["Projects group incidents by theme; each person has a role per project (viewer, editor, manager…).",
             "An incident has attributes (status, date, location, tags…), source material and a feed. Every change is recorded, optionally with a reason. In comments, type @ to mention a person or a group such as @reviewer."] },
    { icon: "◎", title: "5 · Public versions",
      body: ["To take an incident public, open “Prepare a public version” on its page. It is a separate record written for the public: the location is generalised by policy (private homes are never exact), only files you choose, photos stripped of metadata (GPS, camera).",
             "Someone entitled (a manager, or a member with publication access) clicks “Approve and publish”. When unsure, use “Ask for a second opinion”. You can withdraw at any time."] },
    { icon: "⇄", title: "6 · Community sites",
      body: ["The public sites (community map, Hồ sơ Nhân quyền) do two things only: forward what people submit into the Inbox here, and show what was approved for publication.",
             "Published records are signed in a public feed; the sites check the signature before showing anything, so nobody can fake content. New submissions or material added to a published incident wait for a new approval before they appear."] },
    { icon: "⚿", title: "7 · Safety",
      body: ["Your personal token (mlc_…) is your key: don't share it, one per device. Lost a device? Ask an admin to revoke it.",
             "Sending to the Internet Archive is public and permanent: only when sure. Submitters' contact details are sealed; only managers can open them, and each opening is logged."] },
    { icon: "ⓘ", target: "#tour-btn", title: "Done!",
      body: ["Press the ⓘ button at the top right to see this introduction again at any time.",
             "Hover over buttons for short explanations."] },
  ],
};
const LABELS = { vi: { next: "Tiếp", back: "Quay lại", skip: "Bỏ qua", done: "Bắt đầu dùng", of: "/" },
                 en: { next: "Next", back: "Back", skip: "Skip", done: "Start", of: "/" } };

export function startTour() {
  document.querySelector(".tour-wrap")?.remove();
  const steps = STEPS[state.lang] || STEPS.vi;
  const L = LABELS[state.lang] || LABELS.vi;
  let i = 0;
  let lit = null;
  const card = el("div", { class: "tour-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "tour-title" });
  const wrap = el("div", { class: "tour-wrap" }, card);
  const close = () => { lit?.classList.remove("tour-lit"); wrap.remove(); document.removeEventListener("keydown", onKey); localSet("onboarded", "1"); };
  const onKey = (e) => {
    if (e.key === "Escape") close();
    if (e.key === "ArrowRight") go(1);
    if (e.key === "ArrowLeft") go(-1);
  };
  const go = (d) => { const n = i + d; if (n < 0) return; if (n >= steps.length) { close(); return; } i = n; draw(); };
  function draw() {
    const s = steps[i];
    lit?.classList.remove("tour-lit");
    lit = s.target ? document.querySelector(s.target) : null;
    if (lit && !lit.hidden) lit.classList.add("tour-lit"); else lit = null;
    card.replaceChildren(
      el("div", { class: "tour-top" }, el("span", { class: "tour-icon", "aria-hidden": "true" }, s.icon),
        el("span", { class: "tour-count" }, `${i + 1}${L.of}${steps.length}`),
        el("button", { type: "button", class: "link small", onclick: close }, L.skip)),
      el("h2", { id: "tour-title" }, s.title),
      ...s.body.map((p) => el("p", {}, p)),
      el("div", { class: "tour-dots", "aria-hidden": "true" }, steps.map((_, k) => el("span", { class: k === i ? "on" : "" }))),
      el("div", { class: "row" },
        i > 0 ? el("button", { type: "button", onclick: () => go(-1) }, "← " + L.back) : "",
        el("span", { class: "spacer" }),
        el("button", { type: "button", class: "primary", id: "tour-next", onclick: () => go(1) },
          i === steps.length - 1 ? L.done : L.next + " →")));
    card.querySelector("#tour-next").focus();
  }
  document.addEventListener("keydown", onKey);
  document.body.append(wrap);
  draw();
}

// After sign-in: once per browser.
export function maybeStartTour() {
  if (!localGet("onboarded") && state.me) startTour();
}

export function tourButton() {
  const b = $("tour-btn");
  if (b) {
    b.onclick = startTour;
    b.title = state.lang === "vi" ? "Hướng dẫn sử dụng (xem lại)" : "Introduction (replay)";
    b.setAttribute("aria-label", b.title);
  }
}
