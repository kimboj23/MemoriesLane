// Hồ sơ Nhân quyền: pages, routed in the browser. Everything shown comes from /api/* (the hub's verified feed);
// every form goes to /api/report or /api/submit (forwarded to the hub). Text is inserted with textContent only.

const $ = (s, r = document) => r.querySelector(s);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "value") n.value = v;
    else if (k === "checked") n.checked = !!v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false && c !== "") n.append(c instanceof Node ? c : String(c));
  return n;
}
const api = async (p, opts) => {
  const r = await fetch(p, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
};
const vi = (x) => (x && (x.vi || x.en)) || "";
const fmtDate = (d) => !d ? "" : d.precision === "year" ? d.value : d.precision === "month" ? `tháng ${+d.value.slice(5, 7)}/${d.value.slice(0, 4)}`
  : new Date(d.value + "T00:00:00").toLocaleDateString("vi-VN");
const fmtTime = (s) => s ? new Date(s).toLocaleString("vi-VN") : "";
const LEVEL = { exact: "vị trí chính xác (nơi công cộng)", street: "khu vực ~250 m", ward: "khu vực phường/xã ~2–3 km",
                province: "khu vực tỉnh/thành", none: "không hiện trên bản đồ" };

const GROUPS = [
  { slug: "vi-pham", name: "Vi phạm", title: "Vụ việc và vi phạm", key: "violation",
    desc: "Một sự kiện, chuỗi sự kiện hoặc hành vi cụ thể có thể ảnh hưởng tới quyền con người.",
    asks: ["Ngày và địa điểm", "Mô tả hành vi cụ thể", "Nguồn hoặc tài liệu ban đầu"] },
  { slug: "to-tung", name: "Tố tụng", title: "Vụ án và tố tụng", key: "proceeding",
    desc: "Một vụ án, các quyết định tố tụng, phiên toà, bản án và tình trạng kháng cáo.",
    asks: ["Số vụ án nếu có", "Toà án và giai đoạn tố tụng", "Tài liệu hoặc nguồn"] },
  { slug: "han-che-mang-xa-hoi", name: "Hạn chế mạng xã hội", title: "Hạn chế mạng xã hội", key: "platform_restriction",
    desc: "Gỡ nội dung, khoá tài khoản, giảm hiển thị, chặn theo vùng hoặc chặn trang web.",
    asks: ["Tên nền tảng hoặc nhà mạng", "Loại hạn chế và ngày", "Ảnh chụp, thông báo hoặc kết quả đo"] },
  { slug: "phong-trao-xa-hoi", name: "Phong trào xã hội", title: "Phong trào xã hội", key: "movement",
    desc: "Mục tiêu, phạm vi, hoạt động và các mốc của một chiến dịch hoặc mạng lưới.",
    asks: ["Mục tiêu đã công bố", "Phạm vi và tình trạng hoạt động", "Nguồn công khai cho các mốc chính"] },
];
const groupBySlug = Object.fromEntries(GROUPS.map((g) => [g.slug, g]));
const STATUS = { reported: "Được trình báo", being_verified: "Đang xác minh", verified: "Đã xác minh" };
const MAT_STATUS = { archived: "Đã lưu đầy đủ", partially_archived: "Lưu được một phần", restricted: "Bị nền tảng hạn chế",
                     login_wall: "Bị chặn đăng nhập", unavailable: "Đã bị gỡ" };
const PLATFORM = { facebook: "Facebook", threads: "Threads", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", x: "X", web: "Trang web" };

let config = null;
async function getConfig() { return config || (config = await api("/api/config")); }

// ---- router ---------------------------------------------------------------------------------------------
const routes = [
  [/^\/$/, home], [/^\/ho-so\/([\w-]+)$/, casePage], [/^\/chung-cu$/, evidence], [/^\/ban-do$/, mapPage],
  [/^\/report-case$/, reportChooser], [/^\/report-case\/([\w-]+)$/, reportForm], [/^\/submit$/, submitForm],
  [/^\/bien-nhan$/, receiptPage], [/^\/cach-hoat-dong$/, howPage],
];
async function route() {
  const main = $("#main");
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const hit = routes.find(([re]) => re.test(path));
  document.querySelectorAll(".main-nav a").forEach((a) => a.setAttribute("aria-current", String(a.getAttribute("href") === path)));
  if (!hit) { main.replaceChildren(el("h1", {}, "Không tìm thấy trang"), el("p", {}, el("a", { href: "/", "data-link": true }, "Về trang chủ"))); return; }
  main.replaceChildren(el("p", { class: "muted" }, "Đang tải…"));
  try { await hit[1](main, ...path.match(hit[0]).slice(1)); }
  catch (e) { main.replaceChildren(el("p", { class: "error" }, e.message)); }
  window.scrollTo(0, 0);
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  history.pushState(null, "", a.getAttribute("href"));
  route();
});
window.addEventListener("popstate", route);
const link = (href, ...kids) => el("a", { href, "data-link": true }, ...kids);

// ---- shared pieces ---------------------------------------------------------------------------------------------
function caseCard(c) {
  const g = groupBySlug[c.group_slug];
  return el("article", { class: "case-card" },
    el("div", { class: "row" }, el("span", { class: `tag g-${c.group_slug || "khac"}` }, g ? g.title : (c.group || "Khác")),
      el("span", { class: `status s-${c.status}` }, STATUS[c.status] || c.status || ""), el("span", { class: "spacer" }),
      el("span", { class: "muted small" }, fmtDate(c.date))),
    el("h3", {}, link(`/ho-so/${c.id}`, vi(c.title))),
    el("p", { class: "clamp" }, vi(c.summary)),
    el("div", { class: "row muted small" }, `${c.material_count ?? c.materials?.length ?? 0} tư liệu nguồn`, " · ",
      `${c.note_count ?? c.notes?.length ?? 0} ghi chú cộng đồng`, c.location?.label ? ` · ${c.location.label}` : ""));
}

async function mapInto(node, cases, { height = 420 } = {}) {
  const cfg = await getConfig();
  node.style.height = height + "px";
  const wait = () => new Promise((r) => (window.L ? r() : setTimeout(() => wait().then(r), 50)));
  await wait();
  const map = L.map(node, { scrollWheelZoom: false }).setView([16.2, 106.3], 5);
  L.tileLayer(cfg.tile_url, { subdomains: "abcd", maxZoom: 18, attribution: "© OpenStreetMap · © CARTO" }).addTo(map);
  const pts = [];
  for (const c of cases) {
    const loc = c.location;
    if (!loc || loc.lat == null) continue;
    pts.push([loc.lat, loc.lng]);
    const m = L.circleMarker([loc.lat, loc.lng], { radius: 8, color: "#7a2e2e", weight: 2, fillColor: "#b5523b", fillOpacity: 0.85 }).addTo(map);
    const pop = el("div", { class: "pop" }, el("strong", {}, vi(c.title)), el("br"),
      el("span", { class: "muted small" }, `${loc.label ? loc.label + " · " : ""}${LEVEL[loc.precision] || ""}`), el("br"),
      el("a", { href: `/ho-so/${c.id}`, "data-link": true }, "Mở hồ sơ →"));
    m.bindPopup(pop);
  }
  if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 11 });
  return map;
}

// ---- pages ----------------------------------------------------------------------------------------------------------
async function home(main) {
  const params = new URLSearchParams(location.search);
  const q = params.get("q") || "", g = params.get("nhom") || "";
  const [data, status] = await Promise.all([api(`/api/cases?${new URLSearchParams({ q, group: g })}`), api("/api/status")]);
  const all = await api("/api/cases");
  const search = el("input", { type: "search", value: q, placeholder: "Tìm theo tiêu đề, nội dung, chủ đề…", "aria-label": "Tìm hồ sơ" });
  const go = (o) => { const p = new URLSearchParams({ q: search.value.trim(), nhom: g, ...o }); for (const [k, v] of [...p]) if (!v) p.delete(k);
    history.pushState(null, "", "/" + (p.toString() ? "?" + p : "")); route(); };
  const mapBox = el("div", { class: "map", id: "map" });
  main.replaceChildren(
    el("section", { class: "hero" },
      el("p", { class: "eyebrow" }, "Cơ sở dữ liệu công ích · Việt Nam"),
      el("h1", {}, "Hồ sơ theo từng nhóm.", el("br"), el("em", {}, "Nguồn cho từng dữ kiện.")),
      el("p", { class: "lede" }, "Vụ việc, vụ án, hạn chế nền tảng và phong trào xã hội: mỗi hồ sơ kèm tư liệu nguồn đã được lưu trữ, niêm phong và có mã băm để ai cũng kiểm chứng được."),
      el("div", { class: "row" }, el("a", { class: "btn", href: "/report-case", "data-link": true }, "Trình báo hồ sơ mới"),
        el("a", { class: "btn ghost", href: "/submit", "data-link": true }, "Gửi tài liệu"))),
    el("section", { class: "stats" },
      [["Hồ sơ đã công bố", status.cases], ["Tư liệu nguồn", status.materials], ["Ghi chú cộng đồng", status.notes], ["Nhóm hồ sơ", 4]]
        .map(([k, v]) => el("div", { class: "stat" }, el("strong", {}, String(v ?? 0)), el("span", {}, k)))),
    el("section", {},
      el("div", { class: "sec-head" }, el("h2", {}, "Danh mục hồ sơ"), el("span", { class: "muted" }, "Duyệt theo nhóm dữ liệu")),
      el("div", { class: "groups" }, GROUPS.map((x) => el("button", { class: "group" + (g === x.slug ? " on" : ""), type: "button",
        onclick: () => go({ nhom: g === x.slug ? "" : x.slug }) },
        el("span", { class: `tag g-${x.slug}` }, x.title), el("strong", {}, String(all.counts[x.slug] || 0)), el("span", { class: "muted small" }, x.desc)))),
      el("form", { class: "search", onsubmit: (e) => { e.preventDefault(); go({}); } }, search, el("button", { class: "btn", type: "submit" }, "Tìm")),
      g || q ? el("p", { class: "muted" }, `${data.cases.length} hồ sơ phù hợp `, el("button", { class: "link", type: "button", onclick: () => go({ q: "", nhom: "" }) }, "· xoá bộ lọc")) : "",
      data.cases.length ? el("div", { class: "cases" }, data.cases.map(caseCard)) : el("p", { class: "muted empty" }, "Chưa có hồ sơ nào phù hợp.")),
    el("section", {},
      el("div", { class: "sec-head" }, el("h2", {}, "Bản đồ công khai có kiểm soát"), el("span", { class: "muted" }, "Vị trí chỉ hiển thị ở độ chính xác an toàn")),
      mapBox));
  const full = await Promise.all(all.cases.map((c) => api(`/api/cases/${c.id}`)));
  await mapInto(mapBox, full);
}

function fileView(f) {
  const label = f.provided_by === "contributor" ? "Do người đóng góp cung cấp" : ({ "full-page": "Toàn trang", embed: "Bản nhúng", "restriction-notice": "Thông báo hạn chế", image: "Ảnh", video: "Video" }[f.label] || "Bản lưu");
  const media = f.kind === "video" ? el("video", { src: f.url, controls: true, preload: "metadata" })
    : f.kind === "audio" ? el("audio", { src: f.url, controls: true })
    : el("a", { href: f.url, target: "_blank", rel: "noopener" }, el("img", { src: f.url, alt: label, loading: "lazy" }));
  return el("figure", { class: "file" }, media, el("figcaption", {}, label, el("code", { class: "hash", title: "SHA-256 của bản công bố" }, f.sha256.slice(0, 16) + "…")));
}

async function casePage(main, id) {
  const c = await api(`/api/cases/${id}`);
  const g = groupBySlug[c.group_slug];
  const mapBox = el("div", { class: "map small" });
  main.replaceChildren(
    el("p", {}, link("/", "← Tra cứu")),
    el("article", { class: "case" },
      el("div", { class: "row" }, el("span", { class: `tag g-${c.group_slug || "khac"}` }, g ? g.title : (c.group || "Khác")),
        el("span", { class: `status s-${c.status}` }, STATUS[c.status] || ""), el("span", { class: "spacer" }),
        el("span", { class: "muted small" }, `Mã công khai ${c.id} · phiên bản ${c.version}`)),
      el("h1", {}, vi(c.title)),
      el("p", { class: "lede pre" }, vi(c.summary)),
      el("dl", { class: "facts" },
        el("dt", {}, "Thời gian"), el("dd", {}, fmtDate(c.date) || "—"),
        el("dt", {}, "Khu vực"), el("dd", {}, c.location ? `${c.location.label || ""} ${c.location.label ? "· " : ""}${LEVEL[c.location.precision] || ""}` : "Không công bố vị trí"),
        el("dt", {}, "Công bố"), el("dd", {}, fmtTime(c.published_at)),
        (c.tags || []).length ? [el("dt", {}, "Chủ đề"), el("dd", {}, c.tags.join(", "))] : ""),
      c.location?.lat != null ? mapBox : "",
      c.notes.length ? el("section", {}, el("h2", {}, "Lời kể từ cộng đồng"),
        c.notes.map((n) => el("blockquote", { class: "note" }, el("p", { class: "pre" }, vi(n.text)),
          el("footer", {}, [n.credit || "Ẩn danh", fmtDate(n.date)].filter(Boolean).join(" · "))))) : "",
      el("section", {}, el("h2", {}, "Tư liệu nguồn"),
        el("p", { class: "muted small" }, "Mỗi tư liệu được kho lưu trữ chụp và niêm phong. Mã băm manifest cho phép đối chiếu với bản lưu gốc; mã băm từng tệp cho phép kiểm tra bản bạn tải về chưa bị thay đổi."),
        c.materials.length ? c.materials.map(materialCard) : el("p", { class: "muted" }, "Chưa có tư liệu nguồn được công bố.")),
      c.community_files.length ? el("section", {}, el("h2", {}, "Tài liệu do cộng đồng gửi"),
        el("div", { class: "files" }, c.community_files.map(fileView))) : "",
      el("p", {}, el("a", { class: "btn ghost", href: `/submit?ho-so=${c.id}`, "data-link": true }, "Gửi thêm tài liệu cho hồ sơ này"))));
  if (c.location?.lat != null) await mapInto(mapBox, [c], { height: 260 });
}

function materialCard(m) {
  return el("div", { class: "material" },
    el("div", { class: "row" }, el("strong", {}, PLATFORM[m.platform] || m.platform || "Nguồn"),
      el("span", { class: `mstatus m-${m.status}` }, MAT_STATUS[m.status] || m.status), el("span", { class: "spacer" }),
      el("span", { class: "muted small" }, m.captured_at ? "Lưu lúc " + fmtTime(m.captured_at) : "")),
    m.title ? el("p", {}, m.title) : "", vi(m.summary) ? el("p", { class: "pre" }, vi(m.summary)) : "",
    m.files.length ? el("div", { class: "files" }, m.files.map(fileView)) : "",
    el("div", { class: "row small" },
      m.original_url ? el("a", { href: m.original_url, target: "_blank", rel: "noopener noreferrer nofollow" }, "Nguồn gốc ↗") : el("span", { class: "muted" }, "Liên kết gốc không công bố"),
      m.wayback_url ? el("a", { href: m.wayback_url, target: "_blank", rel: "noopener noreferrer" }, "Bản sao Internet Archive ↗") : "",
      el("span", { class: "spacer" }),
      m.manifest_sha256 ? el("code", { class: "hash", title: "SHA-256 của manifest bản lưu" }, "manifest " + m.manifest_sha256.slice(0, 20) + "…") : ""));
}

async function evidence(main) {
  const q = new URLSearchParams(location.search).get("q") || "";
  const d = await api(`/api/evidence?q=${encodeURIComponent(q)}`);
  const search = el("input", { type: "search", value: q, placeholder: "Tìm theo nền tảng, tiêu đề, hồ sơ…", "aria-label": "Tìm chứng cứ" });
  main.replaceChildren(
    el("h1", {}, "Kho tư liệu đã kiểm duyệt"),
    el("p", { class: "lede" }, "Tra cứu chứng cứ và nguồn: văn bản, hình ảnh, video và bản lưu web. Trang này không tự tải nội dung từ nguồn bên ngoài; mọi tệp đến từ kho lưu trữ và được kiểm tra mã băm trước khi hiển thị."),
    el("form", { class: "search", onsubmit: (e) => { e.preventDefault(); history.pushState(null, "", `/chung-cu?q=${encodeURIComponent(search.value.trim())}`); route(); } },
      search, el("button", { class: "btn", type: "submit" }, "Tìm")),
    el("details", { class: "howto" }, el("summary", {}, "Cách tự kiểm chứng một tệp"),
      el("ol", {}, el("li", {}, "Tải tệp về (bấm vào ảnh hoặc video)."),
        el("li", {}, "Tính SHA-256: trên Windows ", el("code", {}, "certutil -hashfile tệp SHA256"), ", trên macOS/Linux ", el("code", {}, "shasum -a 256 tệp"), "."),
        el("li", {}, "So với mã băm hiển thị cạnh tệp. Khớp nghĩa là tệp không bị sửa sau khi công bố."))),
    d.evidence.length ? d.evidence.map((m) => el("div", {}, el("p", { class: "muted small" }, "Hồ sơ: ", link(`/ho-so/${m.case.id}`, vi(m.case.title))), materialCard(m)))
      : el("p", { class: "muted empty" }, "Chưa có tư liệu phù hợp."));
}

async function mapPage(main) {
  const list = await api("/api/cases");
  const full = await Promise.all(list.cases.map((c) => api(`/api/cases/${c.id}`)));
  const box = el("div", { class: "map" });
  main.replaceChildren(el("h1", {}, "Bản đồ công khai có kiểm soát"),
    el("p", { class: "lede" }, "Vị trí chỉ hiển thị ở độ chính xác an toàn: nhà riêng chỉ hiện ở mức phường/xã hoặc tỉnh; chỉ nơi công cộng mới có thể hiện chính xác. Hồ sơ không có vị trí công khai sẽ không xuất hiện ở đây."), box);
  await mapInto(box, full, { height: 560 });
}

// ---- forms ---------------------------------------------------------------------------------------------------------------
const ACCEPT = ".pdf,.txt,.jpg,.jpeg,.png,.webp,.mp4,.webm";
function readFile(input) {
  const f = input.files && input.files[0];
  if (!f) return Promise.resolve(null);
  if (f.size > 20 * 1024 * 1024) return Promise.reject(new Error("Tệp quá 20 MB."));
  return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok({ name: f.name, data: r.result }); r.onerror = () => bad(new Error("Không đọc được tệp.")); r.readAsDataURL(f); });
}
async function seal(contact) {
  if (!contact) return null;
  const { public_key } = await api("/api/contact-key");
  if (!public_key) throw new Error("Không mã hoá được thông tin liên hệ lúc này. Hãy để trống hoặc thử lại sau.");
  const sodium = (await import("/vendor/sodium.mjs")).default;
  await sodium.ready;
  const pk = sodium.from_base64(public_key, sodium.base64_variants.ORIGINAL);
  return sodium.to_base64(sodium.crypto_box_seal(sodium.from_string(contact), pk), sodium.base64_variants.ORIGINAL);
}
const field = (label, input, help, req) => el("label", { class: "field" }, el("span", {}, label, req ? el("b", { class: "req" }, " *") : ""), input,
  help ? el("small", {}, help) : "");
function privacyBlock() {
  const alias = el("input", { maxlength: "80", autocomplete: "off" });
  const contact = el("input", { maxlength: "300", autocomplete: "off", placeholder: "Ví dụ: Signal, email riêng…" });
  const anon = el("input", { type: "checkbox", checked: true });
  return { alias, contact, anon, node: el("fieldset", {}, el("legend", {}, "Thông tin người gửi — không bắt buộc"),
    el("p", { class: "muted small" }, "Có thể gửi ẩn danh. Đừng ghi thông tin có thể nhận dạng bạn hoặc người khác nếu điều đó làm tăng rủi ro."),
    field("Tên hoặc bí danh", alias, "Nếu điền, có thể được ghi công khi công bố."),
    field("Kênh liên lạc an toàn", contact, "Được mã hoá ngay trên trình duyệt của bạn; chỉ người quản lý hồ sơ mở được, và mỗi lần mở đều được ghi lại. Để trống để ẩn danh hoàn toàn."),
    el("label", { class: "check" }, anon, " Gửi ẩn danh (không liên kết với tài khoản nào)")) };
}
function receiptBox(code) {
  const url = `${location.origin}/bien-nhan#${code}`;
  return el("div", { class: "receipt" }, el("h2", {}, "Đã nhận. Cảm ơn bạn."),
    el("p", {}, "Nội dung đã được chuyển vào kho lưu trữ, cách ly và chờ nhóm biên tập xem xét. Không có gì được công bố tự động."),
    el("p", {}, "Mã biên nhận (hãy lưu lại; đây là cách duy nhất để kiểm tra trạng thái):"),
    el("code", { class: "code" }, code),
    el("p", { class: "small" }, "Kiểm tra sau tại trang ", link("/bien-nhan", "Kiểm tra biên nhận"), ", hoặc lưu đường dẫn: ", el("code", {}, url)));
}

function reportChooser(main) {
  main.replaceChildren(
    el("h1", {}, "Đề nghị mở hồ sơ mới"),
    el("p", { class: "lede" }, "Chọn đúng nhóm dữ liệu để bắt đầu. Mỗi nhóm có biểu mẫu riêng. Gửi thông tin không có nghĩa là sẽ được công bố: nhóm biên tập đánh giá an toàn, xác minh nguồn và soạn một bản công khai riêng."),
    el("div", { class: "notices" }, [["Không công khai ngay", "Chỉ nhóm biên tập thấy nội dung bạn gửi."], ["Có thể gửi ẩn danh", "Không cần danh tính."],
      ["Kiểm tra trước khi công bố", "Phân loại, xác minh, rồi mới duyệt."]].map(([h, p]) => el("div", { class: "notice" }, el("strong", {}, h), el("p", {}, p)))),
    el("div", { class: "groups" }, GROUPS.map((g) => el("div", { class: "group static" }, el("span", { class: `tag g-${g.slug}` }, g.title),
      el("p", {}, g.desc), el("ul", {}, g.asks.map((a) => el("li", {}, a))),
      el("a", { class: "btn", href: `/report-case/${g.slug}`, "data-link": true }, "Bắt đầu biểu mẫu")))),
    el("p", { class: "muted" }, "Không chắc nên chọn nhóm nào? Chọn nhóm gần nhất; nhóm biên tập có thể phân loại lại mà không mất nội dung hay tài liệu gốc."));
}

const GROUP_FIELDS = {
  "vi-pham": [["Nơi xảy ra", "place"], ["Cơ quan hoặc cá nhân liên quan", "Bên liên quan"], ["Hành vi cụ thể", "Hành vi"]],
  "to-tung": [["Số vụ án (nếu có)", "Số vụ án"], ["Toà án", "Toà án"], ["Giai đoạn tố tụng", "Giai đoạn", ["Khởi tố", "Điều tra", "Truy tố", "Xét xử sơ thẩm", "Phúc thẩm", "Thi hành án", "Khác"]]],
  "han-che-mang-xa-hoi": [["Nền tảng hoặc nhà mạng", "Nền tảng", ["Facebook", "YouTube", "TikTok", "Threads", "Instagram", "X", "Nhà mạng Internet", "Khác"]],
    ["Loại hạn chế", "Loại hạn chế", ["Gỡ nội dung", "Khoá tài khoản", "Giảm hiển thị", "Chặn theo vùng", "Chặn trang web", "Khác"]], ["Đối tượng bị hạn chế", "Đối tượng"]],
  "phong-trao-xa-hoi": [["Mục tiêu đã công bố", "Mục tiêu"], ["Phạm vi", "Phạm vi", ["Địa phương", "Toàn quốc", "Trực tuyến", "Quốc tế"]], ["Tình trạng hoạt động", "Tình trạng", ["Đang hoạt động", "Tạm ngừng", "Đã kết thúc"]]],
};

function reportForm(main, slug) {
  const g = groupBySlug[slug];
  if (!g) { history.replaceState(null, "", "/report-case"); return reportChooser(main); }
  const title = el("input", { required: true, maxlength: "300" });
  const desc = el("textarea", { required: true, rows: "6", maxlength: "10000" });
  const timeline = el("textarea", { rows: "3", maxlength: "10000" });
  const date = el("input", { type: "date" });
  const place = el("input", { maxlength: "200", placeholder: "Ví dụ: Quận 1, TP.HCM (không ghi địa chỉ nhà)" });
  const lat = el("input", { type: "number", step: "any", min: "-90", max: "90" });
  const lng = el("input", { type: "number", step: "any", min: "-180", max: "180" });
  const link_ = el("input", { type: "url", placeholder: "https://…" });
  const file = el("input", { type: "file", accept: ACCEPT });
  const howKnow = el("select", { required: true }, el("option", { value: "" }, "— Chọn —"),
    ["Tôi trực tiếp chứng kiến", "Người trong cuộc kể lại", "Tài liệu hoặc thông báo chính thức", "Báo chí hoặc mạng xã hội", "Khác"].map((x) => el("option", {}, x)));
  const consent = el("input", { type: "checkbox", required: true });
  const extra = (GROUP_FIELDS[slug] || []).filter(([, k]) => k !== "place").map(([label, key, opts]) => ({ key,
    input: opts ? el("select", {}, el("option", { value: "" }, "— Chọn —"), opts.map((o) => el("option", {}, o))) : el("input", { maxlength: "2000" }), label }));
  const priv = privacyBlock();
  const out = el("div");
  const btn = el("button", { class: "btn", type: "submit" }, "Gửi đề nghị");
  main.replaceChildren(
    el("p", {}, link("/report-case", "← Chọn nhóm khác")),
    el("h1", {}, "Đề nghị mở hồ sơ: ", g.title), el("p", { class: "lede" }, g.desc),
    el("form", { class: "form", onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; btn.textContent = "Đang gửi an toàn…";
      try {
        const fields = { "Cách biết thông tin": howKnow.value };
        for (const x of extra) if (x.input.value) fields[x.key] = x.input.value;
        const r = await api("/api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          group: slug, title: title.value, description: desc.value, timeline: timeline.value, date: date.value, place: place.value,
          lat: lat.value, lng: lng.value, link: link_.value, fields, alias: priv.alias.value, anonymous: priv.anon.checked,
          contact_sealed: await seal(priv.contact.value.trim()), consent: consent.checked, file: await readFile(file) }) });
        main.replaceChildren(receiptBox(r.receipt));
      } catch (err) { out.replaceChildren(el("p", { class: "error" }, err.message)); btn.disabled = false; btn.textContent = "Gửi đề nghị"; }
    } },
      el("fieldset", {}, el("legend", {}, "01 · Thông tin cơ bản"),
        el("p", { class: "muted small" }, "Nhóm dữ liệu đã chọn: ", el("strong", {}, g.title)),
        field("Tiêu đề đề nghị mở hồ sơ", title, null, true),
        el("div", { class: "two" }, field("Ngày xảy ra / quan sát đầu tiên", date), field("Khu vực", place)),
        extra.map((x) => field(x.label, x.input))),
      el("fieldset", {}, el("legend", {}, "02 · Mô tả và tác động"),
        el("p", { class: "muted small" }, "Ghi chính xác điều đã xảy ra hoặc quan sát được; không suy đoán nếu chưa có nguồn."),
        field("Tóm tắt có cấu trúc", desc, "Ai, cái gì, khi nào, ở đâu, nguồn nào.", true), field("Diễn biến theo thời gian", timeline)),
      el("fieldset", {}, el("legend", {}, "03 · Vị trí chính xác — không bắt buộc"),
        el("p", { class: "muted small" }, "Chỉ cung cấp toạ độ nếu điều đó không làm lộ nơi ở hoặc vị trí của người có nguy cơ. Bản công khai sẽ chỉ hiện khu vực ước lượng."),
        el("div", { class: "two" }, field("Vĩ độ", lat), field("Kinh độ", lng))),
      el("fieldset", {}, el("legend", {}, "04 · Tài liệu ban đầu — không bắt buộc"),
        el("p", { class: "muted small" }, "Tệp được kiểm tra định dạng, ghi mã băm, đưa vào khu vực cách ly và không tự động công khai."),
        field("Chọn tệp tối đa 20 MB", file, "PDF, TXT, JPG, PNG, WEBP, MP4 hoặc WEBM. Word/Excel: chuyển sang PDF hoặc gửi liên kết HTTPS."),
        field("Liên kết nguồn (HTTPS)", link_, "Liên kết sẽ được kho lưu trữ chụp lại ngay khi nhận, trước khi có thể bị gỡ.")),
      el("fieldset", {}, el("legend", {}, "05 · Mối liên hệ và quyền riêng tư"),
        field("Bạn biết thông tin theo cách nào?", howKnow, null, true), priv.node,
        el("label", { class: "check" }, consent, " Tôi có cơ sở hợp lý để cung cấp thông tin này. Tôi hiểu đề nghị sẽ được kiểm tra và có thể không được công bố. ", el("b", { class: "req" }, "*"))),
      out, btn));
}

async function submitForm(main) {
  const pre = new URLSearchParams(location.search).get("ho-so") || "";
  const { cases } = await api("/api/cases");
  const caseSel = el("select", {}, el("option", { value: "" }, "— Hồ sơ mới / chưa rõ —"),
    cases.map((c) => el("option", { value: c.id, selected: c.id === pre }, `${vi(c.title)} (${c.id})`)));
  const docType = el("select", { required: true }, el("option", { value: "" }, "— Chọn —"),
    ["Văn bản chính thức", "Quyết định / bản án", "Ảnh chụp màn hình", "Ảnh", "Video", "Thông báo của nền tảng", "Kết quả đo kiểm mạng", "Bài báo", "Khác"].map((x) => el("option", {}, x)));
  const title = el("input", { required: true, maxlength: "300" });
  const context = el("textarea", { rows: "5", maxlength: "10000" });
  const file = el("input", { type: "file", accept: ACCEPT });
  const alt = el("input", { type: "url", placeholder: "https://…" });
  const consent = el("input", { type: "checkbox", required: true });
  const priv = privacyBlock();
  const out = el("div");
  const btn = el("button", { class: "btn", type: "submit" }, "Gửi tài liệu");
  main.replaceChildren(
    el("h1", {}, "Gửi tài liệu"),
    el("div", { class: "notices" }, [["Lưu trữ riêng tư", "Không công khai trước khi kiểm duyệt."], ["Có thể ẩn danh", "Thông tin liên hệ không bắt buộc."],
      ["Cách ly tệp", "Tệp được kiểm tra, cách ly, không bao giờ tự công bố."]].map(([h, p]) => el("div", { class: "notice" }, el("strong", {}, h), el("p", {}, p)))),
    el("form", { class: "form", onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; btn.textContent = "Đang gửi an toàn…";
      try {
        const r = await api("/api/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          case_ref: caseSel.value, doc_type: docType.value, title: title.value, context: context.value, alt_link: alt.value,
          alias: priv.alias.value, anonymous: priv.anon.checked, contact_sealed: await seal(priv.contact.value.trim()),
          consent: consent.checked, file: await readFile(file) }) });
        main.replaceChildren(receiptBox(r.receipt));
      } catch (err) { out.replaceChildren(el("p", { class: "error" }, err.message)); btn.disabled = false; btn.textContent = "Gửi tài liệu"; }
    } },
      el("fieldset", {}, el("legend", {}, "01 · Tài liệu thuộc hồ sơ nào?"), field("Hồ sơ", caseSel, "Có thể để trống nếu đây là một vụ việc mới.")),
      el("fieldset", {}, el("legend", {}, "02 · Mô tả chứng cứ"), field("Loại tài liệu", docType, null, true), field("Tiêu đề", title, null, true),
        field("Nội dung và bối cảnh", context)),
      el("fieldset", {}, el("legend", {}, "03 · Đính kèm an toàn"),
        field("Chọn tệp tối đa 20 MB", file, "PDF, TXT, JPG, PNG, WEBP, MP4, WEBM. Word/Excel: chuyển sang PDF hoặc gửi liên kết HTTPS."),
        field("Liên kết HTTPS thay thế", alt)),
      el("fieldset", {}, el("legend", {}, "04 · Thông tin người gửi"), priv.node,
        el("label", { class: "check" }, consent, " Tôi có quyền cung cấp tài liệu này và hiểu tài liệu sẽ được kiểm duyệt trước khi có thể được công bố. ", el("b", { class: "req" }, "*"))),
      out, btn));
}

async function receiptPage(main) {
  const code = el("input", { value: decodeURIComponent(location.hash.slice(1)), placeholder: "XXXXX-XXXXX-XXXXX", autocomplete: "off", "aria-label": "Mã biên nhận" });
  const out = el("div");
  const LABEL = { received: "Đã nhận, đang chờ xem xét.", in_review: "Đang được xem xét.", published: "Đã được công bố.",
                  not_published: "Không được công bố.", unknown: "Không tìm thấy mã này.", unavailable: "Chưa kiểm tra được lúc này, hãy thử lại sau." };
  const check = async (e) => {
    e?.preventDefault();
    if (!code.value.trim()) return;
    out.replaceChildren(el("p", { class: "muted" }, "Đang kiểm tra…"));
    let st;
    try { st = (await api(`/api/receipts/${encodeURIComponent(code.value.trim())}`)).status; } catch { st = "unknown"; }
    out.replaceChildren(el("p", { class: "receipt-status" }, LABEL[st] || st));
  };
  main.replaceChildren(el("h1", {}, "Kiểm tra biên nhận"),
    el("p", { class: "lede" }, "Nhập mã biên nhận bạn nhận được khi gửi. Mã chỉ cho biết trạng thái, không cho biết nội dung, và không liên kết với danh tính của bạn."),
    el("form", { class: "search", onsubmit: check }, code, el("button", { class: "btn", type: "submit" }, "Kiểm tra")), out);
  if (code.value) check();
}

async function howPage(main) {
  const s = await api("/api/status");
  const step = (n, h, p, who) => el("li", { class: "flow-step" }, el("span", { class: "flow-n" }, n), el("div", {}, el("strong", {}, h), el("p", {}, p), el("span", { class: "who" }, who)));
  main.replaceChildren(
    el("h1", {}, "Dữ liệu đi như thế nào"),
    el("p", { class: "lede" }, "Trang này không giữ cơ sở dữ liệu và không tự quyết định công bố gì. Nó chỉ làm hai việc: chuyển những gì bạn gửi vào kho lưu trữ nội bộ, và hiển thị những gì nhóm biên tập đã duyệt."),
    el("ol", { class: "flow" },
      step("1", "Bạn gửi", "Trình báo hoặc tài liệu được ký số và chuyển ngay tới kho lưu trữ. Liên hệ (nếu có) đã được mã hoá trên trình duyệt. Bạn nhận mã biên nhận.", "Trang này → API tiếp nhận (chỉ ghi)"),
      step("2", "Kho lưu trữ nhận và lưu ngay", "Mọi liên kết được chụp lại lập tức, trước khi bị gỡ: ảnh, video, văn bản, kèm mã băm SHA-256 và manifest niêm phong. Tệp được cách ly.", "Nền tảng nội bộ"),
      step("3", "Nhóm biên tập xem xét", "Bài gửi vào Hộp thư (nguồn: Cộng đồng). Người duyệt gắn vào hồ sơ có sẵn, mở hồ sơ mới, hoặc từ chối. Có thể nhờ @reviewer cho ý kiến thứ hai.", "Nền tảng nội bộ"),
      step("4", "Soạn bản công khai riêng", "Viết lại cho công chúng; vị trí được làm mờ theo chính sách (nhà riêng không bao giờ hiện chính xác); chỉ chọn tệp đã xoá siêu dữ liệu (GPS, máy chụp).", "Nền tảng nội bộ"),
      step("5", "Duyệt và công bố", "Một người có quyền công bố duyệt. Bản ghi vào nguồn dữ liệu công khai, được ký bằng khoá trực tuyến do khoá gốc (giữ ngoại tuyến) uỷ quyền.", "Nguồn dữ liệu công khai (tĩnh, có chữ ký)"),
      step("6", "Trang này xác minh rồi mới hiển thị", "Trang kiểm tra chữ ký khoá gốc → khoá trực tuyến → danh mục → mã băm từng bản ghi và từng tệp. Sai một bước là không hiển thị.", "Trang này, bản đồ cộng đồng, và các bản sao")),
    el("section", { class: "verify-box" }, el("h2", {}, "Trạng thái xác minh lúc này"),
      el("dl", { class: "facts" },
        el("dt", {}, "Xác minh gần nhất"), el("dd", {}, s.verified_at ? fmtTime(s.verified_at) : "—"),
        el("dt", {}, "Nguồn dữ liệu tạo lúc"), el("dd", {}, fmtTime(s.feed_generated_at) || "—"),
        el("dt", {}, "Khoá gốc (ghim cố định)"), el("dd", {}, el("code", {}, s.root_key || "—")),
        el("dt", {}, "Khoá trực tuyến đã ký"), el("dd", {}, el("code", {}, s.online_key || "—")),
        el("dt", {}, "Đang hiển thị"), el("dd", {}, `${s.cases} hồ sơ · ${s.materials} tư liệu nguồn · ${s.notes} ghi chú cộng đồng`)),
      s.error ? el("p", { class: "error" }, "Lần tải gần nhất không xác minh được (đang hiển thị bản đã xác minh trước đó): ", s.error) : el("p", { class: "ok" }, "✓ Mọi dữ liệu trên trang đã được xác minh chữ ký.")),
    el("section", {}, el("h2", {}, "Điều này bảo vệ ai"),
      el("ul", {},
        el("li", {}, "Người gửi: trang này không lưu IP, không cần tài khoản; liên hệ được mã hoá đầu cuối tới nhóm biên tập."),
        el("li", {}, "Người trong hồ sơ: không có gì được công bố tự động; vị trí và siêu dữ liệu ảnh được làm mờ/xoá trước khi công bố."),
        el("li", {}, "Sự thật: nếu trang này bị tấn công hay bị chặn, nó không có dữ liệu nội bộ nào để lộ; nguồn dữ liệu có chữ ký có thể được sao chép ở nơi khác và vẫn kiểm chứng được."))));
}

// footer: verification badge on every page
api("/api/status").then((s) => {
  $("#foot-verify").replaceChildren(s.verified_at
    ? el("span", { class: "ok" }, "✓ Dữ liệu đã xác minh chữ ký lúc ", fmtTime(s.verified_at), " · ", link("/cach-hoat-dong", "cách hoạt động"))
    : el("span", { class: "muted" }, "Chưa tải được nguồn dữ liệu đã xác minh."));
}).catch(() => {});
route();
