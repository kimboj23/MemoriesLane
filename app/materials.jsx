/* ============================================================================
   materials.jsx — public Materials browser: search/filter over first-class
   archived source materials (gap: public discovery, independent of cases).
   ============================================================================ */

function MaterialsPanel({ lang, onClose, onOpenCase }) {
  const [q, setQ] = React.useState("");
  const [collection, setCollection] = React.useState("");
  const [mediaType, setMediaType] = React.useState("");
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

          {loading && <div className="feed-view feed-loading"><div className="feed-spinner" /><span>{lang === "vi" ? "Đang tải…" : "Loading…"}</span></div>}

          {!loading && materials.length === 0 && (
            <div className="feed-view feed-empty">
              <span className="feed-empty-glyph">◌</span>
              <p>{lang === "vi" ? "Không có tư liệu nào phù hợp." : "No materials match these filters."}</p>
            </div>
          )}

          {!loading && materials.length > 0 && (
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
        </div>
      </div>
    </div>
  );
}

window.MaterialsPanel = MaterialsPanel;
