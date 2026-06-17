/* ============================================================================
   feed.jsx — Unified List View: documented cases (containers) followed by
   individual memory cards, both topic/category filtered via the feed API.
   ============================================================================ */

function CaseFeedCard({ item, lang, onOpen }) {
  const title   = lang === "vi" ? item.title_vi   : (item.title_en   || item.title_vi);
  const summary = lang === "vi" ? item.summary_vi : (item.summary_en || item.summary_vi);
  const BADGE = {
    active:     { vi: "Đang diễn ra", en: "Ongoing"    },
    resolved:   { vi: "Đã kết thúc",  en: "Resolved"   },
    historical: { vi: "Lịch sử",      en: "Historical" },
  };
  const badgeLabel = (BADGE[item.status] || BADGE.active)[lang];
  const topics = Array.isArray(item.topics) ? item.topics : [];

  return (
    <button className="feed-case-card" onClick={onOpen}>
      <div className="feed-case-top">
        <span className="feed-case-kicker">
          <svg className="feed-case-icon" width="11" height="11" viewBox="0 0 11 11" fill="none"
            stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="3" width="9" height="7" rx="1" />
            <path d="M3.5 3V2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
          </svg>
          {lang === "vi" ? "Hồ sơ vụ việc" : "Case"}
        </span>
        <span className={`feed-case-badge feed-badge--${item.status || "active"}`}>{badgeLabel}</span>
      </div>
      <div className="feed-case-title">{title}</div>
      <p className="feed-case-summary">{summary}</p>
      {topics.length > 0 && (
        <div className="feed-tags">
          {topics.map((t) => (
            <span key={t.slug} className="topic-tag topic-tag--case">
              {lang === "vi" ? t.name_vi : t.name_en}
            </span>
          ))}
        </div>
      )}
      <div className="feed-case-footer">
        <span className="feed-case-count">
          {item.memory_count || 0} {lang === "vi" ? "tiếng nói liên quan" : "linked memories"}
        </span>
        <span className="feed-case-cta">{lang === "vi" ? "Xem hồ sơ →" : "View case →"}</span>
      </div>
    </button>
  );
}

function MemoryFeedCard({ item, lang, onOpen }) {
  const c0     = catOf(item.cat);
  const text   = lang === "vi" ? item.vi : (item.en || item.vi);
  const date   = lang === "vi" ? item.date : (item.dateEn || item.date || String(item.year));
  const topics = Array.isArray(item.topics) ? item.topics : [];

  return (
    <button className="feed-memory-card" onClick={onOpen}>
      <div className="feed-memory-meta">
        <span className="feed-memory-cat" style={{ color: c0.color }}>
          <span className="cat-dot" style={{ background: c0.color }} />
          {c0[lang]}
        </span>
        {item.ward && <span className="feed-memory-ward">{item.ward}</span>}
        <span className="feed-memory-date">{date}</span>
      </div>
      <p className="feed-memory-text">{text}</p>
      {topics.length > 0 && (
        <div className="feed-tags">
          {topics.map((t) => (
            <span key={t.slug} className="topic-tag">
              {lang === "vi" ? t.name_vi : t.name_en}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function FeedView({ items, lang, loading, onOpenMemory, onOpenCase }) {
  if (loading) {
    return (
      <div className="feed-view feed-loading">
        <div className="feed-spinner" />
        <span>{lang === "vi" ? "Đang tải…" : "Loading…"}</span>
      </div>
    );
  }

  const cases    = items.filter((i) => i.type === "case");
  const memories = items.filter((i) => i.type === "memory");

  if (items.length === 0) {
    return (
      <div className="feed-view feed-empty">
        <span className="feed-empty-glyph">◌</span>
        <p>{lang === "vi" ? "Không có kết quả nào phù hợp." : "No results match the current filters."}</p>
      </div>
    );
  }

  return (
    <div className="feed-view">
      {cases.length > 0 && (
        <div className="feed-section">
          <div className="feed-section-head">
            <span className="feed-section-label">{lang === "vi" ? "Hồ sơ vụ việc" : "Documented Cases"}</span>
            <span className="feed-section-count">{cases.length}</span>
          </div>
          {cases.map((item) => (
            <CaseFeedCard key={item.id} item={item} lang={lang} onOpen={() => onOpenCase(item.id)} />
          ))}
        </div>
      )}
      {memories.length > 0 && (
        <div className="feed-section">
          <div className="feed-section-head">
            <span className="feed-section-label">{lang === "vi" ? "Tiếng nói" : "Memories"}</span>
            <span className="feed-section-count">{memories.length}</span>
          </div>
          {memories.map((item) => (
            <MemoryFeedCard key={item.id} item={item} lang={lang} onOpen={() => onOpenMemory(item)} />
          ))}
        </div>
      )}
    </div>
  );
}

window.FeedView = FeedView;
