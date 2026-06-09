/* ============================================================================
   map.jsx — Leaflet-based interactive slippy map
   MapView: wraps the Leaflet instance, manages markers, basemap, selection,
   placement pulse, spatial drawing, clearance overlay.
   ============================================================================ */

function MapView({
  lang, basemap, city, memories, selected, composing, placePoint, onPlace,
  queryShape, onShapeUpdate, queryMode, zone, accent, overview, cityCounts,
  onCityDrillDown, onSelectMemory, drawApiRef,
}) {
  const mapRef = React.useRef(null);
  const leafRef = React.useRef(null);
  const markersRef = React.useRef({});
  const tileRef = React.useRef(null);
  const zoneLayerRef = React.useRef(null);
  const pulsePinRef = React.useRef(null);
  const shapeLayerRef = React.useRef(null);
  const bubbleLayersRef = React.useRef([]);
  const drawStateRef = React.useRef({ active: false, type: null, startLatLng: null, circle: null, polygon: null, pts: [] });

  // ----- initialise map once -----
  React.useEffect(() => {
    if (!mapRef.current || leafRef.current) return;
    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
    });
    map.setView(HANOI_CENTER, 13);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    map.on("click", (e) => {
      if (!composingRef.current) return;
      if (window.__drawing) return;
      onPlaceRef.current && onPlaceRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    leafRef.current = map;
    return () => { map.remove(); leafRef.current = null; };
  }, []);

  // Use refs to keep event closures current without reinstalling handlers
  const composingRef = React.useRef(composing);
  const onPlaceRef = React.useRef(onPlace);
  React.useEffect(() => { composingRef.current = composing; }, [composing]);
  React.useEffect(() => { onPlaceRef.current = onPlace; }, [onPlace]);

  // ----- basemap swap -----
  React.useEffect(() => {
    const map = leafRef.current; if (!map) return;
    if (tileRef.current) { map.removeLayer(tileRef.current); tileRef.current = null; }
    const bm = BASEMAP[basemap] || BASEMAP.streets;
    const layer = L.tileLayer(bm.url, {
      attribution: bm.attr,
      subdomains: bm.sub || "",
      maxZoom: bm.maxZoom || 19,
      crossOrigin: true,
    });
    layer.addTo(map);
    layer.bringToBack();
    tileRef.current = layer;
  }, [basemap]);

  // ----- clearance zone -----
  React.useEffect(() => {
    const map = leafRef.current; if (!map) return;
    if (zoneLayerRef.current) { map.removeLayer(zoneLayerRef.current); zoneLayerRef.current = null; }
    if (!zone || !zone.length) return;
    const poly = L.polygon(zone, {
      color: accent || "#d8552f",
      weight: 2,
      opacity: 0.8,
      dashArray: "8 5",
      fillColor: accent || "#d8552f",
      fillOpacity: 0.07,
    });
    poly.addTo(map);
    zoneLayerRef.current = poly;
  }, [zone, accent]);

  // ----- auto-fit bounds -----
  React.useEffect(() => {
    const map = leafRef.current; if (!map) return;
    if (overview) {
      map.fitBounds(VIETNAM_BOUNDS, { padding: [30, 30] });
      return;
    }
    if (city && city.bounds) {
      map.fitBounds(city.bounds, { padding: [40, 40] });
    }
  }, [city, overview]);

  // ----- aggregate bubbles (national overview) -----
  React.useEffect(() => {
    const map = leafRef.current; if (!map) return;
    bubbleLayersRef.current.forEach((l) => map.removeLayer(l));
    bubbleLayersRef.current = [];
    if (!overview) return;
    CITIES.forEach((c) => {
      const count = (cityCounts && cityCounts[c.key]) || 0;
      const r = Math.max(20, Math.min(60, 14 + Math.sqrt(count) * 4));
      const html = `<div class="city-bubble" style="width:${r * 2}px;height:${r * 2}px;line-height:${r * 2}px;border-radius:50%;">
        <span class="cb-city">${c[lang]}</span><span class="cb-count">${count}</span>
      </div>`;
      const icon = L.divIcon({ className: "", html, iconSize: [r * 2, r * 2], iconAnchor: [r, r] });
      const m = L.marker(c.center, { icon, interactive: true });
      m.on("click", () => { if (onCityDrillDown) onCityDrillDown(c.key); });
      m.addTo(map);
      bubbleLayersRef.current.push(m);
    });
  }, [overview, cityCounts, lang]);

  // ----- memory markers -----
  React.useEffect(() => {
    const map = leafRef.current; if (!map) return;
    if (overview) {
      Object.values(markersRef.current).forEach((mk) => map.removeLayer(mk));
      markersRef.current = {};
      return;
    }

    const existing = new Set(Object.keys(markersRef.current));
    const toShow = new Set(memories.map((m) => m.id));

    // remove stale
    existing.forEach((id) => {
      if (!toShow.has(id)) { map.removeLayer(markersRef.current[id]); delete markersRef.current[id]; }
    });

    // add / update
    memories.forEach((m) => {
      const isSel = selected && selected.id === m.id;
      const c = catOf(m.cat);
      const hasPhoto = m.photo || m.photoData;
      const html = `<div class="ember-dot${hasPhoto ? " ember-ring" : ""}${isSel ? " sel" : ""}" style="background:${c.color};${isSel ? `box-shadow:0 0 0 4px ${c.color}55` : ""}"></div>`;
      const icon = L.divIcon({ className: "", html, iconSize: [14, 14], iconAnchor: [7, 7] });

      if (markersRef.current[m.id]) {
        markersRef.current[m.id].setIcon(icon);
      } else {
        const mk = L.marker([m.lat, m.lng], { icon });
        mk.on("click", (e) => { L.DomEvent.stopPropagation(e); onSelectMemory && onSelectMemory(m); });
        mk.addTo(map);
        markersRef.current[m.id] = mk;
      }
    });
  }, [memories, selected, overview]);

  // ----- placement pulse pin -----
  React.useEffect(() => {
    const map = leafRef.current; if (!map) return;
    if (pulsePinRef.current) { map.removeLayer(pulsePinRef.current); pulsePinRef.current = null; }
    if (!placePoint) return;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="24" height="36">
      <path class="place-pin-body" d="M12 0C6.48 0 2 4.48 2 10c0 8.33 10 22 10 22s10-13.67 10-22C22 4.48 17.52 0 12 0z" fill="#f0a721"/>
      <circle cx="12" cy="10" r="4" fill="#fff" opacity="0.85"/>
    </svg>`;
    const icon = L.divIcon({ className: "place-pin-wrap", html: `<div class="place-pin-pulse">${svg}</div>`, iconSize: [24, 36], iconAnchor: [12, 36] });
    pulsePinRef.current = L.marker([placePoint.lat, placePoint.lng], { icon, interactive: false });
    pulsePinRef.current.addTo(map);
  }, [placePoint]);

  // ----- spatial query shape -----
  React.useEffect(() => {
    const map = leafRef.current; if (!map) return;
    if (shapeLayerRef.current) { map.removeLayer(shapeLayerRef.current); shapeLayerRef.current = null; }
    if (!queryShape) return;
    const style = { color: accent || "#d8552f", weight: 2, dashArray: "6 4", fillOpacity: 0.06, fillColor: accent || "#d8552f" };
    let layer;
    if (queryShape.type === "circle") {
      layer = L.circle(queryShape.center, { ...style, radius: queryShape.radius });
    } else if (queryShape.type === "polygon" && queryShape.latlngs && queryShape.latlngs.length >= 3) {
      layer = L.polygon(queryShape.latlngs, style);
    }
    if (layer) { layer.addTo(map); shapeLayerRef.current = layer; }
  }, [queryShape, accent]);

  // ----- drawing API exposed via ref -----
  React.useEffect(() => {
    if (!drawApiRef) return;
    const map = leafRef.current; if (!map) return;
    const ds = drawStateRef.current;

    const startCircle = () => {
      window.__drawing = true;
      ds.active = true; ds.type = "circle";
      map.getContainer().classList.add("drawing-circle", "drawing");
      let startLL = null, circLayer = null;
      const onDown = (e) => {
        startLL = e.latlng;
        if (circLayer) { map.removeLayer(circLayer); circLayer = null; }
      };
      const onMove = (e) => {
        if (!startLL) return;
        const r = haversineM(startLL.lat, startLL.lng, e.latlng.lat, e.latlng.lng);
        if (circLayer) map.removeLayer(circLayer);
        circLayer = L.circle(startLL, { radius: r, color: "#f0a721", weight: 2, dashArray: "5 4", fillOpacity: 0.08 });
        circLayer.addTo(map);
        if (onShapeUpdate) onShapeUpdate({ type: "circle", center: [startLL.lat, startLL.lng], radius: r });
      };
      const onUp = () => {
        map.off("mousedown", onDown);
        map.off("mousemove", onMove);
        map.off("mouseup", onUp);
        map.getContainer().classList.remove("drawing-circle", "drawing");
        window.__drawing = false; ds.active = false;
      };
      map.on("mousedown", onDown);
      map.on("mousemove", onMove);
      map.on("mouseup", onUp);
    };

    const startPolygon = () => {
      window.__drawing = true;
      ds.active = true; ds.type = "polygon"; ds.pts = [];
      map.getContainer().classList.add("drawing-polygon", "drawing");
      let polyLayer = null;
      const pts = [];
      const addPt = (e) => {
        if (pts.length > 0 && haversineM(pts[0][0], pts[0][1], e.latlng.lat, e.latlng.lng) < 20 && pts.length >= 3) {
          finish(); return;
        }
        pts.push([e.latlng.lat, e.latlng.lng]);
        if (polyLayer) map.removeLayer(polyLayer);
        if (pts.length >= 2) {
          polyLayer = L.polyline(pts, { color: "#f0a721", weight: 2, dashArray: "5 4" }).addTo(map);
        }
        if (onShapeUpdate) onShapeUpdate({ type: "polygon", latlngs: [...pts] });
      };
      const finish = () => {
        map.off("click", addPt);
        map.off("dblclick", finish);
        map.getContainer().classList.remove("drawing-polygon", "drawing");
        if (polyLayer) map.removeLayer(polyLayer);
        window.__drawing = false; ds.active = false;
        if (pts.length >= 3 && onShapeUpdate) onShapeUpdate({ type: "polygon", latlngs: pts, closed: true });
      };
      map.on("click", addPt);
      map.on("dblclick", finish);
    };

    const cancelDraw = () => {
      map.getContainer().classList.remove("drawing-circle", "drawing-polygon");
      window.__drawing = false; ds.active = false;
    };

    drawApiRef.current = { startCircle, startPolygon, cancelDraw };
  }, [drawApiRef, onShapeUpdate]);

  // ----- map cursor class -----
  React.useEffect(() => {
    const el = mapRef.current; if (!el) return;
    if (composing && !placePoint) el.classList.add("placing-mode");
    else el.classList.remove("placing-mode");
  }, [composing, placePoint]);

  // ----- pan to selected memory -----
  React.useEffect(() => {
    const map = leafRef.current; if (!map || !selected) return;
    const targetLng = selected.lng + 0.01;
    map.panTo([selected.lat, targetLng], { animate: true, duration: 0.5 });
  }, [selected]);

  return (
    <div className="map-wrap">
      <div ref={mapRef} id="map" className="leaflet-map" />
    </div>
  );
}

window.MapView = MapView;
