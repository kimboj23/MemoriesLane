/* ============================================================================
   materials.jsx — public Materials browser: search/filter over first-class
   archived source materials (gap: public discovery, independent of cases).
   ============================================================================ */

function materialYear(m) {
  const y = m.date && /^\d{4}/.test(m.date) ? m.date.slice(0, 4) : null;
  return y;
}

function MaterialsTimeline({ materials, lang, onOpenCase }) {
  const groups = [];
  const byYear = new Map();
  materials.forEach((m) => {
    const y = materialYear(m) || (lang === "vi" ? "Không rõ ngày" : "Undated");
    if (!byYear.has(y)) { byYear.set(y, []); groups.push(y); }
    byYear.get(y).push(m);
  });

  return (
    <div className="case-timeline ml-timeline">
      {groups.map((y) => (
        <React.Fragment key={y}>
          <div className="case-tl-event ml-timeline-year">
            <div className="case-tl-dot" />
            <div className="case-tl-when">{y}</div>
          </div>
          {byYear.get(y).map((m) => {
            const title = lang === "vi" ? m.titleVi : (m.titleEn || m.titleVi);
            return (
              <div key={m.id} className="case-tl-event">
                <div className="case-tl-dot" />
                <div className="case-tl-when">{m.date || y}</div>
                <div className="case-tl-label">{title}</div>
                {(m.source || m.notes) && (
                  <p className="case-tl-detail">
                    {m.source}{m.source && m.notes ? " — " : ""}{m.notes}
                  </p>
                )}
                {m.caseId && (
                  <button className="arc-link" style={{ marginTop: 6 }} onClick={() => onOpenCase && onOpenCase(m.caseId)}>
                    {lang === "vi" ? "Xem vụ việc liên quan →" : "View related case →"}
                  </button>
                )}
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

function MaterialsPanel({ lang, onClose, onOpenCase }) {
  const [q, setQ] = React.useState("");
  const [collection, setCollection] = React.useState("");
  const [mediaType, setMediaType] = React.useState("");
  const [view, setView] = React.useState("grid"); // "grid" | "timeline"
  const [collections, setCollections] = React.useState([]);
  const [materials, setMaterials] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  React.useEffect(() => {
    fetch("/api/materials/collections")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d && d.collections) setCollections(d.collections); })
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (collection) p.set("collection", collection);
    if (mediaType) p.set("mediaType", mediaType);
    const handle = setTimeout(() => {
      fetch("/api/materials?" + p.toString())
        .then((r) => r.ok ? r.json() : null)
        .then((d) => setMaterials(d && d.materials ? d.materials : []))
        .catch(() => setMaterials([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [q, collection, mediaType]);

  const MEDIA_LABELS = {
    web:      { vi: "Trang web",      en: "Web" },
    document: { vi: "Tài liệu",       en: "Document" },
    social:   { vi: "Mạng xã hội",    en: "Social" },
  };

  return (
    <div className="case-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="case-panel" role="dialog" aria-label={lang === "vi" ? "Tư liệu" : "Materials"}>
        <div className="case-topbar">
          <button className="case-back-btn" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 2L4 7l5 5" />
            </svg>
            {lang === "vi" ? "Quay lại" : "Back"}
          </button>
        </div>

        <div className="case-hero">
          <div className="case-kicker">{lang === "vi" ? "Kho tư liệu" : "Source materials"}</div>
          <h1 className="case-title">{lang === "vi" ? "Tư liệu lưu trữ" : "Archived Materials"}</h1>
          <p className="case-summary">
            {lang === "vi"
              ? "Tài liệu, bài đăng và trang web đã được lưu trữ và xác minh, độc lập với từng vụ việc."
              : "Web pages, documents, and social posts that have been archived and editorially verified, browsable on their own."}
          </p>
        </div>

        <div className="case-section">
          <div className="adm-search">
            <input className="adm-input" type="search"
              placeholder={lang === "vi" ? "Tìm theo tiêu đề, nguồn, ghi chú…" : "Search title, source, notes…"}
              value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          <div className="feed-tags" style={{ marginBottom: 16 }}>
            <button className={"topic-tag" + (mediaType === "" ? " topic-tag--case" : "")}
              onClick={() => setMediaType("")}>{lang === "vi" ? "Mọi loại" : "All types"}</button>
            {Object.keys(MEDIA_LABELS).map((k) => (
              <button key={k} className={"topic-tag" + (mediaType === k ? " topic-tag--case" : "")}
                onClick={() => setMediaType(mediaType === k ? "" : k)}>{MEDIA_LABELS[k][lang]}</button>
            ))}
          </div>

          {collections.length > 0 && (
            <div className="feed-tags" style={{ marginBottom: 16 }}>
              <button className={"topic-tag" + (collection === "" ? " topic-tag--case" : "")}
                onClick={() => setCollection("")}>{lang === "vi" ? "Mọi bộ sưu tập" : "All collections"}</button>
              {collections.map((c) => (
                <button key={c.collection} className={"topic-tag" + (collection === c.collection ? " topic-tag--case" : "")}
                  onClick={() => setCollection(collection === c.collection ? "" : c.collection)}>
                  {c.collection} ({c.count})
                </button>
              ))}
            </div>
          )}

          <div className="feed-tags" style={{ marginBottom: 16 }}>
            <button className={"topic-tag" + (view === "grid" ? " topic-tag--case" : "")}
              onClick={() => setView("grid")}>{lang === "vi" ? "Lưới" : "Grid"}</button>
            <button className={"topic-tag" + (view === "timeline" ? " topic-tag--case" : "")}
              onClick={() => setView("timeline")}>{lang === "vi" ? "Dòng thời gian" : "Timeline"}</button>
          </div>

          {loading && <div className="feed-view feed-loading"><div className="feed-spinner" /><span>{lang === "vi" ? "Đang tải…" : "Loading…"}</span></div>}

          {!loading && materials.length === 0 && (
            <div className="feed-view feed-empty">
              <span className="feed-empty-glyph">◌</span>
              <p>{lang === "vi" ? "Không có tư liệu nào phù hợp." : "No materials match these filters."}</p>
            </div>
          )}

          {!loading && materials.length > 0 && view === "grid" && (
            <div className="arc-grid">
              {materials.map((m) => (
                <div key={m.id}>
                  <ArchiveCard item={m} lang={lang} />
                  {m.caseId && (
                    <button className="arc-link" style={{ marginTop: 6, display: "inline-block" }}
                      onClick={() => onOpenCase && onOpenCase(m.caseId)}>
                      {lang === "vi" ? "Xem vụ việc liên quan →" : "View related case →"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!loading && materials.length > 0 && view === "timeline" && (
            <MaterialsTimeline materials={materials} lang={lang} onOpenCase={onOpenCase} />
          )}
        </div>
      </div>
    </div>
  );
}

window.MaterialsPanel = MaterialsPanel;
