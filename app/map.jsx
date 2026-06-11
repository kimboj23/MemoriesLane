/* ============================================================================
   map.jsx — real OpenStreetMap slippy map (Leaflet).
   Selectable OSM-based basemaps, glowing memory-embers (category-coloured),
   the proposed clearance zone, click-to-place, and a placement pulse.
   Memories passed in are already time-filtered by the App.
   ============================================================================ */

function MapView({
  memories, placing, onPlace, onSelect, selectedId, focus = null, placingMode = false,
  basemap = "streets", accent = "#d8552f", accumulation = "subtle",
  showZone = true, lang = "vi",
  queryMode = null, queryShape = null, onShape = null, onDraftChange = null, drawApiRef = null,
  cityObj = null, zone = null, overview = null, onPickCity = null,
}) {
  const elRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const tileRef = React.useRef(null);
  const markersRef = React.useRef({});
  const placeRef = React.useRef(null);
  const zoneRef = React.useRef(null);
  const shapeRef = React.useRef(null);
  const aggRef = React.useRef([]);
  const firstFit = React.useRef(true);
  // keep latest callbacks without re-initialising the map
  const cb = React.useRef({});
  cb.current = { onPlace, onSelect, queryMode, onPickCity };

  // --- init once ---
  React.useEffect(() => {
    const map = L.map(elRef.current, {
      center: HANOI_CENTER, zoom: 14, minZoom: 5, maxZoom: 19,
      zoomControl: false, attributionControl: true,
    });
    map.attributionControl.setPrefix(false).setPosition("bottomleft");
    map.on("click", (e) => {
      if (cb.current.queryMode) return; // drawing a spatial query — ignore place clicks
      cb.current.onPlace({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 60);
    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); map.remove(); mapRef.current = null; };
  }, []);

  // --- basemap swap ---
  React.useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const b = BASEMAP[basemap] || BASEMAP.streets;
    if (tileRef.current) tileRef.current.remove();
    tileRef.current = L.tileLayer(b.url, {
      subdomains: b.sub, maxZoom: b.maxZoom || 19, attribution: b.attr, crossOrigin: true,
    }).addTo(map);
    tileRef.current.bringToBack();
  }, [basemap]);

  // --- clearance zone (per active city; only Hà Nội has one) ---
  React.useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (zoneRef.current) { zoneRef.current.remove(); zoneRef.current = null; }
    if (showZone && zone && zone.length) {
      zoneRef.current = L.polygon(zone, {
        color: accent, weight: 1.6, dashArray: "7 6", fillColor: accent, fillOpacity: 0.1,
        interactive: false, className: "zone-poly",
      }).addTo(map);
    }
  }, [accent, showZone, zone]);

  // --- auto-fit: national overview → Vietnam; city → its bounding box ---
  React.useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const animate = !firstFit.current; firstFit.current = false;
    if (overview) map.fitBounds(VIETNAM_BOUNDS, { padding: [36, 36], animate });
    else if (cityObj) map.fitBounds(cityObj.bounds, { padding: [28, 28], maxZoom: 15, animate });
  }, [cityObj && cityObj.key, !!overview]);

  // --- national aggregate bubbles (Level 1 overview, drill-down on click) ---
  React.useEffect(() => {
    const map = mapRef.current; if (!map) return;
    aggRef.current.forEach((m) => m.remove()); aggRef.current = [];
    if (!overview) return;
    overview.forEach((o) => {
      const size = Math.round(46 + Math.min(38, o.count * 1.6));
      const icon = L.divIcon({
        className: "agg-icon",
        html: `<div class="agg-bubble" style="width:${size}px;height:${size}px;--c:${accent}"><b>${o.count}</b><span>${o.name}</span></div>`,
        iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      });
      const mk = L.marker([o.lat, o.lng], { icon, riseOnHover: true }).addTo(map);
      mk.on("click", () => cb.current.onPickCity && cb.current.onPickCity(o.key));
      aggRef.current.push(mk);
    });
  }, [overview, accent]);

  // --- memory markers (rebuild on data / accumulation change) ---
  React.useEffect(() => {
    const map = mapRef.current; if (!map) return;
    Object.values(markersRef.current).forEach((m) => m.remove());
    markersRef.current = {};
    const glow = accumulation === "off" ? 0 : accumulation === "bold" ? 1 : 0.5;
    memories.forEach((m) => {
      const c = catOf(m.cat).color;
      const icon = L.divIcon({
        className: "ember-icon",
        html: `<span class="ember-dot${m.id === selectedId ? " sel" : ""}" style="--c:${c};--glow:${glow}"></span>${m.photo ? '<span class="ember-ring" style="--c:' + c + '"></span>' : ""}`,
        iconSize: [16, 16], iconAnchor: [8, 8],
      });
      const mk = L.marker([m.lat, m.lng], { icon, riseOnHover: true, keyboard: false }).addTo(map);
      mk.on("click", () => cb.current.onSelect(m));
      markersRef.current[m.id] = mk;
    });
  }, [memories, accumulation, accent]);

  // --- selection highlight without rebuild ---
  React.useEffect(() => {
    Object.entries(markersRef.current).forEach(([id, mk]) => {
      const el = mk.getElement && mk.getElement();
      if (!el) return;
      const dot = el.querySelector(".ember-dot");
      if (dot) dot.classList.toggle("sel", id === selectedId);
    });
  }, [selectedId, memories]);

  // --- placement pulse (panned to sit beside the compose dock) ---
  React.useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (placeRef.current) { placeRef.current.remove(); placeRef.current = null; }
    if (placing) {
      const icon = L.divIcon({ className: "place-icon", html: '<svg class="place-pin" width="32" height="42" viewBox="0 0 32 42"><path class="place-pin-body" d="M16 1 C8.3 1 2 7.3 2 15 C2 24 16 40 16 40 C16 40 30 24 30 15 C30 7.3 23.7 1 16 1 Z"/><circle class="place-pin-dot" cx="16" cy="15" r="5"/></svg>', iconSize: [32, 42], iconAnchor: [16, 40] });
      placeRef.current = L.marker([placing.lat, placing.lng], { icon, interactive: false, zIndexOffset: 1000 }).addTo(map);
      const narrow = window.innerWidth <= 760;
      const z = map.getZoom();
      const off = narrow
        ? L.point(0, Math.round(window.innerHeight * 0.20))
        : L.point(Math.round(Math.min(430, window.innerWidth * 0.34) / 2), 0);
      const center = map.unproject(map.project([placing.lat, placing.lng], z).add(off), z);
      map.setView(center, z, { animate: true });
    }
  }, [placing]);

  // --- persisted spatial query shape (circle / polygon) ---
  React.useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (shapeRef.current) { shapeRef.current.remove(); shapeRef.current = null; }
    if (queryShape) {
      const opts = { color: accent, weight: 1.8, dashArray: "6 5", fillColor: accent,
        fillOpacity: 0.08, interactive: false, className: "query-shape" };
      if (queryShape.type === "circle")
        shapeRef.current = L.circle(queryShape.center, { ...opts, radius: queryShape.radius }).addTo(map);
      else if (queryShape.type === "polygon" && queryShape.latlngs.length >= 3)
        shapeRef.current = L.polygon(queryShape.latlngs, opts).addTo(map);
    }
  }, [queryShape, accent]);

  // --- drawing interaction (circle drag / polygon clicks) ---
  React.useEffect(() => {
    const map = mapRef.current, el = elRef.current; if (!map) return;
    if (!queryMode) { el.classList.remove("drawing"); if (drawApiRef) drawApiRef.current = {}; return; }
    el.classList.add("drawing");
    const style = { color: accent, weight: 1.8, dashArray: "6 5", fillColor: accent, fillOpacity: 0.08 };

    if (queryMode === "circle") {
      map.dragging.disable();
      let center = null, circle = null, done = false;
      const down = (e) => { center = e.latlng; circle = L.circle(center, { ...style, radius: 1 }).addTo(map); };
      const move = (e) => { if (center && circle) circle.setRadius(Math.max(map.distance(center, e.latlng), 1)); };
      const up = (e) => {
        if (center) {
          const r = Math.max(map.distance(center, e.latlng), 25);
          done = true; onShape && onShape({ type: "circle", center: [center.lat, center.lng], radius: r });
        }
      };
      map.on("mousedown", down); map.on("mousemove", move); map.on("mouseup", up);
      if (drawApiRef) drawApiRef.current = { cancel: () => onShape && onShape(null) };
      return () => {
        map.off("mousedown", down); map.off("mousemove", move); map.off("mouseup", up);
        map.dragging.enable(); el.classList.remove("drawing");
        if (circle) circle.remove(); // always remove — committed shape is redrawn by the persisted-shape effect
      };
    }

    // polygon
    map.doubleClickZoom.disable();
    let pts = [], line = null, dots = [], done = false;
    const redraw = () => {
      if (line) line.remove();
      line = (pts.length >= 3 ? L.polygon(pts, style) : L.polyline(pts, style)).addTo(map);
      dots.forEach((d) => d.remove()); dots = pts.map((p, i) =>
        L.circleMarker(p, { radius: i === 0 ? 6 : 4, color: accent, weight: 2,
          fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(map));
      onDraftChange && onDraftChange(pts.length);
    };
    const finish = () => {
      if (pts.length >= 3) { done = true; onShape && onShape({ type: "polygon", latlngs: pts.map((p) => [p.lat, p.lng]) }); }
    };
    const click = (e) => {
      if (pts.length >= 3) {
        const first = map.latLngToContainerPoint(pts[0]);
        const here = map.latLngToContainerPoint(e.latlng);
        if (first.distanceTo(here) < 14) { finish(); return; } // click first vertex to close
      }
      pts.push(e.latlng); redraw();
    };
    const dbl = () => finish();
    map.on("click", click); map.on("dblclick", dbl);
    if (drawApiRef) drawApiRef.current = { finish, cancel: () => onShape && onShape(null), count: () => pts.length };
    return () => {
      map.off("click", click); map.off("dblclick", dbl);
      map.doubleClickZoom.enable(); el.classList.remove("drawing");
      if (line) line.remove(); dots.forEach((d) => d.remove()); // always remove — committed shape is redrawn by the persisted-shape effect
      onDraftChange && onDraftChange(0);
    };
  }, [queryMode, accent]);

  // --- crosshair cursor while waiting for a location pick ---
  React.useEffect(() => {
    const el = elRef.current; if (!el) return;
    el.classList.toggle("placing-mode", !!placingMode);
  }, [placingMode]);

  // --- focus the selected memory beside the reading dock (Airbnb-style) ---
  React.useEffect(() => {
    const map = mapRef.current; if (!map || !focus) return;
    const narrow = window.innerWidth <= 760;
    const z = Math.max(map.getZoom(), 15);
    const off = narrow
      ? L.point(0, Math.round(window.innerHeight * 0.20))
      : L.point(Math.round(Math.min(430, window.innerWidth * 0.34) / 2), 0);
    const center = map.unproject(map.project([focus.lat, focus.lng], z).add(off), z);
    map.setView(center, z, { animate: true });
  }, [focus && focus.id]);

  return (
    <div className="map-wrap">
      <div ref={elRef} className="leaflet-map"></div>
      <div className="map-zoom">
        <button onClick={() => mapRef.current && mapRef.current.zoomIn()} aria-label="Zoom in">+</button>
        <button onClick={() => mapRef.current && mapRef.current.zoomOut()} aria-label="Zoom out">–</button>
      </div>
    </div>
  );
}

window.MapView = MapView;
