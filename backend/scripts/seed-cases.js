#!/usr/bin/env node
"use strict";
/**
 * Seeds one documented case (Phúc Tân–Phúc Xá forced relocation),
 * links three memories to it, and assigns topic tags to the case.
 * Safe to re-run — uses ON CONFLICT DO NOTHING for the case insert.
 *
 * Run inside Docker:
 *   docker compose exec backend node scripts/seed-cases.js
 */
require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const CASE_ID = "case-phuc-tan";

const archives = JSON.stringify([
  {
    tool: "auto-archiver",
    mediaType: "social",
    titleVi: "Video trực tiếp ghi lại cưỡng chế ngày 14/3/2026",
    titleEn: "Live video documenting the 14 March 2026 forced eviction",
    source: "Facebook",
    account: "Nhóm hỗ trợ pháp lý Phúc Tân",
    date: "2026-03-14",
    originalUrl: null,
    archivedUrl: "https://archive.org/details/phuctan-eviction-20260314",
  },
  {
    tool: "archive-box",
    mediaType: "web",
    titleVi: "Quyết định phê duyệt quy hoạch phân khu đô thị sông Hồng tỷ lệ 1/5000",
    titleEn: "Approval decision for the Red River Urban Sub-zone Master Plan (1:5000)",
    source: "UBND TP. Hà Nội",
    date: "2022-03-25",
    originalUrl: "https://hanoi.gov.vn/web/guest/chi-tiet-tin-tuc/-/tai-lieu/quy-hoach-song-hong",
    archivedUrl: "https://web.archive.org/web/20230401120000/https://hanoi.gov.vn/web/guest/chi-tiet-tin-tuc/-/tai-lieu/quy-hoach-song-hong",
  },
  {
    tool: "auto-archiver",
    mediaType: "social",
    titleVi: "Chuỗi bài đăng về tình trạng người dân Phúc Tân sau cưỡng chế",
    titleEn: "Thread on Phúc Tân residents' conditions after forced relocation",
    source: "Twitter/X",
    account: "@phaplyvietnam",
    date: "2026-04-02",
    originalUrl: null,
    archivedUrl: "https://archive.ph/phaplyvietnam-phuctan-20260402",
  },
  {
    tool: "archive-box",
    mediaType: "document",
    titleVi: "Thông báo cưỡng chế số 45/TB-UBND phường Phúc Tân (scan)",
    titleEn: "Compulsory relocation notice No. 45/TB-UBND, Phúc Tân ward (scan)",
    source: "UBND Phường Phúc Tân",
    date: "2026-02-08",
    originalUrl: null,
    archivedUrl: null,
    notes: "Nhận từ cư dân. Đang chờ số hóa hoàn chỉnh.",
  },
]);

const sections = JSON.stringify([
  {
    type: "text",
    titleVi: "Bối cảnh",
    titleEn: "Background",
    bodyVi: `Phúc Tân và Phúc Xá là hai phường nằm sát bờ sông Hồng, thuộc quận Hoàn Kiếm và Ba Đình, Hà Nội. Đây là khu dân cư lâu đời với hàng nghìn hộ gia đình sinh sống nhiều thế hệ. Từ năm 2019, chính quyền thành phố Hà Nội triển khai dự án cải tạo hành lang thoát lũ sông Hồng, đặt nhiều hộ dân vào diện phải di dời.

Nhiều gia đình đã ở đây hơn 30–40 năm, không có giấy tờ nhà đất hợp lệ do lịch sử phức tạp của khu vực, dẫn đến tranh chấp về mức bồi thường và quyền tái định cư. Một số hộ được đề nghị mức bồi thường thấp hơn nhiều so với giá thị trường, trong khi chỉ tiêu tái định cư không đủ đáp ứng nhu cầu của tất cả các hộ bị ảnh hưởng.`,
    bodyEn: `Phúc Tân and Phúc Xá are two wards along the Red River in Hoàn Kiếm and Ba Đình districts of Hanoi. They are long-established communities where thousands of families have lived for generations. In 2019, the Hanoi city government launched a Red River flood-corridor improvement project that placed many households in the path of forced relocation.

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
        detailVi: "Hàng trăm chữ ký được thu thập và nộp lên UBND quận Hoàn Kiếm và UBND thành phố Hà Nội.",
        detailEn: "Hundreds of signatures were collected and submitted to the Hoàn Kiếm District and Hanoi city People's Committees.",
      },
      {
        year: 2022, month: 9,
        labelVi: "Đợt cưỡng chế đầu tiên",
        labelEn: "First wave of forced relocations",
        detailVi: "Một số hộ dân bị di dời theo lệnh cưỡng chế. Những gia đình không có hộ khẩu tại chỗ không đủ điều kiện nhận nhà tái định cư.",
        detailEn: "A number of households were forcibly relocated. Families without local residence registration were ineligible for resettlement housing.",
      },
      {
        year: 2024, month: 3,
        labelVi: "Tình trạng hiện tại: vẫn đang tiếp diễn",
        labelEn: "Current status: ongoing",
        detailVi: "Nhiều hộ vẫn đang chờ phán quyết về bồi thường. Một số gia đình đã nộp đơn khởi kiện hành chính.",
        detailEn: "Many households are still awaiting compensation rulings. Some families have filed administrative lawsuits.",
      },
    ],
  },
  {
    type: "text",
    titleVi: "Tác động và bối cảnh rộng hơn",
    titleEn: "Impact and Broader Context",
    bodyVi: `Trường hợp Phúc Tân – Phúc Xá phản ánh một mô hình phổ biến trong các dự án chỉnh trang đô thị tại Việt Nam: tốc độ triển khai nhanh, thông tin hạn chế, và sự chênh lệch đáng kể giữa bồi thường đề xuất với chi phí tái tạo cuộc sống ổn định.

Đặc biệt đối với những gia đình không có giấy tờ nhà đất hợp lệ — tình trạng phổ biến trong các khu dân cư hình thành trước Đổi Mới — hệ thống pháp lý thực tế không cung cấp đủ biện pháp bảo vệ.`,
    bodyEn: `The Phúc Tân–Phúc Xá case reflects a pattern common to urban redevelopment projects across Vietnam: rapid implementation timelines, limited advance information, and a significant gap between proposed compensation and the actual cost of rebuilding a stable life.

Particularly for families without valid land title — a common condition in communities that formed before Đổi Mới — the legal system offers insufficient practical protection.`,
  },
]);

async function run() {
  // Upsert case
  const caseResult = await pool.query(
    `INSERT INTO cases
       (id, title_vi, title_en, summary_vi, summary_en, city, lat, lng, status, sections, created_at, approved)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO NOTHING`,
    [
      CASE_ID,
      "Cưỡng chế di dời khu dân cư Phúc Tân – Phúc Xá",
      "Forced Relocation of the Phúc Tân–Phúc Xá Riverside Community",
      "Hàng nghìn hộ dân sống dọc bờ sông Hồng tại Phúc Tân và Phúc Xá phải đối mặt với di dời cưỡng bức trong khuôn khổ dự án cải tạo hành lang thoát lũ. Nhiều gia đình không có giấy tờ hợp lệ, bồi thường thấp hơn thị trường, và thiếu chỉ tiêu tái định cư.",
      "Thousands of households along the Red River in Phúc Tân and Phúc Xá face forced displacement under a flood-corridor improvement project. Many families lack valid land title and were offered below-market compensation, with resettlement housing falling short of need.",
      "hanoi", 21.0475, 105.856,
      "active", sections, "2024-01-15", 1,
    ]
  );
  console.log(caseResult.rowCount > 0
    ? `✔  Created case: ${CASE_ID}`
    : `–  Case already exists: ${CASE_ID} (skipped)`);

  // Link memories to case
  const LINK_IDS = ["m01", "m03", "m11", "m16", "m17"];
  for (const id of LINK_IDS) {
    const r = await pool.query(
      `UPDATE memories SET case_id = $1 WHERE id = $2 AND case_id IS NULL`,
      [CASE_ID, id]
    );
    console.log(r.rowCount > 0 ? `  ✔  Linked memory: ${id}` : `  –  Memory ${id}: already linked or not found`);
  }

  // Update archives for this case (always refresh)
  await pool.query(`UPDATE cases SET archives = $1 WHERE id = $2`, [archives, CASE_ID]);
  console.log(`✔  Updated archives for case: ${CASE_ID}`);

  // Assign topics to case
  const CASE_TOPIC_SLUGS = ["land-rights", "nha-o"];
  const { rows: topicRows } = await pool.query(
    `SELECT id, slug FROM topics WHERE slug = ANY($1)`, [CASE_TOPIC_SLUGS]
  );
  for (const t of topicRows) {
    await pool.query(
      `INSERT INTO case_topics (case_id, topic_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [CASE_ID, t.id]
    );
    console.log(`  ✔  Tagged case with topic: ${t.slug}`);
  }

  await pool.end();
  console.log("Done.");
}

run().catch((err) => { console.error("[seed-cases] fatal:", err.message); process.exit(1); });
