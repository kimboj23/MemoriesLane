/* ============================================================================
   memorylane — Ký Ức Hà Nội
   data.jsx : i18n strings, categories, the proposed clearance zone, the seed
              archive of civic memories (real Hà Nội coordinates), utilities.
   The map is now a real OpenStreetMap-based slippy map (Leaflet), so memories
   pin to recognisable streets. Coordinates are WGS-84 lat / lng.
   ============================================================================ */

// ---------------------------------------------------------------------------
// i18n — Tiếng Việt is primary; English mirrors it.
// ---------------------------------------------------------------------------
const STR = {
  vi: {
    siteName: "Miền Ký Ức",
    tagline: "Một bản đồ ký ức của những tiếng nói",
    addMemory: "Để lại ký ức",
    tapToPlace: "Chạm vào bản đồ, nơi ký ức của bạn thuộc về",
    close: "Đóng",
    yourMemory: "Ký ức của bạn",
    writeHere: "Viết ra điều bạn muốn được nhớ. Không tên thật, không thông tin nhận dạng.",
    category: "Thể loại",
    when: "Khoảng thời gian",
    whenHint: "ví dụ: Tháng 3, 2026",
    ward: "Phường / khu vực",
    wardHint: "ví dụ: Phúc Tân",
    addPhoto: "Thêm ảnh (không bắt buộc)",
    photoOptional: "Ảnh, video hoặc tư liệu — không bắt buộc",
    optimizing: "Đang tối ưu ảnh…",
    remove: "Gỡ bỏ",
    submit: "Gửi vào kho lưu trữ",
    anonNote: "Hoàn toàn ẩn danh. Chúng tôi không lưu tên, vị trí thật hay danh tính của bạn.",
    received: "Đã nhận",
    receivedBody: "Ký ức của bạn đang trên đường vào kho lưu trữ và có thể mất tới ba ngày để hiện ra. Trong lúc chờ, hãy lắng nghe những ký ức gần đây.",
    nearby: "Ký ức lân cận",
    exploreNearby: "Khám phá xung quanh",
    aboutTitle: "Về kho lưu trữ này",
    aboutBody: "Đây là một kho lưu trữ ký ức tập thể, ẩn danh, ghi lại trải nghiệm sống của người Việt giữa những thay đổi xã hội. Mỗi ký ức được ghim vào một nơi chốn có thật.",
    howTitle: "Cách tham gia",
    how1: "Chọn một nơi chốn trên bản đồ",
    how2: "Viết lại ký ức của bạn",
    how3: "Gửi đi và chờ được duyệt",
    how4: "Lắng nghe ký ức của người khác",
    guidelinesTitle: "Giữ cho nhau an toàn",
    guidelinesBody: "Đừng để lại tên thật, số điện thoại, địa chỉ hay bất cứ điều gì có thể nhận dạng bạn hoặc người khác. Mỗi mẩu ký ức được duyệt thủ công bởi một nhóm tình nguyện trước khi xuất hiện.",
    clearanceZone: "Khu vực di dời 2026–2045",
    clearanceNote: "Vùng được đề xuất tái định cư",
    langLabel: "EN",
    menu: "Mục lục",
    voices: "tiếng nói được lưu giữ",
    photoPlaceholder: "ảnh tư liệu",
    timeWhen: "Thời gian",
    yearLabel: "Năm", monthLabel: "Tháng", dayLabel: "Ngày", timeLabel: "Giờ",
    optionalMD: "Tháng / Ngày — không bắt buộc",
    step1: "Chọn nơi chốn trên bản đồ", step2: "Viết câu chuyện của bạn", step3: "Gửi vào kho lưu trữ",
    chooseLocation: "Chạm vào bản đồ để đánh dấu", changeLocation: "chạm để chọn lại", placeChosen: "Đã chọn nơi chốn",
    placePrompt: "Chạm vào bản đồ để chọn nơi câu chuyện của bạn diễn ra", pickFirst: "Hãy chọn nơi chốn trên bản đồ trước",
    chooseYear: "Chọn năm…", anyOpt: "— bất kỳ —", dontKnow: "Không rõ", circa: "Khoảng", earlier: "Trước 1985",
    saving: "Đang lưu", yearOnlyTag: "chỉ năm", monthYearTag: "tháng & năm", fullDateTag: "ngày đầy đủ", circaTag: "ước chừng",
    yearNeeded: "Cần chọn năm", required2: "bắt buộc", minuteLabel: "Phút",
    times: ["Sáng", "Trưa", "Chiều", "Tối", "Đêm"],
    findPlace: "Tìm nơi chốn…",
    // research mode
    research: "Nghiên cứu", researchMode: "Chế độ nghiên cứu",
    advSearch: "Tìm kiếm nâng cao",
    resultsOf: "kết quả / tổng", matchCount: "phù hợp",
    temporal: "Khoảng thời gian", precision: "Độ chính xác",
    precYear: "Năm", precMonth: "Tháng", precDay: "Ngày",
    from: "Từ", to: "đến",
    spatial: "Truy vấn không gian", drawCircle: "Vẽ vòng tròn", drawPoly: "Vẽ đa giác",
    clearShape: "Xóa vùng", finishShape: "Hoàn tất", cancelDraw: "Hủy",
    dragRadius: "Kéo trên bản đồ để đặt bán kính", clickPts: "Chạm để thêm điểm",
    inside: "bên trong", points: "điểm", radius: "bán kính",
    textSearch: "Tìm kiếm văn bản", boolHint: 'Ví dụ: ("di dời" AND "đền bù") NOT "thông báo"',
    boolErr: "Truy vấn không hợp lệ", boolSub: "AND · OR · NOT · () · \"cụm từ\"",
    filters: "Bộ lọc", fLang: "Ngôn ngữ", fStatus: "Trạng thái", fContent: "Loại nội dung",
    stAll: "Tất cả", stVer: "Đã duyệt", stUnver: "Chưa duyệt",
    ctPhoto: "Ảnh", ctVideo: "Video", ctText: "Văn bản",
    resetAll: "Đặt lại tất cả", exportView: "Xuất dữ liệu",
    // export ecosystem
    exportTitle: "Xuất dữ liệu", exportSub: "Chỉ xuất những kết quả đang được lọc.",
    tierAName: "Báo cáo nhanh", tierAFor: "Cho nhà báo",
    tierADesc: "Ảnh chụp bản đồ, 10  ký ức tiêu biểu và thống kê tóm tắt.",
    tierBName: "Bộ dữ liệu có cấu trúc", tierBFor: "Cho nhà nghiên cứu",
    tierBDesc: "Toàn bộ siêu dữ liệu của kết quả đã lọc, kèm trạng thái kiểm duyệt.",
    openReport: "Mở báo cáo", downloadHtml: "Tải HTML",
    privacyNote: "Tên và địa chỉ IP được loại bỏ tự động. Chỉ dữ liệu công khai được xuất.",
    noResults: "Không có kết quả nào để xuất.",
    // multi-city network
    nation: "Toàn Việt Nam", viewing: "Đang xem", selectLoc: "Chọn nơi chốn",
    memoriesWord: "ký ức", beFirst: "Hãy là người đầu tiên",
    nationHint: "Chạm vào một thành phố để khám phá", allCities: "Tất cả thành phố",
    network: "Mạng lưới ký ức",
  },
  en: {
    siteName: "Memory Lane",
    tagline: "A map of memory, made of voices",
    addMemory: "Leave a memory",
    tapToPlace: "Touch the map, where your memory belongs",
    close: "Close",
    yourMemory: "Your memory",
    writeHere: "Write what you want remembered. No real names, no identifying details.",
    category: "Category",
    when: "Time period",
    whenHint: "e.g. March 2026",
    ward: "Ward / area",
    wardHint: "e.g. Phúc Tân",
    addPhoto: "Add a photo (optional)",
    photoOptional: "A photo, video or document — optional",
    optimizing: "Optimizing image…",
    remove: "Remove",
    submit: "Send to the archive",
    anonNote: "Completely anonymous. We store no name, no true location, nothing about you.",
    received: "Received",
    receivedBody: "Your memory is on its way into the archive and may take up to three days to appear. While you wait, listen to the memories nearby.",
    nearby: "Memories nearby",
    exploreNearby: "Explore around here",
    aboutTitle: "About this archive",
    aboutBody: "This is a collective, anonymous archive of memory — recording lived experience and acts of resistance around the restructuring of Hà Nội, including proposals to relocate more than 860,000 residents between 2026 and 2045. Each memory is pinned to a real place. Together, they weave a map that no power can erase.",
    howTitle: "How to take part",
    how1: "Choose a place on the map",
    how2: "Write down your memory",
    how3: "Send it and wait for review",
    how4: "Listen to others' memories",
    guidelinesTitle: "Keeping each other safe",
    guidelinesBody: "Do not leave real names, phone numbers, addresses, or anything that could identify you or others. Every testimony is reviewed by hand by a volunteer group before it appears.",
    clearanceZone: "Relocation zone 2026–2045",
    clearanceNote: "Area proposed for resettlement",
    langLabel: "VI",
    menu: "Contents",
    voices: "voices preserved",
    photoPlaceholder: "archive image",
    timeWhen: "Time",
    yearLabel: "Year", monthLabel: "Month", dayLabel: "Day", timeLabel: "Time",
    optionalMD: "Month / Day — optional",
    step1: "Choose the location on the map", step2: "Share your story", step3: "Send to the archive",
    chooseLocation: "Touch the map to mark a place", changeLocation: "tap to change", placeChosen: "Location chosen",
    placePrompt: "Touch the map to mark where your story took place", pickFirst: "Please choose a location on the map first",
    chooseYear: "Choose year…", anyOpt: "— any —", dontKnow: "Don't know", circa: "Circa",
    saving: "Saving", yearOnlyTag: "year only", monthYearTag: "month & year", fullDateTag: "full date", circaTag: "approximate",
    yearNeeded: "Please choose a year", required2: "required", minuteLabel: "Minute",
    times: ["Morning", "Midday", "Afternoon", "Evening", "Night"],
    findPlace: "Find a place…",
    // research mode
    research: "Research", researchMode: "Research mode",
    advSearch: "Advanced search",
    resultsOf: "results of", matchCount: "match",
    temporal: "Temporal range", precision: "Precision",
    precYear: "Year", precMonth: "Month", precDay: "Day",
    from: "From", to: "to",
    spatial: "Spatial query", drawCircle: "Circle", drawPoly: "Polygon",
    clearShape: "Clear area", finishShape: "Finish", cancelDraw: "Cancel",
    dragRadius: "Drag on the map to set the radius", clickPts: "Click to add points",
    inside: "inside", points: "points", radius: "radius",
    textSearch: "Text search", boolHint: 'e.g. ("police" AND "violence") NOT "official statement"',
    boolErr: "Invalid query", boolSub: "AND · OR · NOT · () · \"phrase\"",
    filters: "Filters", fLang: "Language", fStatus: "Status", fContent: "Content type",
    stAll: "All", stVer: "Verified", stUnver: "Unverified",
    ctPhoto: "Photo", ctVideo: "Video", ctText: "Text",
    resetAll: "Reset all", exportView: "Export data",
    // export ecosystem
    exportTitle: "Export data", exportSub: "Exports only the results currently filtered in your view.",
    tierAName: "Quick Report", tierAFor: "For journalists",
    tierADesc: "A map snapshot, the top 10 memories, and summary statistics — ready to print or share.",
    tierBName: "Structured Dataset", tierBFor: "For researchers",
    tierBDesc: "Full metadata of every filtered result, including moderation status, for statistical analysis.",
    openReport: "Open report", downloadHtml: "Download HTML",
    privacyNote: "Personal names and IP addresses are stripped automatically. Only public data is exported.",
    noResults: "No results to export.",
    // multi-city network
    nation: "All of Vietnam", viewing: "Viewing", selectLoc: "Select location",
    memoriesWord: "memories", beFirst: "Be the first",
    nationHint: "Tap a city to explore", allCities: "All cities",
    network: "Memory network",
  },
};

// ---------------------------------------------------------------------------
// Categories — colour-blind-safe categorical palette
// ---------------------------------------------------------------------------
const CATS = [
  { key: "personal", vi: "Chuyện đời", en: "Life Story", color: "#CE9A2E" },
  { key: "news", vi: "Tin tức", en: "News", color: "#37566E" },
  { key: "community", vi: "Chung tay", en: "Community Action", color: "#2E8576" },
  { key: "event", vi: "Sự kiện", en: "Event", color: "#C2461F" },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.key, c]));

const LEGACY_CAT = { everyday: "personal", memory: "personal", witness: "news", petition: "community", protest: "community", eviction: "turning" };
function catOf(key) { return CAT[key] || CAT[LEGACY_CAT[key]] || CATS[0]; }

const MONTHS = {
  vi: ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

const HANOI_CENTER = [21.0305, 105.8520];

// ---------------------------------------------------------------------------
// BASEMAPS
// ---------------------------------------------------------------------------
const BASEMAPS = [
  { key: "streets", vi: "Phố", en: "Streets",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", sub: "abcd", maxZoom: 20,
    attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
    swatch: "linear-gradient(135deg,#eee8dc,#dfe6ea 55%,#cdd8c6)" },
  { key: "light", vi: "Tối giản", en: "Minimal",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", sub: "abcd", maxZoom: 20,
    attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
    swatch: "linear-gradient(135deg,#f7f5f1,#e8e6e1)" },
  { key: "dark", vi: "Ban đêm", en: "Night",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", sub: "abcd", maxZoom: 20,
    attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
    swatch: "linear-gradient(135deg,#27302d,#11201b)" },
  { key: "satellite", vi: "Vệ tinh", en: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", sub: "", maxZoom: 19,
    attr: 'Imagery © <a href="https://www.esri.com">Esri</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    swatch: "linear-gradient(135deg,#3a5a3f,#5b6b48 55%,#2d4150)" },
];
const BASEMAP = Object.fromEntries(BASEMAPS.map((b) => [b.key, b]));

const MIN_YEAR = 1985;
const MAX_YEAR = 2045;

const WARDS = [
  { name: "Tây Hồ", lat: 21.0670, lng: 105.8180 },
  { name: "Ba Đình", lat: 21.0340, lng: 105.8340 },
  { name: "Hoàn Kiếm", lat: 21.0287, lng: 105.8520 },
  { name: "Hai Bà Trưng", lat: 21.0080, lng: 105.8520 },
  { name: "Đống Đa", lat: 21.0170, lng: 105.8280 },
  { name: "Cầu Giấy", lat: 21.0310, lng: 105.8000 },
  { name: "Long Biên", lat: 21.0440, lng: 105.8800 },
  { name: "Phúc Xá", lat: 21.0480, lng: 105.8460 },
  { name: "Phúc Tân", lat: 21.0340, lng: 105.8580 },
  { name: "Chương Dương", lat: 21.0250, lng: 105.8600 },
  { name: "Bạch Đằng", lat: 21.0120, lng: 105.8620 },
  { name: "Thanh Xuân", lat: 21.0000, lng: 105.8150 },
  { name: "Hoàng Mai", lat: 20.9850, lng: 105.8600 },
];
function nearestWard(lat, lng) {
  let best = WARDS[0], bd = Infinity;
  for (const w of WARDS) { const dd = Math.hypot(w.lat - lat, w.lng - lng); if (dd < bd) { bd = dd; best = w; } }
  return best.name;
}

const CLEARANCE_ZONE = [
  [21.0525, 105.8505], [21.0500, 105.8560], [21.0410, 105.8600],
  [21.0310, 105.8628], [21.0210, 105.8640], [21.0105, 105.8652],
  [21.0065, 105.8602], [21.0160, 105.8582], [21.0260, 105.8560],
  [21.0360, 105.8532], [21.0455, 105.8508],
];
const CLEARANCE_LABEL = [21.0300, 105.8595];

// ---------------------------------------------------------------------------
// CITIES — national network
// ---------------------------------------------------------------------------
const VIETNAM_BOUNDS = [[8.4, 102.1], [23.4, 109.7]];
const CITIES = [
  { key: "hanoi", vi: "Hà Nội", en: "Hà Nội", center: [21.0305, 105.8520], zoom: 13,
    bounds: [[20.93, 105.74], [21.12, 105.95]], zone: CLEARANCE_ZONE, zoneLabel: CLEARANCE_LABEL },
  { key: "hcmc", vi: "TP. Hồ Chí Minh", en: "Ho Chi Minh City", center: [10.7769, 106.7009], zoom: 13,
    bounds: [[10.69, 106.60], [10.86, 106.78]] },
  { key: "hue", vi: "Huế", en: "Hue", center: [16.4660, 107.5860], zoom: 14,
    bounds: [[16.43, 107.55], [16.50, 107.62]] },
  { key: "danang", vi: "Đà Nẵng", en: "Da Nang", center: [16.0600, 108.2200], zoom: 13,
    bounds: [[16.01, 108.14], [16.13, 108.30]] },
  { key: "cantho", vi: "Cần Thơ", en: "Can Tho", center: [10.0340, 105.7800], zoom: 13,
    bounds: [[9.98, 105.71], [10.08, 105.83]] },
];
const CITY = Object.fromEntries(CITIES.map((c) => [c.key, c]));
function memoryCity(m) { return m.city || "hanoi"; }
function nearestCity(lat, lng) {
  let best = CITIES[0], bd = Infinity;
  for (const c of CITIES) { const dd = Math.hypot(c.center[0] - lat, c.center[1] - lng); if (dd < bd) { bd = dd; best = c; } }
  return best;
}

// ---------------------------------------------------------------------------
// MEMORIES — seed archive
// ---------------------------------------------------------------------------
const MEMORIES = [
  { id: "m01", lat: 21.0335, lng: 105.8585, ward: "Phúc Tân", cat: "event", year: 2026, date: "14 Tháng 3, 2026 · 06:15", dateEn: "14 March 2026 · 06:15", photo: true,
    vi: "Sáng nay họ dán thông báo lên cánh cửa nhà tôi. Ba mươi ngày. Cả đời ông bà tôi ở con ngõ này, giờ gói lại trong ba mươi ngày.",
    en: "This morning they taped the notice to my door. Thirty days. My grandparents' whole life in this alley, now folded into thirty days." },
  { id: "m02", lat: 21.0305, lng: 105.8510, ward: "Hoàn Kiếm", cat: "personal", year: 2026, date: "2 Tháng 4, 2026 · 05:00", dateEn: "2 April 2026 · 05:00",
    vi: "Bà bán trà đá đầu ngõ vẫn dọn hàng lúc năm giờ sáng, như thể không có gì thay đổi. Có lẽ đó là cách bà phản kháng.",
    en: "The iced-tea seller still sets up at five each morning, as if nothing is changing. Maybe that is her way of resisting." },
];

// ---------------------------------------------------------------------------
// National network memories
// ---------------------------------------------------------------------------
const MEMORIES_NETWORK = [
  { id: "hcmc1", city: "hcmc", lat: 10.7705, lng: 106.7215, ward: "Thủ Thiêm", cat: "personal", year: 2012, date: "Khoảng 2012", dateEn: "circa 2012", photo: true,
    vi: "Khu nhà tôi ở Thủ Thiêm giờ là bãi đất trống nhìn sang quận Một. Tôi vẫn đi xe qua, chỉ để nhìn nơi từng là sân nhà mình.",
    en: "My block in Thủ Thiêm is now empty land facing District 1. I still ride past, just to look at where our yard used to be." },
  { id: "hcmc2", city: "hcmc", lat: 10.7721, lng: 106.6983, ward: "Bến Thành", cat: "personal", year: 2025, date: "Tháng 9, 2025", dateEn: "September 2025",
    vi: "Đồng hồ chợ Bến Thành vẫn chạy. Mẹ tôi hẹn gặp ba dưới gác chuông ấy năm 1968. Tôi không để ai gỡ nó đi.",
    en: "The Bến Thành market clock still runs. My mother met my father under that tower in 1968. I won't let anyone take it down." },
  { id: "hue1", city: "hue", lat: 16.4712, lng: 107.5772, ward: "Thượng Thành", cat: "event", year: 2021, date: "Tháng 2, 2021", dateEn: "February 2021", photo: true,
    vi: "Nhà tôi dựng trên Thượng Thành kinh thành Huế bốn đời. Họ di dời chúng tôi để trả lại tường thành cho lịch sử. Nhưng chúng tôi cũng là lịch sử.",
    en: "My family lived on the citadel ramparts of Huế for four generations. They moved us to give the walls back to history. But we are history too." },
  { id: "hue2", city: "hue", lat: 16.4690, lng: 107.5930, ward: "Phú Hội", cat: "personal", year: 2020, date: "Khoảng 2020", dateEn: "circa 2020",
    vi: "Cầu Trường Tiền đổi màu đèn mỗi tối. Hồi nhỏ nó chỉ có ánh trăng. Tôi vẫn thích ánh trăng hơn.",
    en: "The Trường Tiền bridge changes colour every night now. As a child it had only moonlight. I still prefer the moon." },
  { id: "dn1", city: "danang", lat: 16.0712, lng: 108.2238, ward: "Hải Châu", cat: "personal", year: 2022, date: "Khoảng 2022", dateEn: "circa 2022", photo: true,
    vi: "Làng chài bên sông Hàn giờ là dãy cao ốc kính. Cha tôi chỉ tay: 'Thuyền mình từng buộc đúng chỗ kia.'",
    en: "The fishing village by the Hàn River is now a row of glass towers. My father points: 'Our boat was tied right there.'" },
  { id: "dn2", city: "danang", lat: 16.0613, lng: 108.2275, ward: "Sơn Trà", cat: "event", year: 2024, date: "Tháng 7, 2024", dateEn: "July 2024",
    vi: "Cầu Rồng phun lửa mỗi cuối tuần. Du khách quay phim. Tôi nhớ bến phà cũ từng ở đây, và người lái phà tên Bảy.",
    en: "The Dragon Bridge breathes fire each weekend. Tourists film it. I remember the old ferry that was here, and the ferryman named Bảy." },
  { id: "ct1", city: "cantho", lat: 10.0152, lng: 105.7402, ward: "Cái Răng", cat: "personal", year: 2024, date: "Khoảng 2024", dateEn: "circa 2024", photo: true,
    vi: "Chợ nổi Cái Răng mỗi năm một thưa. Ghe ít dần, đường bộ nhiều thêm. Tôi dạy con tôi cách treo bẹo, phòng khi nó còn muốn nhớ.",
    en: "The Cái Răng floating market thins each year. Fewer boats, more roads. I teach my child how to hang the 'bẹo' pole, in case they ever wish to remember." },
  { id: "ct2", city: "cantho", lat: 10.0335, lng: 105.7905, ward: "Ninh Kiều", cat: "news", year: 2026, date: "Tháng 3, 2026", dateEn: "March 2026",
    vi: "Bờ sông Ninh Kiều lại sạt một đoạn. Nước lấy đi từng mảnh đất, lặng lẽ hơn mọi quy hoạch.",
    en: "Another stretch of the Ninh Kiều riverbank has collapsed. The water takes the land piece by piece, quieter than any plan." },
];
MEMORIES_NETWORK.forEach((m) => MEMORIES.push(m));
MEMORIES.forEach((m) => { if (!m.city) m.city = "hanoi"; });

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function uid() {
  return "u" + Math.random().toString(36).slice(2, 9);
}

function compressImage(file, maxDim = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve({ dataUrl: canvas.toDataURL("image/jpeg", quality), width, height });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function isApprox(m) {
  return /khoảng|ước/i.test(m.date || "") || /circa|approx|around|before/i.test(m.dateEn || "");
}

function dist(a, b) {
  return Math.hypot(a.lat - b.lat, (a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180));
}

function fauxCoord(lat, lng) {
  return `${(+lat).toFixed(4)}°N · ${(+lng).toFixed(4)}°E`;
}

/* ===========================================================================
   RESEARCH-MODE DERIVATIONS
   =========================================================================== */

function parseMemoryDate(m) {
  const year = m.year || null;
  if ("month" in m || "day" in m) {
    return { year, month: m.month != null ? +m.month : null, day: m.day != null ? +m.day : null };
  }
  const s = (m.dateEn || m.date || "");
  let month = null, day = null;
  for (let i = 0; i < MONTHS.en.length; i++) {
    if (new RegExp("\\b" + MONTHS.en[i], "i").test(s)) { month = i + 1; break; }
  }
  if (month != null) {
    const dm = s.match(/\b(\d{1,2})\s+[A-Za-z]/);
    if (dm) day = +dm[1];
  }
  return { year, month, day };
}

function dateBoundsInt(year, month, day) {
  if (!year) return [0, 99999999];
  const lo = year * 10000 + (month || 1) * 100 + (day || 1);
  const hi = year * 10000 + (month || 12) * 100 + (day || 31);
  return [lo, hi];
}
function memoryDateBounds(m) { const d = parseMemoryDate(m); return dateBoundsInt(d.year, d.month, d.day); }

function isVerified(m) { return !m.mine; }
function memoryLang(m) { return m.lang || "vi"; }
function memoryMedia(m) {
  if (m.media === "video") return "video";
  if (m.photo || m.photoData) return "photo";
  return "text";
}

function arweaveHash(seed) {
  const cs = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let h = 2166136261 >>> 0; const s = String(seed); let out = "";
  for (let i = 0; i < 43; i++) {
    h ^= s.charCodeAt(i % s.length) + i * 131;
    h = Math.imul(h, 16777619) >>> 0;
    out += cs[h % 64];
  }
  return out;
}

function submittedISO(m) {
  if (m.submittedAt) return new Date(m.submittedAt).toISOString();
  const d = parseMemoryDate(m);
  const dt = new Date(Date.UTC(d.year || 2026, (d.month || 1) - 1, d.day || 1,
    8 + (arweaveHash(m.id).charCodeAt(0) % 12), 0, 0));
  return dt.toISOString();
}

const CAT_SLUG = { personal: "life-story", news: "news", community: "community-action", event: "event" };
const TAG_LEXICON = [
  ["notice", "eviction-notice"], ["thirty days", "eviction-notice"], ["evict", "eviction"],
  ["petition", "petition"], ["signatures", "petition"], ["sign the", "petition"],
  ["candle", "vigil"], ["dyke", "river"], ["river", "river"], ["flood", "river"], ["islet", "river"],
  ["excavator", "demolition"], ["red paint", "demolition"], ["tear it down", "demolition"], ["bulldoz", "demolition"],
  ["bridge", "bridge"], ["flower", "flower"], ["daisies", "flower"], ["tree", "tree"], ["almond", "tree"],
  ["market", "market"], ["chợ", "market"], ["compensation", "compensation"], ["resettle", "resettlement"],
  ["relocat", "relocation"], ["journalist", "press"], ["article", "press"], ["bicycle", "craft"],
  ["phở", "livelihood"], ["shop", "livelihood"], ["vendor", "livelihood"], ["kite", "childhood"],
  ["lake", "lake"], ["chalk", "memory-keeping"], ["street-name", "memory-keeping"], ["band on", "vigil"],
];
function deriveTags(m) {
  const set = new Set();
  set.add(CAT_SLUG[m.cat] || m.cat);
  if (m.ward) set.add(m.ward.toLowerCase().replace(/\s+/g, "-"));
  const d = parseMemoryDate(m);
  if (d.year >= 2026) set.add("relocation-era"); else if (d.year < 2010) set.add("historical");
  if (isApprox(m)) set.add("approximate");
  const mt = memoryMedia(m); if (mt !== "text") set.add(mt);
  const hay = ((m.en || "") + " " + (m.vi || "")).toLowerCase();
  for (const [kw, tag] of TAG_LEXICON) if (hay.includes(kw)) set.add(tag);
  return [...set];
}

function searchHaystack(m) {
  const c = catOf(m.cat);
  return [m.vi, m.en, m.ward, c.vi, c.en, deriveTags(m).join(" ")]
    .filter(Boolean).join("  ").toLowerCase();
}

function haversineM(aLat, aLng, bLat, bLng) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR, dLng = (bLng - aLng) * toR;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function pointInPolygon(lat, lng, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
    const hit = (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}
function inShape(m, shape) {
  if (!shape) return true;
  if (shape.type === "circle")
    return haversineM(m.lat, m.lng, shape.center[0], shape.center[1]) <= shape.radius;
  if (shape.type === "polygon")
    return shape.latlngs.length >= 3 && pointInPolygon(m.lat, m.lng, shape.latlngs);
  return true;
}

Object.assign(window, {
  STR, CATS, CAT, catOf, MONTHS, MEMORIES, HANOI_CENTER, BASEMAPS, BASEMAP, WARDS, nearestWard,
  CLEARANCE_ZONE, CLEARANCE_LABEL, MIN_YEAR, MAX_YEAR,
  uid, compressImage, dist, fauxCoord, isApprox,
  parseMemoryDate, dateBoundsInt, memoryDateBounds, isVerified, memoryLang, memoryMedia,
  arweaveHash, submittedISO, deriveTags, searchHaystack, CAT_SLUG,
  haversineM, pointInPolygon, inShape,
  VIETNAM_BOUNDS, CITIES, CITY, memoryCity, nearestCity,
});
