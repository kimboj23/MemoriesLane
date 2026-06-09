/* ============================================================================
   app.jsx — root App component, wires everything together
   ============================================================================ */

const TWEAK_DEFAULTS = { typeVoice: "serif", accent: "#d8552f", accumulation: "subtle" };
const QUOTE_FONTS = { serif: "'Lora', serif", sans: "'Be Vietnam Pro', sans-serif", mono: "'IBM Plex Mono', monospace" };
const NOW_YEAR = 2026;

// ---------------------------------------------------------------------------
// CitySwitcher
// ---------------------------------------------------------------------------
function CitySwitcher({ lang, city, overview, open, onSelect, onSelectNation, onClose }) {
  const t = STR[lang];
  return (
    <>
      {open && <div className="city-backdrop" onClick={onClose} />}
      <div className={"city-switcher " + (open ? "open" : "")} role="listbox" aria-label={t.selectLoc}>
        <div className="city-switcher-head">{t.network}</div>
        <button className={"city-opt " + (overview ? "on" : "")} onClick={() => { onSelectNation(); onClose(); }}>
          <span className="city-opt-name">{t.nation}</span>
          <span className="city-opt-count">{MEMORIES.length} {t.memoriesWord}</span>
        </button>
        {CITIES.map((c) => {
          const cnt = MEMORIES.filter((m) => (m.city || "hanoi") === c.key).length;
          const on = !overview && city && city.key === c.key;
          return (
            <button key={c.key} className={"city-opt " + (on ? "on" : "")} onClick={() => { onSelect(c.key); onClose(); }}>
              <span className="city-opt-name">{c[lang]}</span>
              <span className="city-opt-count">{cnt > 0 ? `${cnt} ${t.memoriesWord}` : t.beFirst}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// LayerControl
// ---------------------------------------------------------------------------
function LayerControl({ lang, basemap, theme, open, onBasemap, onTheme, onClose }) {
  const t = STR[lang];
  return (
    <>
      {open && <div className="layers-backdrop" onClick={onClose} />}
      <div className={"layer-pop " + (open ? "open" : "")} role="listbox" aria-label="Map style">
        <div className="layer-pop-head">{lang === "vi" ? "Kiểu bản đồ" : "Map style"}</div>
        <div className="layer-grid">
          {BASEMAPS.map((b) => (
            <button key={b.key} className={"layer-opt " + (basemap === b.key ? "on" : "")} onClick={() => { onBasemap(b.key); onClose(); }}>
              <span className="layer-swatch" style={{ background: b.swatch }} />
              <span className="layer-name">{b[lang]}</span>
            </button>
          ))}
        </div>
        <div className="layer-sep" />
        <button className="layer-theme-btn" onClick={onTheme}>
          {theme === "dark" ? "☀ " + (lang === "vi" ? "Sáng" : "Light") : "☾ " + (lang === "vi" ? "Tối" : "Dark")}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// RangeSlider (dual-handle with peaks histogram)
// ---------------------------------------------------------------------------
function RangeSlider({ min, max, value, onChange, peaks, accent }) {
  const [lo, hi] = value;
  const trackRef = React.useRef(null);

  const pct = (v) => ((v - min) / (max - min)) * 100;
  const maxPeak = peaks && peaks.length ? Math.max(...peaks.map((p) => p.count), 1) : 1;

  const clamp = (v) => Math.max(min, Math.min(max, v));
  const valFromX = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const frac = (clientX - rect.left) / rect.width;
    return clamp(Math.round(min + frac * (max - min)));
  };

  const drag = (which) => (eDown) => {
    eDown.preventDefault();
    const move = (e) => {
      const v = valFromX(e.clientX);
      if (which === "lo") onChange([Math.min(v, hi), hi]);
      else onChange([lo, Math.max(v, lo)]);
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="range-wrap">
      {peaks && peaks.length > 0 && (
        <div className="peaks-hist">
          {peaks.map((p) => (
            <div key={p.year} className={"peak-bar " + (p.year >= lo && p.year <= hi ? "in" : "")}
              style={{ height: Math.round((p.count / maxPeak) * 32) + "px", background: accent }} />
          ))}
        </div>
      )}
      <div ref={trackRef} className="range-track">
        <div className="range-fill"
          style={{ left: pct(lo) + "%", width: (pct(hi) - pct(lo)) + "%", background: accent }} />
        <div className="range-thumb lo" style={{ left: pct(lo) + "%" }} onMouseDown={drag("lo")}
          role="slider" aria-valuemin={min} aria-valuemax={max} aria-valuenow={lo} tabIndex={0} />
        <div className="range-thumb hi" style={{ left: pct(hi) + "%" }} onMouseDown={drag("hi")}
          role="slider" aria-valuemin={min} aria-valuemax={max} aria-valuenow={hi} tabIndex={0} />
      </div>
      <div className="range-labels">
        <span>{lo}</span>
        <span>{hi}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------
function Timeline({ lang, range, onChange, peaks, accent, expanded, onToggle }) {
  const t = STR[lang];
  const chips = [
    { label: lang === "vi" ? "Tất cả" : "All", range: [MIN_YEAR, MAX_YEAR] },
    { label: "1985–2000", range: [1985, 2000] },
    { label: "2000–2020", range: [2000, 2020] },
    { label: "2020–2026", range: [2020, 2026] },
    { label: "2026+", range: [2026, MAX_YEAR] },
  ];
  const activeChip = chips.find((c) => c.range[0] === range[0] && c.range[1] === range[1]);

  return (
    <div className={"timeline-pill " + (expanded ? "open" : "")}>
      <button className="timeline-toggle" onClick={onToggle}>
        <span className="tl-icon">◎</span>
        <span className="tl-range">{range[0]} – {range[1]}</span>
        <span className="tl-caret">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="timeline-panel">
          <div className="tl-chips">
            {chips.map((c) => (
              <button key={c.label}
                className={"tl-chip " + (activeChip && activeChip.label === c.label ? "on" : "")}
                style={activeChip && activeChip.label === c.label ? { borderColor: accent, color: accent } : undefined}
                onClick={() => onChange(c.range)}>
                {c.label}
              </button>
            ))}
          </div>
          <RangeSlider min={MIN_YEAR} max={MAX_YEAR} value={range} onChange={onChange} peaks={peaks} accent={accent} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
function App() {
  const [lang, setLang] = React.useState("vi");
  const [theme, setTheme] = React.useState("light");
  const [basemap, setBasemap] = React.useState("streets");
  const [layersOpen, setLayersOpen] = React.useState(false);
  const [city, setCity] = React.useState("hanoi");
  const [cityOpen, setCityOpen] = React.useState(false);
  const [range, setRange] = React.useState([MIN_YEAR, MAX_YEAR]);
  const [memories, setMemories] = React.useState(MEMORIES);
  const [composing, setComposing] = React.useState(false);
  const [placePoint, setPlacePoint] = React.useState(null);
  const [selected, setSelected] = React.useState(null);
  const [aboutOpen, setAboutOpen] = React.useState(false);
  const [researchOpen, setResearchOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [timelineOpen, setTimelineOpen] = React.useState(false);
  const [tweakActive, setTweakActive] = React.useState(false);

  // advanced search state
  const [adv, setAdv] = React.useState({
    precTemporal: "year",
    fromYear: "", toYear: "", fromMonth: "", toMonth: "", fromDay: "", toDay: "",
    textQ: "", queryError: false,
    catFilter: new Set(),
    contentFilter: new Set(),
    langFilter: new Set(),
    statusFilter: "all",
  });
  const [queryMode, setQueryMode] = React.useState(null); // null | "circle" | "polygon"
  const [queryShape, setQueryShape] = React.useState(null);
  const drawApiRef = React.useRef(null);

  const [tweaks, setTweakVal] = useTweaks(TWEAK_DEFAULTS);
  const setTweak = (k, v) => setTweakVal(k, v);

  const accent = tweaks.accent || "#d8552f";
  const gold = "#f0a721";

  // Theme effect
  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.setProperty("--ember", accent);
  }, [theme, accent]);

  // Listen for tweaks panel activation from parent
  React.useEffect(() => {
    const handler = (e) => {
      if (e.data && e.data.type === "__activate_edit_mode") setTweakActive(true);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Derived values
  const overview = city === "all";
  const cityObj = overview ? null : (CITY[city] || CITY.hanoi);
  const zone = cityObj ? (cityObj.zone || null) : null;

  const cityCounts = React.useMemo(() => {
    const m = {};
    CITIES.forEach((c) => { m[c.key] = 0; });
    memories.forEach((mem) => { const k = mem.city || "hanoi"; if (m[k] !== undefined) m[k]++; });
    return m;
  }, [memories]);

  const scopeMemories = React.useMemo(() => {
    if (overview) return memories;
    return memories.filter((m) => (m.city || "hanoi") === city);
  }, [memories, city, overview]);

  const filteredByRange = React.useMemo(() => {
    return scopeMemories.filter((m) => {
      const y = m.year || NOW_YEAR;
      return y >= range[0] && y <= range[1];
    });
  }, [scopeMemories, range]);

  // Advanced search filter
  const queryFn = React.useMemo(() => {
    if (!adv.textQ.trim()) return null;
    const fn = compileQuery(adv.textQ);
    return fn === "ERROR" ? null : fn;
  }, [adv.textQ]);

  const results = React.useMemo(() => {
    let r = filteredByRange;

    // temporal filter
    if (adv.fromYear || adv.toYear) {
      const prec = adv.precTemporal;
      const loY = +adv.fromYear || MIN_YEAR, hiY = +adv.toYear || MAX_YEAR;
      const loM = +adv.fromMonth || 1, hiM = +adv.toMonth || 12;
      const loD = +adv.fromDay || 1, hiD = +adv.toDay || 31;
      const lo = loY * 10000 + (prec !== "year" ? loM * 100 : 100) + (prec === "day" ? loD : 1);
      const hi = hiY * 10000 + (prec !== "year" ? hiM * 100 : 1200) + (prec === "day" ? hiD : 31);
      r = r.filter((m) => {
        const [mlo, mhi] = memoryDateBounds(m);
        return mhi >= lo && mlo <= hi;
      });
    }

    // spatial filter
    if (queryShape) r = r.filter((m) => inShape(m, queryShape));

    // text filter
    if (queryFn) r = r.filter((m) => queryFn(searchHaystack(m)));

    // category
    if (adv.catFilter.size > 0) r = r.filter((m) => adv.catFilter.has(m.cat));

    // content type
    if (adv.contentFilter.size > 0) r = r.filter((m) => adv.contentFilter.has(memoryMedia(m)));

    // language
    if (adv.langFilter.size > 0) r = r.filter((m) => adv.langFilter.has(memoryLang(m)));

    // status
    if (adv.statusFilter === "verified") r = r.filter(isVerified);
    else if (adv.statusFilter === "unverified") r = r.filter((m) => !isVerified(m));

    return r;
  }, [filteredByRange, adv, queryShape, queryFn]);

  const visible = researchOpen ? results : filteredByRange;

  const peaks = React.useMemo(() => {
    const map = {};
    for (let y = MIN_YEAR; y <= MAX_YEAR; y++) map[y] = 0;
    scopeMemories.forEach((m) => { if (m.year && map[m.year] !== undefined) map[m.year]++; });
    return Object.entries(map).map(([year, count]) => ({ year: +year, count }));
  }, [scopeMemories]);

  const nearby = React.useMemo(() => {
    if (!placePoint) return [];
    return [...scopeMemories]
      .sort((a, b) => dist(a, placePoint) - dist(b, placePoint))
      .slice(0, 3);
  }, [placePoint, scopeMemories]);

  const wanderIndex = React.useRef(0);
  const navigateMemory = (dir) => {
    if (!visible.length) return;
    if (!selected) { setSelected(visible[0]); wanderIndex.current = 0; return; }
    const idx = visible.findIndex((m) => m.id === selected.id);
    const next = (idx + dir + visible.length) % visible.length;
    wanderIndex.current = next;
    setSelected(visible[next]);
  };

  const t = STR[lang];
  const cityLabel = overview ? t.nation : (cityObj ? cityObj[lang] : "Hà Nội");

  const closeResearch = () => {
    setResearchOpen(false);
    setQueryMode(null);
    setQueryShape(null);
    if (drawApiRef.current) drawApiRef.current.cancelDraw();
  };

  const resetAdv = () => setAdv({
    precTemporal: "year",
    fromYear: "", toYear: "", fromMonth: "", toMonth: "", fromDay: "", toDay: "",
    textQ: "", queryError: false,
    catFilter: new Set(), contentFilter: new Set(), langFilter: new Set(), statusFilter: "all",
  });

  const handleStartCircle = () => {
    setQueryMode("circle");
    drawApiRef.current && drawApiRef.current.startCircle();
  };
  const handleStartPolygon = () => {
    setQueryMode("polygon");
    drawApiRef.current && drawApiRef.current.startPolygon();
  };
  const handleClearShape = () => { setQueryShape(null); setQueryMode(null); };
  const handleCancelDraw = () => { setQueryMode(null); drawApiRef.current && drawApiRef.current.cancelDraw(); };

  return (
    <div className={"app " + (composing ? "is-composing" : "") + (selected ? " has-selected" : "")}>
      {/* ── Topbar ── */}
      <header className="topbar">
        <button className="topbar-city" onClick={() => setCityOpen((v) => !v)}>
          <span className="topbar-city-name">{cityLabel}</span>
          <span className="topbar-city-caret">▾</span>
        </button>

        <div className="topbar-brand">
          <span className="brand-primary">{t.siteName}</span>
        </div>

        <div className="topbar-right">
          <button className="topbar-btn" onClick={() => setResearchOpen((v) => !v)} title={t.research}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
              <line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
          <button className="topbar-btn" onClick={() => setLayersOpen((v) => !v)} title={lang === "vi" ? "Kiểu bản đồ" : "Map style"}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 1l7 3.5-7 3.5L1 4.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              <path d="M1 8l7 3.5L15 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M1 11.5l7 3.5 7-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
          <button className="topbar-btn lang-btn" onClick={() => setLang((l) => l === "vi" ? "en" : "vi")}>
            {t.langLabel}
          </button>
          <button className="topbar-btn" onClick={() => setAboutOpen(true)} title={t.aboutTitle} aria-label={t.aboutTitle}>?</button>
        </div>
      </header>

      {/* ── City switcher ── */}
      <CitySwitcher lang={lang} city={cityObj} overview={overview} open={cityOpen}
        onSelect={(k) => { setCity(k); setCityOpen(false); setSelected(null); }}
        onSelectNation={() => { setCity("all"); setCityOpen(false); setSelected(null); }}
        onClose={() => setCityOpen(false)} />

      {/* ── Layer control ── */}
      <LayerControl lang={lang} basemap={basemap} theme={theme} open={layersOpen}
        onBasemap={(b) => setBasemap(b)}
        onTheme={() => setTheme((t) => t === "dark" ? "light" : "dark")}
        onClose={() => setLayersOpen(false)} />

      {/* ── Map ── */}
      <MapView
        lang={lang} basemap={basemap} city={cityObj} memories={visible}
        selected={selected} composing={composing} placePoint={placePoint}
        onPlace={(pt) => setPlacePoint(pt)}
        queryShape={queryShape} onShapeUpdate={setQueryShape}
        queryMode={queryMode} zone={zone} accent={accent}
        overview={overview} cityCounts={cityCounts}
        onCityDrillDown={(k) => { setCity(k); }}
        onSelectMemory={(m) => { setSelected(m); setComposing(false); }}
        drawApiRef={drawApiRef}
      />

      {/* ── Place banner ── */}
      {composing && !placePoint && (
        <div className="place-banner">
          <span className="place-banner-dot" style={{ background: gold }} />
          {t.placePrompt}
        </div>
      )}

      {/* ── Clearance tag ── */}
      {zone && !overview && (
        <div className="clearance-tag" style={{ borderColor: accent + "80", color: accent }}>
          <span className="ct-dot" style={{ background: accent }} />
          {t.clearanceZone}
        </div>
      )}

      {/* ── CTA FAB ── */}
      {!composing && !selected && !researchOpen && (
        <button className="cta-fab" style={{ background: accent }}
          onClick={() => { setComposing(true); setSelected(null); setPlacePoint(null); }}>
          {t.addMemory}
        </button>
      )}

      {/* ── Timeline ── */}
      {!composing && !selected && (
        <Timeline lang={lang} range={range} onChange={setRange} peaks={peaks} accent={accent}
          expanded={timelineOpen} onToggle={() => setTimelineOpen((v) => !v)} />
      )}

      {/* ── Advanced search ── */}
      {researchOpen && (
        <AdvancedSearch
          lang={lang} accent={accent}
          results={results.length} total={scopeMemories.length}
          precTemporal={adv.precTemporal} onPrecTemporal={(v) => setAdv((a) => ({ ...a, precTemporal: v }))}
          fromYear={adv.fromYear} toYear={adv.toYear}
          fromMonth={adv.fromMonth} toMonth={adv.toMonth}
          fromDay={adv.fromDay} toDay={adv.toDay}
          onFromYear={(v) => setAdv((a) => ({ ...a, fromYear: v }))}
          onToYear={(v) => setAdv((a) => ({ ...a, toYear: v }))}
          onFromMonth={(v) => setAdv((a) => ({ ...a, fromMonth: v }))}
          onToMonth={(v) => setAdv((a) => ({ ...a, toMonth: v }))}
          onFromDay={(v) => setAdv((a) => ({ ...a, fromDay: v }))}
          onToDay={(v) => setAdv((a) => ({ ...a, toDay: v }))}
          queryMode={queryMode}
          onStartCircle={handleStartCircle}
          onStartPolygon={handleStartPolygon}
          onClearShape={handleClearShape}
          onFinishShape={() => setQueryMode(null)}
          onCancelDraw={handleCancelDraw}
          queryShape={queryShape}
          textQ={adv.textQ}
          onTextQ={(v) => {
            const fn = compileQuery(v);
            setAdv((a) => ({ ...a, textQ: v, queryError: v.trim() && fn === "ERROR" }));
          }}
          queryError={adv.queryError}
          catFilter={adv.catFilter} onCatFilter={(s) => setAdv((a) => ({ ...a, catFilter: s }))}
          contentFilter={adv.contentFilter} onContentFilter={(s) => setAdv((a) => ({ ...a, contentFilter: s }))}
          langFilter={adv.langFilter} onLangFilter={(s) => setAdv((a) => ({ ...a, langFilter: s }))}
          statusFilter={adv.statusFilter} onStatusFilter={(v) => setAdv((a) => ({ ...a, statusFilter: v }))}
          onReset={resetAdv}
          onExport={() => setExportOpen(true)}
          onClose={closeResearch}
        />
      )}

      {/* ── Export modal ── */}
      {exportOpen && (
        <ExportModal lang={lang} accent={accent} results={results} adv={adv}
          onClose={() => setExportOpen(false)} />
      )}

      {/* ── Compose sheet ── */}
      {composing && (
        <ComposeSheet
          point={placePoint} lang={lang} accent={accent} gold={gold}
          city={cityObj}
          onSubmit={(mem) => {
            setMemories((prev) => [mem, ...prev]);
          }}
          onClose={() => { setComposing(false); setPlacePoint(null); }}
          nearby={nearby}
          onOpenMemory={(m) => { setSelected(m); setComposing(false); }}
        />
      )}

      {/* ── Memory detail ── */}
      {selected && (
        <MemoryDetail
          memory={selected} lang={lang} accent={accent} gold={gold}
          quoteFont={tweaks.typeVoice}
          onClose={() => setSelected(null)}
          onPrev={() => navigateMemory(-1)}
          onNext={() => navigateMemory(1)}
        />
      )}

      {/* ── About panel ── */}
      {aboutOpen && <AboutPanel lang={lang} onClose={() => setAboutOpen(false)} />}

      {/* ── Tweaks panel ── */}
      <TweaksPanel active={tweakActive} tweaks={tweaks} setTweak={setTweak}
        onClose={() => setTweakActive(false)} />

      {/* Voice count watermark */}
      {!composing && !selected && !researchOpen && (
        <div className="voice-count">
          <b>{visible.length}</b> {t.voices}
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
