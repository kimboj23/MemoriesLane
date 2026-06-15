/* ============================================================================
   archive-admin.jsx — authorised-user panel to submit source links for
   archiving and watch their status. Talks to the admin API:
     POST /api/archive            (queue a URL)
     GET  /api/archive/queue      (list jobs)
     POST /api/archive/:id/retry  (requeue failed/partial)
   Auth is the admin Bearer token, held in localStorage. The token never
   leaves the browser except as an Authorization header to the same origin.
   ============================================================================ */

const ARC_TOKEN_KEY = "ml_admin_token";
// Fallback ArchiveBox base for local dev; production uses the value from
// /api/config (ARCHIVEBOX_PUBLIC_URL on the host) so the link points at the
// public tunnel without rebuilding the frontend.
const ARCHIVEBOX_FALLBACK = "http://localhost:8000";
const ARC_MEDIA = [
  { key: "document", vi: "Tài liệu", en: "Document" },
  { key: "web", vi: "Trang web", en: "Web page" },
  { key: "social", vi: "Mạng xã hội", en: "Social" },
];
const ARC_STATUS = {
  pending:  { vi: "Đang chờ",   en: "Pending",  cls: "is-pending" },
  running:  { vi: "Đang chạy",  en: "Running",  cls: "is-running" },
  archived: { vi: "Đã lưu",     en: "Archived", cls: "is-ok" },
  partial:  { vi: "Một phần",   en: "Partial",  cls: "is-partial" },
  failed:   { vi: "Thất bại",   en: "Failed",   cls: "is-fail" },
};

function TopicChips({ topics, selected, onToggle, lang }) {
  return (
    <div className="adm-chips">
      {topics.map((t) => (
        <button key={t.slug} type="button"
          className={"adm-chip " + (selected.includes(t.slug) ? "on" : "")}
          onClick={() => onToggle(t.slug)}>
          {lang === "vi" ? t.name_vi : t.name_en}
        </button>
      ))}
    </div>
  );
}

function ArchiveAdmin({ lang, onClose }) {
  const L = (vi, en) => (lang === "vi" ? vi : en);

  const [token, setToken] = React.useState(() => localStorage.getItem(ARC_TOKEN_KEY) || "");
  const [authed, setAuthed] = React.useState(false);
  const [authErr, setAuthErr] = React.useState("");
  const [tab, setTab] = React.useState("submit");

  // submit form
  const [cases, setCases] = React.useState([]);
  const [caseId, setCaseId] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [media, setMedia] = React.useState("document");
  const [titleEn, setTitleEn] = React.useState("");
  const [titleVi, setTitleVi] = React.useState("");
  const [source, setSource] = React.useState("");
  const [account, setAccount] = React.useState("");
  const [date, setDate] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null); // {ok, text}

  // queue
  const [queue, setQueue] = React.useState([]);
  const [qLoading, setQLoading] = React.useState(false);

  // topics + case authoring + per-row editing
  const [allTopics, setAllTopics] = React.useState([]);
  const [archiveboxBase, setArchiveboxBase] = React.useState(null);
  const [cf, setCf] = React.useState({ titleVi: "", titleEn: "", summaryVi: "", summaryEn: "", city: "hanoi", status: "active", topics: [] });
  const [caseBusy, setCaseBusy] = React.useState(false);
  const [caseMsg, setCaseMsg] = React.useState(null);
  const [editId, setEditId] = React.useState(null);
  const [editCase, setEditCase] = React.useState("");
  const [editTopics, setEditTopics] = React.useState([]);

  const authFetch = (path, opts = {}) =>
    fetch(path, { ...opts, headers: { ...(opts.headers || {}), Authorization: "Bearer " + token } });

  const loadCases = React.useCallback(() => {
    authFetch("/api/cases")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.cases) {
          const list = d.cases.map((c) => ({ id: c.id, title: c.title_en || c.title_vi || c.id, city: c.city, status: c.status }));
          setCases(list);
          if (list.length && !caseId) setCaseId(list[0].id);
        }
      })
      .catch(() => {});
  }, [token, caseId]);

  const loadQueue = React.useCallback(() => {
    setQLoading(true);
    authFetch("/api/archive/queue")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setQueue(d.archives || []); })
      .catch(() => {})
      .finally(() => setQLoading(false));
  }, [token]);

  // Validate the token by hitting an authed endpoint.
  const unlock = () => {
    setAuthErr("");
    authFetch("/api/archive/queue").then((r) => {
      if (r.ok) {
        localStorage.setItem(ARC_TOKEN_KEY, token);
        setAuthed(true);
        loadCases();
        return r.json().then((d) => setQueue(d.archives || []));
      }
      setAuthErr(L("Mã không hợp lệ.", "Invalid token."));
    }).catch(() => setAuthErr(L("Không kết nối được máy chủ.", "Could not reach the server.")));
  };

  // Auto-unlock if a token is already stored.
  React.useEffect(() => { if (token && !authed) unlock(); /* eslint-disable-line */ }, []);

  // Poll the queue while viewing it so statuses update as the worker runs.
  React.useEffect(() => {
    if (!authed || tab !== "queue") return;
    loadQueue();
    const t = setInterval(loadQueue, 8000);
    return () => clearInterval(t);
  }, [authed, tab, loadQueue]);

  const lock = () => {
    localStorage.removeItem(ARC_TOKEN_KEY);
    setToken(""); setAuthed(false); setQueue([]); setCases([]);
  };

  const validUrl = (() => { try { const u = new URL(url); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; } })();
  const canSubmit = authed && caseId.trim() && validUrl && !busy;

  const submit = () => {
    if (!canSubmit) return;
    setBusy(true); setMsg(null);
    authFetch("/api/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: caseId.trim(), originalUrl: url.trim(), mediaType: media, titleEn, titleVi, source, account, date, notes }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (ok) {
          setMsg({ ok: true, text: L("Đã đưa vào hàng chờ lưu trữ.", "Queued for archiving.") });
          setUrl(""); setTitleEn(""); setTitleVi(""); setSource(""); setAccount(""); setDate(""); setNotes("");
        } else {
          setMsg({ ok: false, text: (d && (d.error + (d.details ? ": " + d.details.join(", ") : ""))) || L("Gửi thất bại.", "Submit failed.") });
        }
      })
      .catch(() => setMsg({ ok: false, text: L("Lỗi mạng.", "Network error.") }))
      .finally(() => setBusy(false));
  };

  const retry = (id) => authFetch(`/api/archive/${id}/retry`, { method: "POST" }).then(loadQueue).catch(() => {});

  // Load the topic taxonomy once authed (public endpoint).
  React.useEffect(() => {
    if (!authed) return;
    fetch("/api/topics").then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && d.topics) setAllTopics(d.topics); }).catch(() => {});
    fetch("/api/config").then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && d.archiveboxUrl) setArchiveboxBase(d.archiveboxUrl); }).catch(() => {});
  }, [authed]);

  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const createCase = () => {
    if (!cf.titleVi.trim() || !cf.summaryVi.trim()) {
      setCaseMsg({ ok: false, text: L("Cần tiêu đề (VI) và tóm tắt (VI).", "Title (VI) and summary (VI) are required.") });
      return;
    }
    setCaseBusy(true); setCaseMsg(null);
    authFetch("/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cf) })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (ok) {
          setCaseMsg({ ok: true, text: L("Đã tạo hồ sơ vụ việc.", "Case created.") });
          setCf({ titleVi: "", titleEn: "", summaryVi: "", summaryEn: "", city: cf.city, status: "active", topics: [] });
          loadCases();
        } else {
          setCaseMsg({ ok: false, text: (d && (d.error + (d.details ? ": " + d.details.join(", ") : ""))) || L("Tạo thất bại.", "Create failed.") });
        }
      })
      .catch(() => setCaseMsg({ ok: false, text: L("Lỗi mạng.", "Network error.") }))
      .finally(() => setCaseBusy(false));
  };

  const startEdit = (a) => { setEditId(a.id); setEditCase(a.case_id || ""); setEditTopics((a.topics || []).map((t) => t.slug)); };
  const saveEdit = (id) => {
    authFetch(`/api/archive/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId: editCase, topics: editTopics }) })
      .then(() => { setEditId(null); loadQueue(); }).catch(() => {});
  };

  // -- render ---------------------------------------------------------------
  return (
    <aside className="sheet-dock adm-dock" role="dialog" aria-modal="false">
      <button className="sheet-close" onClick={onClose} aria-label={L("Đóng", "Close")}>✕</button>
      <div className="sheet-body">
        <div className="sheet-eyebrow">
          <span className="dot" style={{ background: "var(--gold)" }} />
          {L("Lưu trữ tư liệu", "Archive sources")}
        </div>

        {!authed ? (
          <div className="adm-auth">
            <div className="field-label">{L("Mã quản trị", "Admin token")}</div>
            <input className="adm-input" type="password" value={token} autoFocus
              placeholder={L("Dán mã Bearer…", "Paste Bearer token…")}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") unlock(); }} />
            <button className="send-btn" onClick={unlock} disabled={!token.trim()}>{L("Mở khóa", "Unlock")}</button>
            {authErr && <div className="adm-msg is-fail">{authErr}</div>}
            <div className="adm-hint">{L("Chỉ dành cho biên tập viên được ủy quyền.", "For authorised editors only.")}</div>
          </div>
        ) : (
          <React.Fragment>
            <div className="adm-tabs">
              <button className={"adm-tab " + (tab === "submit" ? "on" : "")} onClick={() => setTab("submit")}>{L("Gửi", "Submit")}</button>
              <button className={"adm-tab " + (tab === "queue" ? "on" : "")} onClick={() => setTab("queue")}>{L("Hàng chờ", "Queue")}</button>
              <button className={"adm-tab " + (tab === "cases" ? "on" : "")} onClick={() => setTab("cases")}>{L("Hồ sơ", "Cases")}</button>
              <button className="adm-lock" onClick={lock} title={L("Khóa", "Lock")}>⏏</button>
            </div>

            {tab === "submit" && (
              <div className="adm-form">
                <div className="field-label">{L("Hồ sơ vụ việc", "Case")}</div>
                {cases.length > 0 ? (
                  <select className="date-sel adm-wide" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
                    {cases.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                ) : (
                  <input className="adm-input" value={caseId} placeholder="case-id" onChange={(e) => setCaseId(e.target.value)} />
                )}

                <div className="field-label">{L("Liên kết gốc", "Source URL")} <em className="adm-req">∗</em></div>
                <input className="adm-input" type="url" value={url} placeholder="https://…"
                  onChange={(e) => setUrl(e.target.value)} />
                {url && !validUrl && <div className="adm-hint is-fail">{L("URL không hợp lệ", "Not a valid URL")}</div>}

                <div className="field-label">{L("Loại tư liệu", "Material type")}</div>
                <div className="adm-chips">
                  {ARC_MEDIA.map((m) => (
                    <button key={m.key} className={"adm-chip " + (media === m.key ? "on" : "")} onClick={() => setMedia(m.key)}>
                      {m[lang]}
                    </button>
                  ))}
                </div>
                <div className="adm-hint">
                  {media === "social"
                    ? L("→ auto-archiver + Internet Archive", "→ auto-archiver + Internet Archive")
                    : L("→ ArchiveBox + Internet Archive", "→ ArchiveBox + Internet Archive")}
                </div>

                <div className="field-label">{L("Tiêu đề", "Title")}</div>
                <input className="adm-input" value={titleEn} placeholder={L("Tiêu đề (EN)", "Title (EN)")} onChange={(e) => setTitleEn(e.target.value)} />
                <input className="adm-input adm-mt" value={titleVi} placeholder={L("Tiêu đề (VI)", "Title (VI)")} onChange={(e) => setTitleVi(e.target.value)} />

                <div className="adm-two">
                  <div>
                    <div className="field-label">{L("Nguồn", "Source")}</div>
                    <input className="adm-input" value={source} placeholder={L("VD: UBND Hà Nội", "e.g. Hanoi gov")} onChange={(e) => setSource(e.target.value)} />
                  </div>
                  <div>
                    <div className="field-label">{L("Tài khoản", "Account")}</div>
                    <input className="adm-input" value={account} placeholder="@handle" onChange={(e) => setAccount(e.target.value)} />
                  </div>
                </div>

                <div className="field-label">{L("Ngày tư liệu", "Material date")}</div>
                <input className="adm-input" value={date} placeholder="2026-03-14" onChange={(e) => setDate(e.target.value)} />

                <div className="field-label">{L("Ghi chú", "Notes")}</div>
                <textarea className="memory-input adm-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />

                <button className={"send-btn " + (canSubmit ? "" : "disabled")} onClick={submit} disabled={!canSubmit}>
                  {busy ? L("Đang gửi…", "Submitting…") : L("Đưa vào lưu trữ", "Queue for archiving")}
                </button>
                {msg && <div className={"adm-msg " + (msg.ok ? "is-ok" : "is-fail")}>{msg.text}</div>}
              </div>
            )}

            {tab === "queue" && (
              <div className="adm-queue">
                <div className="adm-queue-head">
                  <span>{queue.length} {L("mục", "jobs")}</span>
                  <span className="adm-queue-actions">
                    <a className="adm-extlink" href={(archiveboxBase || ARCHIVEBOX_FALLBACK).replace(/\/$/, "") + "/admin/core/snapshot/"} target="_blank" rel="noopener noreferrer">ArchiveBox ↗</a>
                    <button className="adm-refresh" onClick={loadQueue}>{qLoading ? "…" : "↻"}</button>
                  </span>
                </div>
                {queue.length === 0 && !qLoading && <div className="adm-hint">{L("Chưa có mục nào.", "Nothing queued yet.")}</div>}
                {queue.map((a) => {
                  const st = ARC_STATUS[a.status] || { en: a.status, vi: a.status, cls: "" };
                  const editing = editId === a.id;
                  return (
                    <div key={a.id} className="adm-row">
                      <div className="adm-row-top">
                        <span className={"adm-badge " + st.cls}>{st[lang]}</span>
                        <span className="adm-row-media">{a.media_type}</span>
                        <span className="adm-row-actions">
                          {(a.status === "failed" || a.status === "partial") &&
                            <button className="adm-retry" onClick={() => retry(a.id)}>{L("Thử lại", "Retry")}</button>}
                          <button className="adm-retry" onClick={() => (editing ? setEditId(null) : startEdit(a))}>
                            {editing ? L("Đóng", "Close") : L("Sửa", "Edit")}
                          </button>
                        </span>
                      </div>
                      <div className="adm-row-title">{a.title_en || a.title_vi || a.original_url}</div>
                      {Array.isArray(a.topics) && a.topics.length > 0 && (
                        <div className="adm-row-tags">
                          {a.topics.map((t) => <span key={t.slug} className="adm-tag">{t.name_en}</span>)}
                        </div>
                      )}
                      <div className="adm-row-links">
                        {a.original_url && <a className="adm-link" href={a.original_url} target="_blank" rel="noopener noreferrer">{L("Gốc", "Original")} ↗</a>}
                        {a.wayback_url && <a className="adm-link is-saved" href={a.wayback_url} target="_blank" rel="noopener noreferrer">Wayback ↗</a>}
                        {a.local_url && <a className="adm-link is-local" href={a.local_url} target="_blank" rel="noopener noreferrer">{L("Bản lưu", "Local")} ↗</a>}
                      </div>
                      {a.error && <div className="adm-row-err">{a.error}</div>}
                      {editing && (
                        <div className="adm-edit">
                          <div className="field-label">{L("Gán hồ sơ", "Assign to case")}</div>
                          <select className="date-sel adm-wide" value={editCase} onChange={(e) => setEditCase(e.target.value)}>
                            <option value="">{L("— chưa gán —", "— unassigned —")}</option>
                            {cases.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                          </select>
                          <div className="field-label">{L("Nhãn (chủ đề)", "Tags (topics)")}</div>
                          <TopicChips topics={allTopics} selected={editTopics} onToggle={(s) => setEditTopics((p) => toggle(p, s))} lang={lang} />
                          <button className="send-btn" onClick={() => saveEdit(a.id)}>{L("Lưu thay đổi", "Save changes")}</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {tab === "cases" && (
              <div className="adm-form">
                <div className="field-label">{L("Tiêu đề", "Title")}</div>
                <input className="adm-input" value={cf.titleEn} placeholder={L("Tiêu đề (EN)", "Title (EN)")} onChange={(e) => setCf({ ...cf, titleEn: e.target.value })} />
                <input className="adm-input adm-mt" value={cf.titleVi} placeholder={L("Tiêu đề (VI) ∗", "Title (VI) ∗")} onChange={(e) => setCf({ ...cf, titleVi: e.target.value })} />

                <div className="field-label">{L("Tóm tắt", "Summary")}</div>
                <textarea className="memory-input adm-notes" rows={2} placeholder={L("Tóm tắt (VI) ∗", "Summary (VI) ∗")} value={cf.summaryVi} onChange={(e) => setCf({ ...cf, summaryVi: e.target.value })} />
                <textarea className="memory-input adm-notes adm-mt" rows={2} placeholder={L("Tóm tắt (EN)", "Summary (EN)")} value={cf.summaryEn} onChange={(e) => setCf({ ...cf, summaryEn: e.target.value })} />

                <div className="adm-two">
                  <div>
                    <div className="field-label">{L("Thành phố", "City")}</div>
                    <select className="date-sel adm-wide" value={cf.city} onChange={(e) => setCf({ ...cf, city: e.target.value })}>
                      {(typeof CITIES !== "undefined" ? CITIES : [{ key: "hanoi", en: "Hanoi", vi: "Hà Nội" }]).map((c) => (
                        <option key={c.key} value={c.key}>{lang === "vi" ? (c.vi || c.en) : c.en}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="field-label">{L("Trạng thái", "Status")}</div>
                    <select className="date-sel adm-wide" value={cf.status} onChange={(e) => setCf({ ...cf, status: e.target.value })}>
                      <option value="active">{L("Đang diễn ra", "Active")}</option>
                      <option value="resolved">{L("Đã giải quyết", "Resolved")}</option>
                      <option value="historical">{L("Lịch sử", "Historical")}</option>
                    </select>
                  </div>
                </div>

                <div className="field-label">{L("Nhãn (chủ đề)", "Tags (topics)")}</div>
                <TopicChips topics={allTopics} selected={cf.topics} onToggle={(s) => setCf({ ...cf, topics: toggle(cf.topics, s) })} lang={lang} />

                <button className={"send-btn " + (caseBusy ? "disabled" : "")} onClick={createCase} disabled={caseBusy}>
                  {caseBusy ? L("Đang tạo…", "Creating…") : L("Tạo hồ sơ vụ việc", "Create case")}
                </button>
                {caseMsg && <div className={"adm-msg " + (caseMsg.ok ? "is-ok" : "is-fail")}>{caseMsg.text}</div>}

                <div className="adm-queue-head adm-caselist-head"><span>{cases.length} {L("hồ sơ", "cases")}</span></div>
                {cases.map((c) => (
                  <div key={c.id} className="adm-caserow">
                    <div className="adm-caserow-title">{c.title}</div>
                    <div className="adm-caserow-meta">{c.city} · {c.status}</div>
                  </div>
                ))}
              </div>
            )}
          </React.Fragment>
        )}
      </div>
    </aside>
  );
}

window.ArchiveAdmin = ArchiveAdmin;
