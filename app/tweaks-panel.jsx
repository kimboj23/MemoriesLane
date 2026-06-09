/* ============================================================================
   tweaks-panel.jsx — dev-only design-token playground.
   Floats over the UI when the parent iframe sends { type:"__activate_edit_mode" }.
   ============================================================================ */

function useTweaks(defaults) {
  const [vals, setVals] = React.useState(defaults);
  React.useEffect(() => {
    const handler = (e) => {
      if (e.data && e.data.type === "__edit_mode_set_keys") {
        setVals((prev) => ({ ...prev, ...e.data.payload }));
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);
  const set = React.useCallback((key, val) => {
    setVals((prev) => {
      const next = { ...prev, [key]: val };
      try { window.parent.postMessage({ type: "__edit_mode_set_keys", payload: { [key]: val } }, "*"); } catch (_) {}
      return next;
    });
  }, []);
  return [vals, set];
}

function TweakSection({ title, children }) {
  return (
    <div className="tweak-section">
      <div className="tweak-section-head">{title}</div>
      {children}
    </div>
  );
}

function TweakRow({ label, children }) {
  return (
    <div className="tweak-row">
      <span className="tweak-label">{label}</span>
      <div className="tweak-ctrl">{children}</div>
    </div>
  );
}

function TweakSlider({ value, min, max, step = 1, onChange }) {
  return (
    <input type="range" className="tweak-slider"
      min={min} max={max} step={step}
      value={value} onChange={(e) => onChange(+e.target.value)} />
  );
}

function TweakToggle({ value, onChange }) {
  return (
    <button className={"tweak-toggle " + (value ? "on" : "")} onClick={() => onChange(!value)}>
      {value ? "ON" : "OFF"}
    </button>
  );
}

function TweakRadio({ value, options, onChange }) {
  if (options.length <= 4) {
    return (
      <div className="tweak-seg">
        {options.map((o) => (
          <button key={o.key} className={"tseg-btn " + (value === o.key ? "on" : "")}
            onClick={() => onChange(o.key)}>
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <select className="tweak-sel" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  );
}

function TweakSelect({ value, options, onChange }) {
  return (
    <select className="tweak-sel" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.key || o} value={o.key || o}>{o.label || o}</option>)}
    </select>
  );
}

function TweakText({ value, onChange, placeholder }) {
  return (
    <input type="text" className="tweak-input" value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} />
  );
}

function TweakNumber({ value, onChange, min, max }) {
  return (
    <input type="number" className="tweak-input tweak-num" value={value}
      min={min} max={max}
      onChange={(e) => onChange(+e.target.value)} />
  );
}

const SWATCH_COLORS = [
  "#d8552f", "#CE9A2E", "#2E8576", "#37566E", "#C2461F",
  "#6a5acd", "#e86b3e", "#c0392b", "#27ae60", "#2980b9",
];

function TweakColor({ value, onChange }) {
  return (
    <div className="tweak-color-row">
      <input type="color" className="tweak-color-input" value={value}
        onChange={(e) => onChange(e.target.value)} />
      <div className="tweak-swatches">
        {SWATCH_COLORS.map((c) => (
          <button key={c} className={"tweak-swatch " + (c === value ? "on" : "")}
            style={{ background: c }} onClick={() => onChange(c)} aria-label={c} />
        ))}
      </div>
    </div>
  );
}

function TweakButton({ label, onClick }) {
  return (
    <button className="tweak-action-btn" onClick={onClick}>{label}</button>
  );
}

function TweaksPanel({ active, tweaks, setTweak, onClose }) {
  const [pos, setPos] = React.useState({ x: 16, y: 80 });
  const [dragging, setDragging] = React.useState(null);
  const panelRef = React.useRef(null);

  const onMouseDown = (e) => {
    if (e.target.closest("input,select,button")) return;
    setDragging({ ox: e.clientX - pos.x, oy: e.clientY - pos.y });
  };
  React.useEffect(() => {
    if (!dragging) return;
    const mv = (e) => setPos({ x: e.clientX - dragging.ox, y: e.clientY - dragging.oy });
    const up = () => setDragging(null);
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
  }, [dragging]);

  React.useEffect(() => {
    const handler = (e) => {
      if (e.data && e.data.type === "__activate_edit_mode") { /* handled by parent */ }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  if (!active) return null;

  return (
    <div ref={panelRef} className="tweaks-panel"
      style={{ left: pos.x, top: pos.y, position: "fixed", zIndex: 9999 }}
      onMouseDown={onMouseDown}>
      <div className="tweaks-header">
        <span>⚙ Design Tweaks</span>
        <button className="tweaks-close" onClick={onClose}>✕</button>
      </div>
      <div className="tweaks-body">
        <TweakSection title="Typography">
          <TweakRow label="Quote font">
            <TweakRadio value={tweaks.typeVoice}
              options={[{ key: "serif", label: "Serif" }, { key: "sans", label: "Sans" }, { key: "mono", label: "Mono" }]}
              onChange={(v) => setTweak("typeVoice", v)} />
          </TweakRow>
        </TweakSection>
        <TweakSection title="Colour">
          <TweakRow label="Accent">
            <TweakColor value={tweaks.accent} onChange={(v) => setTweak("accent", v)} />
          </TweakRow>
        </TweakSection>
        <TweakSection title="Map pins">
          <TweakRow label="Style">
            <TweakRadio value={tweaks.accumulation}
              options={[{ key: "subtle", label: "Subtle" }, { key: "bold", label: "Bold" }, { key: "heat", label: "Heat" }]}
              onChange={(v) => setTweak("accumulation", v)} />
          </TweakRow>
        </TweakSection>
      </div>
    </div>
  );
}

Object.assign(window, { useTweaks, TweaksPanel, TweakSection, TweakRow, TweakSlider, TweakToggle, TweakRadio, TweakSelect, TweakText, TweakNumber, TweakColor, TweakButton });
