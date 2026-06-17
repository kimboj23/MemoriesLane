/* ============================================================================
   compose.jsx — the submission flow (location-first, Queering-the-Map style).
   ① choose a place on the map → ② write your story → ③ send.
   Docks beside the map (map stays visible & clickable). Photo is compressed
   client-side. Ward is auto-derived from the chosen point — no manual field.
   ============================================================================ */

const YEARS = (() => { const a = []; for (let y = 2026; y >= MIN_YEAR; y--) a.push(y); return a; })();
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

function buildDate(lang, sel) {
  const { year, month, day, hour, minute } = sel;
  const specificMonth = /^\d+$/.test(month);
  const specificDay = specificMonth && /^\d+$/.test(day);
  const S = STR[lang];
  let label, labelEn, tag;
  if (!specificMonth) {
    if (month === "circa") { label = `Khoảng ${year}`; labelEn = `circa ${year}`; tag = S.circaTag; }
    else { label = `${year}`; labelEn = `${year}`; tag = S.yearOnlyTag; }
  } else if (!specificDay) {
    label = `${MONTHS.vi[+month - 1]}, ${year}`; labelEn = `${MONTHS.en[+month - 1]} ${year}`; tag = S.monthYearTag;
  } else {
    label = `${day} ${MONTHS.vi[+month - 1]}, ${year}`; labelEn = `${day} ${MONTHS.en[+month - 1]} ${year}`; tag = S.fullDateTag;
    if (hour !== "") { const tm = `${hour}:${minute || "00"}`; label += ` · ${tm}`; labelEn += ` · ${tm}`; }
  }
  return { label, labelEn, tag };
}

function ComposeSheet({ point, lang, accent, gold, city, onSubmit, onClose, nearby, onOpenMemory }) {
  const t = STR[lang];
  const [step, setStep] = React.useState("write"); // write | received
  const [text, setText] = React.useState("");
  const [cat, setCat] = React.useState("personal");
  const [year, setYear] = React.useState("");
  const [month, setMonth] = React.useState("");
  const [day, setDay] = React.useState("");
  const [hour, setHour] = React.useState("");
  const [minute, setMinute] = React.useState("");
  const [photo, setPhoto] = React.useState(null);
  const [optimizing, setOptimizing] = React.useState(false);
  const [attribution, setAttribution] = React.useState("anonymous");
  const [authorName, setAuthorName] = React.useState("");
  const [mediaUrl, setMediaUrl] = React.useState("");
  const fileRef = React.useRef(null);

  const specificMonth = /^\d+$/.test(month);
  const specificDay = specificMonth && /^\d+$/.test(day);
  const built = year ? buildDate(lang, { year, month, day, hour, minute }) : null;
  const derivedWard = point
    ? (city && city.key === "hanoi" ? nearestWard(point.lat, point.lng) : (city ? city[lang] : nearestWard(point.lat, point.lng)))
    : null;
  const hasText = text.trim().length > 1;
  const attributionValid = attribution === "anonymous" || authorName.trim().length > 0;
  const canSend = !!point && hasText && !!year && attributionValid;

  const pickPhoto = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setOptimizing(true);
    try { setPhoto(await compressImage(file, 1280, 0.7)); } catch (_) { alert(t.photoError || (lang === "vi" ? "Không thể đọc ảnh. Hãy thử tệp khác." : "Could not read image. Try a different file.")); }
    setOptimizing(false);
  };

  const send = () => {
    if (!canSend) return;
    const mem = {
      id: uid(), lat: point.lat, lng: point.lng, cat,
      city: city ? city.key : "hanoi",
      ward: derivedWard || "—",
      year: parseInt(year, 10) || 2026,
      month: specificMonth ? +month : null,
      day: specificDay ? +day : null,
      date: built ? built.label : (lang === "vi" ? "Không rõ" : "Undated"),
      dateEn: built ? built.labelEn : "Undated",
      vi: text.trim(), en: text.trim(),
      lang,
      photo: !!photo, photoData: photo ? photo.dataUrl : null,
      media: photo ? "photo" : "text",
      attribution,
      authorName: attribution === "anonymous" ? null : authorName.trim(),
      mediaUrl: mediaUrl.trim() || null,
      submittedAt: Date.now(),
      mine: true,
    };
    onSubmit(mem);
    setStep("received");
  };

  return (
    <aside className={"sheet-dock " + (step === "received" ? "sheet-received " : "") + (point ? "" : "awaiting")} role="dialog" aria-modal="false">
      <button className="sheet-close" onClick={onClose} aria-label={t.close}>✕</button>

      {step === "write" && (
        <div className="sheet-body">
          <div className="sheet-eyebrow">
            <span className="dot" style={{ background: gold }} />
            {t.addMemory}
          </div>

          {/* ① ② ③ guided steps */}
          <ol className="compose-steps">
            <li className={"cstep " + (point ? "done" : "active")}>
              <span className="cstep-n">{point ? "✓" : "1"}</span>
              <div className="cstep-body">
                <span className="cstep-title">{t.step1}</span>
                {point
                  ? <span className="cstep-meta">{derivedWard} · {fauxCoord(point.lat, point.lng)} <em>· {t.changeLocation}</em></span>
                  : <span className="cstep-meta hint">{t.chooseLocation}</span>}
              </div>
            </li>
            <li className={"cstep " + (hasText ? "done" : point ? "active" : "")}>
              <span className="cstep-n">{hasText ? "✓" : "2"}</span>
              <div className="cstep-body"><span className="cstep-title">{t.step2}</span></div>
            </li>
            <li className={"cstep " + (canSend ? "active" : "")}>
              <span className="cstep-n">3</span>
              <div className="cstep-body"><span className="cstep-title">{t.step3}</span></div>
            </li>
          </ol>

          <textarea className="memory-input" value={text}
            onChange={(e) => setText(e.target.value)} placeholder={t.writeHere} rows={5} />

          <div className="field-label">{t.category}</div>
          <div className="cat-chips">
            {CATS.map((c) => (
              <button key={c.key} className={"cat-chip " + (cat === c.key ? "on" : "")}
                onClick={() => setCat(c.key)}
                style={cat === c.key ? { borderColor: c.color, color: c.color } : undefined}>
                <span className="cat-dot" style={{ background: c.color }} />
                {c[lang]}
              </button>
            ))}
          </div>

          <div className="field-label">{t.timeWhen}</div>
          <div className="date-grid">
            <label className="date-field">
              <span className="date-cap req">{t.yearLabel} <em>∗ {t.required2}</em></span>
              <select className="date-sel" value={year}
                onChange={(e) => { setYear(e.target.value); if (!e.target.value) { setMonth(""); setDay(""); setHour(""); setMinute(""); } }}>
                <option value="">{t.chooseYear}</option>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <label className="date-field">
              <span className="date-cap">{t.monthLabel}</span>
              <select className="date-sel" value={month} disabled={!year}
                onChange={(e) => { const v = e.target.value; setMonth(v); if (!/^\d+$/.test(v)) { setDay(""); setHour(""); setMinute(""); } }}>
                <option value="">{t.anyOpt}</option>
                <option value="circa">{t.circa}…</option>
                <option value="unknown">{t.dontKnow}</option>
                {MONTHS[lang].map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </label>
            <label className={"date-field" + (specificMonth ? "" : " off")}>
              <span className="date-cap">{t.dayLabel}</span>
              <select className="date-sel" value={day} disabled={!specificMonth}
                onChange={(e) => { setDay(e.target.value); if (!e.target.value) { setHour(""); setMinute(""); } }}>
                <option value="">{specificMonth ? t.anyOpt : "—"}</option>
                {specificMonth && Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
              </select>
            </label>
          </div>
          <div className={"time-field" + (specificDay ? "" : " off")}>
            <span className="date-cap">{t.timeLabel}</span>
            <div className="time-hm">
              <select className="date-sel" value={hour} disabled={!specificDay} aria-label={t.timeLabel}
                onChange={(e) => { setHour(e.target.value); if (!e.target.value) setMinute(""); }}>
                <option value="">{specificDay ? "––" : "—"}</option>
                {specificDay && HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
              <span className="time-colon">:</span>
              <select className="date-sel" value={minute} disabled={!specificDay || !hour} aria-label={t.minuteLabel}
                onChange={(e) => setMinute(e.target.value)}>
                <option value="">{hour ? "00" : "—"}</option>
                {specificDay && hour && MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="date-help">{t.optionalMD}</div>
          {built && (
            <div className="date-summary">
              {t.saving}: <b>{lang === "vi" ? built.label : built.labelEn}</b> <span className="date-tag">({built.tag})</span>
            </div>
          )}

          <div className="field-label">{t.addPhoto}</div>
          {!photo && !optimizing && (
            <button className="photo-drop" onClick={() => fileRef.current && fileRef.current.click()}>
              <span className="photo-plus">＋</span>
              <span>{t.photoOptional}</span>
            </button>
          )}
          {optimizing && (
            <div className="photo-drop optimizing"><span className="mini-spin" />{t.optimizing}</div>
          )}
          {photo && (
            <div className="photo-preview">
              <img src={photo.dataUrl} alt="" />
              <button className="photo-remove" onClick={() => setPhoto(null)}>{t.remove}</button>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={pickPhoto} hidden />

          <div className="field-label">{lang === "vi" ? "Ghi danh tác giả" : "Attribution"}</div>
          <div className="cat-chips">
            {[
              { key: "anonymous", vi: "Ẩn danh", en: "Anonymous" },
              { key: "pseudonym", vi: "Bút danh", en: "Pseudonym" },
              { key: "real-name", vi: "Tên thật", en: "Real name" },
            ].map((a) => (
              <button key={a.key} className={"cat-chip " + (attribution === a.key ? "on" : "")}
                onClick={() => setAttribution(a.key)}>
                {a[lang]}
              </button>
            ))}
          </div>
          {attribution !== "anonymous" && (
            <input className="memory-input" style={{ marginTop: 8 }} value={authorName}
              placeholder={lang === "vi" ? "Tên hoặc bút danh của bạn" : "Your name or pseudonym"}
              onChange={(e) => setAuthorName(e.target.value)} />
          )}

          <div className="field-label">{lang === "vi" ? "Liên kết ghi âm/video (không bắt buộc)" : "Audio/video link (optional)"}</div>
          <input className="memory-input" type="url" value={mediaUrl}
            placeholder={lang === "vi" ? "https://… (bản ghi âm gốc, nếu có)" : "https://… (an existing recording, if any)"}
            onChange={(e) => setMediaUrl(e.target.value)} />

          <button className={"send-btn " + (canSend ? "" : "disabled")} onClick={send} disabled={!canSend}>
            {t.submit}
          </button>
          {!point && <div className="send-hint">{t.pickFirst}</div>}
          <div className="anon-note">
            <span className="lock">◆</span>{t.anonNote}
          </div>
        </div>
      )}

      {step === "received" && (
        <div className="sheet-body received-body">
          <div className="received-mark">
            <span className="received-ring" />
            <span className="received-check">✓</span>
          </div>
          <div className="received-title">{t.received}</div>
          <p className="received-text">{t.receivedBody}</p>

          <div className="nearby-head">
            <span className="hair" /> {t.nearby} <span className="hair" />
          </div>
          <div className="nearby-list">
            {nearby.map((m) => (
              <button key={m.id} className="nearby-card" onClick={() => onOpenMemory(m)}>
                <div className="nearby-meta">
                  <span className="cat-dot" style={{ background: catOf(m.cat).color }} />
                  {catOf(m.cat)[lang]} · {m.ward}
                </div>
                <div className="nearby-quote">{lang === "vi" ? m.vi : m.en}</div>
              </button>
            ))}
          </div>
          <button className="ghost-btn" onClick={onClose}>{t.exploreNearby} →</button>
        </div>
      )}
    </aside>
  );
}

window.ComposeSheet = ComposeSheet;
