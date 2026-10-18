// Maps (Leaflet 1.9.4, vendored under web/vendor/leaflet, BSD-2). Loaded only when a map is shown.
// Tiles come from the server-configured tile URL (/v1/config): every tile request reveals the viewed area
// to that tile server, so deployments can point it at a self-hosted one.
import { api, el, t } from "./core.js";

let loading = null;
let config = null;

export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      document.head.append(el("link", { rel: "stylesheet", href: "vendor/leaflet/leaflet.css" }));
      const s = el("script", { src: "vendor/leaflet/leaflet.js" });
      s.onload = () => resolve(window.L);
      s.onerror = () => reject(new Error("map library failed to load"));
      document.head.append(s);
    });
  }
  return loading;
}

const STATUS_COLOR = { to_do: "#16a34a", in_progress: "#9333ea", help_needed: "#ca8a04", ready_for_review: "#0891b2",
                       completed: "#2563eb", cancelled: "#78716c" };
const VIETNAM = [[16.0, 106.0], 5];

async function baseMap(node, opts = {}) {
  const L = await loadLeaflet();
  config = config || await api("/v1/config");
  const map = L.map(node, { scrollWheelZoom: opts.scrollWheelZoom ?? false, ...opts });
  L.tileLayer(config.tile_url, { maxZoom: 20, subdomains: config.tile_subdomains || "abc", detectRetina: false,
                                 attribution: config.tile_attribution, referrerPolicy: "strict-origin" }).addTo(map);
  return { L, map };
}

// The incidents map (Atlos "map" display): one dot per incident with a location, coloured by status.
export async function incidentsMap(node, incidents) {
  const { L, map } = await baseMap(node, { scrollWheelZoom: true });
  const pts = [];
  for (const inc of incidents) {
    if (inc.lat == null || inc.lng == null) continue;
    const ll = [inc.lat, inc.lng];
    pts.push(ll);
    const popup = el("div", { class: "map-pop" },
      el("a", { href: `#/incidents/${inc.id}` }, el("strong", {}, inc.slug), " · ", inc.description),
      el("div", { class: "meta" }, t("incStatus")[inc.status] || inc.status, inc.place ? " · " + inc.place : ""));
    // Precision (Atlos): exact ±10 m, vicinity ±100 m, locality ±1 km, drawn as a halo.
    const r = { exact: 10, vicinity: 100, locality: 1000 }[inc.geo_precision];
    if (r) L.circle(ll, { radius: r, color: STATUS_COLOR[inc.status], weight: 1, fillOpacity: 0.08 }).addTo(map);
    L.circleMarker(ll, { radius: 8, color: "#fff", weight: 2, fillColor: STATUS_COLOR[inc.status] || "#475569", fillOpacity: 0.95 })
      .bindPopup(popup).addTo(map);
  }
  if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
  else map.setView(...VIETNAM);
  return map;
}

// A small read-only map on the incident page.
export async function pointMap(node, inc) {
  const { L, map } = await baseMap(node, { zoomControl: false, attributionControl: true });
  const ll = [inc.lat, inc.lng];
  const r = { exact: 10, vicinity: 100, locality: 1000 }[inc.geo_precision];
  if (r) L.circle(ll, { radius: r, weight: 1, fillOpacity: 0.1 }).addTo(map);
  L.circleMarker(ll, { radius: 7, color: "#fff", weight: 2, fillColor: STATUS_COLOR[inc.status] || "#2563eb", fillOpacity: 1 }).addTo(map);
  map.setView(ll, { exact: 17, vicinity: 16, locality: 14 }[inc.geo_precision] || 15);
  return map;
}

// Click-to-place picker for the location editor. onPick(lat, lng).
export async function pickerMap(node, lat, lng, onPick) {
  const { L, map } = await baseMap(node, { scrollWheelZoom: true });
  let marker = null;
  const place = (ll) => {
    if (marker) marker.setLatLng(ll); else marker = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 }).addTo(map);
  };
  if (lat != null && lng != null) { place([lat, lng]); map.setView([lat, lng], 15); } else map.setView(...VIETNAM);
  map.on("click", (e) => {
    const la = Math.round(e.latlng.lat * 1e6) / 1e6, ln = Math.round(e.latlng.lng * 1e6) / 1e6;
    place([la, ln]);
    onPick(la, ln);
  });
  setTimeout(() => map.invalidateSize(), 50);   // drawn inside a modal that was just opened
  return { map, set: (la, ln) => { if (la != null && ln != null && !isNaN(la) && !isNaN(ln)) { place([la, ln]); map.setView([la, ln]); } } };
}
