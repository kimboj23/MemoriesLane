/* ============================================================================
   app.jsx — state, layout, theme (light default), basemap layer switcher,
   temporal timeline, language, wandering, and Tweaks.
   ============================================================================ */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "typeVoice": "serif",
  "accent": "#d8552f",
  "accumulation": "subtle"
}/*EDITMODE-END*/;

const QUOTE_FONTS = {
  serif: "'Lora', Georgia, 'Times New Roman', serif",
  sans: "'Be Vietnam Pro', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
};

// ---- city switcher (hub-and-spoke navigation) -----------------------------
function CitySwitcher({ lang, city, counts, onPick, onClose }) {
  const S = STR[lang];
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const sorted = [...CITIES].sort((a, b) => (counts[b.key] || 0) - (counts[a.key] || 0));
  const Row = ({ k, name, alt, n }) => (
    <button className={"city-row " + (city === k ? "on" : "")} onClick={() => onPick(k)} role="menuitem">
      <span className="city-row-body">
        <span className="city-row-name">{name}</span>
        {alt && <span className="city-row-alt">{alt}</span>}
      </span>
      <span className={"city-row-count" + (n === 0 ? " zero" : "")}>{n === 0 ? S.beFirst : n}</span>
    </button>
  );
  return (
    <React.Fragment>
      <div className="pop-scrim" onClick={onClose}></div>
      <div className="city-pop" role="menu">
        <div className="pop-label">{S.selectLoc}</div>
        <Row k="all" name={S.nation} alt={S.allCities} n={total} />
        <div className="city-divider"></div>
        {sorted.map((c) => (
          <Row key={c.key} k={c.key}
            name={c[lang]} alt={c.vi !== c.en ? (lang === "vi" ? c.en : c.vi) : null}
            n={counts[c.key] || 0} />
        ))}
      </div>
    </React.Fragment>
  );
}

// ---- basemap layer switcher popover ---------------------------------------
function LayerControl({ lang, basemap, theme, onPick, onTheme, onClose }) {
  return (
    <React.Fragment>
      <div className="pop-scrim" onClick={onClose}></div>
      <div className="layer-pop" role="menu">
        <div className="pop-label">{lang === "vi" ? "Lớp bản đồ" : "Map layer"}</div>
        <div className="layer-grid">
          {BASEMAPS.map((b) => (
            <button key={b.key} className={"layer-opt " + (basemap === b.key ? "on" : "")}
              onClick={() => onPick(b.key)}>
              <span className="layer-swatch" style={{ background: b.swatch }}></span>
              <span className="layer-name">{b[lang]}</span>
            </button>
          ))}
        </div>
        <div className="pop-divider"></div>
        <button className="theme-row" onClick={onTheme}>
          <span>{lang === "vi" ? "Giao diện" : "Appearance"}</span>
          <span className="theme-pillset">
            <span className={"theme-seg " + (theme === "light" ? "on" : "")}>{lang === "vi" ? "Sáng" : "Light"}</span>
            <span className={"theme-seg " + (theme === "dark" ? "on" : "")}>{lang === "vi" ? "Tối" : "Dark"}</span>
          </span>
        </button>
      </div>
    </React.Fragment>
  );
}

// ---- relocation-zone legend ------------------------------------------------
// ---- temporal timeline -----------------------------------------------------
const NOW_YEAR = 2026;

function RangeSlider({ lo, hi, peaks, onChange }) {
  const span = MAX_YEAR - MIN_YEAR;
  const loPct = ((lo - MIN_YEAR) / span) * 100;
  const hiPct = ((hi - MIN_YEAR) / span) * 100;
  const maxCount = Math.max(1, ...peaks.map((p) => p.count));
  return (
    <div className="rng">
      <div className="rng-peaks">
        {peaks.map((p) => {
          const left = ((p.year - MIN_YEAR) / span) * 100;
          const h = 6 + 18 * (p.count / maxCount);
          const on = p.year >= lo && p.year <= hi;
          return (
            <button key={p.year} className={"rng-peak" + (on ? " on" : "")}
              style={{ left: left + "%", height: h + "px" }}
              onClick={() => onChange([p.year, p.year])}
              title={p.year + " · " + p.count} aria-label={p.year + ": " + p.count} />
          );
        })}
      </div>
      <div className="rng-track">
        <div className="rng-fill" style={{ left: loPct + "%", right: 100 - hiPct + "%" }} />
      </div>
      <input type="range" className="rng-input" min={MIN_YEAR} max={MAX_YEAR} step={1} value={lo}
        onChange={(e) => onChange([Math.min(+e.target.value, hi), hi])} aria-label="Start year" />
      <input type="range" className="rng-input" min={MIN_YEAR} max={MAX_YEAR} step={1} value={hi}
        onChange={(e) => onChange([lo, Math.max(+e.target.value, lo)])} aria-label="End year" />
    </div>
  );
}

function Timeline({ lang, range, count, peaks, onChange }) {
  const t = STR[lang];
  const [open, setOpen] = React.useState(false);
  const [lo, hi] = range;
  const allTime = lo <= MIN_YEAR && hi >= MAX_YEAR;
  const single = lo === hi ? lo : null;
  const allLabel = lang === "vi" ? "Mọi thời điểm" : "All time";
  const label = allTime ? allLabel : single != null ? String(single) : lo + "–" + hi;

  if (!open) {
    return (
      <button className={"timeline-toggle " + (allTime ? "" : "filtered")}
        onClick={() => setOpen(true)}
        aria-label={lang === "vi" ? "Lọc theo thời gian" : "Filter by time"}>
        <span className="tl-clock">◷</span>
        <span className="tl-toggle-text">
          <small>{lang === "vi" ? "Thời gian" : "Time"}</small>
          <b>{label}</b>
        </span>
      </button>
    );
  }

  const chips = [
    { id: "all", vi: "Mọi thời điểm", en: "All time", r: [MIN_YEAR, MAX_YEAR] },
    { id: "l5", vi: "5 năm qua", en: "Last 5 yrs", r: [NOW_YEAR - 4, NOW_YEAR] },
    { id: "20s", vi: "Thập niên 2020", en: "2020s", r: [2020, 2029] },
    { id: "10s", vi: "Thập niên 2010", en: "2010s", r: [2010, 2019] },
    { id: "pre", vi: "Trước 2010", en: "Before 2010", r: [MIN_YEAR, 2009] },
    { id: "reloc", vi: "Di dời 2026–45", en: "Relocation era", r: [2026, MAX_YEAR] },
  ];
  const matches = (r) => r[0] === lo && r[1] === hi;

  return (
    <div className={"timeline" + (single != null ? " single" : "")}>
      <div className="time-head">
        <div className="time-readout">
          <span className={"time-year" + (single != null ? " is-single" : "")}>{label}</span>
          <span className="time-count">{count} {t.voices}</span>
        </div>
        <button className="time-reset" onClick={() => onChange([MIN_YEAR, MAX_YEAR])} disabled={allTime}>
          {lang === "vi" ? "Đặt lại" : "Reset"}
        </button>
        <button className="time-collapse" onClick={() => setOpen(false)}
          aria-label={lang === "vi" ? "Thu gọn" : "Collapse"}>✕</button>
      </div>

      <div className="time-chips">
        {chips.map((c) => (
          <button key={c.id} className={"time-chip" + (matches(c.r) ? " on" : "")}
            onClick={() => onChange(c.r)}>{c[lang]}</button>
        ))}
      </div>

      <RangeSlider lo={lo} hi={hi} peaks={peaks} onChange={onChange} />

      <div className="time-scale">
        <span>{MIN_YEAR}</span><span className="time-mid">{NOW_YEAR}</span><span>{MAX_YEAR}</span>
      </div>
    </div>
  );
}

// Map backend column names to the shape the frontend expects.
// Backend uses text_vi/text_en/has_photo/date_label; frontend uses vi/en/photo/date.
function fromApi(r) {
  return {
    id: r.id,
    lat: r.lat, lng: r.lng,
    city: r.city, ward: r.ward,
    cat: r.cat,
    year: r.year, month: r.month, day: r.day,
    date: r.date_label || String(r.year),
    dateEn: r.date_label_en || String(r.year),
    lang: r.lang,
    vi: r.text_vi,
    en: r.text_en || r.text_vi,
    photo: !!r.has_photo,
    media: r.media_type,
    caseId: r.case_id || null,
    topics: Array.isArray(r.topics) ? r.topics : [],
  };
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [lang, setLang] = React.useState("vi");
  const [theme, setTheme] = React.useState("light");
  const [basemap, setBasemap] = React.useState("streets");
  const [layersOpen, setLayersOpen] = React.useState(false);
  const [city, setCity] = React.useState("hanoi");
  const [cityOpen, setCityOpen] = React.useState(false);
  const [range, setRange] = React.useState([MIN_YEAR, MAX_YEAR]);
  const [memories, setMemories] = React.useState(() => MEMORIES.slice());

  // Load approved memories from backend; fall back to static seed data if empty.
  React.useEffect(() => {
    fetch("/api/memories")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data && data.memories && data.memories.length > 0)
          setMemories(data.memories.map(fromApi));
      })
      .catch((e) => console.warn("Failed to load memories from API:", e));
  }, []);

  const [composing, setComposing] = React.useState(false);
  const [placePoint, setPlacePoint] = React.useState(null);
  const [selected, setSelected] = React.useState(null);
  const [aboutOpen, setAboutOpen] = React.useState(false);
  const [adminOpen, setAdminOpen] = React.useState(false);
  const [materialsOpen, setMaterialsOpen] = React.useState(false);
  const [openCaseId, setOpenCaseId] = React.useState(null);
  const [caseProfile, setCaseProfile] = React.useState(null);
  const [allTopics, setAllTopics] = React.useState([]);
  // --- research mode ---
  const [research, setResearch] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [adv, setAdv] = React.useState({
    precision: "year", fM: null, fD: null, tM: null, tD: null,
    query: "", cats: [], langs: [], content: [], status: "all", topics: [],
  });
  const [listView, setListView] = React.useState(false);
  const [feedItems, setFeedItems] = React.useState([]);
  const [feedLoading, setFeedLoading] = React.useState(false);
  const [queryMode, setQueryMode] = React.useState(null);
  const [queryShape, setQueryShape] = React.useState(null);
  const [draftCount, setDraftCount] = React.useState(0);
  const drawApiRef = React.useRef({});
  const wanderHist = React.useRef([]);

  const S = STR[lang];
  const accent = t.accent;

  React.useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);

  React.useEffect(() => {
    if (!openCaseId) { setCaseProfile(null); return; }
    fetch(`/api/cases/${encodeURIComponent(openCaseId)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data && data.case) {
          setCaseProfile({ caseData: data.case, memories: (data.memories || []).map(fromApi) });
        } else {
          setOpenCaseId(null);
        }
      })
      .catch((e) => { console.warn("Failed to load case profile:", e); setOpenCaseId(null); });
  }, [openCaseId]);

  // Load rights-based topics for the filter bar (once on mount)
  React.useEffect(() => {
    fetch("/api/topics")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data && data.topics) setAllTopics(data.topics); })
      .catch(() => {});
  }, []);

  // Fetch unified feed whenever list view is active + any filter changes.
  React.useEffect(() => {
    if (!listView || city === "all") return;
    setFeedLoading(true);
    const p = new URLSearchParams();
    if (city) p.set("city", city);
    p.set("minYear", String(range[0]));
    p.set("maxYear", String(range[1]));
    if (adv.cats && adv.cats.length)   p.set("cats",   adv.cats.join(","));
    if (adv.topics && adv.topics.length) p.set("topics", adv.topics.join(","));
    fetch("/api/feed?" + p.toString())
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setFeedItems(data.items || []); })
      .catch(() => {})
      .finally(() => setFeedLoading(false));
  }, [listView, city, range, adv.cats, adv.topics]);

  const [lo, hi] = range;
  const compiled = React.useMemo(() => compileQuery(adv.query), [adv.query]);

  // ---- multi-city scope (hub-and-spoke) ----
  const cityObj = city === "all" ? null : (CITY[city] || CITY.hanoi);
  const cityCounts = React.useMemo(() => {
    const o = {}; CITIES.forEach((c) => (o[c.key] = 0));
    memories.forEach((m) => { const k = memoryCity(m); o[k] = (o[k] || 0) + 1; });
    return o;
  }, [memories]);
  const scopeMemories = React.useMemo(
    () => (city === "all" ? memories : memories.filter((m) => memoryCity(m) === city)),
    [memories, city]
  );
  const overview = React.useMemo(() => {
    if (city !== "all") return null;
    return CITIES.map((c) => ({ key: c.key, name: c[lang], lat: c.center[0], lng: c.center[1], count: cityCounts[c.key] || 0 }))
      .filter((o) => o.count > 0);
  }, [city, lang, cityCounts]);

  // full Research-Mode result set: temporal (Y/M/D) + spatial + Boolean + facets
  const results = React.useMemo(() => {
    const qLo = lo * 10000 + (adv.fM || 1) * 100 + (adv.fD || 1);
    const qHi = hi * 10000 + (adv.tM || 12) * 100 + (adv.tD || 31);
    return scopeMemories.filter((m) => {
      const [mLo, mHi] = memoryDateBounds(m);
      if (!(mHi >= qLo && mLo <= qHi)) return false;
      if (!inShape(m, queryShape)) return false;
      if (adv.cats.length && !adv.cats.includes(m.cat)) return false;
      if (adv.content.length && !adv.content.includes(memoryMedia(m))) return false;
      if (adv.langs.length && !adv.langs.includes(memoryLang(m))) return false;
      if (adv.status === "verified" && !isVerified(m)) return false;
      if (adv.status === "unverified" && isVerified(m)) return false;
      if (!compiled.test(searchHaystack(m))) return false;
      if (adv.topics && adv.topics.length && !(m.topics && m.topics.some((t) => adv.topics.includes(t.slug)))) return false;
      return true;
    });
  }, [scopeMemories, lo, hi, adv, queryShape, compiled]);
  const visible = results;
  const mapMemories = visible;

  const resetResearch = () => {
    onRangeReset();
    setAdv({ precision: "year", fM: null, fD: null, tM: null, tD: null, query: "", cats: [], langs: [], content: [], status: "all", topics: [] });
    setQueryMode(null); setQueryShape(null);
  };
  const onRangeReset = () => setRange([MIN_YEAR, MAX_YEAR]);
  // leaving Research Mode tears down any spatial draft AND committed query shape
  const closeResearch = () => { setResearch(false); setQueryMode(null); setQueryShape(null); };

  // Escape cancels an in-progress spatial draw (without committing a shape)
  React.useEffect(() => {
    if (!queryMode) return;
    const onKey = (e) => { if (e.key === "Escape") setQueryMode(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queryMode]);

  // memory-peaks histogram — counts per year, drives the spikes on the axis
  const peaks = React.useMemo(() => {
    const counts = {};
    scopeMemories.forEach((m) => { const y = m.year || 2026; counts[y] = (counts[y] || 0) + 1; });
    return Object.keys(counts).map((y) => ({ year: +y, count: counts[y] })).sort((a, b) => a.year - b.year);
  }, [scopeMemories]);

  const nearby = React.useMemo(() => {
    if (!placePoint) return [];
    return scopeMemories.filter((m) => !m.mine)
      .map((m) => ({ m, d: dist(placePoint, m) })).sort((a, b) => a.d - b.d)
      .slice(0, 3).map((x) => x.m);
  }, [placePoint, scopeMemories]);

  const pickCity = (k) => { setCity(k); setCityOpen(false); setSelected(null); setComposing(false); setPlacePoint(null); setQueryShape(null); setQueryMode(null); if (k === "all") setListView(false); };
  const openCompose = () => { if (city === "all") setCity("hanoi"); setSelected(null); setAboutOpen(false); setLayersOpen(false); setComposing(true); setPlacePoint(null); };
  // Map clicks only set a location while actively composing (entered via the +
  // button). A click on the map never opens the form on its own.
  const mapClick = (p) => { if (city === "all" || !composing) return; setSelected(null); setAboutOpen(false); setLayersOpen(false); setPlacePoint(p); };
  const closeCompose = () => { setComposing(false); setPlacePoint(null); };
  const submit = (mem) => {
    setMemories((prev) => [...prev, mem]); // optimistic UI update
    fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mem),
    }).catch(() => {}); // silent — memory stays visible locally regardless
  };
  const openMemory = (m) => { setComposing(false); setPlacePoint(null); wanderHist.current = []; setSelected(m); };

  const wanderNext = () => setSelected((cur) => {
    if (!cur) return cur;
    const others = memories.filter((x) => x.id !== cur.id);
    const near = others.sort((a, b) => dist(cur, a) - dist(cur, b)).slice(0, 6);
    const pick = near[Math.floor(Math.random() * Math.min(4, near.length))] || others[0];
    if (pick && wanderHist.current.length < 100) wanderHist.current.push(cur);
    return pick || cur;
  });
  const wanderPrev = () => { const p = wanderHist.current.pop(); if (p) setSelected(p); else wanderNext(); };

  const appStyle = { "--quote-font": QUOTE_FONTS[t.typeVoice] || QUOTE_FONTS.serif, "--ember": accent };

  return (
    <div className="app" style={appStyle}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◈</span>
          <div className="brand-text">
            <div className="brand-name">{S.siteName}</div>
            <div className="brand-tag">{S.tagline}</div>
          </div>
        </div>
        <div className="topbar-right">
          <span className="voices"><b>{scopeMemories.length}</b> {S.voices}</span>
          {city !== "all" && (
            <button
              className={"pill-btn icon-btn" + (listView ? " active" : "")}
              onClick={() => setListView((v) => !v)}
              title={listView ? (lang === "vi" ? "Xem bản đồ" : "Map view") : (lang === "vi" ? "Xem danh sách" : "List view")}
              aria-label={listView ? "Map view" : "List view"}>
              {listView ? (
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1.5 7.5 C3.5 3, 11.5 3, 13.5 7.5 C11.5 12, 3.5 12, 1.5 7.5Z" />
                  <circle cx="7.5" cy="7.5" r="2" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="2" y1="4" x2="13" y2="4" />
                  <line x1="2" y1="7.5" x2="13" y2="7.5" />
                  <line x1="2" y1="11" x2="13" y2="11" />
                </svg>
              )}
            </button>
          )}
          <button className={"pill-btn icon-btn " + (research ? "active" : "")}
            onClick={() => { setLayersOpen(false); if (research) closeResearch(); else setResearch(true); }}
            title={S.research} aria-label={S.research}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="6.5" cy="6.5" r="4"/>
              <line x1="9.7" y1="9.7" x2="13" y2="13"/>
            </svg>
          </button>
          <button className={"pill-btn icon-btn " + (layersOpen ? "active" : "")}
            onClick={() => setLayersOpen((v) => !v)}
            title={lang === "vi" ? "Lớp bản đồ" : "Map layers"} aria-label={lang === "vi" ? "Lớp bản đồ" : "Map layers"}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1.5,5.5 7.5,2 13.5,5.5 7.5,9"/>
              <polyline points="1.5,9 7.5,12.5 13.5,9"/>
            </svg>
          </button>
          <button className={"pill-btn icon-btn " + (materialsOpen ? "active" : "")}
            onClick={() => { setLayersOpen(false); setMaterialsOpen((v) => !v); }}
            title={lang === "vi" ? "Tư liệu lưu trữ" : "Materials"} aria-label={lang === "vi" ? "Tư liệu lưu trữ" : "Materials"}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.8" y="2.2" width="11.4" height="3.2" rx="1" />
              <path d="M2.8 5.4 h9.4 v6 a1 1 0 0 1-1 1 h-7.4 a1 1 0 0 1-1-1 z" />
              <line x1="6" y1="8" x2="9" y2="8" />
            </svg>
          </button>
          <button className={"pill-btn icon-btn ghost " + (adminOpen ? "active" : "")}
            onClick={() => { setLayersOpen(false); setAdminOpen((v) => !v); }}
            title={lang === "vi" ? "Quản trị lưu trữ" : "Archive admin"} aria-label={lang === "vi" ? "Quản trị lưu trữ" : "Archive admin"}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7.5 1.5l2 4 4.4.6-3.2 3.1.75 4.3-3.95-2.1-3.95 2.1.75-4.3-3.2-3.1 4.4-.6z" />
            </svg>
          </button>
          <button className="pill-btn" onClick={() => setLang(lang === "vi" ? "en" : "vi")}>{S.langLabel}</button>
          <button className="pill-btn icon-btn ghost"
            onClick={() => { setSelected(null); setComposing(false); setPlacePoint(null); setLayersOpen(false); setAboutOpen(true); }}
            title={S.menu} aria-label={S.menu}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="7.5" cy="7.5" r="5.5"/>
              <line x1="7.5" y1="5" x2="7.5" y2="5.1" strokeWidth="2.2"/>
              <line x1="7.5" y1="7.5" x2="7.5" y2="10.5"/>
            </svg>
          </button>
        </div>
        {layersOpen && (
          <LayerControl lang={lang} basemap={basemap} theme={theme}
            onPick={(k) => setBasemap(k)} onTheme={() => setTheme(theme === "light" ? "dark" : "light")}
            onClose={() => setLayersOpen(false)} />
        )}
      </header>

      <button className={"city-switch" + (cityOpen ? " open" : "")}
        onClick={() => { setCityOpen((v) => !v); setLayersOpen(false); }} aria-haspopup="menu">
        <span className="city-pin"></span>
        <span className="city-switch-text">
          <small>{S.viewing}</small>
          <b>{city === "all" ? S.nation : cityObj[lang]}</b>
        </span>
        <span className="city-caret">▾</span>
      </button>
      {cityOpen && (
        <CitySwitcher lang={lang} city={city} counts={cityCounts} onPick={pickCity}
          onClose={() => setCityOpen(false)} />
      )}

      <MapView
        memories={city === "all" ? [] : mapMemories} placing={placePoint} onPlace={mapClick} onSelect={openMemory}
        selectedId={selected && selected.id} placingMode={composing && !placePoint}
        focus={selected ? { lat: selected.lat, lng: selected.lng, id: selected.id } : null}
        basemap={basemap} accent={accent}
        accumulation={t.accumulation} lang={lang}
        queryMode={queryMode} queryShape={queryShape}
        onShape={(s) => { setQueryShape(s); setQueryMode(null); }}
        onDraftChange={setDraftCount} drawApiRef={drawApiRef}
        cityObj={cityObj} overview={overview} onPickCity={pickCity} />

      {listView && city !== "all" && (
        <div className="list-overlay">
          <FeedView
            items={feedItems} lang={lang} loading={feedLoading}
            onOpenMemory={openMemory}
            onOpenCase={(id) => setOpenCaseId(id)} />
        </div>
      )}

      {city === "all" && (
        <div className="nation-hint"><span className="nation-dot"></span>{S.nationHint}</div>
      )}

      {composing && !placePoint && (
        <div className="place-banner">
          <span className="place-banner-n">①</span>
          <span>{S.placePrompt}</span>
          <button className="place-banner-x" onClick={closeCompose} aria-label={S.close}>✕</button>
        </div>
      )}

      {city !== "all" && (
        <button className="cta" onClick={openCompose}>
          <span className="cta-plus">＋</span>
          <span className="cta-text"><b>{S.addMemory}</b><small>{S.tapToPlace}</small></span>
        </button>
      )}

      {!research && city !== "all" && (
        <Timeline lang={lang} range={range} count={visible.length} peaks={peaks}
          onChange={setRange} />
      )}

      {research && (
        <AdvancedSearch
          lang={lang} accent={accent} range={range} onRange={setRange}
          adv={adv} setAdv={setAdv} total={scopeMemories.length} resultCount={results.length}
          compiled={compiled}
          queryMode={queryMode} setQueryMode={setQueryMode}
          queryShape={queryShape} setQueryShape={setQueryShape}
          draftCount={draftCount} drawApiRef={drawApiRef}
          onExport={() => setExportOpen(true)} onClose={closeResearch}
          onResetAll={resetResearch}
          allTopics={allTopics} />
      )}

      {exportOpen && (
        <ExportModal lang={lang} results={results} range={range} adv={adv} shape={queryShape}
          onClose={() => setExportOpen(false)} />
      )}

      {composing && (
        <ComposeSheet point={placePoint} lang={lang} accent={accent} gold="var(--gold)" city={cityObj}
          onSubmit={submit} onClose={closeCompose} nearby={nearby} onOpenMemory={openMemory} />
      )}
      {selected && (
        <MemoryDetail memory={selected} lang={lang}
          onClose={() => setSelected(null)} onPrev={wanderPrev} onNext={wanderNext}
          onOpenCase={(id) => setOpenCaseId(id)} />
      )}
      {caseProfile && (
        <CaseProfile
          caseData={caseProfile.caseData}
          memories={caseProfile.memories}
          lang={lang}
          onClose={() => { setOpenCaseId(null); setCaseProfile(null); }}
          onSelectMemory={(m) => { setOpenCaseId(null); setCaseProfile(null); setSelected(m); }} />
      )}
      {aboutOpen && <AboutPanel lang={lang} onClose={() => setAboutOpen(false)} />}
      {adminOpen && <ArchiveAdmin lang={lang} onClose={() => setAdminOpen(false)} />}
      {materialsOpen && (
        <MaterialsPanel lang={lang} onClose={() => setMaterialsOpen(false)}
          onOpenCase={(id) => { setMaterialsOpen(false); setOpenCaseId(id); }} />
      )}

      <TweaksPanel>
        <TweakSection label={lang === "vi" ? "Tiếng nói" : "Voice"} />
        <TweakRadio label={lang === "vi" ? "Kiểu chữ lời chứng" : "Testimony type"} value={t.typeVoice}
          options={["serif", "sans", "mono"]} onChange={(v) => setTweak("typeVoice", v)} />
        <TweakColor label={lang === "vi" ? "Màu ký ức" : "Ember"} value={t.accent}
          options={["#d8552f", "#e0902a", "#b0432a", "#c84b78"]} onChange={(v) => setTweak("accent", v)} />
        <TweakSection label={lang === "vi" ? "Bản đồ" : "Map"} />
        <TweakRadio label={lang === "vi" ? "Tụ ký ức" : "Accumulation"} value={t.accumulation}
          options={["off", "subtle", "bold"]} onChange={(v) => setTweak("accumulation", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
