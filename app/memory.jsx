/* ============================================================================
   memory.jsx — read-side components: MemoryDetail dock, AboutPanel modal
   ============================================================================ */

function PhotoPlaceholder({ width = 340, height = 220 }) {
  const id = "pp" + Math.random().toString(36).slice(2, 7);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} xmlns="http://www.w3.org/2000/svg" className="photo-placeholder-svg" aria-hidden="true">
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" width="12" height="12" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="12" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.18" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill={`url(#${id})`} />
      <text x={width / 2} y={height / 2 + 5} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.35" fontFamily="IBM Plex Mono, monospace">
        [ archive image ]
      </text>
    </svg>
  );
}

function MemoryDetail({ memory: m, lang, accent, gold, onClose, onPrev, onNext, quoteFont }) {
  const t = STR[lang];

  React.useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose && onClose();
      if (e.key === "ArrowLeft") onPrev && onPrev();
      if (e.key === "ArrowRight") onNext && onNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onPrev, onNext]);

  if (!m) return null;
  const c = catOf(m.cat);
  const text = lang === "vi" ? m.vi : m.en;
  const when = lang === "vi" ? m.date : (m.dateEn || m.date);
  const approx = isApprox(m);
  const fqFont = quoteFont === "mono" ? "'IBM Plex Mono', monospace" : quoteFont === "sans" ? "'Be Vietnam Pro', sans-serif" : "'Lora', serif";

  return (
    <aside className="read-dock" role="dialog" aria-modal="false">
      <button className="dock-close" onClick={onClose} aria-label={t.close}>✕</button>

      <div className="read-cat-pill" style={{ background: c.color + "22", color: c.color, borderColor: c.color + "55" }}>
        <span className="cat-dot" style={{ background: c.color }} />
        {c[lang]}
      </div>

      <div className="read-coord">{fauxCoord(m.lat, m.lng)}</div>

      <div className="read-photo">
        {m.photoData
          ? <img src={m.photoData} alt={t.photoPlaceholder} className="read-photo-img" />
          : <PhotoPlaceholder width={340} height={200} />}
      </div>

      <blockquote className="read-quote" style={{ fontFamily: fqFont }}>
        {text}
      </blockquote>

      <div className="read-footer">
        <div className="read-footer-row">
          <span className="read-footer-label">{t.timeWhen}</span>
          <span className="read-footer-val">{approx ? "~" : ""}{when}</span>
        </div>
        <div className="read-footer-row">
          <span className="read-footer-label">{t.ward}</span>
          <span className="read-footer-val">{m.ward}</span>
        </div>
        {m.mine && (
          <div className="read-footer-row">
            <span className="read-footer-label">Status</span>
            <span className="read-footer-val pending">● {lang === "vi" ? "Đang chờ duyệt" : "Pending review"}</span>
          </div>
        )}
      </div>

      <nav className="read-nav" aria-label="Navigate memories">
        <button className="nav-btn" onClick={onPrev} aria-label="Previous">
          ← {lang === "vi" ? "Lân cận" : "Nearby"}
        </button>
        <span className="nav-sep">·</span>
        <span className="nav-drift">{lang === "vi" ? "drift" : "drift"}</span>
        <span className="nav-sep">·</span>
        <button className="nav-btn" onClick={onNext} aria-label="Next">
          {lang === "vi" ? "Lân cận" : "Nearby"} →
        </button>
      </nav>
    </aside>
  );
}

function AboutPanel({ lang, onClose }) {
  const t = STR[lang];
  return (
    <div className="about-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="about-modal" role="dialog" aria-modal="true" aria-label={t.aboutTitle}>
        <button className="about-close" onClick={onClose} aria-label={t.close}>✕</button>
        <div className="about-kicker">Miền Ký Ức · Memories of Hà Nội</div>
        <h2 className="about-title">{t.aboutTitle}</h2>
        <p className="about-body">{t.aboutBody}</p>

        <h3 className="about-sub">{t.howTitle}</h3>
        <ol className="about-steps">
          <li>{t.how1}</li>
          <li>{t.how2}</li>
          <li>{t.how3}</li>
          <li>{t.how4}</li>
        </ol>

        <h3 className="about-sub">{t.guidelinesTitle}</h3>
        <p className="about-body">{t.guidelinesBody}</p>

        <h3 className="about-sub">{lang === "vi" ? "Phân loại ký ức" : "Memory categories"}</h3>
        <div className="about-legend">
          {CATS.map((c) => (
            <div key={c.key} className="legend-row">
              <span className="legend-dot" style={{ background: c.color }} />
              <span className="legend-name">{c[lang]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { MemoryDetail, AboutPanel, PhotoPlaceholder });
