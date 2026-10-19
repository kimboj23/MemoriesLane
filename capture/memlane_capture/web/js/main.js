// Boot, connect (personal token), navigation, notification bell and the hash router.
import { $, api, el, isAdmin, localSet, modal, state, t } from "./core.js";
import { inboxPage, saveSheet } from "./inbox.js";
import { incidentPage, incidentsPage, newIncidentPage } from "./incidents.js";
import { intakeDetailPage, intakeRedirect } from "./intake.js";
import { itemPage } from "./item.js";
import { notificationsPage } from "./notifications.js";
import { adminPage, invitePage } from "./people.js";
import { projectManagePage, projectsPage } from "./projects.js";
import { publicationPage } from "./publish.js";

const ROUTES = [
  [/^#\/incidents\/([\w-]+)$/, (v, m) => incidentPage(v, m[1])],
  [/^#\/incidents$/, (v, m, q) => incidentsPage(v, q)],
  [/^#\/new$/, (v, m, q) => newIncidentPage(v, q)],
  [/^#\/items\/([\w-]+)$/, (v, m) => itemPage(v, m[1])],
  [/^#\/inbox$/, (v, m, q) => inboxPage(v, q)],
  [/^#\/projects\/([\w-]+)$/, (v, m, q) => projectManagePage(v, m[1], q)],
  [/^#\/projects$/, (v) => projectsPage(v)],
  [/^#\/notifications$/, (v, m, q) => notificationsPage(v, q)],
  [/^#\/admin$/, (v) => adminPage(v)],
  [/^#\/intake\/([\w-]+)$/, (v, m) => intakeDetailPage(v, m[1])],
  [/^#\/intake$/, (v, m, q) => intakeRedirect(q)],
  [/^#\/publications\/([\w-]+)$/, (v, m) => publicationPage(v, m[1])],
];
// An invite link must work for someone who has no account yet.
const INVITE = /^#\/invite\/([\w-]+)$/;

async function route() {
  const [path, query = ""] = (location.hash || "#/incidents").split("?");
  const invite = path.match(INVITE);
  if (!state.me && !invite) return;
  state.cleanups.splice(0).forEach((fn) => fn());
  document.querySelectorAll(".lb, .modal-wrap").forEach((n) => n.remove());
  const params = new URLSearchParams(query);
  for (const a of document.querySelectorAll("nav.main a")) a.setAttribute("aria-current", String(path.startsWith(a.getAttribute("href"))));
  const hit = invite ? [INVITE, (v, m) => invitePage(v, m[1], { connect })] : ROUTES.find(([re]) => re.test(path));
  if (!hit) { location.hash = "#/incidents"; return; }
  if (invite) $("connect").hidden = true;
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
  refreshBell();
}

let bellTimer = null;
async function refreshBell() {
  if (!state.me) return;
  try {
    const { unread } = await api("/v1/notifications/unread_count");
    $("bell-count").textContent = unread > 99 ? "99+" : String(unread);
    $("bell-count").hidden = !unread;
    $("bell").setAttribute("aria-label", `${t("notifications")}: ${unread}`);
  } catch { /* offline: keep the last count */ }
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
    el("a", { href: "#/projects" }, t("navProjects")),
    isAdmin() ? el("a", { href: "#/admin" }, t("admin")) : "");
  $("quick-save").textContent = "+ " + t("saveLink");
  $("quick-save").title = state.lang === "vi" ? "Lưu một liên kết vào kho (từ bất kỳ trang nào)" : "Save a link to the archive (from any page)";
  $("bell").title = t("notifications");
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
  for (const id of ["logout", "nav", "quick-save", "bell"]) $(id).hidden = false;
  renderShell();
  // A share target / bookmarklet entry (?url= or ?text=) goes straight to the save sheet.
  const q = new URLSearchParams(location.search);
  if ((q.get("url") || q.get("text")) && !location.hash) {
    location.hash = `#/inbox?${q.get("url") ? "url=" + encodeURIComponent(q.get("url")) : "text=" + encodeURIComponent(q.get("text"))}`;
    history.replaceState(null, "", location.pathname + location.hash);
  }
  clearInterval(bellTimer);
  bellTimer = setInterval(refreshBell, 30000);
  await route();
}

function logout() {
  localSet("token", null);
  state.token = null; state.me = null; state.projects = []; state.contributors = [];
  clearInterval(bellTimer);
  for (const id of ["logout", "nav", "quick-save", "bell"]) $(id).hidden = true;
  $("who").textContent = "";
  $("view").replaceChildren();
  if (INVITE.test(location.hash.split("?")[0])) { route(); return; }
  $("connect").hidden = false;
}

document.addEventListener("DOMContentLoaded", () => {
  renderShell();
  $("lang").onclick = () => { state.lang = state.lang === "vi" ? "en" : "vi"; localSet("lang", state.lang); renderShell(); route(); };
  $("logout").onclick = logout;
  $("quick-save").onclick = async () => modal(t("saveLink"), await saveSheet({ onSaved: () => window.dispatchEvent(new Event("mlc:saved")) }));
  $("connect-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("connect-error").hidden = true;
    try { await connect($("token").value.trim()); } catch (err) {
      $("connect-error").textContent = err.message; $("connect-error").hidden = false;
    }
  });
  window.addEventListener("hashchange", route);
  // Date fields open their calendar when clicked anywhere, not only on the small icon.
  document.addEventListener("click", (e) => {
    const d = e.target.closest?.('input[type="date"]');
    if (d && !d.disabled && !d.readOnly) { try { d.showPicker(); } catch { /* not supported: the icon still works */ } }
  });
  window.addEventListener("mlc:logout", logout);
  window.addEventListener("mlc:notif", refreshBell);
  if (state.token) connect(state.token).catch(logout); else logout();
});
