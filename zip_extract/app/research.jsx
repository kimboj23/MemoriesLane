/* ============================================================================
   research.jsx — "Research Mode": the Advanced Search sidebar.
   Temporal range (Year/Month/Day precision), spatial radius/polygon query,
   Boolean text search, faceted filters, and the gateway to Data Export.
   Chrome stays in the cold document voice (mono, uppercase labels); the
   testimony itself is never restyled here.
   ============================================================================ */

// ---- Boolean query compiler ------------------------------------------------
// Supports AND · OR · NOT · ( ) · "quoted phrases" · implicit-AND adjacency.
// Returns { ok, test(haystack)->bool, error? }. Empty query → matches all.
function tokenizeQuery(q) {
  const toks = []; const re = /\s*("(?:[^"]*)"|\(|\)|[^\s()]+)/g; let m;
  while ((m = re.exec(q))) {
    const t = m[1];
    if (t === "(" || t === ")") toks.push({ type: t });
    else if (t[0] === '"') toks.push({ type: "TERM", val: t.slice(1, -1).toLowerCase().trim() });
    else {
      const up = t.toUpperCase();
      if (up === "AND" || up === "OR" || up === "NOT") toks.push({ type: up });
      else toks.push({ type: "TERM", val: t.toLowerCase() });
    }
  }
  return toks;
}

function compileQuery(q) {
  const toks = tokenizeQuery(q || "");
  if (!toks.length) return { ok: true, test: () => true };
  let i = 0;
  const peek = () => toks[i];
  const expect = (type) => { if (toks[i] && toks[i].type === type) { i++; return; } throw new Error("expected " + type); };
  function parseOr() {
    let node = parseAnd();
    while (peek() && peek().type === "OR") { i++; const r = parseAnd(); const a = node; node = (h) => a(h) || r(h); }
    return node;
  }
  function parseAnd() {
    let node = parseUnary();
    while (peek() && peek().type !== "OR" && peek().type !== ")") {
      if (peek().type === "AND") i++;
      const r = parseUnary(); const a = node; node = (h) => a(h) && r(h);
    }
    return node;
  }
  function parseUnary() {
    if (peek() && peek().type === "NOT") { i++; const r = parseUnary(); return (h) => !r(h); }
    return parsePrimary();
  }
  function parsePrimary() {
    const tk = peek();
    if (!tk) throw new Error("unexpected end");
    if (tk.type === "(") { i++; const n = parseOr(); expect(")"); return n; }
    if (tk.type === "TERM") { i++; const v = tk.val; return (h) => v === "" || h.includes(v); }
    throw new Error("unexpected " + tk.type);
  }
  try {
    const test = parseOr();
    if (i !== toks.length) throw new Error("trailing tokens");
    return { ok: true, test };
  } catch (e) { return { ok: false, error: e.message, test: () => true }; }
}

// ---- small controls --------------------------------------------------------
function RSSegmented({ value, options, onChange }) {
  return (
    <div className="rs-seg">
      {options.map((o) => (
        <button key={o.v} className={"rs-seg-btn" + (value === o.v ? " on" : "")}
          onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

function RSCheckChips({ items, selected, onToggle }) {
  return (
    <div className="rs-chips">
      {items.map((it) => {
        const on = selected.includes(it.v);
        return (
          <button key={it.v} className={"rs-chip" + (on ? " on" : "")}
            onClick={() => onToggle(it.v)}
            style={on && it.color ? { borderColor: it.color, color: it.color } : undefined}>
            {it.color && <span className="rs-chip-dot" style={{ background: it.color }} />}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

const YEAR_OPTS = (() => { const a = []; for (let y = MAX_YEAR; y >= MIN_YEAR; y--) a.push(y); return a; })();

// ---- the panel -------------------------------------------------------------
function AdvancedSearch({
  lang, accent, range, onRange, adv, setAdv,
  total, resultCount, compiled,
  queryMode, setQueryMode, queryShape, setQueryShape, draftCount, drawApiRef,
  onExport, onClose, onResetAll,
}) {
  const S = STR[lang];
  const patch = (p) => setAdv((a) => ({ ...a, ...p }));

  const setPrecision = (v) => {
    if (v === "year") patch({ precision: v, fM: null, fD: null, tM: null, tD: null });
    else if (v === "month") patch({ precision: v, fD: null, tD: null });
    else patch({ precision: v });
  };
  const toggleIn = (key, v) => patch({ [key]: adv[key].includes(v) ? adv[key].filter((x) => x !== v) : [...adv[key], v] });

  const drawing = !!queryMode;
  const startDraw = (mode) => { setQueryShape(null); setQueryMode(mode); };
  const num = (v) => (v == null ? "" : String(v));

  return (
    <aside className="research-dock" role="region" aria-label={S.advSearch}>
      <header className="rs-head">
        <div className="rs-head-text">
          <div className="rs-kicker">{S.researchMode}</div>
          <h2 className="rs-title">{S.advSearch}</h2>
        </div>
        <button className="rs-close" onClick={onClose} aria-label={S.close}>✕</button>
      </header>

      <div className="rs-summary">
        <div className="rs-count"><b>{resultCount}</b> <span>/ {total}</span></div>
        <div className="rs-count-label">{S.matchCount}</div>
        <button className="rs-export" onClick={onExport} disabled={resultCount === 0}>{S.exportView} ↓</button>
      </div>

      <div className="rs-scroll">
        {/* ---- temporal ---- */}
        <section className="rs-section">
          <div className="rs-label-row">
            <span className="rs-label">{S.temporal}</span>
            <RSSegmented value={adv.precision}
              options={[{ v: "year", label: S.precYear }, { v: "month", label: S.precMonth }, { v: "day", label: S.precDay }]}
              onChange={setPrecision} />
          </div>
          <div className="rs-daterow">
            <span className="rs-from">{S.from}</span>
            <select className="rs-sel" value={range[0]} onChange={(e) => onRange([Math.min(+e.target.value, range[1]), range[1]])}>
              {YEAR_OPTS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            {adv.precision !== "year" && (
              <select className="rs-sel sm" value={num(adv.fM)} onChange={(e) => patch({ fM: e.target.value ? +e.target.value : null })}>
                <option value="">{S.precMonth}</option>
                {MONTHS[lang].map((m, idx) => <option key={idx} value={idx + 1}>{idx + 1}</option>)}
              </select>
            )}
            {adv.precision === "day" && (
              <select className="rs-sel sm" value={num(adv.fD)} onChange={(e) => patch({ fD: e.target.value ? +e.target.value : null })}>
                <option value="">{S.precDay}</option>
                {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
              </select>
            )}
          </div>
          <div className="rs-daterow">
            <span className="rs-from">{S.to}</span>
            <select className="rs-sel" value={range[1]} onChange={(e) => onRange([range[0], Math.max(+e.target.value, range[0])])}>
              {YEAR_OPTS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            {adv.precision !== "year" && (
              <select className="rs-sel sm" value={num(adv.tM)} onChange={(e) => patch({ tM: e.target.value ? +e.target.value : null })}>
                <option value="">{S.precMonth}</option>
                {MONTHS[lang].map((m, idx) => <option key={idx} value={idx + 1}>{idx + 1}</option>)}
              </select>
            )}
            {adv.precision === "day" && (
              <select className="rs-sel sm" value={num(adv.tD)} onChange={(e) => patch({ tD: e.target.value ? +e.target.value : null })}>
                <option value="">{S.precDay}</option>
                {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
              </select>
            )}
          </div>
        </section>

        {/* ---- spatial ---- */}
        <section className="rs-section">
          <span className="rs-label">{S.spatial}</span>
          <div className="rs-shape-btns">
            <button className={"rs-shape-btn" + (queryMode === "circle" ? " on" : "")}
              onClick={() => startDraw("circle")}><span className="rs-glyph">◯</span>{S.drawCircle}</button>
            <button className={"rs-shape-btn" + (queryMode === "polygon" ? " on" : "")}
              onClick={() => startDraw("polygon")}><span className="rs-glyph">⬡</span>{S.drawPoly}</button>
          </div>

          {drawing && queryMode === "circle" && (
            <div className="rs-draw-hint">{S.dragRadius}</div>
          )}
          {drawing && queryMode === "polygon" && (
            <div className="rs-draw-poly">
              <span className="rs-draw-hint">{S.clickPts} · <b>{draftCount}</b> {S.points}</span>
              <div className="rs-draw-actions">
                <button className="rs-mini ember" disabled={draftCount < 3}
                  onClick={() => drawApiRef.current && drawApiRef.current.finish && drawApiRef.current.finish()}>{S.finishShape}</button>
                <button className="rs-mini" onClick={() => setQueryMode(null)}>{S.cancelDraw}</button>
              </div>
            </div>
          )}
          {!drawing && queryShape && (
            <div className="rs-shape-status">
              <span className="rs-shape-info">
                {queryShape.type === "circle"
                  ? <>◯ {S.radius} {queryShape.radius >= 1000 ? (queryShape.radius / 1000).toFixed(2) + " km" : Math.round(queryShape.radius) + " m"}</>
                  : <>⬡ {queryShape.latlngs.length} {S.points}</>}
                <span className="rs-shape-inside"> · {resultCount} {S.inside}</span>
              </span>
              <button className="rs-mini" onClick={() => setQueryShape(null)}>{S.clearShape}</button>
            </div>
          )}
        </section>

        {/* ---- boolean text ---- */}
        <section className="rs-section">
          <span className="rs-label">{S.textSearch}</span>
          <input className={"rs-search" + (compiled && !compiled.ok ? " err" : "")}
            value={adv.query} onChange={(e) => patch({ query: e.target.value })}
            placeholder={S.boolHint} spellCheck={false} />
          <div className={"rs-bool-sub" + (compiled && !compiled.ok ? " err" : "")}>
            {compiled && !compiled.ok ? "⚠ " + S.boolErr : S.boolSub}
          </div>
        </section>

        {/* ---- facets ---- */}
        <section className="rs-section">
          <span className="rs-label">{S.filters}</span>

          <div className="rs-facet">
            <span className="rs-facet-cap">{S.category}</span>
            <RSCheckChips items={CATS.map((c) => ({ v: c.key, label: c[lang], color: c.color }))}
              selected={adv.cats} onToggle={(v) => toggleIn("cats", v)} />
          </div>

          <div className="rs-facet">
            <span className="rs-facet-cap">{S.fContent}</span>
            <RSCheckChips items={[{ v: "photo", label: S.ctPhoto }, { v: "video", label: S.ctVideo }, { v: "text", label: S.ctText }]}
              selected={adv.content} onToggle={(v) => toggleIn("content", v)} />
          </div>

          <div className="rs-facet">
            <span className="rs-facet-cap">{S.fLang}</span>
            <RSCheckChips items={[{ v: "vi", label: "Tiếng Việt" }, { v: "en", label: "English" }]}
              selected={adv.langs} onToggle={(v) => toggleIn("langs", v)} />
          </div>

          <div className="rs-facet">
            <span className="rs-facet-cap">{S.fStatus}</span>
            <RSSegmented value={adv.status}
              options={[{ v: "all", label: S.stAll }, { v: "verified", label: S.stVer }, { v: "unverified", label: S.stUnver }]}
              onChange={(v) => patch({ status: v })} />
          </div>
        </section>
      </div>

      <footer className="rs-foot">
        <button className="rs-reset" onClick={onResetAll}>{S.resetAll}</button>
        <button className="rs-export-lg" onClick={onExport} disabled={resultCount === 0}>{S.exportView} ↓</button>
      </footer>
    </aside>
  );
}

window.compileQuery = compileQuery;
window.AdvancedSearch = AdvancedSearch;
