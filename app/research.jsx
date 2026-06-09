/* ============================================================================
   research.jsx — AdvancedSearch panel + Boolean query compiler
   ============================================================================ */

// ---------------------------------------------------------------------------
// Boolean query parser: AND / OR / NOT / () / "phrase"
// ---------------------------------------------------------------------------
function compileQuery(q) {
  if (!q || !q.trim()) return null;
  const tokens = [];
  let i = 0;
  const s = q.trim();
  while (i < s.length) {
    if (s[i] === " ") { i++; continue; }
    if (s[i] === "(") { tokens.push({ t: "LPAREN" }); i++; continue; }
    if (s[i] === ")") { tokens.push({ t: "RPAREN" }); i++; continue; }
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j++;
      tokens.push({ t: "TERM", v: s.slice(i + 1, j).toLowerCase() });
      i = j + 1; continue;
    }
    let j = i;
    while (j < s.length && s[j] !== " " && s[j] !== "(" && s[j] !== ")") j++;
    const word = s.slice(i, j);
    if (/^AND$/i.test(word)) tokens.push({ t: "AND" });
    else if (/^OR$/i.test(word)) tokens.push({ t: "OR" });
    else if (/^NOT$/i.test(word)) tokens.push({ t: "NOT" });
    else tokens.push({ t: "TERM", v: word.toLowerCase() });
    i = j;
  }

  let pos = 0;
  function peek() { return tokens[pos]; }
  function consume() { return tokens[pos++]; }

  function parseOr() {
    let left = parseAnd();
    while (peek() && peek().t === "OR") { consume(); const right = parseAnd(); left = (hay) => left(hay) || right(hay); }
    return left;
  }
  function parseAnd() {
    let left = parseUnary();
    while (peek() && peek().t === "AND") { consume(); const right = parseUnary(); left = (hay) => left(hay) && right(hay); }
    return left;
  }
  function parseUnary() {
    if (peek() && peek().t === "NOT") { consume(); const sub = parsePrimary(); return (hay) => !sub(hay); }
    return parsePrimary();
  }
  function parsePrimary() {
    const tk = peek();
    if (!tk) return () => true;
    if (tk.t === "LPAREN") {
      consume();
      const expr = parseOr();
      if (peek() && peek().t === "RPAREN") consume();
      return expr;
    }
    if (tk.t === "TERM") { consume(); const v = tk.v; return (hay) => hay.includes(v); }
    consume();
    return () => true;
  }

  try {
    const fn = parseOr();
    if (pos < tokens.length) throw new Error("trailing");
    return fn;
  } catch (_) {
    return "ERROR";
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function RSSegmented({ value, options, onChange }) {
  return (
    <div className="rs-seg">
      {options.map((o) => (
        <button key={o.key} className={"rs-seg-btn " + (value === o.key ? "on" : "")}
          onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RSCheckChips({ value, options, onChange, getColor }) {
  const toggle = (key) => {
    const next = new Set(value);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(next);
  };
  return (
    <div className="rs-chips">
      {options.map((o) => {
        const on = value.has(o.key);
        const col = getColor ? getColor(o.key) : undefined;
        return (
          <button key={o.key}
            className={"rs-chip " + (on ? "on" : "")}
            style={on && col ? { borderColor: col, color: col, background: col + "18" } : undefined}
            onClick={() => toggle(o.key)}>
            {col && <span className="cat-dot" style={{ background: col, opacity: on ? 1 : 0.5 }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AdvancedSearch panel
// ---------------------------------------------------------------------------
function AdvancedSearch({
  lang, accent, results, total,
  // temporal
  precTemporal, onPrecTemporal,
  fromYear, toYear, fromMonth, toMonth, fromDay, toDay,
  onFromYear, onToYear, onFromMonth, onToMonth, onFromDay, onToDay,
  // spatial
  queryMode, onStartCircle, onStartPolygon, onClearShape, onFinishShape, onCancelDraw,
  queryShape,
  // text
  textQ, onTextQ, queryError,
  // facets
  catFilter, onCatFilter,
  contentFilter, onContentFilter,
  langFilter, onLangFilter,
  statusFilter, onStatusFilter,
  // actions
  onReset, onExport, onClose,
}) {
  const t = STR[lang];
  const S = t;

  const yearOpts = (() => { const a = [{ key: "", label: t.anyOpt }]; for (let y = MAX_YEAR; y >= MIN_YEAR; y--) a.push({ key: String(y), label: String(y) }); return a; })();
  const monthOpts = [{ key: "", label: t.anyOpt }, ...MONTHS[lang].map((m, i) => ({ key: String(i + 1), label: m }))];
  const dayOpts = [{ key: "", label: t.anyOpt }, ...Array.from({ length: 31 }, (_, i) => ({ key: String(i + 1), label: String(i + 1) }))];

  const shapeInfo = queryShape
    ? (queryShape.type === "circle"
      ? `${Math.round(queryShape.radius)}m ${t.radius}`
      : `${(queryShape.latlngs || []).length} ${t.points}`)
    : null;

  const isDrawing = queryMode === "circle" || queryMode === "polygon";

  return (
    <div className="research-dock" role="complementary" aria-label={t.researchMode}>
      <div className="rs-header">
        <span className="rs-kicker">{t.researchMode}</span>
        <span className="rs-title">{t.advSearch}</span>
        <button className="rs-close" onClick={onClose} aria-label={t.close}>✕</button>
      </div>

      {/* Summary bar */}
      <div className="rs-summary">
        <span className="rs-count">
          <b>{results}</b> {t.resultsOf} <b>{total}</b>
        </span>
        <button className="rs-export-sm" onClick={onExport}>{t.exportView}</button>
      </div>

      <div className="rs-scroll">

        {/* ── Temporal ── */}
        <div className="rs-section">
          <div className="rs-section-head">{t.temporal}</div>
          <div className="rs-row">
            <span className="rs-label">{t.precision}</span>
            <RSSegmented value={precTemporal}
              options={[{ key: "year", label: t.precYear }, { key: "month", label: t.precMonth }, { key: "day", label: t.precDay }]}
              onChange={onPrecTemporal} />
          </div>
          <div className="rs-date-grid">
            <div className="rs-date-group">
              <span className="rs-date-cap">{t.from}</span>
              <select className="rs-sel" value={fromYear} onChange={(e) => onFromYear(e.target.value)}>
                {yearOpts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              {precTemporal !== "year" && (
                <select className="rs-sel" value={fromMonth} onChange={(e) => onFromMonth(e.target.value)}>
                  {monthOpts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              )}
              {precTemporal === "day" && (
                <select className="rs-sel" value={fromDay} onChange={(e) => onFromDay(e.target.value)}>
                  {dayOpts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              )}
            </div>
            <div className="rs-date-group">
              <span className="rs-date-cap">{t.to}</span>
              <select className="rs-sel" value={toYear} onChange={(e) => onToYear(e.target.value)}>
                {yearOpts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              {precTemporal !== "year" && (
                <select className="rs-sel" value={toMonth} onChange={(e) => onToMonth(e.target.value)}>
                  {monthOpts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              )}
              {precTemporal === "day" && (
                <select className="rs-sel" value={toDay} onChange={(e) => onToDay(e.target.value)}>
                  {dayOpts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              )}
            </div>
          </div>
        </div>

        {/* ── Spatial ── */}
        <div className="rs-section">
          <div className="rs-section-head">{t.spatial}</div>
          <div className="rs-spatial-btns">
            <button className={"rs-draw-btn " + (queryMode === "circle" ? "on" : "")} onClick={onStartCircle}>
              ○ {t.drawCircle}
            </button>
            <button className={"rs-draw-btn " + (queryMode === "polygon" ? "on" : "")} onClick={onStartPolygon}>
              ⬡ {t.drawPoly}
            </button>
          </div>
          {isDrawing && (
            <div className="rs-draw-hint">
              <span>{queryMode === "circle" ? t.dragRadius : t.clickPts}</span>
              <div className="rs-draw-actions">
                {queryMode === "polygon" && <button className="rs-draw-finish" onClick={onFinishShape}>{t.finishShape}</button>}
                <button className="rs-draw-cancel" onClick={onCancelDraw}>{t.cancelDraw}</button>
              </div>
            </div>
          )}
          {queryShape && !isDrawing && (
            <div className="rs-shape-status">
              <span>✓ {shapeInfo} {t.inside}</span>
              <button className="rs-clear-shape" onClick={onClearShape}>{t.clearShape}</button>
            </div>
          )}
        </div>

        {/* ── Text search ── */}
        <div className="rs-section">
          <div className="rs-section-head">{t.textSearch}</div>
          <div className={"rs-text-wrap " + (queryError ? "err" : "")}>
            <input className="rs-text-input" value={textQ} onChange={(e) => onTextQ(e.target.value)}
              placeholder={t.boolHint} spellCheck={false} />
            {queryError && <div className="rs-bool-err">{t.boolErr}</div>}
          </div>
          <div className="rs-bool-hint">{t.boolSub}</div>
        </div>

        {/* ── Facets ── */}
        <div className="rs-section">
          <div className="rs-section-head">{t.filters}</div>

          <div className="rs-filter-label">{t.category}</div>
          <RSCheckChips value={catFilter}
            options={CATS.map((c) => ({ key: c.key, label: c[lang] }))}
            getColor={(k) => catOf(k).color}
            onChange={onCatFilter} />

          <div className="rs-filter-label">{t.fContent}</div>
          <RSCheckChips value={contentFilter}
            options={[{ key: "photo", label: t.ctPhoto }, { key: "video", label: t.ctVideo }, { key: "text", label: t.ctText }]}
            onChange={onContentFilter} />

          <div className="rs-filter-label">{t.fLang}</div>
          <RSCheckChips value={langFilter}
            options={[{ key: "vi", label: "Tiếng Việt" }, { key: "en", label: "English" }]}
            onChange={onLangFilter} />

          <div className="rs-filter-label">{t.fStatus}</div>
          <RSSegmented value={statusFilter}
            options={[{ key: "all", label: t.stAll }, { key: "verified", label: t.stVer }, { key: "unverified", label: t.stUnver }]}
            onChange={onStatusFilter} />
        </div>

      </div>{/* /rs-scroll */}

      <div className="rs-footer">
        <button className="rs-reset" onClick={onReset}>{t.resetAll}</button>
        <button className="rs-export-lg" onClick={onExport} style={{ background: accent }}>{t.exportView}</button>
      </div>
    </div>
  );
}

Object.assign(window, { compileQuery, AdvancedSearch });
