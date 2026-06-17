/* ============================================================================
   case-profile.jsx — full-screen case detail panel (Airbnb-style deep dive).
   Opens on top of the map when a memory belongs to a documented case.
   ============================================================================ */

const MONTHS_SHORT_VI = ["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10","T11","T12"];
const MONTHS_SHORT_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtEventDate(year, month, lang) {
  if (!month) return String(year);
  return lang === "vi"
    ? `${MONTHS_SHORT_VI[month - 1]}, ${year}`
    : `${MONTHS_SHORT_EN[month - 1]} ${year}`;
}

function CaseStatusBadge({ status, lang }) {
  const labels = {
    active:     { vi: "Đang diễn ra", en: "Ongoing" },
    resolved:   { vi: "Đã kết thúc",  en: "Resolved" },
    historical: { vi: "Lịch sử",      en: "Historical" },
  };
  const label = (labels[status] || labels.active)[lang];
  return <span className={`case-badge case-badge--${status || "active"}`}>{label}</span>;
}

function CaseSectionText({ section, lang }) {
  return (
    <div className="case-section">
      <h2 className="case-section-title">{lang === "vi" ? section.titleVi : (section.titleEn || section.titleVi)}</h2>
      <p className="case-section-body">{lang === "vi" ? section.bodyVi : (section.bodyEn || section.bodyVi)}</p>
    </div>
  );
}

function CaseSectionTimeline({ section, lang }) {
  const events = section.events || [];
  return (
    <div className="case-section">
      <h2 className="case-section-title">{lang === "vi" ? section.titleVi : (section.titleEn || section.titleVi)}</h2>
      <div className="case-timeline">
        {events.map((ev, i) => (
          <div key={i} className="case-tl-event">
            <div className="case-tl-dot" />
            <div className="case-tl-when">{fmtEventDate(ev.year, ev.month, lang)}</div>
            <div className="case-tl-label">{lang === "vi" ? ev.labelVi : (ev.labelEn || ev.labelVi)}</div>
            {(ev.detailVi || ev.detailEn) && (
              <p className="case-tl-detail">{lang === "vi" ? ev.detailVi : (ev.detailEn || ev.detailVi)}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const ARC_TOOL_LABELS = {
  "auto-archiver": "Auto-Archiver",
  "archive-box": "Archive Box",
};
const ARC_MEDIA_GLYPHS = {
  web: "⌘", social: "◎", video: "▷", document: "≡", image: "◫",
};

function ArchiveCard({ item, lang }) {
  const tool = ARC_TOOL_LABELS[item.tool] || item.tool || "Archive";
  const glyph = ARC_MEDIA_GLYPHS[item.mediaType] || "◦";
  const title = lang === "vi" ? item.titleVi : (item.titleEn || item.titleVi);
  const hasLinks = item.originalUrl || item.archivedUrl;
  return (
    <div className={`arc-card arc-card--${item.tool || "other"}`}>
      <div className="arc-card-head">
        <span className={`arc-tool-badge arc-tool--${item.tool || "other"}`}>{tool}</span>
        <span className="arc-media-type"><span className="arc-glyph">{glyph}</span>{item.mediaType}</span>
        {item.date && <span className="arc-date">{item.date}</span>}
        {item.sha256 && (
          <span className="arc-verified" title={`SHA-256: ${item.sha256}`}>
            ✓ {lang === "vi" ? "Đã xác thực" : "Verified"}
          </span>
        )}
      </div>
      <p className="arc-title">{title}</p>
      {item.source && (
        <div className="arc-source">
          {item.source}{item.account ? <span className="arc-account"> · {item.account}</span> : null}
        </div>
      )}
      {item.notes && <div className="arc-notes">{item.notes}</div>}
      {hasLinks && (
        <div className="arc-links">
          {item.originalUrl && (
            <a href={item.originalUrl} target="_blank" rel="noopener noreferrer" className="arc-link">
              {lang === "vi" ? "Tài liệu gốc ↗" : "Original ↗"}
            </a>
          )}
          {item.archivedUrl && (
            <a href={item.archivedUrl} target="_blank" rel="noopener noreferrer" className="arc-link arc-link--saved">
              {lang === "vi" ? "Bản lưu ↗" : "Archived ↗"}
            </a>
          )}
          {item.waczUrl && (
            <a href={item.waczUrl} target="_blank" rel="noopener noreferrer" className="arc-link">
              WACZ ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function CaseVoiceCard({ memory, lang, onSelect }) {
  const c0 = catOf(memory.cat);
  const text = lang === "vi" ? memory.vi : (memory.en || memory.vi);
  const date = lang === "vi" ? memory.date : (memory.dateEn || memory.date);
  return (
    <button className="case-voice-card" onClick={() => onSelect(memory)}>
      <div className="case-voice-meta">
        <span className="case-voice-cat" style={{ color: c0.color }}>
          <span className="cat-dot" style={{ background: c0.color }} />
          {c0[lang]}
        </span>
        <span className="case-voice-date">{date}</span>
      </div>
      <p className="case-voice-text">{text}</p>
      <div className="case-voice-cta">{lang === "vi" ? "Đọc ký ức →" : "Read memory →"}</div>
    </button>
  );
}

function CaseProfile({ caseData, memories, lang, onClose, onSelectMemory }) {
  // Close on Escape
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sections = Array.isArray(caseData.sections) ? caseData.sections : [];
  const title = lang === "vi" ? caseData.title_vi : (caseData.title_en || caseData.title_vi);
  const summary = lang === "vi" ? caseData.summary_vi : (caseData.summary_en || caseData.summary_vi);

  const handleSelectVoice = (memory) => {
    onClose();
    onSelectMemory && onSelectMemory(memory);
  };

  return (
    <div className="case-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="case-panel" role="dialog" aria-label={title}>
        <div className="case-topbar">
          <button className="case-back-btn" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 2L4 7l5 5" />
            </svg>
            {lang === "vi" ? "Quay lại" : "Back"}
          </button>
          <CaseStatusBadge status={caseData.status} lang={lang} />
        </div>

        <div className="case-hero">
          <div className="case-kicker">{lang === "vi" ? "Hồ sơ vụ việc" : "Case profile"}</div>
          <h1 className="case-title">{title}</h1>
          <p className="case-summary">{summary}</p>
          {caseData.topics && caseData.topics.length > 0 && (
            <div className="case-topics">
              {caseData.topics.map((t) => (
                <span key={t.slug} className="topic-tag topic-tag--case">
                  {lang === "vi" ? t.name_vi : t.name_en}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="case-sections">
          {sections.map((s, i) =>
            s.type === "timeline"
              ? <CaseSectionTimeline key={i} section={s} lang={lang} />
              : <CaseSectionText key={i} section={s} lang={lang} />
          )}
        </div>

        {memories.length > 0 && (
          <div className="case-voices-section">
            <h2 className="case-voices-title">
              {lang === "vi" ? "Tiếng nói cộng đồng" : "Community voices"}
            </h2>
            <div className="case-voice-cards">
              {memories.map((m) => (
                <CaseVoiceCard key={m.id} memory={m} lang={lang} onSelect={handleSelectVoice} />
              ))}
            </div>
          </div>
        )}

        {Array.isArray(caseData.archives) && caseData.archives.length > 0 && (
          <div className="case-voices-section case-archives-section">
            <h2 className="case-voices-title">
              {lang === "vi" ? "Tài liệu lưu trữ" : "Archived Materials"}
            </h2>
            <p className="case-archives-sub">
              {lang === "vi"
                ? "Tài liệu được thu thập và lưu trữ bởi nhóm biên tập thông qua Archive Box và Auto-Archiver."
                : "Materials collected and preserved by the editorial team using Archive Box and Auto-Archiver."}
            </p>
            <div className="arc-grid">
              {caseData.archives.map((item, i) => (
                <ArchiveCard key={i} item={item} lang={lang} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

window.CaseProfile = CaseProfile;
window.ArchiveCard = ArchiveCard;
