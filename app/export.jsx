/* ============================================================================
   export.jsx — data export: Tier A Quick Report (HTML/print) + Tier B Dataset
   ============================================================================ */

const EXPORT_COLS = [
  "id", "lat", "lng", "year", "month", "day",
  "category", "tags", "timestamp_submitted", "hash_arweave",
  "media_url", "is_verified", "language", "ward",
  "content_type", "text_vi", "text_en",
];

function deriveRow(m) {
  const d = parseMemoryDate(m);
  return {
    id: m.id,
    lat: m.lat,
    lng: m.lng,
    year: d.year || "",
    month: d.month || "",
    day: d.day || "",
    category: m.cat,
    tags: deriveTags(m).join("|"),
    timestamp_submitted: submittedISO(m),
    hash_arweave: arweaveHash(m.id),
    media_url: m.photoData ? "[embedded]" : "",
    is_verified: isVerified(m) ? "true" : "false",
    language: memoryLang(m),
    ward: m.ward || "",
    content_type: memoryMedia(m),
    text_vi: (m.vi || "").replace(/\n/g, " "),
    text_en: (m.en || "").replace(/\n/g, " "),
  };
}

function csvCell(v) {
  const s = String(v == null ? "" : v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCSV(rows) {
  const lines = [EXPORT_COLS.join(",")];
  rows.forEach((r) => lines.push(EXPORT_COLS.map((c) => csvCell(r[c])).join(",")));
  return lines.join("\r\n");
}

function toJSON(rows) {
  return JSON.stringify(rows, null, 2);
}

function toGeoJSON(mems) {
  return JSON.stringify({
    type: "FeatureCollection",
    features: mems.map((m) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [m.lng, m.lat] },
      properties: deriveRow(m),
    })),
  }, null, 2);
}

function downloadText(content, filename, mime) {
  const blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function computeStats(mems) {
  const total = mems.length;
  const verified = mems.filter(isVerified).length;
  const unverified = total - verified;
  const byCat = {};
  CATS.forEach((c) => { byCat[c.key] = 0; });
  mems.forEach((m) => { if (byCat[m.cat] !== undefined) byCat[m.cat]++; });
  const years = mems.map((m) => m.year).filter(Boolean);
  const peakMap = {};
  years.forEach((y) => { peakMap[y] = (peakMap[y] || 0) + 1; });
  const peakYears = Object.entries(peakMap).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([y]) => +y);
  const span = years.length ? [Math.min(...years), Math.max(...years)] : [null, null];
  return { total, verified, unverified, byCat, peakYears, span };
}

function topMemories(results, n = 10) {
  return [...results]
    .sort((a, b) => {
      const va = isVerified(a) ? 1 : 0, vb = isVerified(b) ? 1 : 0;
      if (vb !== va) return vb - va;
      return (b.year || 0) - (a.year || 0);
    })
    .slice(0, n);
}

function summarizeFilters(adv, lang) {
  const parts = [];
  const t = STR[lang];
  if (adv.fromYear || adv.toYear) parts.push(`${adv.fromYear || MIN_YEAR}–${adv.toYear || MAX_YEAR}`);
  if (adv.catFilter && adv.catFilter.size > 0) parts.push([...adv.catFilter].join(", "));
  if (adv.textQ) parts.push(`"${adv.textQ}"`);
  if (adv.queryShape) parts.push(adv.queryShape.type === "circle" ? `circle ${Math.round(adv.queryShape.radius)}m` : "polygon");
  return parts.length ? parts.join(" · ") : (lang === "vi" ? "Tất cả ký ức" : "All memories");
}

function buildSnapshotSVG(mems, w = 640, h = 320) {
  const lat2y = (lat) => h - ((lat - 8.4) / (23.4 - 8.4)) * h;
  const lng2x = (lng) => ((lng - 102.1) / (109.7 - 102.1)) * w;
  const dots = mems.map((m) => {
    const c = catOf(m.cat);
    const x = lng2x(m.lng).toFixed(1), y = lat2y(m.lat).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="4" fill="${c.color}" opacity="0.85"/>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="background:#f5f2ed;border-radius:6px;">
  <rect width="${w}" height="${h}" fill="#f5f2ed"/>
  ${dots}
</svg>`;
}

function buildReportHTML(mems, lang, filterSummary) {
  const t = STR[lang];
  const stats = computeStats(mems);
  const top = topMemories(mems, 10);
  const svgMap = buildSnapshotSVG(mems);
  const now = new Date().toISOString().slice(0, 10);

  const memHtml = top.map((m) => {
    const c = catOf(m.cat);
    const text = lang === "vi" ? m.vi : m.en;
    const when = lang === "vi" ? m.date : (m.dateEn || m.date);
    return `<div style="border-left:3px solid ${c.color};padding:8px 14px;margin:12px 0;background:#fafaf8;">
      <div style="font-size:11px;color:#888;margin-bottom:4px;">${c[lang]} · ${m.ward} · ${when}</div>
      <div style="font-size:14px;font-family:Georgia,serif;line-height:1.6;">${text}</div>
    </div>`;
  }).join("");

  const catRows = CATS.map((c) => `<tr><td style="padding:4px 8px;color:${c.color}">●</td><td style="padding:4px 8px;">${c[lang]}</td><td style="padding:4px 8px;text-align:right;">${stats.byCat[c.key] || 0}</td></tr>`).join("");

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t.tierAName} — ${t.siteName}</title>
<style>
body{font-family:Georgia,serif;color:#1a1a1a;max-width:800px;margin:40px auto;padding:0 20px}
h1{font-size:22px;margin-bottom:4px}
.sub{color:#888;font-size:13px;font-family:monospace}
.stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0}
.stat-box{border:1px solid #e0ddd8;border-radius:6px;padding:12px;text-align:center}
.stat-n{font-size:28px;font-weight:700;color:#d8552f}
.stat-l{font-size:12px;color:#666;margin-top:4px}
table{border-collapse:collapse;width:100%}
@media print{body{margin:0}button{display:none}}
</style>
</head>
<body>
<h1>Miền Ký Ức · ${t.tierAName}</h1>
<p class="sub">${now} · ${filterSummary}</p>

${svgMap}

<div class="stat-grid">
  <div class="stat-box"><div class="stat-n">${stats.total}</div><div class="stat-l">${t.voices}</div></div>
  <div class="stat-box"><div class="stat-n">${stats.verified}</div><div class="stat-l">${t.stVer}</div></div>
  <div class="stat-box"><div class="stat-n">${stats.span[0] || "—"} – ${stats.span[1] || "—"}</div><div class="stat-l">${lang === "vi" ? "Khoảng thời gian" : "Date span"}</div></div>
</div>

<table><thead><tr><th></th><th style="text-align:left">${t.category}</th><th style="text-align:right">#</th></tr></thead><tbody>${catRows}</tbody></table>

<h2 style="margin-top:32px">${lang === "vi" ? "10 ký ức tiêu biểu" : "Top 10 memories"}</h2>
${memHtml}

<p style="color:#aaa;font-size:11px;margin-top:32px">
  ${t.privacyNote}<br>
  Miền Ký Ức — ${now}
</p>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// ExportModal component
// ---------------------------------------------------------------------------
function ExportModal({ lang, accent, results, adv, onClose }) {
  const t = STR[lang];
  const [tier, setTier] = React.useState("a");
  const [fmt, setFmt] = React.useState("csv");
  const [reportHtml, setReportHtml] = React.useState(null);

  if (!results || results.length === 0) {
    return (
      <div className="export-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="export-modal" role="dialog" aria-modal="true">
          <button className="export-close" onClick={onClose}>✕</button>
          <div className="export-title">{t.exportTitle}</div>
          <p>{t.noResults}</p>
        </div>
      </div>
    );
  }

  const doExportDataset = () => {
    const rows = results.map(deriveRow);
    if (fmt === "csv") downloadText(toCSV(rows), "memorieslane-data.csv", "text/csv;charset=utf-8");
    else if (fmt === "json") downloadText(toJSON(rows), "memorieslane-data.json", "application/json");
    else if (fmt === "geojson") downloadText(toGeoJSON(results), "memorieslane-data.geojson", "application/geo+json");
  };

  const doOpenReport = () => {
    const fs = summarizeFilters(adv || {}, lang);
    const html = buildReportHTML(results, lang, fs);
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
    else setReportHtml(html);
  };

  const doDownloadReport = () => {
    const fs = summarizeFilters(adv || {}, lang);
    downloadText(buildReportHTML(results, lang, fs), "memorieslane-report.html", "text/html;charset=utf-8");
  };

  return (
    <div className="export-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="export-modal" role="dialog" aria-modal="true" aria-label={t.exportTitle}>
        <button className="export-close" onClick={onClose} aria-label={t.close}>✕</button>
        <div className="export-kicker">Miền Ký Ức</div>
        <div className="export-title">{t.exportTitle}</div>
        <p className="export-sub">{t.exportSub} <b>{results.length}</b></p>

        {/* Tier selector */}
        <div className="export-tiers">
          <button className={"export-tier " + (tier === "a" ? "on" : "")} onClick={() => setTier("a")}>
            <div className="tier-badge">A</div>
            <div className="tier-info">
              <div className="tier-name">{t.tierAName}</div>
              <div className="tier-for">{t.tierAFor}</div>
              <div className="tier-desc">{t.tierADesc}</div>
            </div>
          </button>
          <button className={"export-tier " + (tier === "b" ? "on" : "")} onClick={() => setTier("b")}>
            <div className="tier-badge">B</div>
            <div className="tier-info">
              <div className="tier-name">{t.tierBName}</div>
              <div className="tier-for">{t.tierBFor}</div>
              <div className="tier-desc">{t.tierBDesc}</div>
            </div>
          </button>
        </div>

        {tier === "a" && (
          <div className="export-actions">
            <button className="export-btn primary" style={{ background: accent }} onClick={doOpenReport}>{t.openReport}</button>
            <button className="export-btn" onClick={doDownloadReport}>{t.downloadHtml}</button>
          </div>
        )}

        {tier === "b" && (
          <div className="export-b">
            <div className="export-fmt-row">
              {["csv", "json", "geojson"].map((f) => (
                <button key={f} className={"export-fmt " + (fmt === f ? "on" : "")} onClick={() => setFmt(f)}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
            <button className="export-btn primary" style={{ background: accent }} onClick={doExportDataset}>
              ↓ {lang === "vi" ? "Tải xuống" : "Download"} .{fmt}
            </button>
          </div>
        )}

        <p className="export-privacy">{t.privacyNote}</p>
      </div>
    </div>
  );
}

Object.assign(window, { ExportModal, deriveRow, toCSV, toJSON, toGeoJSON, computeStats, buildReportHTML, summarizeFilters });
