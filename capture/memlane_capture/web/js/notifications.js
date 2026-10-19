// Notifications (Atlos): newest first, unread dot, mark read/unread, mark all read, and the incidents you follow.
import { ago, api, el, mount, post, projectDot, statusChip, t, verdictChip } from "./core.js";

function describe(n) {
  if (n.kind === "comment") return t("feedComment");
  if (n.kind === "created") return t("feedCreated");
  if (n.kind === "material_added") return t("feedMaterialAdded");
  if (n.kind === "material_removed") return t("feedMaterialRemoved");
  if (n.kind === "capture") return t("feedCaptureVerb");
  if (n.kind === "publication") return t("feedPub")[n.action] || t("publication");
  if (n.kind === "intake") return t("feedIntake");
  const label = { description: t("description"), status: t("status"), sensitive: t("sensitivity"), tags: t("tags"),
                  event_date: t("date"), place: t("place"), lat: t("lat"), lng: t("lng"), geo_precision: t("precision"),
                  assignees: t("assignees"), custom: t("attributes"), deleted: "deleted" }[n.field] || n.field || "";
  return t("feedChanged")(label);
}

export async function notificationsPage(view, params) {
  const unreadOnly = params.get("unread") === "1";
  const list = el("ul", { class: "feed notif-list" });
  async function draw() {
    const { notifications } = await api(`/v1/notifications?limit=100${unreadOnly ? "&unread_only=true" : ""}`);
    mount(list, notifications.length ? notifications.map((n) => el("li", { class: "feed-item notif" + (n.read ? "" : " unread") },
      el("button", { type: "button", class: "dot-btn", "aria-label": n.read ? t("markUnread") : "read", title: n.read ? t("markUnread") : "",
        onclick: async () => { await post("/v1/notifications/read", { ids: [n.id], unread: n.read }); await draw(); window.dispatchEvent(new Event("mlc:notif")); } },
        el("span", { class: "unread-dot" })),
      el("div", { class: "feed-body" },
        el("div", {}, projectDot({ color: (n.incident || n.publication).color }), " ", el("strong", {}, n.actor || t("feedCapture")), " ", describe(n),
          " · ", el("a", { href: n.publication && (n.kind === "publication" || !n.incident) ? `#/publications/${n.publication.id}` : `#/incidents/${n.incident.id}`,
            onclick: () => post("/v1/notifications/read", { ids: [n.id] }).then(() => window.dispatchEvent(new Event("mlc:notif"))) },
            n.incident ? `${n.incident.slug} ${n.incident.description}` : `${n.publication.public_id} ${n.publication.summary}`),
          n.verdict ? [" ", verdictChip(n.verdict)] : ""),
        n.body && (n.kind === "comment" || n.reason === "review_requested") ? el("div", { class: "comment-text" }, n.body) : "",
        el("div", { class: "meta" }, ago(n.created_at), " · ", t("why")[n.reason] || n.reason)))) :
      el("p", { class: "muted center" }, t("noNotifications")));
  }
  const subs = el("div");
  const showSubs = async () => {
    const { incidents } = await api("/v1/me/subscriptions");
    mount(subs, el("div", { class: "card" }, el("h3", { class: "sec-head" }, t("subscriptions")),
      incidents.length ? el("ul", { class: "plain" }, incidents.map((i) => el("li", { class: "row" }, projectDot({ color: i.color }),
        el("a", { href: `#/incidents/${i.id}` }, `${i.slug} ${i.description}`), statusChip(i.status),
        el("button", { type: "button", class: "link small", onclick: async () => {
          await api(`/v1/incidents/${i.id}/subscription`, { method: "DELETE" }); await showSubs();
        } }, t("following"))))) : el("p", { class: "muted" }, t("empty"))));
  };
  mount(view, el("div", { class: "row" }, el("h1", {}, t("notifications")), el("span", { class: "spacer" }),
    el("a", { class: "btn", href: unreadOnly ? "#/notifications" : "#/notifications?unread=1", "aria-pressed": String(unreadOnly) }, t("unreadOnly")),
    el("button", { type: "button", onclick: async () => { await post("/v1/notifications/read", { all: true }); await draw(); window.dispatchEvent(new Event("mlc:notif")); } }, t("markAllRead"))),
    el("div", { class: "inc-grid" }, el("div", {}, list), el("aside", {}, subs)));
  await Promise.all([draw(), showSubs()]);
}
