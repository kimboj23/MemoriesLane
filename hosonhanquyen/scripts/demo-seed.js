"use strict";
/**
 * Demo data for Hồ sơ Nhân quyền, made by running the real flow (for a funder demo or local testing).
 * Every case is FICTIONAL sample data: placeholder names (Nguyễn Văn A…), neutral public source pages.
 *
 *   HUB_URL=http://127.0.0.1:8700 HUB_ADMIN_TOKEN=mlc_… node scripts/demo-seed.js setup
 *       → creates the hub project "Hồ sơ Nhân quyền" (code HSNQ, attribute "Nhóm hồ sơ") and the source
 *         "ho-so-nhan-quyen"; writes .env for this site (gitignored) with the source key and feed settings.
 *   (start the site: npm start)
 *   HUB_URL=… HUB_ADMIN_TOKEN=… SITE_URL=http://127.0.0.1:3903 node scripts/demo-seed.js content
 *       → submits four sample reports and one document THROUGH THE SITE (like a visitor), then, as a reviewer in
 *         the hub, creates the incidents, waits for the captures, writes the public versions and publishes them.
 */
const fs = require("fs");
const path = require("path");

const HUB = (process.env.HUB_URL || "http://127.0.0.1:8700").replace(/\/+$/, "");
const SITE = (process.env.SITE_URL || "http://127.0.0.1:3903").replace(/\/+$/, "");
const TOKEN = process.env.HUB_ADMIN_TOKEN;
if (!TOKEN) { console.error("HUB_ADMIN_TOKEN is required (an admin token of the hub)"); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hub(method, p, body) {
  const r = await fetch(HUB + p, { method, headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  const d = t ? JSON.parse(t) : null;
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${t.slice(0, 300)}`);
  return d;
}
async function site(p, body) {
  const r = await fetch(SITE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(`${p}: ${r.status} ${JSON.stringify(d)}`);
  return d;
}

const GROUP_OPTIONS = ["Vi phạm", "Tố tụng", "Hạn chế mạng xã hội", "Phong trào xã hội"];

async function setup() {
  const { projects } = await hub("GET", "/v1/projects?include_archived=true");
  let proj = projects.find((p) => p.code === "HSNQ");
  if (!proj) {
    proj = await hub("POST", "/v1/projects", { code: "HSNQ", name: "Hồ sơ Nhân quyền", color: "#7a2e2e",
      description: "Hồ sơ trình báo và tài liệu gửi từ trang Hồ sơ Nhân quyền.",
      attributes: [{ name: "Nhóm hồ sơ", type: "select", options: GROUP_OPTIONS }] });
  }
  const me = await hub("GET", "/v1/me");
  await hub("PUT", `/v1/projects/${proj.id}/members/${me.id}/publish`, { can_publish: true }).catch(() => {});
  const routing = { case_report: proj.id, document: proj.id, link: proj.id, memory: proj.id };
  const { sources } = await hub("GET", "/v1/admin/sources");
  const existing = sources.find((s) => s.slug === "ho-so-nhan-quyen");
  const src = existing ? await hub("POST", `/v1/admin/sources/${existing.id}/rotate`)
    : await hub("POST", "/v1/admin/sources", { slug: "ho-so-nhan-quyen", name: "Hồ sơ Nhân quyền", routing });
  if (existing) await hub("PATCH", `/v1/admin/sources/${existing.id}`, { routing });
  const keys = await (await fetch(HUB + "/feed/keys.json")).json().catch(() => null);
  const envFile = path.join(__dirname, "..", ".env");
  const lines = [
    "# written by scripts/demo-seed.js setup — gitignored; contains the source key",
    `HUB_URL=${HUB}`, "HUB_SOURCE=ho-so-nhan-quyen", `HUB_INTAKE_KEY=${src.key}`,
    `HUB_FEED_URL=${process.env.HUB_FEED_URL || HUB + "/feed"}`,
    `HUB_FEED_ROOT_KEY=${process.env.HUB_FEED_ROOT_KEY || (keys && keys.root_public) || ""}`,
    "FEED_REFRESH_S=20", "PORT=3903",
    ...(process.env.TILE_URL ? [`TILE_URL=${process.env.TILE_URL}`] : []),   // map tiles (a CARTO key, if any, goes in the URL)
  ];
  fs.writeFileSync(envFile, lines.join("\n") + "\n", { mode: 0o600 });
  console.log(`project HSNQ ${proj.id}; source ho-so-nhan-quyen ${existing ? "key rotated" : "created"}; wrote ${envFile}`);
  if (!keys) console.log("NOTE: could not read the feed's keys.json; set HUB_FEED_ROOT_KEY in .env to the published root public key");
}

// Fictional sample cases. Sources are neutral public pages (no private people).
const CASES = [
  { group: "han-che-mang-xa-hoi", title: "Trang cộng đồng bị giảm hiển thị sau loạt bài về quy hoạch (dữ liệu mẫu)",
    description: "Dữ liệu mẫu. Một trang cộng đồng về đô thị (tên giả: “Phố Cũ Của Tôi”) ghi nhận lượt tiếp cận giảm hơn 80% trong ba ngày sau khi đăng loạt bài về đề án quy hoạch. Ban quản trị nhận thông báo “nội dung có thể vi phạm tiêu chuẩn cộng đồng” nhưng không nêu bài cụ thể.",
    date: "2026-03-14", place: "Quận Hoàn Kiếm, Hà Nội", lat: 21.0287, lng: 105.8523,
    fields: { "Nền tảng": "Facebook", "Loại hạn chế": "Giảm hiển thị", "Đối tượng": "Trang cộng đồng (tên giả)" },
    link: "https://vi.wikipedia.org/wiki/Ki%E1%BB%83m_duy%E1%BB%87t_Internet",
    pub: { place_kind: "online", precision: "province", precision_reason: "Trang công khai nói rõ hoạt động tại Hà Nội", place_label: "Hà Nội", status: "being_verified" } },
  { group: "to-tung", title: "Phiên toà sơ thẩm xét xử ông Nguyễn Văn A về tội “lợi dụng quyền tự do dân chủ” (dữ liệu mẫu)",
    description: "Dữ liệu mẫu. Ông Nguyễn Văn A (nhân vật giả định) bị xét xử sơ thẩm sau các bài viết trên mạng xã hội. Gia đình cho biết không được thông báo lịch xét xử trước ba ngày như quy định; luật sư đề nghị hoãn phiên toà nhưng không được chấp nhận.",
    date: "2026-05-20", place: "Toà án nhân dân TP. Hà Nội", lat: 21.0245, lng: 105.8412,
    fields: { "Số vụ án": "Mẫu-01/2026", "Toà án": "TAND TP. Hà Nội (giả định)", "Giai đoạn": "Xét xử sơ thẩm" },
    link: "https://vi.wikipedia.org/wiki/T%E1%BB%B1_do_ng%C3%B4n_lu%E1%BA%ADn",
    pub: { place_kind: "public_institution", precision: "exact", place_label: "Trụ sở toà án, Hà Nội", status: "verified" } },
  { group: "vi-pham", title: "Cưỡng chế giải toả khu dân cư ven sông khi chưa có quyết định bồi thường (dữ liệu mẫu)",
    description: "Dữ liệu mẫu. Khoảng 40 hộ (số liệu giả định) cho biết lực lượng cưỡng chế đến lúc sáng sớm, khi nhiều hộ chưa nhận quyết định bồi thường. Một số đồ đạc bị thu giữ; người dân được yêu cầu ký biên bản ngay tại chỗ.",
    date: "2026-07-02", place: "Phường ven sông, Hà Nội", lat: 21.0452, lng: 105.8630,
    fields: { "Bên liên quan": "Ban giải phóng mặt bằng (giả định)", "Hành vi": "Cưỡng chế khi chưa có quyết định bồi thường" },
    link: "https://vi.wikipedia.org/wiki/Quy%E1%BB%81n_con_ng%C6%B0%E1%BB%9Di",
    pub: { place_kind: "private_city", precision: "ward", place_label: "Ven sông Hồng, Hà Nội", status: "being_verified" } },
  { group: "phong-trao-xa-hoi", title: "Mạng lưới tình nguyện bảo vệ cây xanh đô thị (dữ liệu mẫu)",
    description: "Dữ liệu mẫu. Một mạng lưới tình nguyện (tên giả: “Xanh Phố”) vận động giữ lại hàng cây cổ thụ trên một tuyến phố trước dự án mở rộng đường, bằng kiến nghị và các buổi gặp gỡ công khai.",
    date: "2026-04-01", place: "Hà Nội", lat: 21.0368, lng: 105.8342,
    fields: { "Mục tiêu": "Giữ lại hàng cây và công khai đánh giá tác động", "Phạm vi": "Địa phương", "Tình trạng": "Đang hoạt động" },
    link: "https://vi.wikipedia.org/wiki/M%C3%B4i_tr%C6%B0%E1%BB%9Dng",
    pub: { place_kind: "public_gathering", precision: "street", place_label: "Một tuyến phố ở Ba Đình, Hà Nội", status: "reported" } },
];

// a small PNG so the demo shows a contributor file being cleaned and published
function samplePng() {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAAAwCAIAAABhdOiYAAAAZElEQVR4nO3QMQ0AIADAMHzhAq/4wwGc7GgyAUvHXlOXxveDeIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBygRwceGKVL3xVq5wAAAABJRU5ErkJggg==";
}

async function content() {
  const { projects } = await hub("GET", "/v1/projects?include_archived=true");
  const proj = projects.find((p) => p.code === "HSNQ");
  if (!proj) throw new Error("run `setup` first");
  const receipts = [];
  for (const c of CASES) {
    const r = await site("/api/report", { group: c.group, title: c.title, description: c.description, date: c.date, place: c.place,
      lat: c.lat, lng: c.lng, link: c.link, fields: { "Cách biết thông tin": "Tài liệu hoặc thông báo chính thức", ...c.fields },
      alias: "", anonymous: true, consent: true });
    receipts.push(r.receipt);
    console.log("submitted via the site:", c.title.slice(0, 60), "· receipt", r.receipt);
  }
  await sleep(1500);
  const { intake } = await hub("GET", `/v1/intake?project_id=${proj.id}&state=new&limit=200`);
  const published = [];
  for (const c of CASES) {
    const k = intake.find((x) => x.summary === c.title);
    if (!k) { console.warn("not in the hub inbox yet:", c.title); continue; }
    const made = await hub("POST", `/v1/intake/${k.id}/create`, {});
    const incId = made.created_incident_id;
    published.push({ c, incId });
  }
  // a community document for the court case, through the site's /submit, filed under that incident
  const court = published.find((x) => x.c.group === "to-tung");
  if (court) {
    await site("/api/submit", { doc_type: "Ảnh chụp màn hình", title: "Ảnh thông báo lịch xét xử (dữ liệu mẫu)",
      context: "Dữ liệu mẫu: ảnh minh hoạ thay cho thông báo lịch xét xử gia đình nhận được.", anonymous: true, consent: true,
      file: { name: "thong-bao.png", data: samplePng() } });
    await sleep(1500);
    const { intake: docs } = await hub("GET", `/v1/intake?project_id=${proj.id}&state=new&limit=50`);
    const doc = docs.find((x) => x.summary.startsWith("Ảnh thông báo lịch xét xử"));
    if (doc) await hub("POST", `/v1/intake/${doc.id}/attach`, { incident_id: court.incId });
  }
  console.log("waiting for the archive to capture the source links…");
  for (const { incId } of published) {
    for (let i = 0; i < 90; i++) {
      const inc = await hub("GET", `/v1/incidents/${incId}`);
      if (inc.material.every((m) => m.latest_capture && m.latest_capture.state === "done")) break;
      await sleep(2000);
    }
  }
  for (const { c, incId } of published) {
    const pub = await hub("POST", `/v1/incidents/${incId}/publication`);
    await hub("PATCH", `/v1/publications/${pub.id}`, {
      title_vi: c.title, summary_vi: c.description, public_status: c.pub.status,
      group: { "vi-pham": "Vi phạm", "to-tung": "Tố tụng", "han-che-mang-xa-hoi": "Hạn chế mạng xã hội", "phong-trao-xa-hoi": "Phong trào xã hội" }[c.group],
      place_kind: c.pub.place_kind, precision: c.pub.precision, precision_reason: c.pub.precision_reason || null,
      place_label: c.pub.place_label, date: c.date, date_precision: c.group === "to-tung" ? "day" : "month",
      tags: ["dữ liệu mẫu"],
    });
    const done = await hub("POST", `/v1/publications/${pub.id}/approve`);
    console.log("published", done.public_id, "·", c.title.slice(0, 50));
  }
  console.log("\nreceipts (check on the site's /bien-nhan):", receipts.join("  "));
  console.log("the site shows them after its next feed refresh (FEED_REFRESH_S) — or POST", SITE + "/api/feed-changed");
  await fetch(SITE + "/api/feed-changed", { method: "POST" }).catch(() => {});
}

const cmd = process.argv[2];
(cmd === "setup" ? setup() : cmd === "content" ? content() : Promise.reject(new Error("usage: demo-seed.js setup|content")))
  .catch((e) => { console.error(e.message); process.exit(1); });
