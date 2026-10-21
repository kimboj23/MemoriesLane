// Admin health (health.py): how captures go per platform (block rate), the scheduled canary, and the warning
// badge on the Admin link. Read only; nothing here changes captures.
import { api, el, fmtDate, infoButton, sec, t, verdictChip } from "./core.js";

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

  const latest = canary.latest || [];
  const canaryCard = el("section", { class: "card stack" },
    sec([t("canaryTitle"), infoButton(t("canaryTitle"), el("p", {}, t("canaryHelp")))]),
    !canary.links ? el("p", { class: "muted" }, t("canaryNone"))
      : el("p", { class: "meta" }, t("canaryMeta")(canary.links, canary.interval_h,
          canary.runs[0] ? fmtDate(canary.runs[0].run_at) : "—", canary.next_run ? fmtDate(canary.next_run) : "—")),
    latest.length ? el("div", { class: "table-wrap" }, el("table", { class: "inc-table" },
      el("thead", {}, el("tr", {}, [t("canaryLink"), t("platform"), t("canaryExpected"), t("canaryGot"), ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, latest.map((r) => el("tr", { class: r.ok ? "" : "health-bad-row" },
        el("td", {}, r.note || "—"), el("td", {}, r.platform || "—"), el("td", {}, verdictChip(r.expected)),
        el("td", { title: (r.reasons || []).join("\n") }, verdictChip(r.verdict || "failed")),
        el("td", {}, r.ok ? "✓" : "⚠ " + t("canaryWorse"))))))) : "");
  return [statsCard, canaryCard];
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
