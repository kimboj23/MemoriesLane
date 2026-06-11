"use strict";
/**
 * Seed one sample case (Phúc Tân–Phúc Xá forced relocation) and link
 * three existing memories to it.
 *
 * Run: docker exec memorieslane-backend-1 node scripts/seed-cases.js
 * Safe to re-run — uses INSERT OR IGNORE and skips already-linked memories.
 */
const { initDb, getDb } = require("../db");

const CASE_ID = "case-phuc-tan";

const sections = JSON.stringify([
  {
    type: "text",
    titleVi: "Bối cảnh",
    titleEn: "Background",
    bodyVi: `Phúc Tân và Phúc Xá là hai phường nằm sát bờ sông Hồng, thuộc quận Hoàn Kiếm và Ba Đình, Hà Nội. Đây là khu dân cư lâu đời với hàng nghìn hộ gia đình sinh sống nhiều thế hệ. Từ năm 2019, chính quyền thành phố Hà Nội triển khai dự án cải tạo hành lang thoát lũ sông Hồng, đặt nhiều hộ dân vào diện phải di dời.

Nhiều gia đình đã ở đây hơn 30–40 năm, không có giấy tờ nhà đất hợp lệ do lịch sử phức tạp của khu vực, dẫn đến tranh chấp về mức bồi thường và quyền tái định cư. Một số hộ được đề nghị mức bồi thường thấp hơn nhiều so với giá thị trường, trong khi chỉ tiêu tái định cư không đủ đáp ứng nhu cầu của tất cả các hộ bị ảnh hưởng.`,
    bodyEn: `Phúc Tân and Phúc Xá are two wards along the Red River, in Hoàn Kiếm and Ba Đình districts of Hanoi. They are long-established communities where thousands of families have lived for generations. In 2019, the Hanoi city government launched a Red River flood-corridor improvement project that placed many households in the path of forced relocation.

Many families had lived here for 30–40 years without valid land-title documents — a legacy of the area's complex history — leading to disputes over compensation levels and resettlement rights. Some households were offered compensation far below market rates, while available resettlement housing did not meet the needs of all affected families.`,
  },
  {
    type: "timeline",
    titleVi: "Diễn biến",
    titleEn: "Timeline of Events",
    events: [
      {
        year: 2019, month: 4,
        labelVi: "Thông báo cưỡng chế đầu tiên",
        labelEn: "First eviction notices issued",
        detailVi: "Chính quyền phường dán thông báo di dời tại nhiều nhà trong khu vực. Người dân lần đầu được thông báo chính thức về dự án cải tạo hành lang thoát lũ.",
        detailEn: "Ward authorities posted relocation notices on homes throughout the area. Residents received their first official notification of the flood-corridor improvement project.",
      },
      {
        year: 2020, month: 6,
        labelVi: "Họp dân — bất đồng về bồi thường",
        labelEn: "Community meeting — compensation disputes",
        detailVi: "Hội nghị dân phố được triệu tập để thảo luận về phương án bồi thường. Nhiều hộ phản đối mức đề xuất và yêu cầu được thẩm định độc lập.",
        detailEn: "A neighbourhood meeting was convened to discuss compensation schemes. Many households rejected the proposed figures and demanded independent property valuation.",
      },
      {
        year: 2021, month: null,
        labelVi: "Đơn kiến nghị tập thể",
        labelEn: "Collective petition filed",
        detailVi: "Hàng trăm chữ ký được thu thập và nộp lên UBND quận Hoàn Kiếm và UBND thành phố Hà Nội, đề nghị xem xét lại chính sách bồi thường và tái định cư.",
        detailEn: "Hundreds of signatures were collected and submitted to the Hoàn Kiếm District and Hanoi city People's Committees, requesting a review of compensation and resettlement policy.",
      },
      {
        year: 2022, month: 9,
        labelVi: "Đợt cưỡng chế đầu tiên",
        labelEn: "First wave of forced relocations",
        detailVi: "Một số hộ dân bị di dời theo lệnh cưỡng chế. Những gia đình không có hộ khẩu tại chỗ không đủ điều kiện nhận nhà tái định cư và phải tự lo nơi ở.",
        detailEn: "A number of households were forcibly relocated. Families without local residence registration were ineligible for resettlement housing and had to find their own accommodation.",
      },
      {
        year: 2024, month: 3,
        labelVi: "Tình trạng hiện tại: vẫn đang tiếp diễn",
        labelEn: "Current status: ongoing",
        detailVi: "Nhiều hộ vẫn đang chờ phán quyết về bồi thường. Một số gia đình đã nộp đơn khởi kiện hành chính. Công trình cải tạo tiếp tục được triển khai trong khi nhiều vụ việc còn chưa được giải quyết.",
        detailEn: "Many households are still awaiting compensation rulings. Some families have filed administrative lawsuits. Construction continues while multiple cases remain unresolved.",
      },
    ],
  },
  {
    type: "text",
    titleVi: "Tác động và bối cảnh rộng hơn",
    titleEn: "Impact and Broader Context",
    bodyVi: `Trường hợp Phúc Tân – Phúc Xá phản ánh một mô hình phổ biến trong các dự án chỉnh trang đô thị tại Việt Nam: tốc độ triển khai nhanh, thông tin hạn chế, và sự chênh lệch đáng kể giữa bồi thường đề xuất với chi phí tái tạo cuộc sống ổn định.

Đặc biệt đối với những gia đình không có giấy tờ nhà đất hợp lệ — tình trạng phổ biến trong các khu dân cư hình thành trước Đổi Mới — hệ thống pháp lý thực tế không cung cấp đủ biện pháp bảo vệ. Những tổn thất này thường không được ghi chép trong các báo cáo chính thức.`,
    bodyEn: `The Phúc Tân–Phúc Xá case reflects a pattern common to urban redevelopment projects across Vietnam: rapid implementation timelines, limited advance information, and a significant gap between proposed compensation and the actual cost of rebuilding a stable life.

Particularly for families without valid land title — a common condition in communities that formed before Đổi Mới — the legal system offers insufficient practical protection. These losses typically go unrecorded in official accounts.`,
  },
]);

const CASE = {
  id: CASE_ID,
  title_vi: "Cưỡng chế di dời khu dân cư Phúc Tân – Phúc Xá",
  title_en: "Forced Relocation of the Phúc Tân–Phúc Xá Riverside Community",
  summary_vi: "Hàng nghìn hộ dân sống dọc bờ sông Hồng tại Phúc Tân và Phúc Xá phải đối mặt với di dời cưỡng bức trong khuôn khổ dự án cải tạo hành lang thoát lũ. Nhiều gia đình không có giấy tờ hợp lệ, bồi thường thấp hơn thị trường, và thiếu chỉ tiêu tái định cư.",
  summary_en: "Thousands of households along the Red River in Phúc Tân and Phúc Xá face forced displacement under a flood-corridor improvement project. Many families lack valid land title and were offered below-market compensation, with resettlement housing falling short of need.",
  city: "hanoi",
  lat: 21.0475,
  lng: 105.856,
  status: "active",
  sections,
  created_at: "2024-01-15",
  approved: 1,
};

// Memories to link — must already exist in the DB (seeded by seed-memories.js).
const LINK_IDS = ["m03", "m11", "m17"];

function run() {
  initDb();
  const db = getDb();

  const upsert = db.prepare(`
    INSERT OR IGNORE INTO cases
      (id, title_vi, title_en, summary_vi, summary_en, city, lat, lng, status, sections, created_at, approved)
    VALUES
      (@id, @title_vi, @title_en, @summary_vi, @summary_en, @city, @lat, @lng, @status, @sections, @created_at, @approved)
  `);

  const result = upsert.run(CASE);
  console.log(result.changes > 0
    ? `Created case: ${CASE_ID}`
    : `Case already exists: ${CASE_ID} (skipped)`);

  const link = db.prepare("UPDATE memories SET case_id = ? WHERE id = ? AND case_id IS NULL");
  let linked = 0;
  for (const id of LINK_IDS) {
    const r = link.run(CASE_ID, id);
    if (r.changes > 0) { linked++; console.log(`  Linked memory: ${id}`); }
    else console.log(`  Memory ${id}: already linked or not found (skipped)`);
  }
  console.log(`Done. Linked ${linked} memories to ${CASE_ID}.`);
}

run();
