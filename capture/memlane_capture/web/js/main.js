// Boot, connect (personal token), navigation and the hash router.
import { $, api, el, localSet, modal, state, t } from "./core.js";
import { inboxPage, saveSheet } from "./inbox.js";
import { incidentPage, incidentsPage, newIncidentPage } from "./incidents.js";
import { itemPage } from "./item.js";
import { projectManagePage, projectsPage } from "./projects.js";

const ROUTES = [
  [/^#\/incidents\/([\w-]+)$/, (v, m) => incidentPage(v, m[1])],
  [/^#\/incidents$/, (v, m, q) => incidentsPage(v, q)],
  [/^#\/new$/, (v, m, q) => newIncidentPage(v, q)],
  [/^#\/items\/([\w-]+)$/, (v, m) => itemPage(v, m[1])],
  [/^#\/inbox$/, (v, m, q) => inboxPage(v, q)],
  [/^#\/projects\/([\w-]+)$/, (v, m) => projectManagePage(v, m[1])],
  [/^#\/projects$/, (v) => projectsPage(v)],
];

async function route() {
  if (!state.me) return;
  state.cleanups.splice(0).forEach((fn) => fn());
  document.querySelectorAll(".lb, .modal-wrap").forEach((n) => n.remove());
  const [path, query = ""] = (location.hash || "#/incidents").split("?");
  const params = new URLSearchParams(query);
  for (const a of document.querySelectorAll("nav.main a")) a.setAttribute("aria-current", String(path.startsWith(a.getAttribute("href"))));
  const hit = ROUTES.find(([re]) => re.test(path));
  if (!hit) { location.hash = "#/incidents"; return; }
  // Each navigation renders into its own container. A page that finishes loading after the user
  // has already moved on writes into a detached node instead of replacing the current page.
  const seq = ++state.routeSeq;
  const view = el("div", {}, el("p", { class: "muted" }, t("loading")));
  $("view").replaceChildren(view);
  try {
    await hit[1](view, path.match(hit[0]), params);
  } catch (e) {
    if (seq === state.routeSeq) view.replaceChildren(el("p", { class: "error" }, e.message));
  }
  if (seq === state.routeSeq) window.scrollTo(0, 0);
}

function renderShell() {
  document.documentElement.lang = state.lang;
  document.title = t("brand");
  $("brand").textContent = t("brand");
  $("lang").textContent = state.lang === "vi" ? "EN" : "VI";
  $("logout").textContent = t("logout");
  $("nav").replaceChildren(
    el("a", { href: "#/incidents" }, t("navIncidents")),
    el("a", { href: "#/inbox" }, t("navInbox")),
    el("a", { href: "#/projects" }, t("navProjects")));
  $("quick-save").textContent = "+ " + t("saveLink");
  $("connect-title").textContent = t("connectTitle");
  $("connect-help").textContent = t("connectHelp");
  $("connect-btn").textContent = t("connect");
}

async function connect(token) {
  state.token = token;
  try {
    state.me = await api("/v1/me");
  } catch (e) {
    state.token = null;
    throw e;
  }
  localSet("token", token);
  $("who").textContent = state.me.name;
  $("connect").hidden = true;
  for (const id of ["logout", "nav", "quick-save"]) $(id).hidden = false;
  // A share target / bookmarklet entry (?url= or ?text=) goes straight to the save sheet.
  const q = new URLSearchParams(location.search);
  if ((q.get("url") || q.get("text")) && !location.hash) {
    location.hash = `#/inbox?${q.get("url") ? "url=" + encodeURIComponent(q.get("url")) : "text=" + encodeURIComponent(q.get("text"))}`;
    history.replaceState(null, "", location.pathname + location.hash);
  }
  await route();
}

function logout() {
  localSet("token", null);
  state.token = null; state.me = null; state.projects = []; state.contributors = [];
  for (const id of ["logout", "nav", "quick-save"]) $(id).hidden = true;
  $("who").textContent = "";
  $("view").replaceChildren();
  $("connect").hidden = false;
}

document.addEventListener("DOMContentLoaded", () => {
  renderShell();
  $("lang").onclick = () => { state.lang = state.lang === "vi" ? "en" : "vi"; localSet("lang", state.lang); renderShell(); route(); };
  $("logout").onclick = logout;
  $("quick-save").onclick = async () => modal(t("saveLink"), await saveSheet({ onSaved: () => {} }));
  $("connect-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("connect-error").hidden = true;
    try { await connect($("token").value.trim()); } catch (err) {
      $("connect-error").textContent = err.message; $("connect-error").hidden = false;
    }
  });
  window.addEventListener("hashchange", route);
  window.addEventListener("mlc:logout", logout);
  if (state.token) connect(state.token).catch(logout); else logout();
});
