// In-browser viewers for every artifact kind, and a full-screen viewer (lightbox).
//
// Artifact URLs are short-lived signed URLs, so <img>/<video>/<iframe> load them directly.
// The server sends every artifact with `CSP: sandbox; default-src 'none'`, and HTML is also
// embedded in <iframe sandbox>: captured pages never run scripts or fetch anything.
import { el, fmtBytes, t, toast } from "./core.js";

const label = (a) => t("labels")[a.label] || a.label;
const isJson = (a) => (a.mime || "").includes("json") || a.kind === "metadata" || a.kind === "manifest";
const isText = (a) => a.kind === "text" || (a.mime || "").startsWith("text/plain") || (a.mime || "").includes("subrip") || (a.mime || "").includes("vtt");
const isHtml = (a) => a.kind === "html" || (a.mime || "").startsWith("text/html");

async function fetchText(a, limit) {
  const res = await fetch(a.url);
  if (!res.ok) throw new Error(res.statusText);
  let txt = await res.text();
  if (isJson(a)) { try { txt = JSON.stringify(JSON.parse(txt), null, 2); } catch { /* show as is */ } }
  return limit && txt.length > limit ? txt.slice(0, limit) + "\n…" : txt;
}

function meta(a) {
  return [label(a), a.kind, fmtBytes(a.bytes), a.duration_s ? `${Math.round(a.duration_s)} s` : ""].filter(Boolean).join(" · ");
}

// Small preview card. Clicking opens the full viewer on this artifact, with prev/next across `all`.
export function artifactCard(a, all, { blur = false } = {}) {
  let preview;
  if (a.kind === "image" || a.kind === "screenshot") {
    preview = el("img", { src: a.url, alt: label(a), loading: "lazy", class: a.label === "full-page" ? "top" : null });
  } else if (a.kind === "video") {
    preview = el("div", { class: "vid" }, el("video", { src: a.url + "#t=0.5", preload: "metadata", muted: true }), el("span", { class: "play" }, "▶"));
  } else if (a.kind === "audio") {
    preview = el("div", { class: "textprev" }, "♪ " + label(a));
  } else if (isHtml(a)) {
    preview = el("div", { class: "htmlprev" },
      el("iframe", { src: a.url, sandbox: "", loading: "lazy", title: label(a), tabindex: "-1", referrerpolicy: "no-referrer" }));
  } else if (a.kind === "link") {
    let host = a.url;
    try { host = new URL(a.url).hostname; } catch { /* keep */ }
    preview = el("div", { class: "textprev link" }, "🌐 " + host);
  } else if (isText(a) || isJson(a)) {
    const pre = el("pre", { class: "textprev" }, t("loading"));
    fetchText(a, 1500).then((txt) => { pre.textContent = txt; }).catch(() => { pre.textContent = "✕"; });
    preview = pre;
  } else {
    preview = el("div", { class: "textprev" }, a.mime || a.kind);
  }
  const card = el("figure", {
    class: "art" + (blur ? " blurred" : ""), tabindex: "0", role: "button", "aria-label": label(a),
    onclick: (e) => {
      if (card.classList.contains("blurred")) { e.stopPropagation(); card.classList.remove("blurred"); return; }
      if (a.kind === "link") { window.open(a.url, "_blank", "noopener,noreferrer"); return; }
      openViewer(all, all.indexOf(a));
    },
    onkeydown: (e) => { if (e.key === "Enter") card.click(); },
  }, el("div", { class: "art-prev" }, preview, blur ? el("span", { class: "reveal" }, t("reveal")) : ""),
     el("figcaption", {}, meta(a)));
  return card;
}

export function artifactGrid(list, opts) {
  const viewable = list.filter(Boolean);
  return el("div", { class: "arts" }, viewable.map((a) => artifactCard(a, viewable, opts)));
}

// ---- full viewer -----------------------------------------------------------------
export function openViewer(list, index) {
  const items = list.filter((a) => a.kind !== "link");
  let i = Math.max(0, items.indexOf(list[index]));
  let actual = false;
  const body = el("div", { class: "lb-body" });
  const title = el("div", { class: "lb-title" });
  const tools = el("div", { class: "lb-tools" });

  const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); };
  const go = (d) => { if (items.length > 1) { i = (i + d + items.length) % items.length; actual = false; render(); } };
  const onKey = (e) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
  };

  function render() {
    const a = items[i];
    title.replaceChildren(el("strong", {}, label(a)),
      el("span", { class: "muted" }, ` · ${[a.kind, fmtBytes(a.bytes), a.duration_s ? `${Math.round(a.duration_s)} s` : ""].filter(Boolean).join(" · ")}`),
      a.sha256 ? el("code", { class: "lb-hash", title: "SHA-256" }, a.sha256) : "");
    const isImg = a.kind === "image" || a.kind === "screenshot";
    tools.replaceChildren(
      isImg ? el("button", { type: "button", onclick: () => { actual = !actual; render(); } }, actual ? t("fit") : t("actual")) : "",
      el("a", { class: "btn", href: a.url, target: "_blank", rel: "noopener noreferrer" }, t("openTab")),
      el("a", { class: "btn", href: a.url, download: `${a.label}-${(a.sha256 || "").slice(0, 12)}` }, t("download")),
      a.sha256 ? el("button", { type: "button", onclick: () => navigator.clipboard?.writeText(a.sha256).then(() => toast("SHA-256 ✓")) }, "SHA-256") : "",
      items.length > 1 ? el("span", { class: "muted" }, `${i + 1} / ${items.length}`) : "",
      el("button", { type: "button", class: "icon", "aria-label": t("close"), onclick: close }, "✕"));

    let content;
    if (isImg) {
      content = el("img", { src: a.url, alt: label(a), class: actual ? "actual" : "fit", onclick: () => { actual = !actual; render(); } });
    } else if (a.kind === "video") {
      content = el("video", { src: a.url, controls: true, autoplay: true, class: "fit" });
    } else if (a.kind === "audio") {
      content = el("audio", { src: a.url, controls: true, autoplay: true });
    } else if (isHtml(a)) {
      content = el("div", { class: "lb-html" }, el("p", { class: "muted small" }, t("htmlNote")),
        el("iframe", { src: a.url, sandbox: "", title: label(a), referrerpolicy: "no-referrer" }));
    } else if (isText(a) || isJson(a)) {
      const pre = el("pre", { class: "lb-text" }, t("loading"));
      fetchText(a).then((txt) => { pre.textContent = txt; }).catch((e) => { pre.textContent = e.message; });
      content = pre;
    } else {
      content = el("p", {}, a.mime || a.kind);
    }
    body.replaceChildren(content);
    body.classList.toggle("scroll", actual);
  }

  const wrap = el("div", { class: "lb", role: "dialog", "aria-modal": "true" },
    el("div", { class: "lb-head" }, title, tools),
    el("div", { class: "lb-main" },
      items.length > 1 ? el("button", { type: "button", class: "lb-nav", "aria-label": "previous", onclick: () => go(-1) }, t("prev")) : "",
      body,
      items.length > 1 ? el("button", { type: "button", class: "lb-nav", "aria-label": "next", onclick: () => go(1) }, t("next")) : ""));
  document.addEventListener("keydown", onKey);
  document.body.append(wrap);
  render();
}
