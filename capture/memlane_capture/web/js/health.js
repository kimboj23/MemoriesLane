// Admin health (health.py): how captures go per platform (block rate), the scheduled canary, and the warning
// badge on the Admin link. Read only; nothing here changes captures.
import { api, el, fmtDate, infoButton, onLeave, post, sec, t, toast, verdictChip } from "./core.js";

const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);

export async function healthPanels() {
  let stats, canary;
  try {
    [stats, canary] = await Promise.all([api("/v1/admin/capture-stats?days=7"), api("/v1/admin/canary")]);
  } catch (e) {
    return el("section", { class: "card" }, sec(t("healthTitle")), el("p", { class: "error" }, e.message));
  }
  const days = [...new Set(stats.platforms.flatMap((p) => p.days.map((d) => d.day)))].sort().slice(-7);
  const cell = (p, day) => {
    const d = p.days.find((x) => x.day === day);
    if (!d) return el("td", { class: "num muted" }, "·");
    const share = pct(d.blocked, d.total);
    return el("td", { class: "num health-" + (share >= 50 ? "bad" : share >= 20 ? "warn" : "ok"),
      title: Object.entries(d.counts).map(([v, n]) => `${(t("status_")[v] || v)}: ${n}`).join("\n") },
      `${d.blocked}/${d.total}`);
  };
  const statsCard = el("section", { class: "card stack" },
    sec([t("healthTitle"), infoButton(t("healthTitle"), el("p", {}, t("healthHelp")))]),
    stats.platforms.length ? el("div", { class: "table-wrap" }, el("table", { class: "inc-table health-table" },
      el("thead", {}, el("tr", {}, el("th", {}, t("platform")), days.map((d) => el("th", { class: "num" }, d.slice(5))),
        el("th", { class: "num", title: t("waitingTip") }, t("healthWaiting")))),
      el("tbody", {}, stats.platforms.map((p) => el("tr", {}, el("td", {}, p.platform), days.map((d) => cell(p, d)),
        el("td", { class: "num" }, String(stats.waiting_rate_limited[p.platform] || 0)))))))
      : el("p", { class: "muted" }, t("empty")),
    el("p", { class: "meta" }, t("healthLegend")));

  const canaryBox = el("div");
  const draw = (c) => canaryBox.replaceChildren(canaryCard(c, draw));
  draw(canary);
  if (canary.request) watch(draw);
  return [statsCard, canaryBox];
}

// While a run is waiting or running, refresh every 5 s; stop when it is done or the page is left.
function watch(draw) {
  const id = setInterval(async () => {
    try {
      const c = await api("/v1/admin/canary");
      draw(c);
      if (!c.request) clearInterval(id);
    } catch { clearInterval(id); }
  }, 5000);
  onLeave(() => clearInterval(id));
}

function canaryCard(canary, draw) {
  const latest = canary.latest || [];
  const running = !!canary.request;
  const run = el("button", { type: "button", class: "primary", id: "canary-run", disabled: running || !canary.links,
    title: t("canaryRunTip")(canary.links, canary.proxied_links, canary.est_paid_mb),
    onclick: async () => {
      try { draw(await post("/v1/admin/canary/run")); watch(draw); } catch (err) { toast(err.message, true); }
    } }, running ? (canary.request.started_at ? t("canaryRunning") : t("canaryQueued")) : t("canaryRun"));
  return el("section", { class: "card stack" },
    sec([t("canaryTitle"), infoButton(t("canaryTitle"), el("p", {}, t("canaryHelp")))], canary.links ? run : ""),
    !canary.links ? el("p", { class: "muted" }, t("canaryNone"))
      : el("p", { class: "meta" }, t("canaryMeta")(canary.links, canary.interval_h,
          canary.runs[0] ? fmtDate(canary.runs[0].run_at) : "—", canary.next_run ? fmtDate(canary.next_run) : "—"),
          " · ", t("canaryCost")(canary.proxied_links, canary.est_paid_mb)),
    canary.last_request_error && !running ? el("p", { class: "error" }, canary.last_request_error) : "",
    latest.length ? el("div", { class: "table-wrap" }, el("table", { class: "inc-table" },
      el("thead", {}, el("tr", {}, [t("canaryLink"), t("platform"), t("canaryExpected"), t("canaryGot"), ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, latest.map((r) => el("tr", { class: r.ok ? "" : "health-bad-row" },
        el("td", {}, r.note || "—"), el("td", {}, r.platform || "—"), el("td", {}, verdictChip(r.expected)),
        el("td", { title: (r.reasons || []).join("\n") }, verdictChip(r.verdict || "failed")),
        el("td", {}, r.ok ? "✓" : "⚠ " + t("canaryWorse"))))))) : "");
}

// The Admin link shows ⚠ while there are alerts (a canary link worse than expected; a platform mostly blocked today).
export async function adminBadge(link) {
  if (!link) return;
  try {
    const { alerts } = await api("/v1/admin/health");
    if (alerts.length) {
      link.append(el("span", { class: "nav-alert", title: alerts.map((a) => a.kind === "canary"
        ? t("alertCanary")(a.platform, a.note) : t("alertBlocked")(a.platform, a.blocked, a.total)).join("\n") }, " ⚠"));
    }
  } catch { /* not an admin, or offline: no badge */ }
}
