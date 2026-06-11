/* ============================================================================
   export.jsx — the Data Export ecosystem.
   Tier A · Quick Report (journalists): printable HTML/PDF with a map snapshot,
            the top memories, and summary statistics.
   Tier B · Structured Dataset (researchers): CSV / JSON / GeoJSON of the full
            metadata for every filtered result, moderation status included.
   Privacy: only public, already-published data is serialised — no raw uploads,
   names, or IPs ever leave the archive.
   ============================================================================ */

// ---- the canonical export row (pure function of a memory) ------------------
const EXPORT_COLS = [
  "id", "latitude", "longitude", "year", "month", "day", "category", "tags",
  "timestamp_submitted", "hash_arweave", "media_url", "is_verified",
  "language", "ward", "content_type", "text_vi", "text_en",
];

function deriveRow(m) {
  const d = parseMemoryDate(m);
  const verified = isVerified(m);
  const media = memoryMedia(m);
  const hash = verified ? arweaveHash(m.id) : "";
  const media_url = media === "text" ? "" : (verified ? "https://arweave.net/" + hash : "");
  return {
    id: m.id,
    latitude: +(+m.lat).toFixed(5),
    longitude: +(+m.lng).toFixed(5),
    year: d.year,
    month: d.month,            // null when unknown
    day: d.day,                // null when unknown
    category: catOf(m.cat).en,
    tags: deriveTags(m),
    timestamp_submitted: submittedISO(m),
    hash_arweave: hash || null,
    media_url: media_url || null,
    is_verified: verified,
    language: memoryLang(m),
    ward: m.ward || null,
    content_type: media,
    text_vi: m.vi || "",
    text_en: m.en || "",
  };
}

// ---- serialisers -----------------------------------------------------------
function csvCell(v) {
  if (v == null) return "";
  if (Array.isArray(v)) v = v.join(";");
  v = String(v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function toCSV(rows) {
  const head = EXPORT_COLS.join(",");
  const body = rows.map((r) => EXPORT_COLS.map((c) => csvCell(r[c])).join(",")).join("\n");
  return head + "\n" + body + "\n";
}
function toJSON(rows) {
  return JSON.stringify({
    archive: "Miền Ký Ức — Memory Lane",
    generated: new Date().toISOString(),
    privacy: "Public testimony only. Names and IPs stripped.",
    count: rows.length,
    records: rows,
  }, null, 2);
}
function toGeoJSON(rows) {
  return JSON.stringify({
    type: "FeatureCollection",
    generated: new Date().toISOString(),
    features: rows.map((r) => {
      const props = { ...r }; delete props.latitude; delete props.longitude;
      return { type: "Feature", geometry: { type: "Point", coordinates: [r.longitude, r.latitude] }, properties: props };
    }),
  }, null, 2);
}

function downloadText(name, text, mime) {
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// ---- statistics ------------------------------------------------------------
function computeStats(results) {
  const total = results.length;
  const verified = results.filter(isVerified).length;
  const byCat = {}; CATS.forEach((c) => (byCat[c.key] = 0));
  const byYear = {};
  results.forEach((m) => {
    byCat[m.cat] = (byCat[m.cat] || 0) + 1;
    const y = parseMemoryDate(m).year || 0; byYear[y] = (byYear[y] || 0) + 1;
  });
  const peak = Object.entries(byYear).map(([y, n]) => [+y, n]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const years = Object.keys(byYear).map(Number).filter(Boolean);
  const span = years.length ? [Math.min(...years), Math.max(...years)] : null;
  return { total, verified, unverified: total - verified, byCat, byYear, peak, span };
}

function topMemories(results, n) {
  return results.slice().sort((a, b) =>
    (parseMemoryDate(b).year - parseMemoryDate(a).year) || (isVerified(b) - isVerified(a))
  ).slice(0, n);
}

// ---- filter summary (human readable) --------------------------------------
function summarizeFilters(lang, range, adv, shape, compiled) {
  const S = STR[lang]; const out = [];
  const mm = (m) => (m == null ? "" : "-" + String(m).padStart(2, "0"));
  out.push(`${S.temporal}: ${range[0]}${mm(adv.fM)}${adv.precision === "day" ? mm(adv.fD) : ""} → ${range[1]}${mm(adv.tM)}${adv.precision === "day" ? mm(adv.tD) : ""}`);
  if (shape) out.push(shape.type === "circle"
    ? `${S.spatial}: ◯ ${shape.radius >= 1000 ? (shape.radius / 1000).toFixed(2) + "km" : Math.round(shape.radius) + "m"}`
    : `${S.spatial}: ⬡ ${shape.latlngs.length} ${S.points}`);
  if (adv.query.trim()) out.push(`${S.textSearch}: ${adv.query.trim()}`);
  if (adv.cats.length) out.push(`${S.category}: ${adv.cats.map((k) => catOf(k)[lang]).join(", ")}`);
  if (adv.content.length) out.push(`${S.fContent}: ${adv.content.join(", ")}`);
  if (adv.langs.length) out.push(`${S.fLang}: ${adv.langs.join(", ")}`);
  if (adv.status !== "all") out.push(`${S.fStatus}: ${adv.status === "verified" ? S.stVer : S.stUnver}`);
  return out;
}

// ---- map snapshot (SVG, equirectangular within result bbox) ----------------
function buildSnapshotSVG(results, shape) {
  const W = 680, H = 384, pad = 34;
  const pts = results.map((m) => [m.lat, m.lng]);
  let lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1]);
  if (shape && shape.type === "polygon") { shape.latlngs.forEach((p) => { lats.push(p[0]); lngs.push(p[1]); }); }
  if (shape && shape.type === "circle") { lats.push(shape.center[0]); lngs.push(shape.center[1]); }
  if (!lats.length) { lats = [HANOI_CENTER[0]]; lngs = [HANOI_CENTER[1]]; }
  let minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  let dLat = maxLat - minLat, dLng = maxLng - minLng;
  if (dLat < 0.004) { const c = (minLat + maxLat) / 2; minLat = c - 0.004; maxLat = c + 0.004; dLat = 0.008; }
  if (dLng < 0.004) { const c = (minLng + maxLng) / 2; minLng = c - 0.004; maxLng = c + 0.004; dLng = 0.008; }
  const sx = (lng) => pad + ((lng - minLng) / dLng) * (W - 2 * pad);
  const sy = (lat) => pad + ((maxLat - lat) / dLat) * (H - 2 * pad);

  let g = `<rect x="0" y="0" width="${W}" height="${H}" fill="#ece7db"/>`;
  for (let i = 1; i < 6; i++) {
    const gx = pad + (i / 6) * (W - 2 * pad), gy = pad + (i / 6) * (H - 2 * pad);
    g += `<line x1="${gx}" y1="${pad}" x2="${gx}" y2="${H - pad}" stroke="#d8cdb6" stroke-width="1"/>`;
    g += `<line x1="${pad}" y1="${gy}" x2="${W - pad}" y2="${gy}" stroke="#d8cdb6" stroke-width="1"/>`;
  }
  g += `<rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}" fill="none" stroke="#cdc3ad" stroke-width="1"/>`;

  if (shape && shape.type === "polygon" && shape.latlngs.length >= 3) {
    const d = shape.latlngs.map((p) => sx(p[1]) + "," + sy(p[0])).join(" ");
    g += `<polygon points="${d}" fill="#d8552f22" stroke="#d8552f" stroke-width="1.6" stroke-dasharray="6 5"/>`;
  }
  if (shape && shape.type === "circle") {
    const cx = sx(shape.center[1]), cy = sy(shape.center[0]);
    const edgeLng = shape.center[1] + shape.radius / (111320 * Math.cos(shape.center[0] * Math.PI / 180));
    const rx = Math.abs(sx(edgeLng) - cx);
    const edgeLat = shape.center[0] + shape.radius / 110540;
    const ry = Math.abs(sy(edgeLat) - cy);
    g += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#d8552f22" stroke="#d8552f" stroke-width="1.6" stroke-dasharray="6 5"/>`;
  }
  results.forEach((m) => {
    const c = catOf(m.cat).color;
    g += `<circle cx="${sx(m.lng).toFixed(1)}" cy="${sy(m.lat).toFixed(1)}" r="4.5" fill="${c}" stroke="#fff" stroke-width="1.2"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block">${g}</svg>`;
}

// ---- Quick Report HTML -----------------------------------------------------
function buildReportHTML(lang, results, range, adv, shape) {
  const S = STR[lang];
  const st = computeStats(results);
  const tops = topMemories(results, 10);
  const snap = buildSnapshotSVG(results, shape);
  const fsum = summarizeFilters(lang, range, adv, shape, null);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const gen = new Date();

  const catRows = CATS.filter((c) => st.byCat[c.key]).map((c) =>
    `<div class="stat-cat"><span class="dot" style="background:${c.color}"></span>${esc(c[lang])}<b>${st.byCat[c.key]}</b></div>`).join("");
  const peakStr = st.peak.map(([y, n]) => `${y} <span class="muted">(${n})</span>`).join(" · ") || "—";
  const topRows = tops.map((m, i) => `
    <li class="mem">
      <div class="mem-i">${String(i + 1).padStart(2, "0")}</div>
      <div class="mem-b">
        <div class="mem-meta"><span class="dot" style="background:${catOf(m.cat).color}"></span>
          ${esc(catOf(m.cat)[lang])} · ${esc(m.ward || "—")} · ${esc(lang === "vi" ? m.date : (m.dateEn || m.date))}
          ${isVerified(m) ? '<span class="vchip">✓ ' + esc(S.stVer) + "</span>" : '<span class="uchip">' + esc(S.stUnver) + "</span>"}
        </div>
        <blockquote>${esc(lang === "vi" ? m.vi : m.en)}</blockquote>
      </div>
    </li>`).join("");

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"/>
<title>${esc(S.siteName)} — ${esc(S.tierAName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Lora:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<style>
:root{--ground:#ece7db;--panel:#fff;--ink:#23302a;--dim:#5f6b60;--faint:#979b8d;--line:#e0d8c7;--gold:#b07d1f;--ember:#d8552f;--mono:'IBM Plex Mono',monospace;--serif:'Lora',Georgia,serif}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--mono);-webkit-font-smoothing:antialiased;line-height:1.5}
.wrap{max-width:860px;margin:0 auto;padding:48px 40px 64px}
.rep-head{border-bottom:2px solid var(--ink);padding-bottom:18px;margin-bottom:26px}
.rep-kick{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--ember);font-weight:600}
.rep-h1{font-family:var(--serif);font-size:30px;font-weight:600;margin:8px 0 4px}
.rep-sub{font-size:12px;color:var(--dim);letter-spacing:.03em}
.section-l{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--gold);margin:34px 0 14px;font-weight:600}
.snap{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#ece7db}
.legend{display:flex;flex-wrap:wrap;gap:16px;margin-top:12px}
.legend span{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--dim)}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block}
.filt{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
.filt span{border:1px solid var(--line);border-radius:999px;padding:5px 11px;font-size:11px;color:var(--dim);background:#fff}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.stat{border:1px solid var(--line);border-radius:12px;padding:16px 18px;background:#fff}
.stat .k{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
.stat .v{font-family:var(--serif);font-size:30px;font-weight:600;margin-top:6px;line-height:1}
.stat.wide{grid-column:span 3;display:flex;flex-wrap:wrap;gap:18px;align-items:center}
.stat-cat{display:flex;align-items:center;gap:7px;font-size:13px}
.stat-cat b{margin-left:3px;color:var(--ink)}
.muted{color:var(--faint)}
ol.mems{list-style:none;margin:0;padding:0}
.mem{display:flex;gap:16px;padding:16px 0;border-bottom:1px solid var(--line)}
.mem-i{font-size:12px;color:var(--ember);font-weight:600;padding-top:3px}
.mem-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--dim);margin-bottom:8px}
.mem blockquote{font-family:var(--serif);font-size:17px;line-height:1.55;margin:0;color:var(--ink)}
.vchip{color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:2px 7px;font-size:9px}
.uchip{color:var(--ember);border:1px solid var(--ember);border-radius:999px;padding:2px 7px;font-size:9px}
.privacy{margin-top:34px;padding-top:18px;border-top:1px solid var(--line);font-size:11px;color:var(--faint);line-height:1.6}
@media print{body{background:#fff}.wrap{padding:0}.mem{break-inside:avoid}.snap,.stat{break-inside:avoid}}
</style></head><body><div class="wrap">
<div class="rep-head">
  <div class="rep-kick">${esc(S.tierAName)} · ${esc(S.tierAFor)}</div>
  <div class="rep-h1">${esc(S.siteName)}</div>
  <div class="rep-sub">${esc(lang === "vi" ? "Tạo lúc" : "Generated")} ${gen.toLocaleString(lang === "vi" ? "vi-VN" : "en-GB")} · ${st.total} ${esc(S.matchCount)}</div>
</div>

<div class="section-l">${esc(lang === "vi" ? "Ảnh chụp bản đồ" : "Map snapshot")}</div>
<div class="snap">${snap}</div>
<div class="legend">${CATS.map((c) => `<span><i class="dot" style="background:${c.color}"></i>${esc(c[lang])}</span>`).join("")}</div>
<div class="filt">${fsum.map((f) => `<span>${esc(f)}</span>`).join("")}</div>

<div class="section-l">${esc(lang === "vi" ? "Thống kê tóm tắt" : "Summary statistics")}</div>
<div class="stats">
  <div class="stat"><div class="k">${esc(S.matchCount)}</div><div class="v">${st.total}</div></div>
  <div class="stat"><div class="k">${esc(S.stVer)}</div><div class="v">${st.verified}</div></div>
  <div class="stat"><div class="k">${esc(S.stUnver)}</div><div class="v">${st.unverified}</div></div>
  <div class="stat wide"><div><div class="k">${esc(lang === "vi" ? "Năm cao điểm" : "Peak dates")}</div><div style="font-family:var(--serif);font-size:18px;margin-top:6px">${peakStr}</div></div>
    <div style="margin-left:auto"><div class="k">${esc(lang === "vi" ? "Khoảng năm" : "Date span")}</div><div style="font-family:var(--serif);font-size:18px;margin-top:6px">${st.span ? st.span[0] + " – " + st.span[1] : "—"}</div></div></div>
  <div class="stat wide">${catRows}</div>
</div>

<div class="section-l">${esc(lang === "vi" ? "10 ký ức tiêu biểu" : "Top 10 memories")}</div>
<ol class="mems">${topRows}</ol>

<div class="privacy">${esc(S.privacyNote)}</div>
</div></body></html>`;
}

function openReport(html) {
  const w = window.open("", "_blank");
  if (w && w.document) { w.document.open(); w.document.write(html); w.document.close(); }
  else downloadText("ky-uc-ha-noi-report.html", html, "text/html");
}

// ---- the export modal ------------------------------------------------------
function ExportModal({ lang, results, range, adv, shape, onClose }) {
  const S = STR[lang];
  const rows = React.useMemo(() => results.map(deriveRow), [results]);
  const stamp = () => new Date().toISOString().slice(0, 10);
  const fname = (ext) => `ky-uc-ha-noi_${stamp()}_${rows.length}.${ext}`;

  const doReport = () => openReport(buildReportHTML(lang, results, range, adv, shape));
  const dlReport = () => downloadText(fname("html"), buildReportHTML(lang, results, range, adv, shape), "text/html");

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="read-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="export-card" role="dialog" aria-label={S.exportTitle}>
        <button className="sheet-close" onClick={onClose} aria-label={S.close}>✕</button>
        <div className="exp-kicker">{S.researchMode}</div>
        <h2 className="exp-h">{S.exportTitle}</h2>
        <p className="exp-sub">{S.exportSub} <b>{rows.length}</b> {S.matchCount}.</p>

        <div className="tier">
          <div className="tier-head">
            <span className="tier-letter">A</span>
            <div className="tier-name"><b>{S.tierAName}</b><small>{S.tierAFor}</small></div>
            <span className="tier-fmt">PDF · HTML</span>
          </div>
          <p className="tier-desc">{S.tierADesc}</p>
          <div className="tier-btns">
            <button className="fmt-btn primary" onClick={doReport}>{S.openReport} ↗</button>
            <button className="fmt-btn" onClick={dlReport}>{S.downloadHtml}</button>
          </div>
        </div>

        <div className="tier">
          <div className="tier-head">
            <span className="tier-letter">B</span>
            <div className="tier-name"><b>{S.tierBName}</b><small>{S.tierBFor}</small></div>
            <span className="tier-fmt">CSV · JSON · GeoJSON</span>
          </div>
          <p className="tier-desc">{S.tierBDesc}</p>
          <div className="tier-cols">
            {EXPORT_COLS.map((c) => <code key={c} className={/verified|hash/.test(c) ? "col key" : "col"}>{c}</code>)}
          </div>
          <div className="tier-btns">
            <button className="fmt-btn" onClick={() => downloadText(fname("csv"), toCSV(rows), "text/csv")}>CSV</button>
            <button className="fmt-btn" onClick={() => downloadText(fname("json"), toJSON(rows), "application/json")}>JSON</button>
            <button className="fmt-btn" onClick={() => downloadText(fname("geojson"), toGeoJSON(rows), "application/geo+json")}>GeoJSON</button>
          </div>
        </div>

        <div className="exp-privacy"><span className="lock">◆</span>{S.privacyNote}</div>
      </aside>
    </div>
  );
}

window.ExportModal = ExportModal;
window.deriveRow = deriveRow;
