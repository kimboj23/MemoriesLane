#!/usr/bin/env node
"use strict";
/**
 * One-time seed script — restores all 37 original archive memories into
 * the PostgreSQL database as pre-approved entries.
 * Safe to re-run: skips any ID that already exists.
 *
 * Run inside Docker:
 *   docker compose exec backend node scripts/seed-memories.js
 *
 * Or locally (with DATABASE_URL set):
 *   DATABASE_URL=postgresql://memorylane:memorylane@localhost:5432/memorylane \
 *     node backend/scripts/seed-memories.js
 */
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MEMORIES = [
  // ── Hà Nội ────────────────────────────────────────────────────────────────
  { id:"m01", city:"hanoi",   lat:21.0335, lng:105.8585, ward:"Phúc Tân",      cat:"event",     year:2026, month:3,    day:14,   date_label:"14 Tháng 3, 2026 · 06:15",  date_label_en:"14 March 2026 · 06:15",   has_photo:1, media_type:"photo",
    text_vi:"Sáng nay họ dán thông báo lên cánh cửa nhà tôi. Ba mươi ngày. Cả đời ông bà tôi ở con ngõ này, giờ gói lại trong ba mươi ngày.",
    text_en:"This morning they taped the notice to my door. Thirty days. My grandparents' whole life in this alley, now folded into thirty days." },
  { id:"m02", city:"hanoi",   lat:21.0305, lng:105.8510, ward:"Hoàn Kiếm",     cat:"personal",  year:2026, month:4,    day:2,    date_label:"2 Tháng 4, 2026 · 05:00",   date_label_en:"2 April 2026 · 05:00",   has_photo:0, media_type:"text",
    text_vi:"Bà bán trà đá đầu ngõ vẫn dọn hàng lúc năm giờ sáng, như thể không có gì thay đổi. Có lẽ đó là cách bà phản kháng.",
    text_en:"The iced-tea seller still sets up at five each morning, as if nothing is changing. Maybe that is her way of resisting." },
  { id:"m03", city:"hanoi",   lat:21.0485, lng:105.8455, ward:"Phúc Xá",       cat:"community", year:2026, month:2,    day:null, date_label:"Tháng 2, 2026",              date_label_en:"February 2026",           has_photo:0, media_type:"text",
    text_vi:"Chúng tôi thu được hơn bốn trăm chữ ký trong ba ngày. Họ nói dự án 'vì lợi ích chung'. Lợi ích của ai?",
    text_en:"We gathered over four hundred signatures in three days. They call the project 'for the common good.' Whose good?" },
  { id:"m04", city:"hanoi",   lat:21.0255, lng:105.8605, ward:"Chương Dương",   cat:"personal",  year:1998, month:null, day:null, date_label:"Khoảng 1998",                date_label_en:"circa 1998",              has_photo:1, media_type:"photo",
    text_vi:"Tôi sinh ra trong căn nhà nhìn ra bãi giữa sông Hồng. Mùa nước lên, cả xóm cùng kê đồ lên cao.",
    text_en:"I was born in a house facing the river islet. When the floods came, the whole hamlet lifted its belongings together." },
  { id:"m05", city:"hanoi",   lat:21.0135, lng:105.8625, ward:"Bạch Đằng",     cat:"community", year:2026, month:5,    day:9,    date_label:"9 Tháng 5, 2026 · 20:40",   date_label_en:"9 May 2026 · 20:40",    has_photo:0, media_type:"video",
    text_vi:"Tối qua chúng tôi thắp nến dọc bờ đê. Không khẩu hiệu, chỉ ánh nến. Đủ để họ biết chúng tôi vẫn ở đây.",
    text_en:"Last night we lit candles along the dyke. No slogans, only candlelight. Enough for them to know we are still here." },
  { id:"m06", city:"hanoi",   lat:21.0355, lng:105.8340, ward:"Ba Đình",        cat:"event",     year:2026, month:4,    day:null, date_label:"Tháng 4, 2026",              date_label_en:"April 2026",              has_photo:0, media_type:"text",
    text_vi:"Tôi thấy hai chiếc máy xúc đỗ ở cuối phố từ tuần trước. Chúng chưa làm gì. Chỉ đứng đó, như một lời nhắc.",
    text_en:"I have seen two excavators parked at the end of the street since last week. They have done nothing. They just stand there, like a reminder." },
  { id:"m07", city:"hanoi",   lat:21.0560, lng:105.8190, ward:"Tây Hồ",        cat:"personal",  year:2025, month:11,   day:null, date_label:"Tháng 11, 2025",             date_label_en:"November 2025",           has_photo:1, media_type:"photo",
    text_vi:"Gánh hàng hoa vẫn đi qua mỗi sáng. Cúc hoạ mi đã về. Tôi mua một bó, đặt lên bậu cửa sổ căn nhà sắp không còn là của mình.",
    text_en:"The flower vendor still passes each morning. The daisies have returned. I buy a bunch and set it on the sill of a house that will soon no longer be mine." },
  { id:"m08", city:"hanoi",   lat:21.0185, lng:105.8270, ward:"Đống Đa",        cat:"personal",  year:1985, month:null, day:null, date_label:"Khoảng 1985",                date_label_en:"circa 1985",              has_photo:0, media_type:"text",
    text_vi:"Cây bàng trước cửa lớp tôi đã bốn mươi năm tuổi. Người ta đánh dấu sơn đỏ lên thân nó hôm qua.",
    text_en:"The almond tree outside my old classroom is forty years old. Yesterday someone marked its trunk with red paint." },
  { id:"m09", city:"hanoi",   lat:21.0320, lng:105.8525, ward:"Hoàn Kiếm",     cat:"community", year:2026, month:3,    day:null, date_label:"Tháng 3, 2026",              date_label_en:"March 2026",              has_photo:0, media_type:"text",
    text_vi:"Họ bảo gửi đơn lên phường. Phường bảo gửi lên quận. Quận im lặng. Nên chúng tôi viết ở đây.",
    text_en:"They told us to file with the ward. The ward said file with the district. The district is silent. So we write here." },
  { id:"m10", city:"hanoi",   lat:21.0445, lng:105.8720, ward:"Long Biên",      cat:"personal",  year:2026, month:4,    day:null, date_label:"Tháng 4, 2026",              date_label_en:"April 2026",              has_photo:0, media_type:"text",
    text_vi:"Từ bên này cầu nhìn sang, phố cổ vẫn sáng đèn. Tôi tự hỏi bao nhiêu ngọn đèn kia còn cháy sang năm.",
    text_en:"From this side of the bridge, the Old Quarter still glows. I wonder how many of those lights will still burn next year." },
  { id:"m11", city:"hanoi",   lat:21.0348, lng:105.8565, ward:"Phúc Tân",      cat:"personal",  year:2026, month:3,    day:null, date_label:"Tháng 3, 2026",              date_label_en:"March 2026",              has_photo:0, media_type:"text",
    text_vi:"Số nhà của chúng tôi giờ là một con số trong bản đồ quy hoạch. Nhưng đây là nơi con gái tôi tập đi.",
    text_en:"Our house number is now a figure on a planning map. But this is where my daughter learned to walk." },
  { id:"m12", city:"hanoi",   lat:21.0075, lng:105.8520, ward:"Hai Bà Trưng",  cat:"event",     year:2026, month:5,    day:null, date_label:"Tháng 5, 2026",              date_label_en:"May 2026",                has_photo:0, media_type:"video",
    text_vi:"Chợ Hôm sáng nay ai cũng đeo dải băng trắng trên tay.",
    text_en:"At Chợ Hôm this morning, everyone wore a white band on their wrist." },
  { id:"m13", city:"hanoi",   lat:21.0295, lng:105.8540, ward:"Hoàn Kiếm",     cat:"news",      year:2026, month:4,    day:null, date_label:"Tháng 4, 2026",              date_label_en:"April 2026",              has_photo:0, media_type:"text",
    text_vi:"Một nhà báo đến hỏi chuyện rồi không thấy bài đăng.",
    text_en:"A journalist came and asked questions; the article never appeared." },
  { id:"m14", city:"hanoi",   lat:21.0265, lng:105.8585, ward:"Chương Dương",   cat:"personal",  year:1994, month:null, day:null, date_label:"Khoảng 1994",                date_label_en:"circa 1994",              has_photo:1, media_type:"photo",
    text_vi:"Bố tôi sửa xe đạp ở góc phố này ba mươi năm. Ông nói: đất có thể lấy, nhưng tay nghề thì không.",
    text_en:"My father has mended bicycles on this corner for thirty years. He says: land can be taken, but a craft cannot." },
  { id:"m15", city:"hanoi",   lat:21.0600, lng:105.8240, ward:"Tây Hồ",        cat:"personal",  year:2026, month:4,    day:null, date_label:"Tháng 4, 2026",              date_label_en:"April 2026",              has_photo:0, media_type:"text",
    text_vi:"Hồ vẫn ở đó. Người ta không di dời được mặt nước. Tôi bám vào ý nghĩ đó.",
    text_en:"The lake is still there. They cannot relocate water. I hold on to that thought." },
  { id:"m16", city:"hanoi",   lat:21.0330, lng:105.8310, ward:"Ba Đình",        cat:"community", year:2026, month:2,    day:null, date_label:"Tháng 2, 2026",              date_label_en:"February 2026",           has_photo:0, media_type:"text",
    text_vi:"Bà cụ tám mươi tư tuổi chống gậy đi ký đơn. Cụ bảo: tôi ký cho lũ trẻ, không phải cho tôi.",
    text_en:"An eighty-four-year-old woman walked with her cane to sign the petition. She said: I sign for the children, not for myself." },
  { id:"m17", city:"hanoi",   lat:21.0470, lng:105.8470, ward:"Phúc Xá",       cat:"news",      year:2026, month:3,    day:null, date_label:"Tháng 3, 2026",              date_label_en:"March 2026",              has_photo:0, media_type:"text",
    text_vi:"Đền bù không đủ mua một phòng trọ ở vành đai bốn. Họ gọi đó là 'tái định cư'.",
    text_en:"The compensation will not cover a single rented room out by Ring Road 4. They call it 'resettlement.'" },
  { id:"m18", city:"hanoi",   lat:21.0205, lng:105.8230, ward:"Đống Đa",        cat:"personal",  year:2026, month:4,    day:null, date_label:"Tháng 4, 2026",              date_label_en:"April 2026",              has_photo:1, media_type:"photo",
    text_vi:"Quán phở của chú Tư vẫn mở. Chú treo tấm biển: 'Còn một ngày cũng bán'.",
    text_en:"Uncle Tư's phở shop is still open. He hung a sign: 'Even with one day left, we serve.'" },
  { id:"m19", city:"hanoi",   lat:21.0115, lng:105.8640, ward:"Bạch Đằng",     cat:"personal",  year:2005, month:null, day:null, date_label:"Khoảng 2005",                date_label_en:"circa 2005",              has_photo:0, media_type:"text",
    text_vi:"Chúng tôi từng thả diều trên bãi sông. Gió ở đây không thuộc về ai cả.",
    text_en:"We used to fly kites on the riverbank. The wind here belongs to no one." },
  { id:"m20", city:"hanoi",   lat:21.0335, lng:105.8500, ward:"Hoàn Kiếm",     cat:"community", year:2026, month:5,    day:null, date_label:"Tháng 5, 2026",              date_label_en:"May 2026",                has_photo:0, media_type:"text",
    text_vi:"Họ tháo biển tên phố. Chúng tôi viết lại bằng phấn lên tường.",
    text_en:"They took down the street-name sign. We wrote it back in chalk on the wall." },
  { id:"m21", city:"hanoi",   lat:21.0420, lng:105.8615, ward:"Long Biên",      cat:"personal",  year:2026, month:null, day:null, date_label:"2026",                       date_label_en:"2026",                    has_photo:0, media_type:"text",
    text_vi:"Cầu Long Biên đã đứng qua bao lần người ta định phá. Nó vẫn đứng. Chúng tôi học từ nó.",
    text_en:"The Long Biên bridge has outlasted every plan to tear it down. It still stands. We learn from it." },
  { id:"m22", city:"hanoi",   lat:21.0335, lng:105.7960, ward:"Cầu Giấy",      cat:"personal",  year:2026, month:4,    day:null, date_label:"Tháng 4, 2026",              date_label_en:"April 2026",              has_photo:0, media_type:"text",
    text_vi:"Tôi chuyển đến đây sau lần di dời trước. Giờ lại nghe tin quy hoạch. Có nơi nào là mãi mãi không?",
    text_en:"I moved here after the last relocation. Now I hear of a new plan. Is anywhere ever permanent?" },

  // ── TP. Hồ Chí Minh ───────────────────────────────────────────────────────
  { id:"hcmc1", city:"hcmc",  lat:10.7705, lng:106.7215, ward:"Thủ Thiêm",     cat:"personal",  year:2012, month:null, day:null, date_label:"Khoảng 2012",                date_label_en:"circa 2012",              has_photo:1, media_type:"photo",
    text_vi:"Khu nhà tôi ở Thủ Thiêm giờ là bãi đất trống nhìn sang quận Một. Tôi vẫn đi xe qua, chỉ để nhìn nơi từng là sân nhà mình.",
    text_en:"My block in Thủ Thiêm is now empty land facing District 1. I still ride past, just to look at where our yard used to be." },
  { id:"hcmc2", city:"hcmc",  lat:10.7721, lng:106.6983, ward:"Bến Thành",     cat:"personal",  year:2025, month:9,    day:null, date_label:"Tháng 9, 2025",              date_label_en:"September 2025",          has_photo:0, media_type:"text",
    text_vi:"Đồng hồ chợ Bến Thành vẫn chạy. Mẹ tôi hẹn gặp ba dưới gác chuông ấy năm 1968. Tôi không để ai gỡ nó đi.",
    text_en:"The Bến Thành market clock still runs. My mother met my father under that tower in 1968. I won't let anyone take it down." },
  { id:"hcmc3", city:"hcmc",  lat:10.7742, lng:106.7008, ward:"Quận 1",        cat:"event",     year:2026, month:3,    day:null, date_label:"Tháng 3, 2026",              date_label_en:"March 2026",              has_photo:1, media_type:"photo",
    text_vi:"Chung cư cũ của chúng tôi bị dán chữ 'nguy hiểm'. Hơn ba trăm hộ, mỗi nhà một câu chuyện, gói lại trong một tờ thông báo.",
    text_en:"Our old apartment block was stamped 'unsafe.' Three hundred households, each a story, folded into a single notice." },
  { id:"hcmc4", city:"hcmc",  lat:10.7535, lng:106.6635, ward:"Quận 5",        cat:"personal",  year:2023, month:null, day:null, date_label:"Khoảng 2023",                date_label_en:"circa 2023",              has_photo:0, media_type:"text",
    text_vi:"Tiệm thuốc bắc của ông nội ở Chợ Lớn đã đóng cửa. Mùi quế và cam thảo thì vẫn còn trong trí nhớ tôi.",
    text_en:"Grandfather's herbal-medicine shop in Chợ Lớn has closed. The smell of cinnamon and licorice still lives in my memory." },
  { id:"hcmc5", city:"hcmc",  lat:10.8025, lng:106.7135, ward:"Bình Thạnh",    cat:"community", year:2024, month:6,    day:null, date_label:"Tháng 6, 2024",              date_label_en:"June 2024",               has_photo:0, media_type:"text",
    text_vi:"Dãy nhà ven kênh chúng tôi cùng nhau quét vôi trước Tết. Họ nói sẽ giải tỏa. Chúng tôi vẫn quét vôi.",
    text_en:"The houses along the canal — we whitewash them together before Tết. They say it will be cleared. We whitewash them anyway." },

  // ── Huế ───────────────────────────────────────────────────────────────────
  { id:"hue1",  city:"hue",   lat:16.4712, lng:107.5772, ward:"Thượng Thành",  cat:"event",     year:2021, month:2,    day:null, date_label:"Tháng 2, 2021",              date_label_en:"February 2021",           has_photo:1, media_type:"photo",
    text_vi:"Nhà tôi dựng trên Thượng Thành kinh thành Huế bốn đời. Họ di dời chúng tôi để trả lại tường thành cho lịch sử. Nhưng chúng tôi cũng là lịch sử.",
    text_en:"My family lived on the citadel ramparts of Huế for four generations. They moved us to give the walls back to history. But we are history too." },
  { id:"hue2",  city:"hue",   lat:16.4690, lng:107.5930, ward:"Phú Hội",       cat:"personal",  year:2020, month:null, day:null, date_label:"Khoảng 2020",                date_label_en:"circa 2020",              has_photo:0, media_type:"text",
    text_vi:"Cầu Trường Tiền đổi màu đèn mỗi tối. Hồi nhỏ nó chỉ có ánh trăng. Tôi vẫn thích ánh trăng hơn.",
    text_en:"The Trường Tiền bridge changes colour every night now. As a child it had only moonlight. I still prefer the moon." },
  { id:"hue3",  city:"hue",   lat:16.4625, lng:107.5848, ward:"Vỹ Dạ",         cat:"personal",  year:2019, month:null, day:null, date_label:"Khoảng 2019",                date_label_en:"circa 2019",              has_photo:1, media_type:"photo",
    text_vi:"Gia đình tôi sống trên đò sông Hương ba thế hệ. Lên bờ rồi, đêm nào tôi cũng nghe thiếu tiếng nước.",
    text_en:"My family lived on a sampan on the Perfume River for three generations. Now ashore, every night I miss the sound of the water." },
  { id:"hue4",  city:"hue",   lat:16.4720, lng:107.5872, ward:"Đông Ba",        cat:"community", year:2025, month:1,    day:null, date_label:"Tháng 1, 2025",              date_label_en:"January 2025",            has_photo:0, media_type:"text",
    text_vi:"Chợ Đông Ba sáng nay các bà tiểu thương góp tiền sửa lại mái đình cũ. Không ai bảo ai, đó là việc phải làm.",
    text_en:"At Đông Ba market this morning the women traders pooled money to mend the old shrine roof. No one was asked; it was simply what had to be done." },

  // ── Đà Nẵng ───────────────────────────────────────────────────────────────
  { id:"dn1",   city:"danang", lat:16.0712, lng:108.2238, ward:"Hải Châu",      cat:"personal",  year:2022, month:null, day:null, date_label:"Khoảng 2022",                date_label_en:"circa 2022",              has_photo:1, media_type:"photo",
    text_vi:"Làng chài bên sông Hàn giờ là dãy cao ốc kính. Cha tôi chỉ tay: 'Thuyền mình từng buộc đúng chỗ kia.'",
    text_en:"The fishing village by the Hàn River is now a row of glass towers. My father points: 'Our boat was tied right there.'" },
  { id:"dn2",   city:"danang", lat:16.0613, lng:108.2275, ward:"Sơn Trà",       cat:"event",     year:2024, month:7,    day:null, date_label:"Tháng 7, 2024",              date_label_en:"July 2024",               has_photo:0, media_type:"text",
    text_vi:"Cầu Rồng phun lửa mỗi cuối tuần. Du khách quay phim. Tôi nhớ bến phà cũ từng ở đây, và người lái phà tên Bảy.",
    text_en:"The Dragon Bridge breathes fire each weekend. Tourists film it. I remember the old ferry that was here, and the ferryman named Bảy." },
  { id:"dn3",   city:"danang", lat:16.0668, lng:108.2152, ward:"Thanh Khê",     cat:"personal",  year:2026, month:4,    day:null, date_label:"Tháng 4, 2026",              date_label_en:"April 2026",              has_photo:0, media_type:"text",
    text_vi:"Chợ Cồn vẫn đông. Người ta đồn sẽ xây trung tâm thương mại. Cô bán bún tôi ăn từ bé chỉ cười: 'Còn bán ngày nào hay ngày đó.'",
    text_en:"Chợ Cồn is still crowded. They say a mall will rise here. The noodle seller I've known since childhood just smiles: 'I'll sell while I still can.'" },
  { id:"dn4",   city:"danang", lat:16.1010, lng:108.2650, ward:"Sơn Trà",       cat:"community", year:2023, month:5,    day:null, date_label:"Tháng 5, 2023",              date_label_en:"May 2023",                has_photo:0, media_type:"text",
    text_vi:"Chúng tôi cùng nhau trồng lại rừng trên bán đảo Sơn Trà sau mùa sạt lở. Cây con thấp hơn đầu gối, nhưng là một lời hứa.",
    text_en:"We replanted the forest on the Sơn Trà peninsula together after the landslides. The saplings are knee-high, but they are a promise." },

  // ── Cần Thơ ───────────────────────────────────────────────────────────────
  { id:"ct1",   city:"cantho", lat:10.0152, lng:105.7402, ward:"Cái Răng",      cat:"personal",  year:2024, month:null, day:null, date_label:"Khoảng 2024",                date_label_en:"circa 2024",              has_photo:1, media_type:"photo",
    text_vi:"Chợ nổi Cái Răng mỗi năm một thưa. Ghe ít dần, đường bộ nhiều thêm. Tôi dạy con tôi cách treo bẹo, phòng khi nó còn muốn nhớ.",
    text_en:"The Cái Răng floating market thins each year. Fewer boats, more roads. I teach my child how to hang the 'bẹo' pole, in case they ever wish to remember." },
  { id:"ct2",   city:"cantho", lat:10.0335, lng:105.7905, ward:"Ninh Kiều",     cat:"news",      year:2026, month:3,    day:null, date_label:"Tháng 3, 2026",              date_label_en:"March 2026",              has_photo:0, media_type:"text",
    text_vi:"Bờ sông Ninh Kiều lại sạt một đoạn. Nước lấy đi từng mảnh đất, lặng lẽ hơn mọi quy hoạch.",
    text_en:"Another stretch of the Ninh Kiều riverbank has collapsed. The water takes the land piece by piece, quieter than any plan." },
];

async function run() {
  const today = new Date().toISOString().slice(0, 10);
  let inserted = 0, skipped = 0;

  for (const m of MEMORIES) {
    const result = await pool.query(
      `INSERT INTO memories
         (id, lat, lng, city, ward, cat, year, month, day,
          date_label, date_label_en, lang,
          text_vi, text_en, has_photo, photo_path, media_type,
          approved, rejected, submit_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,1,0,$18)
       ON CONFLICT (id) DO NOTHING`,
      [
        m.id, m.lat, m.lng, m.city, m.ward, m.cat,
        m.year, m.month ?? null, m.day ?? null,
        m.date_label, m.date_label_en, "vi",
        m.text_vi, m.text_en,
        m.has_photo, null, m.media_type,
        today,
      ]
    );
    if (result.rowCount > 0) {
      inserted++;
      console.log(`  ✔  ${m.id}  (${m.city})`);
    } else {
      skipped++;
      console.log(`  –  ${m.id}  already exists, skipped`);
    }
  }

  console.log(`\nDone — ${inserted} inserted, ${skipped} skipped.`);
  await pool.end();
}

run().catch((err) => {
  console.error("[seed-memories] fatal:", err.message);
  process.exit(1);
});
