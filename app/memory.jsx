/* ============================================================================
   memory.jsx — the reading experience + the about / menu drawer.
   The interface chrome is the cold "document" (mono); the testimony itself is
   the warm human voice (serif). That contrast is the whole idea.
   ============================================================================ */

function PhotoPlaceholder({ label }) {
  return (
    <div className="photo-ph">
      <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 60">
        <defs>
          <pattern id="ph-stripe" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="transparent" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.4" />
          </pattern>
        </defs>
        <rect width="100" height="60" fill="url(#ph-stripe)" />
      </svg>
      <span className="photo-ph-label">{label}</span>
    </div>
  );
}

function MemoryDetail({ memory, lang, onClose, onPrev, onNext, onOpenCase }) {
  const t = STR[lang];
  const m = memory;
  const c0 = catOf(m.cat);
  const cc = c0.color;

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  return (
    <aside className="read-dock" role="dialog" aria-label={t.yourMemory}>
      <div className="read-panel">
        <button className="sheet-close" onClick={onClose} aria-label={t.close}>✕</button>

        <header className="read-head">
          <span className="read-cat" style={{ color: cc, borderColor: cc }}>
            <span className="cat-dot" style={{ background: cc }} />{c0[lang]}
          </span>
          <span className="read-coord">{fauxCoord(m.lat, m.lng)}</span>
        </header>

        {(m.photo || m.photoData) && (
          <div className="read-photo">
            {m.photoData
              ? <img src={m.photoData} alt="" />
              : <PhotoPlaceholder label={t.photoPlaceholder} />}
          </div>
        )}

        <blockquote className="read-quote">{lang === "vi" ? m.vi : m.en}</blockquote>

        <footer className="read-foot">
          <div className="read-meta">
            <span className="meta-k">{lang === "vi" ? "Thời gian" : "When"}</span>
            <span className="meta-v">
              {isApprox(m) && <span className="approx-mark" title={lang === "vi" ? "Thời gian ước chừng" : "Approximate date"}>~ </span>}
              {lang === "vi" ? m.date : (m.dateEn || m.date)}
            </span>
          </div>
          {m.mine && (
            <div className="read-meta">
              <span className="meta-k">{lang === "vi" ? "Trạng thái" : "Status"}</span>
              <span className="meta-v pending">{lang === "vi" ? "Đang chờ duyệt" : "Pending review"}</span>
            </div>
          )}
        </footer>

        {m.caseId && (
          <div className="case-expand-banner">
            <span className="case-expand-label">
              {lang === "vi" ? "Thuộc hồ sơ vụ việc" : "Part of a documented case"}
            </span>
            <button className="case-expand-btn" onClick={() => onOpenCase && onOpenCase(m.caseId)}>
              {lang === "vi" ? "Xem hồ sơ đầy đủ" : "View full case"} →
            </button>
          </div>
        )}
      </div>

      <nav className="read-nav">
        <button onClick={onPrev}>← {lang === "vi" ? "Lân cận" : "Wander"}</button>
        <span className="read-wander">{lang === "vi" ? "lạc giữa những ký ức" : "drift through memories"}</span>
        <button onClick={onNext}>{lang === "vi" ? "Lân cận" : "Wander"} →</button>
      </nav>
    </aside>
  );
}

function AboutPanel({ lang, onClose }) {
  const t = STR[lang];
  return (
    <div className="read-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="about-card">
        <button className="sheet-close" onClick={onClose} aria-label={t.close}>✕</button>
        <h2 className="about-h">{t.aboutTitle}</h2>
        <p className="about-p">{t.aboutBody}</p>

        <h3 className="about-sub">{t.howTitle}</h3>
        <ol className="about-steps">
          <li><span className="step-n">01</span>{t.how1}</li>
          <li><span className="step-n">02</span>{t.how2}</li>
          <li><span className="step-n">03</span>{t.how3}</li>
          <li><span className="step-n">04</span>{t.how4}</li>
        </ol>

        <h3 className="about-sub">{t.guidelinesTitle}</h3>
        <p className="about-p small">{t.guidelinesBody}</p>

        <div className="about-legend">
          {CATS.map((c) => (
            <span key={c.key} className="legend-item">
              <span className="cat-dot" style={{ background: c.color }} />{c[lang]}
            </span>
          ))}
        </div>
      </aside>
    </div>
  );
}

Object.assign(window, { MemoryDetail, AboutPanel, PhotoPlaceholder });
