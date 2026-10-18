// People: a project's Access panel (members, roles, invite links), the invite page, and the admin page.
import { ago, api, atLeast, copyText, el, fmtDate, isAdmin, loadContributors, mount, patch, post, sec, state, t, toast } from "./core.js";
import { sourcesPanel } from "./intake.js";
import { feedPanel } from "./publish.js";

const ROLES = ["data_only_viewer", "viewer", "editor", "manager", "owner"];
const INVITE_ROLES = ["data_only_viewer", "viewer", "editor", "manager"];
const roleOptions = (list, current) => list.map((r) => el("option", { value: r, selected: r === current }, t("roles")[r]));

export function inviteLink(code) { return `${location.origin}/app/#/invite/${code}`; }

// ---- project Access panel ------------------------------------------------------------------
export async function accessPanel(project) {
  const owner = atLeast(project.my_role, "owner");
  const manager = atLeast(project.my_role, "manager");
  const box = el("div", { class: "stack" });
  async function draw() {
    const { members } = await api(`/v1/projects/${project.id}/members`);
    const rows = members.map((m) => el("tr", {},
      el("td", {}, m.name, m.id === state.me.id ? el("span", { class: "muted" }, ` (${t("you")})`) : ""),
      el("td", {}, owner ? el("select", { "aria-label": t("roles")[m.role], onchange: async (e) => {
        try { await patch(`/v1/projects/${project.id}/members/${m.id}`, { role: e.target.value }); toast(t("saved")); }
        catch (err) { toast(err.message, true); e.target.value = m.role; }
      } }, roleOptions(ROLES, m.role)) : t("roles")[m.role]),
      el("td", {}, manager && atLeast(m.role, "editor") ? el("input", { type: "checkbox", checked: m.can_publish, "aria-label": t("publishGrant"),
        onchange: async (e) => {
          try { await api(`/v1/projects/${project.id}/members/${m.id}/publish`, { method: "PUT", body: JSON.stringify({ can_publish: e.target.checked }) }); toast(t("saved")); }
          catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
        } }) : (m.can_publish ? "✓" : "")),
      el("td", { class: "muted small" }, ago(m.since)),
      el("td", {}, owner || m.id === state.me.id ? el("button", { type: "button", class: "link danger", onclick: async () => {
        try { await api(`/v1/projects/${project.id}/members/${m.id}`, { method: "DELETE" }); await draw(); }
        catch (err) { toast(err.message, true); }
      } }, m.id === state.me.id ? t("leave") : t("remove")) : "")));
    const parts = [sec(t("members")), el("div", { class: "table-wrap" }, el("table", { class: "inc-table" },
      el("thead", {}, el("tr", {}, [t("name"), t("roleCol"), t("publishGrant"), t("since"), ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, rows))),
      el("p", { class: "meta" }, t("publishGrantHelp")),
      el("details", { class: "role-help" }, el("summary", {}, t("whatRoles")),
        el("dl", { class: "kv" }, ROLES.map((r) => [el("dt", {}, t("roles")[r]), el("dd", {}, t("roleHelp")[r])])))];
    if (owner) parts.push(await addMemberForm(project, members, draw), await invitesPanel(project));
    mount(box, parts);
  }
  await draw();
  return box;
}

async function addMemberForm(project, members, redraw) {
  let people = [];
  try { people = await loadContributors(); } catch { return ""; }
  const ids = new Set(members.map((m) => m.id));
  const who = el("select", {}, el("option", { value: "" }, t("choosePerson")),
    people.filter((p) => !ids.has(p.id)).map((p) => el("option", { value: p.id }, p.name)));
  const role = el("select", {}, roleOptions(ROLES, "viewer"));
  return el("form", { class: "card stack", onsubmit: async (e) => {
    e.preventDefault();
    if (!who.value) return;
    try { await post(`/v1/projects/${project.id}/members`, { contributor_id: who.value, role: role.value }); await redraw(); }
    catch (err) { toast(err.message, true); }
  } }, sec(t("addMember")), el("div", { class: "row two" }, who, role), el("button", { type: "submit" }, t("add")));
}

async function invitesPanel(project) {
  const list = el("div", { class: "stack" });
  const shown = el("div");
  async function drawList() {
    const { invites } = await api(`/v1/projects/${project.id}/invites`);
    mount(list, invites.length ? el("div", { class: "table-wrap" }, el("table", { class: "inc-table" },
      el("tbody", {}, invites.map((i) => el("tr", { class: i.active ? "" : "muted" },
        el("td", {}, t("roles")[i.role]), el("td", {}, i.note || ""), el("td", {}, t("uses")(i.uses, i.max_uses)),
        el("td", {}, i.expires_at ? `${t("expires")} ${fmtDate(i.expires_at, false)}` : ""),
        el("td", {}, i.revoked ? t("revoked") : !i.active ? t("expired") : el("button", { type: "button", class: "link danger",
          onclick: async () => { await api(`/v1/projects/${project.id}/invites/${i.id}`, { method: "DELETE" }); await drawList(); } }, t("revoke")))))))) : "");
  }
  const role = el("select", {}, roleOptions(INVITE_ROLES, "viewer"));
  const days = el("input", { type: "number", min: "1", max: "365", value: "14" });
  const uses = el("input", { type: "number", min: "1", max: "1000" });
  const note = el("input", { maxlength: "200" });
  const form = el("form", { class: "card stack", onsubmit: async (e) => {
    e.preventDefault();
    try {
      const inv = await post(`/v1/projects/${project.id}/invites`, { role: role.value, expires_in_days: Number(days.value) || null,
        max_uses: uses.value ? Number(uses.value) : null, note: note.value.trim() || null });
      const link = inviteLink(inv.code);
      mount(shown, el("div", { class: "notice invite-link" }, el("p", {}, t("inviteCreated")),
        el("code", { class: "linkbox" }, link), el("button", { type: "button", onclick: () => copyText(link) }, t("copy"))));
      await drawList();
    } catch (err) { toast(err.message, true); }
  } }, sec(t("newInvite")),
    el("label", {}, t("inviteRole"), role), el("div", { class: "row two" }, el("label", {}, t("expiresDays"), days),
      el("label", {}, t("maxUses"), uses)), el("label", {}, t("note"), note), el("button", { type: "submit" }, t("newInvite")));
  await drawList();
  return el("div", { class: "stack" }, sec(t("invites")), shown, form, list);
}

// ---- invite page (works signed out) ------------------------------------------------------------
export async function invitePage(view, code, { connect }) {
  let info;
  try { info = await fetch(`/v1/invites/${encodeURIComponent(code)}`).then((r) => (r.ok ? r.json() : Promise.reject())); }
  catch { mount(view, el("div", { class: "card narrow" }, el("h1", {}, t("inviteTitle")), el("p", { class: "error" }, t("inviteInvalid")))); return; }
  const head = [el("h1", {}, t("inviteTitle")), el("p", { class: "invite-proj", style: { borderColor: info.project.color } },
    t("invitedAs")(`${info.project.code} · ${info.project.name}`, t("roles")[info.role])), el("p", { class: "muted small" }, t("roleHelp")[info.role])];
  const accept = async (body, withToken) => {
    const res = await fetch(`/v1/invites/${encodeURIComponent(code)}/accept`, { method: "POST",
      headers: { "Content-Type": "application/json", ...(withToken ? { Authorization: "Bearer " + state.token } : {}) },
      body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : t("inviteInvalid"));
    return data;
  };
  if (state.me) {
    mount(view, el("div", { class: "card narrow stack" }, head, el("button", { type: "button", class: "primary", onclick: async () => {
      try { const r = await accept({}, true); location.hash = `#/incidents?project=${r.project_id}`; } catch (e) { toast(e.message, true); }
    } }, t("joinAs")(state.me.name))));
    return;
  }
  const name = el("input", { required: true, maxlength: "80", autocomplete: "nickname" });
  mount(view, el("form", { class: "card narrow stack", onsubmit: async (e) => {
    e.preventDefault();
    try {
      const r = await accept({ name: name.value.trim(), device: navigator.userAgent.includes("Mobile") ? "phone" : "browser" }, false);
      // Show the new personal token once, then sign in with it.
      mount(view, el("div", { class: "card narrow stack" }, el("h1", {}, t("inviteTitle")), el("p", {}, t("yourToken")),
        el("code", { class: "linkbox", id: "new-token" }, r.token), el("button", { type: "button", onclick: () => copyText(r.token) }, t("copy")),
        el("button", { type: "button", class: "primary", onclick: async () => {
          await connect(r.token); location.hash = `#/incidents?project=${r.project_id}`;
        } }, t("continueBtn"))));
    } catch (err) { toast(err.message, true); }
  } }, head, el("label", {}, t("yourName"), name), el("button", { type: "submit", class: "primary" }, t("joinNew"))));
}

// ---- admin page ----------------------------------------------------------------------------
export async function adminPage(view) {
  if (!isAdmin()) { mount(view, el("p", { class: "muted" }, "—")); return; }
  const out = el("div");
  async function draw() {
    const { contributors } = await api("/v1/admin/contributors");
    mount(out, el("div", { class: "table-wrap" }, el("table", { class: "inc-table" },
      el("thead", {}, el("tr", {}, [t("name"), t("globalRole"), t("projectsCol"), t("tokens"), t("lastSeen"), ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, contributors.map((c) => el("tr", { class: c.disabled ? "muted" : "" },
        el("td", {}, c.name, c.email ? el("div", { class: "meta" }, c.email) : ""),
        el("td", {}, el("select", { disabled: c.id === state.me.id, onchange: async (e) => {
          try { await patch(`/v1/admin/contributors/${c.id}`, { role: e.target.value }); toast(t("saved")); } catch (err) { toast(err.message, true); }
        } }, ["contributor", "reviewer", "editor", "admin"].map((r) => el("option", { value: r, selected: r === c.role }, t("globalRoles")[r])))),
        el("td", { class: "small" }, c.projects.map((p) => `${p.code} (${t("roles")[p.role]})`).join(", ")),
        el("td", { class: "num" }, String(c.tokens)),
        el("td", { class: "nowrap small" }, c.last_seen ? ago(c.last_seen) : "—"),
        el("td", { class: "row" },
          el("button", { type: "button", class: "link", onclick: async () => {
            const r = await post(`/v1/admin/contributors/${c.id}/token`);
            showToken(c.name, r.token);
          } }, t("newToken")),
          el("button", { type: "button", class: "link danger", onclick: async () => {
            if (!confirm(t("confirmRevoke"))) return;
            await post(`/v1/admin/contributors/${c.id}/revoke-tokens`); await draw();
          } }, t("revokeTokens")),
          c.id === state.me.id ? "" : el("button", { type: "button", class: "link", onclick: async () => {
            await patch(`/v1/admin/contributors/${c.id}`, { disabled: !c.disabled }); await draw();
          } }, c.disabled ? t("enable") : t("disable")))))))));
  }
  const tokenBox = el("div");
  const showToken = (name, token) => mount(tokenBox, el("div", { class: "notice" }, el("p", {}, t("tokenFor")(name)),
    el("code", { class: "linkbox" }, token), el("button", { type: "button", onclick: () => copyText(token) }, t("copy"))));
  const name = el("input", { required: true, maxlength: "80" });
  const email = el("input", { type: "email", maxlength: "200" });
  const role = el("select", {}, ["contributor", "reviewer", "editor", "admin"].map((r) => el("option", { value: r }, t("globalRoles")[r])));
  mount(view, el("h1", {}, t("admin") + " · " + t("people")), tokenBox,
    el("form", { class: "card stack", onsubmit: async (e) => {
      e.preventDefault();
      try {
        const r = await post("/v1/admin/contributors", { name: name.value.trim(), email: email.value.trim() || null, role: role.value });
        showToken(name.value.trim(), r.token); name.value = ""; email.value = ""; await draw();
      } catch (err) { toast(err.message, true); }
    } }, sec(t("newPerson")), el("div", { class: "row two" }, el("label", {}, t("name"), name), el("label", {}, t("email"), email)),
      el("label", {}, t("globalRole"), role), el("button", { type: "submit" }, t("add"))),
    out, await sourcesPanel(), await feedPanel());
  await draw();
}
