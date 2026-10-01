/*
 * Energy Flow House Card
 * Een Home Assistant Lovelace-kaart die energiestromen (zon, net, batterij, verbruik)
 * geanimeerd over een zelfgekozen afbeelding van je huis tekent.
 *
 * - Zelf te kiezen afbeelding, positie en grootte
 * - Alle labels, het weer en de batterij-indicator zijn versleepbaar
 * - Stroomlijnen teken je zelf in de visuele editor (klik = punt toevoegen)
 * - Animatie loopt in de richting van de energiestroom, snelheid schaalt met vermogen
 */

const EFH_VERSION = "1.0.0";
const EFH_FLOWS = ["solar", "grid", "battery", "home"];
const EFH_LABEL_KEYS = ["solar", "home", "battery", "grid", "weather"];

const EFH_DEFAULTS = {
  image: "",
  aspect_ratio: 0.923, // breedte / hoogte van de kaart
  background: "var(--ha-card-background, var(--card-background-color, #1f232b))",
  text_color: "var(--primary-text-color, #ffffff)",
  secondary_text_color: "var(--secondary-text-color, #a0a4ab)",
  image_position: { x: 0, y: 0, width: 100 }, // in % van de kaart
  font_scale: 1,
  show_direction: true,
  calculate_home: true,
  min_power: 10, // W - daaronder staat de animatie stil
  max_power: 5000, // W - bij dit vermogen loopt de animatie op maximale snelheid
  speed: 12, // % van kaartbreedte per seconde (basis)
  dash: 4, // lengte bewegend streepje, % van kaartbreedte
  gap: 9, // ruimte tussen streepjes, % van kaartbreedte
  line_width: 0.55, // % van kaartbreedte
  line_color: "rgba(255,255,255,0.35)",
  corner_radius: 1.5, // % van kaartbreedte
  entities: {},
  invert: { battery: false, grid: false },
  names: { solar: "Zonnepanelen", home: "Verbruik", battery: "Batterij", grid: "Net" },
  texts: { import: "afname", export: "teruglevering", charging: "laden", discharging: "ontladen" },
  positions: {
    weather: { x: 17, y: 5.5 },
    solar: { x: 31, y: 17.5 },
    home: { x: 80, y: 17.5 },
    battery: { x: 30, y: 91 },
    grid: { x: 77, y: 91 },
  },
  battery_indicator: { show: true, x: 35.2, y: 79.5, width: 3.2, height: 9, orientation: "vertical", show_text: false },
  flows: {
    solar: { points: [[55, 58], [55, 66]], color: "#ffd23f" },
    battery: { points: [[37, 72.6], [53, 72.6]], color: "#ffd23f" },
    home: { points: [[57, 67.6], [72, 67.6]], color: "#ffd23f" },
    grid: { points: [[75, 80], [55, 75.5], [55, 72]], color: "#ffd23f" },
  },
  lines: [],
};

const EFH_WEATHER_ICONS = {
  "clear-night": "mdi:weather-night",
  cloudy: "mdi:weather-cloudy",
  exceptional: "mdi:alert-circle-outline",
  fog: "mdi:weather-fog",
  hail: "mdi:weather-hail",
  lightning: "mdi:weather-lightning",
  "lightning-rainy": "mdi:weather-lightning-rainy",
  partlycloudy: "mdi:weather-partly-cloudy",
  pouring: "mdi:weather-pouring",
  rainy: "mdi:weather-rainy",
  snowy: "mdi:weather-snowy",
  "snowy-rainy": "mdi:weather-snowy-rainy",
  sunny: "mdi:weather-sunny",
  windy: "mdi:weather-windy",
  "windy-variant": "mdi:weather-windy-variant",
};

/* ---------------- helpers ---------------- */

const efhClone = (o) => JSON.parse(JSON.stringify(o ?? null));
const efhIsObj = (o) => o && typeof o === "object" && !Array.isArray(o);

function efhMerge(target, src) {
  if (!efhIsObj(src)) return target;
  for (const k of Object.keys(src)) {
    if (efhIsObj(src[k]) && efhIsObj(target[k])) efhMerge(target[k], src[k]);
    else target[k] = src[k];
  }
  return target;
}

function efhNormalize(user) {
  const c = efhMerge(efhClone(EFH_DEFAULTS), efhClone(user || {}));
  for (const t of EFH_FLOWS) {
    c.flows[t] = Object.assign({ points: [] }, c.flows[t] || {});
    if (!Array.isArray(c.flows[t].points)) c.flows[t].points = [];
  }
  if (!Array.isArray(c.lines)) c.lines = [];
  c.lines = c.lines.map((l) => Object.assign({ points: [] }, l || {}));
  for (const k of EFH_LABEL_KEYS) c.positions[k] = Object.assign({ x: 50, y: 50 }, c.positions[k] || {});
  return c;
}

function efhGetPath(obj, path) {
  return path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function efhSetPath(obj, path, value) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!efhIsObj(o[path[i]])) o[path[i]] = {};
    o = o[path[i]];
  }
  const last = path[path.length - 1];
  if (value === undefined || value === null || value === "") delete o[last];
  else o[last] = value;
}

function efhPathD(pts, r) {
  if (!pts || pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const l1 = Math.hypot(x1 - x0, y1 - y0);
    const l2 = Math.hypot(x2 - x1, y2 - y1);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    if (!(rr > 0)) {
      d += `L${x1.toFixed(2)},${y1.toFixed(2)}`;
      continue;
    }
    const ax = x1 + ((x0 - x1) * rr) / l1;
    const ay = y1 + ((y0 - y1) * rr) / l1;
    const bx = x1 + ((x2 - x1) * rr) / l2;
    const by = y1 + ((y2 - y1) * rr) / l2;
    d += `L${ax.toFixed(2)},${ay.toFixed(2)}Q${x1.toFixed(2)},${y1.toFixed(2)} ${bx.toFixed(2)},${by.toFixed(2)}`;
  }
  const l = pts[pts.length - 1];
  return d + `L${l[0].toFixed(2)},${l[1].toFixed(2)}`;
}

function efhSocColor(soc) {
  if (soc == null) return "var(--secondary-text-color, #aaa)";
  if (soc < 15) return "#ff4d3a";
  if (soc < 40) return "#ffa726";
  return "#4cd964";
}

const efhEsc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const EFH_SVG_NS = "http://www.w3.org/2000/svg";
function efhSvg(tag, attrs = {}) {
  const el = document.createElementNS(EFH_SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/* ---------------- card ---------------- */

const EFH_CARD_CSS = `
:host { display:block; }
ha-card { display:block; overflow:hidden; background:var(--efh-bg); border-radius:var(--ha-card-border-radius, 12px); }
.wrap { position:relative; width:100%; container-type:inline-size; overflow:hidden;
  -webkit-user-select:none; user-select:none; font-family:var(--paper-font-body1_-_font-family, inherit); }
.house { position:absolute; display:block; height:auto; max-width:none; pointer-events:none; }
.placeholder { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center;
  padding:8%; color:var(--efh-text2); font-size:14px; font-size:3.4cqw; }
svg.flows, svg.overlay { position:absolute; inset:0; width:100%; height:100%; overflow:visible; pointer-events:none; }
.base { fill:none; stroke-linecap:round; stroke-linejoin:round; transition:stroke .5s, stroke-opacity .5s; }
.anim { fill:none; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:var(--dash) var(--gap);
  animation:efh-flow var(--dur) linear infinite; transition:opacity .5s; }
.anim.rev { animation-direction:reverse; }
.anim.idle { opacity:0; animation-play-state:paused; }
@keyframes efh-flow { from { stroke-dashoffset:var(--pat); } to { stroke-dashoffset:0; } }

.label, .weather { position:absolute; transform:translate(-50%,-50%); white-space:nowrap; line-height:1.15; text-align:center; }
.label { cursor:pointer; }
.label.hidden, .weather.hidden, .batt.hidden { display:none; }
.label .value { font-size:22px; font-size:calc(5.1cqw * var(--fs)); font-weight:600; color:var(--efh-text);
  display:flex; align-items:center; justify-content:center; gap:.2em; }
.label .name { font-size:15px; font-size:calc(3.5cqw * var(--fs)); color:var(--efh-text2); margin-top:.12em; }
.label ha-icon { --mdc-icon-size:1em; display:inline-flex; }
.label .ico:empty { display:none; }
.label .soc { font-weight:600; }
.weather { display:flex; align-items:center; gap:.45em; color:var(--efh-text2); cursor:pointer;
  font-size:18px; font-size:calc(4.3cqw * var(--fs)); }
.weather ha-icon { --mdc-icon-size:1.6em; display:inline-flex; color:var(--efh-text); }

.batt { position:absolute; transform:translate(-50%,-50%); box-sizing:border-box;
  border:2px solid rgba(255,255,255,.85); border:max(1.5px, .32cqw) solid rgba(255,255,255,.85);
  border-radius:.7cqw; background:rgba(0,0,0,.35); cursor:pointer; }
.batt .inner { position:absolute; inset:.35cqw; overflow:hidden; border-radius:.35cqw; }
.batt .fill { position:absolute; border-radius:.3cqw; transition:height .8s, width .8s, background .8s; }
.batt.vertical .fill { left:0; right:0; bottom:0; }
.batt.horizontal .fill { top:0; bottom:0; left:0; }
.batt .cap { position:absolute; background:rgba(255,255,255,.85); border-radius:.3cqw; }
.batt.vertical .cap { left:30%; right:30%; top:-1.1cqw; height:.75cqw; }
.batt.horizontal .cap { top:30%; bottom:30%; right:-1.1cqw; width:.75cqw; }
.batt .txt { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  font-size:2.2cqw; font-weight:700; color:#fff; text-shadow:0 0 3px #000; }
.batt.charging .fill { animation:efh-pulse 1.8s ease-in-out infinite; }
@keyframes efh-pulse { 0%,100% { filter:brightness(1); } 50% { filter:brightness(1.45); } }

/* ontwerp-modus */
.wrap.design.move .label, .wrap.design.move .weather, .wrap.design.move .batt {
  outline:1px dashed rgba(3,169,244,.9); outline-offset:3px; cursor:move; }
.wrap.design.move .house { pointer-events:auto; cursor:move; outline:1px dashed rgba(255,255,255,.35); }
.wrap.design.draw { cursor:crosshair; }
.wrap.design.draw .label, .wrap.design.draw .weather, .wrap.design.draw .batt { pointer-events:none; opacity:.55; }
.handle { position:absolute; width:12px; height:12px; margin:-6px 0 0 -6px; background:#03a9f4; border:2px solid #fff;
  border-radius:3px; cursor:nwse-resize; box-sizing:border-box; display:none; z-index:5; }
.wrap.design.move .handle { display:block; }
.batt .handle { left:100%; top:100%; }
svg.overlay .pt { pointer-events:all; cursor:grab; }
`;

class EnergyFlowHouseCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._size = { w: 0, h: 0 };
    this._design = null; // {tool: "move"|"draw", active: "solar"|...|"line:0"}
    this._flowEls = {};
    this._imgRatio = null;
  }

  static getConfigElement() {
    return document.createElement("energy-flow-house-card-editor");
  }

  static getStubConfig(hass) {
    const ids = Object.keys(hass?.states || {});
    const find = (re) => ids.find((id) => re.test(id));
    const entities = {};
    const w = ids.find((id) => id.startsWith("weather."));
    if (w) entities.weather = w;
    const s = find(/^sensor\..*(solar|pv|zon).*power/i);
    if (s) entities.solar = s;
    return { image: "", entities };
  }

  setConfig(config) {
    if (!config) throw new Error("Ongeldige configuratie");
    this._config = efhNormalize(config);
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._built) this._applyStates();
  }
  get hass() {
    return this._hass;
  }

  /** Gebruikt door de editor om de kaart als ontwerpcanvas te gebruiken. */
  set designOptions(opts) {
    this._design = opts;
    if (this._built) {
      this._updateDesignClasses();
      this._drawFlows();
    }
  }

  get imageRatio() {
    return this._imgRatio;
  }

  getCardSize() {
    return 7;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  connectedCallback() {
    if (this._wrap && !this._ro) this._observe();
  }

  disconnectedCallback() {
    if (this._ro) this._ro.disconnect();
    this._ro = null;
  }

  /* ---------- opbouw ---------- */

  _render() {
    const c = this._config;
    const label = (key) => `
      <div class="label" data-key="${key}" data-drag="label:${key}">
        <div class="value"><span class="ico"></span><span class="v">—</span><span class="soc"></span></div>
        <div class="name"></div>
      </div>`;
    this.shadowRoot.innerHTML = `
      <style>${EFH_CARD_CSS}</style>
      <ha-card>
        <div class="wrap">
          ${c.image ? `<img class="house" data-drag="image" alt="" draggable="false">` : `<div class="placeholder">Kies een afbeelding van je huis in de kaartinstellingen<br>(bijv. /local/huis.png)</div>`}
          <svg class="flows"></svg>
          <div class="batt" data-drag="batt"><div class="inner"><div class="fill"></div></div><div class="cap"></div><div class="txt"></div><div class="handle" data-drag="batt-resize"></div></div>
          ${["solar", "home", "battery", "grid"].map(label).join("")}
          <div class="weather" data-key="weather" data-drag="label:weather"><ha-icon></ha-icon><span class="t">—</span></div>
          <div class="handle img-handle" data-drag="image-resize"></div>
          <svg class="overlay"></svg>
        </div>
      </ha-card>`;
    const root = this.shadowRoot;
    this._wrap = root.querySelector(".wrap");
    this._img = root.querySelector(".house");
    this._svg = root.querySelector("svg.flows");
    this._overlay = root.querySelector("svg.overlay");
    this._batt = root.querySelector(".batt");
    this._imgHandle = root.querySelector(".img-handle");
    this._labels = {};
    root.querySelectorAll("[data-key]").forEach((el) => (this._labels[el.dataset.key] = el));

    const card = root.querySelector("ha-card");
    card.style.setProperty("--efh-bg", c.background);
    card.style.setProperty("--efh-text", c.text_color);
    card.style.setProperty("--efh-text2", c.secondary_text_color);
    this._wrap.style.setProperty("--fs", c.font_scale);
    this._wrap.style.aspectRatio = String(Number(c.aspect_ratio) > 0 ? c.aspect_ratio : 1);

    if (this._img) {
      this._img.addEventListener("load", () => {
        this._imgRatio = this._img.naturalWidth / this._img.naturalHeight;
        this._positionImageHandle();
        this.dispatchEvent(new CustomEvent("efh-image-loaded", { bubbles: true, composed: true }));
      });
      this._img.src = c.image;
    }

    // klik = meer-info (niet in ontwerpmodus)
    this._wrap.addEventListener("click", (e) => {
      if (this._design) return;
      const t = e.composedPath().find((el) => el.dataset && (el.dataset.key || el.classList?.contains("batt")));
      if (!t) return;
      const key = t.dataset.key || "battery";
      const ent =
        key === "battery" && t.classList.contains("batt")
          ? c.entities.battery_soc || c.entities.battery
          : c.entities[key] || (key === "battery" ? c.entities.battery_soc : null);
      if (ent)
        this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: ent }, bubbles: true, composed: true }));
    });
    this._wrap.addEventListener("pointerdown", (e) => this._onDown(e));
    this._wrap.addEventListener("pointermove", (e) => this._onMove(e));
    this._wrap.addEventListener("pointerup", (e) => this._onUp(e));
    this._wrap.addEventListener("pointercancel", () => (this._drag = null));
    this._wrap.addEventListener("dblclick", (e) => this._onPointDelete(e));
    this._wrap.addEventListener("contextmenu", (e) => this._onPointDelete(e));

    this._built = true;
    this._layout();
    this._updateDesignClasses();
    if (this.isConnected) this._observe();
    this._applyStates();
  }

  _observe() {
    if (this._ro) this._ro.disconnect();
    this._ro = new ResizeObserver(() => {
      const r = this._wrap.getBoundingClientRect();
      if (Math.abs(r.width - this._size.w) > 0.5 || Math.abs(r.height - this._size.h) > 0.5) {
        this._size = { w: r.width, h: r.height };
        this._drawFlows();
      }
    });
    this._ro.observe(this._wrap);
  }

  _layout() {
    const c = this._config;
    if (this._img) {
      const ip = c.image_position;
      Object.assign(this._img.style, { left: `${ip.x}%`, top: `${ip.y}%`, width: `${ip.width}%` });
      this._positionImageHandle();
    }
    for (const k of EFH_LABEL_KEYS) {
      const el = this._labels[k];
      const p = c.positions[k];
      el.style.left = `${p.x}%`;
      el.style.top = `${p.y}%`;
      if (k !== "weather") el.querySelector(".name").textContent = c.names[k] ?? "";
    }
    const b = c.battery_indicator;
    this._batt.className = `batt ${b.orientation === "horizontal" ? "horizontal" : "vertical"}`;
    Object.assign(this._batt.style, { left: `${b.x}%`, top: `${b.y}%`, width: `${b.width}%`, height: `${b.height}%` });
  }

  _positionImageHandle() {
    if (!this._img || !this._imgHandle) return;
    const ip = this._config.image_position;
    const ar = Number(this._config.aspect_ratio) || 1;
    const hPct = this._imgRatio ? (ip.width / this._imgRatio) * ar : 0;
    this._imgHandle.style.left = `${ip.x + ip.width}%`;
    this._imgHandle.style.top = `${ip.y + hPct}%`;
  }

  _updateDesignClasses() {
    if (!this._wrap) return;
    const d = this._design;
    this._wrap.classList.toggle("design", !!d);
    this._wrap.classList.toggle("move", !!d && d.tool === "move");
    this._wrap.classList.toggle("draw", !!d && d.tool === "draw");
    this._wrap.style.touchAction = d ? "none" : "";
  }

  /* ---------- lijnen ---------- */

  _px(pts) {
    return pts.map(([x, y]) => [(x / 100) * this._size.w, (y / 100) * this._size.h]);
  }

  _drawFlows() {
    const { w, h } = this._size;
    if (!this._svg || !w || !h) return;
    const c = this._config;
    const svg = this._svg;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.innerHTML = "";
    const defs = efhSvg("defs");
    const f = efhSvg("filter", { id: "efh-glow", filterUnits: "userSpaceOnUse", x: 0, y: 0, width: w, height: h });
    f.appendChild(efhSvg("feGaussianBlur", { stdDeviation: Math.max(1.5, w * 0.006), result: "b" }));
    const m = efhSvg("feMerge");
    m.appendChild(efhSvg("feMergeNode", { in: "b" }));
    m.appendChild(efhSvg("feMergeNode", { in: "SourceGraphic" }));
    f.appendChild(m);
    defs.appendChild(f);
    svg.appendChild(defs);

    const r = (c.corner_radius / 100) * w;
    const toW = (pct) => (pct / 100) * w;

    // statische (decoratieve) lijnen
    c.lines.forEach((l) => {
      if (l.points.length < 2) return;
      svg.appendChild(
        efhSvg("path", {
          class: "base",
          d: efhPathD(this._px(l.points), r),
          stroke: l.color || c.line_color,
          "stroke-width": toW(l.width ?? c.line_width * 0.5),
        })
      );
    });

    this._flowEls = {};
    for (const t of EFH_FLOWS) {
      const fl = c.flows[t];
      if (fl.points.length < 2) continue;
      if (!this._design && !this._hasSource(t)) continue;
      const d = efhPathD(this._px(fl.points), r);
      const width = toW(fl.width ?? c.line_width);
      const base = efhSvg("path", { class: "base", d, stroke: c.line_color, "stroke-width": width });
      const anim = efhSvg("path", {
        class: "anim idle",
        d,
        stroke: fl.color || "#ffd23f",
        "stroke-width": width * 1.15,
        filter: "url(#efh-glow)",
      });
      const dash = toW(fl.dash ?? c.dash);
      const gap = toW(fl.gap ?? c.gap);
      anim.style.setProperty("--dash", `${dash}px`);
      anim.style.setProperty("--gap", `${gap}px`);
      anim.style.setProperty("--pat", `${dash + gap}px`);
      anim.style.setProperty("--dur", `2s`);
      svg.appendChild(base);
      svg.appendChild(anim);
      this._flowEls[t] = { base, anim, dur: null, dir: 0 };
    }
    this._drawOverlay();
    this._applyStates();
  }

  _hasSource(t) {
    const e = this._config.entities;
    if (t === "home") return !!e.home || (this._config.calculate_home && !!(e.solar || e.grid || e.battery));
    return !!e[t];
  }

  _activePoints(c = this._config, key = this._design?.active) {
    if (!key) return null;
    if (key.startsWith("line:")) return c.lines[Number(key.slice(5))]?.points ?? null;
    return c.flows[key]?.points ?? null;
  }

  _drawOverlay() {
    const ov = this._overlay;
    const { w, h } = this._size;
    if (!ov) return;
    ov.innerHTML = "";
    if (!this._design || !w) return;
    ov.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const c = this._config;
    const defs = efhSvg("defs");
    const mk = efhSvg("marker", {
      id: "efh-arrow",
      viewBox: "0 0 10 10",
      refX: 5,
      refY: 5,
      markerWidth: 5,
      markerHeight: 5,
      orient: "auto-start-reverse",
    });
    mk.appendChild(efhSvg("path", { d: "M0,0 L10,5 L0,10 z", fill: "#03a9f4" }));
    defs.appendChild(mk);
    ov.appendChild(defs);

    const draw = this._design.tool === "draw";
    const all = [
      ...EFH_FLOWS.map((k) => [k, c.flows[k].points]),
      ...c.lines.map((l, i) => [`line:${i}`, l.points]),
    ];
    for (const [key, pts] of all) {
      const active = key === this._design.active;
      if (!pts.length) continue;
      const px = this._px(pts);
      if (active && draw) {
        ov.appendChild(
          efhSvg("path", {
            d: efhPathD(px, 0),
            fill: "none",
            stroke: "#03a9f4",
            "stroke-width": 2,
            "stroke-dasharray": "6 4",
            "marker-mid": "url(#efh-arrow)",
            "marker-end": "url(#efh-arrow)",
          })
        );
        px.forEach(([x, y], i) => {
          const isStart = i === 0;
          ov.appendChild(
            efhSvg("circle", {
              class: "pt",
              "data-drag": `point:${i}`,
              cx: x,
              cy: y,
              r: 7,
              fill: isStart ? "#4cd964" : "#03a9f4",
              stroke: "#fff",
              "stroke-width": 2,
            })
          );
        });
      } else if (draw) {
        px.forEach(([x, y]) =>
          ov.appendChild(efhSvg("circle", { cx: x, cy: y, r: 3, fill: "rgba(255,255,255,.45)" }))
        );
      }
    }
  }

  /* ---------- toestanden ---------- */

  _num(id) {
    const s = id && this._hass?.states?.[id];
    if (!s) return null;
    const v = parseFloat(s.state);
    return Number.isFinite(v) ? v : null;
  }

  _power(id) {
    const s = id && this._hass?.states?.[id];
    if (!s) return null;
    let v = parseFloat(s.state);
    if (!Number.isFinite(v)) return null;
    const u = String(s.attributes?.unit_of_measurement || "W").toLowerCase();
    if (u === "kw") v *= 1000;
    else if (u === "mw") v *= 1e6;
    return v;
  }

  _values() {
    const c = this._config;
    const e = c.entities;
    const inv = c.invert || {};
    const sign = (v, flag) => (v == null ? null : flag ? -v : v);
    const solar = sign(this._power(e.solar), inv.solar);
    const grid = sign(this._power(e.grid), inv.grid);
    const battery = sign(this._power(e.battery), inv.battery);
    let home = sign(this._power(e.home), inv.home);
    if (home == null && !e.home && c.calculate_home && (solar != null || grid != null || battery != null)) {
      home = Math.max(0, (solar || 0) + (grid || 0) + (battery || 0));
    }
    const soc = this._num(e.battery_soc);
    return { solar, grid, battery, home, soc };
  }

  _fmt(w) {
    if (w == null) return "—";
    const lang = this._hass?.locale?.language || this._hass?.language || "nl";
    const a = Math.abs(w);
    if (a < 1000) return `${Math.round(a)} W`;
    const kw = a / 1000;
    return `${new Intl.NumberFormat(lang, { maximumFractionDigits: kw < 10 ? 2 : 1 }).format(kw)} kW`;
  }

  _applyStates() {
    if (!this._built) return;
    const c = this._config;
    const v = this._values();
    const min = Number(c.min_power) || 0;
    const T = c.texts || {};

    const setLabel = (key, valueText, nameExtra, icon, iconColor) => {
      const el = this._labels[key];
      el.querySelector(".v").textContent = valueText;
      const name = c.names[key] ?? "";
      el.querySelector(".name").textContent = nameExtra && c.show_direction ? `${name} · ${nameExtra}` : name;
      const ico = el.querySelector(".ico");
      if (icon) {
        if (!ico.firstChild) ico.appendChild(document.createElement("ha-icon"));
        ico.firstChild.setAttribute("icon", icon);
        ico.firstChild.style.color = iconColor || "";
      } else ico.innerHTML = "";
    };

    // zonnepanelen
    this._labels.solar.classList.toggle("hidden", !c.entities.solar && !this._design);
    setLabel("solar", this._fmt(v.solar));

    // verbruik
    this._labels.home.classList.toggle("hidden", !this._hasSource("home") && !this._design);
    setLabel("home", this._fmt(v.home));

    // net
    this._labels.grid.classList.toggle("hidden", !c.entities.grid && !this._design);
    const gDir = v.grid == null ? 0 : v.grid > min ? 1 : v.grid < -min ? -1 : 0;
    setLabel("grid", this._fmt(v.grid), gDir > 0 ? T.import : gDir < 0 ? T.export : "");

    // batterij
    const hasBatt = !!(c.entities.battery || c.entities.battery_soc);
    this._labels.battery.classList.toggle("hidden", !hasBatt && !this._design);
    const bDir = v.battery == null ? 0 : v.battery > min ? 1 : v.battery < -min ? -1 : 0;
    const bText = c.entities.battery ? this._fmt(v.battery) : "";
    setLabel(
      "battery",
      bText,
      bDir < 0 ? T.charging : bDir > 0 ? T.discharging : "",
      bDir < 0 ? "mdi:lightning-bolt" : null,
      "#4cd964"
    );
    const socEl = this._labels.battery.querySelector(".soc");
    if (v.soc != null) {
      socEl.textContent = `${bText ? "· " : ""}${Math.round(v.soc)}%`;
      socEl.style.color = efhSocColor(v.soc);
    } else socEl.textContent = bText ? "" : "—";

    // batterij-indicator
    const bi = c.battery_indicator;
    const showInd = bi.show && (c.entities.battery_soc || this._design);
    this._batt.classList.toggle("hidden", !showInd);
    this._batt.classList.toggle("charging", bDir < 0);
    const fill = this._batt.querySelector(".fill");
    const soc = Math.max(0, Math.min(100, v.soc ?? (this._design ? 60 : 0)));
    fill.style.background = efhSocColor(v.soc ?? soc);
    if (bi.orientation === "horizontal") {
      fill.style.width = `${soc}%`;
      fill.style.height = "";
    } else {
      fill.style.height = `${soc}%`;
      fill.style.width = "";
    }
    this._batt.querySelector(".txt").textContent = bi.show_text && v.soc != null ? `${Math.round(v.soc)}%` : "";

    // weer
    this._applyWeather();

    // animaties
    const dirs = {
      solar: v.solar != null && v.solar > min ? 1 : 0,
      home: v.home == null ? 0 : v.home > min ? 1 : v.home < -min ? -1 : 0,
      grid: gDir,
      battery: bDir,
    };
    for (const t of EFH_FLOWS) {
      const fe = this._flowEls[t];
      if (!fe) continue;
      const fl = c.flows[t];
      const dir = (fl.reverse ? -1 : 1) * dirs[t];
      const p = Math.abs(v[t] ?? 0);
      const frac = Math.min(1, p / (Number(c.max_power) || 5000));
      const speed = (Number(c.speed) || 12) * (0.35 + 1.65 * frac);
      const pat = Number(fl.dash ?? c.dash) + Number(fl.gap ?? c.gap);
      const dur = Math.max(0.15, Math.round((pat / speed) * 10) / 10);
      if (fe.dur !== dur) {
        fe.anim.style.setProperty("--dur", `${dur}s`);
        fe.dur = dur;
      }
      fe.anim.classList.toggle("idle", dir === 0);
      fe.anim.classList.toggle("rev", dir < 0);
      fe.base.setAttribute("stroke", dir === 0 ? c.line_color : fl.color || "#ffd23f");
      fe.base.setAttribute("stroke-opacity", dir === 0 ? 1 : 0.4);
    }
  }

  _applyWeather() {
    const c = this._config;
    const el = this._labels.weather;
    const id = c.entities.weather;
    const s = id && this._hass?.states?.[id];
    el.classList.toggle("hidden", !id && !this._design);
    const icon = el.querySelector("ha-icon");
    const t = el.querySelector(".t");
    if (!s) {
      icon.setAttribute("icon", "mdi:weather-partly-cloudy");
      t.textContent = id ? "—" : "Weer";
      return;
    }
    const tempId = c.entities.temperature;
    let temp, unit;
    if (tempId && this._hass.states[tempId]) {
      temp = parseFloat(this._hass.states[tempId].state);
      unit = this._hass.states[tempId].attributes.unit_of_measurement || "°C";
    } else if (id.startsWith("weather.")) {
      temp = parseFloat(s.attributes.temperature);
      unit = s.attributes.temperature_unit || "°C";
    } else {
      temp = parseFloat(s.state);
      unit = s.attributes.unit_of_measurement || "°C";
    }
    const lang = this._hass?.locale?.language || "nl";
    t.textContent = Number.isFinite(temp)
      ? `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(temp)}${unit}`
      : "—";
    const ic = id.startsWith("weather.") ? EFH_WEATHER_ICONS[s.state] : s.attributes.icon || "mdi:thermometer";
    icon.setAttribute("icon", ic || "mdi:weather-partly-cloudy");
  }

  /* ---------- ontwerp-interactie ---------- */

  _pct(e) {
    const r = this._wrap.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100];
  }

  _target(e) {
    return e.composedPath().find((el) => el.getAttribute && el.getAttribute("data-drag"));
  }

  _onDown(e) {
    if (!this._design || e.button > 0) return;
    const t = this._target(e);
    const kind = t?.getAttribute("data-drag") || "";
    const p = this._pct(e);
    const c = this._config;
    let drag = null;
    if (this._design.tool === "draw") {
      if (kind.startsWith("point:")) drag = { kind: "point", idx: Number(kind.slice(6)) };
      else drag = { kind: "add" };
    } else {
      if (kind.startsWith("label:")) {
        const key = kind.slice(6);
        drag = { kind: "label", key, orig: { ...c.positions[key] } };
      } else if (kind === "batt") drag = { kind: "batt", orig: { ...c.battery_indicator } };
      else if (kind === "batt-resize") drag = { kind: "batt-resize", orig: { ...c.battery_indicator } };
      else if (kind === "image") drag = { kind: "image", orig: { ...c.image_position } };
      else if (kind === "image-resize") drag = { kind: "image-resize", orig: { ...c.image_position } };
    }
    if (!drag) return;
    drag.start = p;
    drag.moved = false;
    this._drag = drag;
    try {
      this._wrap.setPointerCapture(e.pointerId);
    } catch (_) {}
    e.preventDefault();
    e.stopPropagation();
  }

  _snap(p, prev, shift) {
    let [x, y] = p;
    if (shift && prev) {
      if (Math.abs(x - prev[0]) * this._size.w < Math.abs(y - prev[1]) * this._size.h) x = prev[0];
      else y = prev[1];
    }
    const r = (n) => Math.round(Math.max(-20, Math.min(120, n)) * 10) / 10;
    return [r(x), r(y)];
  }

  _onMove(e) {
    const d = this._drag;
    if (!d) return;
    const p = this._pct(e);
    const dx = p[0] - d.start[0];
    const dy = p[1] - d.start[1];
    if (Math.hypot(dx * this._size.w, dy * this._size.h) / 100 > 3) d.moved = true;
    if (!d.moved) return;
    const c = this._config;
    const r1 = (n) => Math.round(n * 10) / 10;
    switch (d.kind) {
      case "label":
        c.positions[d.key] = { ...c.positions[d.key], x: r1(d.orig.x + dx), y: r1(d.orig.y + dy) };
        this._layout();
        break;
      case "batt":
        Object.assign(c.battery_indicator, { x: r1(d.orig.x + dx), y: r1(d.orig.y + dy) });
        this._layout();
        break;
      case "batt-resize":
        Object.assign(c.battery_indicator, {
          width: r1(Math.max(0.5, d.orig.width + dx * 2)),
          height: r1(Math.max(0.5, d.orig.height + dy * 2)),
        });
        this._layout();
        break;
      case "image":
        Object.assign(c.image_position, { x: r1(d.orig.x + dx), y: r1(d.orig.y + dy) });
        this._layout();
        break;
      case "image-resize":
        c.image_position.width = r1(Math.max(5, d.orig.width + dx));
        this._layout();
        break;
      case "point": {
        const pts = this._activePoints();
        if (!pts) return;
        const prev = pts[d.idx - 1] || pts[d.idx + 1];
        pts[d.idx] = this._snap(p, prev, e.shiftKey);
        this._drawFlows();
        break;
      }
    }
  }

  _onUp(e) {
    const d = this._drag;
    this._drag = null;
    if (!d) return;
    if (d.kind === "add" && !d.moved) {
      const pts = this._activePoints();
      if (!pts) return;
      pts.push(this._snap(this._pct(e), pts[pts.length - 1], e.shiftKey));
      this._drawFlows();
      this._emitDesign();
      return;
    }
    if (d.moved) this._emitDesign();
  }

  _onPointDelete(e) {
    if (!this._design || this._design.tool !== "draw") return;
    const t = this._target(e);
    const kind = t?.getAttribute("data-drag") || "";
    if (!kind.startsWith("point:")) {
      if (e.type === "contextmenu") e.preventDefault();
      return;
    }
    e.preventDefault();
    const pts = this._activePoints();
    if (!pts) return;
    pts.splice(Number(kind.slice(6)), 1);
    this._drawFlows();
    this._emitDesign();
  }

  _emitDesign() {
    this.dispatchEvent(
      new CustomEvent("efh-design-changed", { detail: { config: efhClone(this._config) }, bubbles: true, composed: true })
    );
  }
}

/* ---------------- editor ---------------- */

const EFH_FIELDS = {
  solar: ["entities", "solar"],
  home: ["entities", "home"],
  battery: ["entities", "battery"],
  battery_soc: ["entities", "battery_soc"],
  grid: ["entities", "grid"],
  weather: ["entities", "weather"],
  temperature: ["entities", "temperature"],
  invert_battery: ["invert", "battery"],
  invert_grid: ["invert", "grid"],
  calculate_home: ["calculate_home"],
  image: ["image"],
  aspect_ratio: ["aspect_ratio"],
  image_width: ["image_position", "width"],
  background: ["background"],
  font_scale: ["font_scale"],
  show_direction: ["show_direction"],
  show_battery_indicator: ["battery_indicator", "show"],
  battery_orientation: ["battery_indicator", "orientation"],
  battery_show_text: ["battery_indicator", "show_text"],
  name_solar: ["names", "solar"],
  name_home: ["names", "home"],
  name_battery: ["names", "battery"],
  name_grid: ["names", "grid"],
  min_power: ["min_power"],
  max_power: ["max_power"],
  speed: ["speed"],
  dash: ["dash"],
  gap: ["gap"],
  line_width: ["line_width"],
  line_color: ["line_color"],
  corner_radius: ["corner_radius"],
};

const EFH_LABELS = {
  solar: "Zonnepanelen (vermogen)",
  home: "Huidig verbruik huis (leeg = berekenen)",
  battery: "Batterij vermogen",
  battery_soc: "Batterij laadniveau (SOC %)",
  grid: "Netvermogen",
  weather: "Weer (weather- of temperatuursensor)",
  temperature: "Temperatuursensor (optioneel, overschrijft weer)",
  invert_battery: "Batterij omkeren (positief = laden)",
  invert_grid: "Net omkeren (positief = teruglevering)",
  calculate_home: "Verbruik berekenen als er geen sensor is",
  image: "Afbeelding huis (URL, bijv. /local/huis.png)",
  aspect_ratio: "Verhouding kaart (breedte / hoogte)",
  image_width: "Breedte afbeelding (%)",
  background: "Achtergrond (CSS-kleur)",
  font_scale: "Tekstgrootte",
  show_direction: "Richting tonen (afname / laden …)",
  show_battery_indicator: "Batterij-indicator tonen",
  battery_orientation: "Richting batterij-indicator",
  battery_show_text: "Percentage in indicator tonen",
  name_solar: "Naam zonnepanelen",
  name_home: "Naam verbruik",
  name_battery: "Naam batterij",
  name_grid: "Naam net",
  min_power: "Minimaal vermogen voor animatie (W)",
  max_power: "Vermogen voor maximale snelheid (W)",
  speed: "Animatiesnelheid",
  dash: "Lengte streepje (%)",
  gap: "Ruimte tussen streepjes (%)",
  line_width: "Lijndikte (%)",
  line_color: "Kleur inactieve lijn (CSS)",
  corner_radius: "Afronding hoeken (%)",
};

const EFH_HELPERS = {
  battery: "Standaard: positief = ontladen (naar huis), negatief = laden.",
  grid: "Standaard: positief = afname van het net, negatief = teruglevering.",
  home: "Leeg laten om te berekenen: zon + net + batterij.",
};

const EFH_SCHEMAS = {
  entities: [
    { name: "solar", selector: { entity: { domain: "sensor" } } },
    { name: "home", selector: { entity: { domain: "sensor" } } },
    { name: "battery", selector: { entity: { domain: "sensor" } } },
    { name: "battery_soc", selector: { entity: { domain: "sensor" } } },
    { name: "grid", selector: { entity: { domain: "sensor" } } },
    { name: "weather", selector: { entity: { domain: ["weather", "sensor"] } } },
    { name: "temperature", selector: { entity: { domain: "sensor" } } },
    { name: "invert_battery", selector: { boolean: {} } },
    { name: "invert_grid", selector: { boolean: {} } },
    { name: "calculate_home", selector: { boolean: {} } },
  ],
  layout: [
    { name: "image", selector: { text: {} } },
    { name: "aspect_ratio", selector: { number: { min: 0.3, max: 3, step: 0.001, mode: "box" } } },
    { name: "image_width", selector: { number: { min: 5, max: 300, step: 0.5, mode: "slider" } } },
    { name: "background", selector: { text: {} } },
    { name: "font_scale", selector: { number: { min: 0.4, max: 2.5, step: 0.05, mode: "slider" } } },
    { name: "show_direction", selector: { boolean: {} } },
    { name: "show_battery_indicator", selector: { boolean: {} } },
    {
      name: "battery_orientation",
      selector: {
        select: {
          mode: "dropdown",
          options: [
            { value: "vertical", label: "Verticaal" },
            { value: "horizontal", label: "Horizontaal" },
          ],
        },
      },
    },
    { name: "battery_show_text", selector: { boolean: {} } },
    { name: "name_solar", selector: { text: {} } },
    { name: "name_home", selector: { text: {} } },
    { name: "name_battery", selector: { text: {} } },
    { name: "name_grid", selector: { text: {} } },
  ],
  animation: [
    { name: "min_power", selector: { number: { min: 0, max: 1000, step: 1, mode: "box" } } },
    { name: "max_power", selector: { number: { min: 100, max: 50000, step: 100, mode: "box" } } },
    { name: "speed", selector: { number: { min: 1, max: 60, step: 1, mode: "slider" } } },
    { name: "dash", selector: { number: { min: 0.5, max: 30, step: 0.5, mode: "slider" } } },
    { name: "gap", selector: { number: { min: 0.5, max: 50, step: 0.5, mode: "slider" } } },
    { name: "line_width", selector: { number: { min: 0.1, max: 3, step: 0.05, mode: "slider" } } },
    { name: "corner_radius", selector: { number: { min: 0, max: 10, step: 0.5, mode: "slider" } } },
    { name: "line_color", selector: { text: {} } },
  ],
};

const EFH_FLOW_NAMES = { solar: "Zonnepanelen", grid: "Net", battery: "Batterij", home: "Verbruik" };

const EFH_EDITOR_CSS = `
:host { display:block; }
details { border:1px solid var(--divider-color, #444); border-radius:10px; margin-bottom:12px; overflow:hidden; }
summary { cursor:pointer; padding:12px 14px; font-weight:500; background:var(--secondary-background-color, rgba(127,127,127,.08)); }
.body { padding:12px 14px; }
.toolbar { display:flex; flex-direction:column; gap:8px; margin-bottom:10px; }
.row { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
button, select, input[type=number] { font:inherit; font-size:13px; color:var(--primary-text-color);
  background:var(--card-background-color, #222); border:1px solid var(--divider-color, #555); border-radius:8px; padding:6px 10px; }
button { cursor:pointer; }
button:hover { border-color:var(--primary-color, #03a9f4); }
button.on { background:var(--primary-color, #03a9f4); color:var(--text-primary-color, #fff); border-color:var(--primary-color, #03a9f4); }
input[type=color] { width:36px; height:30px; padding:0; border:none; background:none; vertical-align:middle; }
input[type=number] { width:64px; }
label.inl { display:inline-flex; align-items:center; gap:6px; font-size:13px; }
.help { font-size:12.5px; color:var(--secondary-text-color); line-height:1.45; }
.help b { color:var(--primary-text-color); font-weight:500; }
.canvas { border-radius:10px; overflow:hidden; outline:1px solid var(--divider-color, #444); }
.ff { display:flex; flex-direction:column; gap:10px; }
.ff label { display:flex; flex-direction:column; gap:4px; font-size:13px; color:var(--secondary-text-color); }
.ff label.cb { flex-direction:row; align-items:center; gap:8px; color:var(--primary-text-color); }
.ff input[type=text], .ff select { font:inherit; padding:7px 9px; border-radius:6px; border:1px solid var(--divider-color,#555);
  background:var(--card-background-color,#222); color:var(--primary-text-color); }
.ff input[type=number] { width:auto; }
`;

class EnergyFlowHouseCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tool = "move";
    this._active = "solar";
    this._forms = [];
  }

  setConfig(config) {
    const next = efhNormalize(config);
    delete next.type;
    if (this._config && JSON.stringify(next) === JSON.stringify(this._config)) return;
    this._config = next;
    if (this._built) this._sync();
    else this._build();
  }

  set hass(h) {
    this._hass = h;
    this._forms.forEach((f) => (f.hass = h));
    if (this._card) this._card.hass = h;
    if (this._datalist && !this._datalist.childElementCount) this._fillDatalist();
  }

  async _ensureHa() {
    if (customElements.get("ha-form") && customElements.get("ha-entity-picker")) return true;
    try {
      const helpers = await window.loadCardHelpers?.();
      if (helpers) {
        const c = await helpers.createCardElement({ type: "entities", entities: [] });
        await c?.constructor?.getConfigElement?.();
      }
    } catch (_) {}
    return Promise.race([
      customElements.whenDefined("ha-form").then(() => true),
      new Promise((r) => setTimeout(() => r(!!customElements.get("ha-form")), 2500)),
    ]);
  }

  async _build() {
    if (this._building) return;
    this._building = true;
    const haForm = await this._ensureHa();
    const root = this.shadowRoot;
    root.innerHTML = `
      <style>${EFH_EDITOR_CSS}</style>
      <details open><summary>🎨 Ontwerper — verplaatsen &amp; lijnen tekenen</summary><div class="body">
        <div class="toolbar">
          <div class="row">
            <button data-tool="move">✥ Verplaatsen</button>
            <button data-tool="draw">✎ Lijnen tekenen</button>
            <span style="flex:1"></span>
            <button data-act="fit" title="Kaartverhouding gelijk maken aan de afbeelding">⤢ Afbeelding passend maken</button>
          </div>
          <div class="row draw-only">
            <select class="active"></select>
            <label class="inl">Kleur <input type="color" class="color"></label>
            <label class="inl">Dikte <input type="number" class="width" step="0.05" min="0.05"></label>
          </div>
          <div class="row draw-only">
            <button data-act="undo">↶ Laatste punt</button>
            <button data-act="reverse">⇄ Richting omdraaien</button>
            <button data-act="clear">🗑 Lijn wissen</button>
            <button data-act="add-line">＋ Extra lijn</button>
            <button data-act="del-line">－ Extra lijn verwijderen</button>
          </div>
          <div class="help"></div>
        </div>
        <div class="canvas"></div>
      </div></details>
      <details open><summary>🔌 Entiteiten</summary><div class="body" data-form="entities"></div></details>
      <details><summary>🖼️ Afbeelding &amp; weergave</summary><div class="body" data-form="layout"></div></details>
      <details><summary>⚡ Animatie &amp; lijnen</summary><div class="body" data-form="animation"></div></details>
      <datalist id="efh-entities"></datalist>`;
    this._datalist = root.querySelector("#efh-entities");
    this._fillDatalist();

    for (const key of Object.keys(EFH_SCHEMAS)) {
      const host = root.querySelector(`[data-form="${key}"]`);
      const form = haForm ? this._haForm(key) : this._fallbackForm(key);
      host.appendChild(form);
      this._forms.push(form);
    }

    // ontwerpcanvas = de kaart zelf in ontwerpmodus
    this._card = document.createElement("energy-flow-house-card");
    this._card.setConfig(this._config);
    this._card.designOptions = { tool: this._tool, active: this._active };
    if (this._hass) this._card.hass = this._hass;
    this._card.addEventListener("efh-design-changed", (e) => {
      e.stopPropagation();
      this._emit(e.detail.config, false);
    });
    root.querySelector(".canvas").appendChild(this._card);

    root.querySelectorAll("[data-tool]").forEach((b) =>
      b.addEventListener("click", () => {
        this._tool = b.dataset.tool;
        this._syncToolbar();
      })
    );
    root.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => this._action(b.dataset.act)));
    root.querySelector(".active").addEventListener("change", (e) => {
      this._active = e.target.value;
      this._syncToolbar();
    });
    root.querySelector(".color").addEventListener("change", (e) =>
      this._mutate((c) => (this._activeObj(c).color = e.target.value))
    );
    root.querySelector(".width").addEventListener("change", (e) => {
      const v = parseFloat(e.target.value);
      this._mutate((c) => {
        if (Number.isFinite(v) && v > 0) this._activeObj(c).width = v;
        else delete this._activeObj(c).width;
      });
    });

    this._built = true;
    this._building = false;
    this._sync();
  }

  _fillDatalist() {
    if (!this._datalist || !this._hass) return;
    this._datalist.innerHTML = Object.keys(this._hass.states)
      .filter((id) => /^(sensor|weather)\./.test(id))
      .sort()
      .map((id) => `<option value="${efhEsc(id)}">`)
      .join("");
  }

  _formData() {
    const d = {};
    for (const [name, path] of Object.entries(EFH_FIELDS)) d[name] = efhGetPath(this._config, path);
    return d;
  }

  _applyForm(values) {
    this._mutate((c) => {
      for (const [name, path] of Object.entries(EFH_FIELDS)) {
        if (!(name in values)) continue;
        let v = values[name];
        if (path[0] === "entities" && !v) v = undefined;
        efhSetPath(c, path, v);
      }
    });
  }

  _haForm(key) {
    const f = document.createElement("ha-form");
    f.schema = EFH_SCHEMAS[key];
    f.data = this._formData();
    f.computeLabel = (s) => EFH_LABELS[s.name] || s.name;
    f.computeHelper = (s) => EFH_HELPERS[s.name];
    if (this._hass) f.hass = this._hass;
    f.addEventListener("value-changed", (e) => {
      e.stopPropagation();
      const v = e.detail.value || {};
      const sub = {};
      for (const s of EFH_SCHEMAS[key]) sub[s.name] = v[s.name];
      this._applyForm(sub);
    });
    f._efhRefresh = () => (f.data = this._formData());
    return f;
  }

  _fallbackForm(key) {
    const wrap = document.createElement("div");
    wrap.className = "ff";
    const inputs = {};
    for (const s of EFH_SCHEMAS[key]) {
      const lab = document.createElement("label");
      const sel = s.selector;
      let inp;
      if (sel.boolean) {
        lab.className = "cb";
        inp = document.createElement("input");
        inp.type = "checkbox";
        lab.append(inp, document.createTextNode(EFH_LABELS[s.name]));
      } else {
        lab.append(document.createTextNode(EFH_LABELS[s.name]));
        if (sel.select) {
          inp = document.createElement("select");
          inp.innerHTML = sel.select.options.map((o) => `<option value="${o.value}">${efhEsc(o.label)}</option>`).join("");
        } else {
          inp = document.createElement("input");
          inp.type = sel.number ? "number" : "text";
          if (sel.number) Object.assign(inp, { min: sel.number.min, max: sel.number.max, step: sel.number.step });
          if (sel.entity) inp.setAttribute("list", "efh-entities");
        }
        lab.append(inp);
      }
      inp.addEventListener("change", () => {
        let v = sel.boolean ? inp.checked : inp.value;
        if (sel.number) v = v === "" ? undefined : parseFloat(v);
        this._applyForm({ [s.name]: v });
      });
      inputs[s.name] = { inp, sel };
      wrap.appendChild(lab);
    }
    wrap._efhRefresh = () => {
      const d = this._formData();
      for (const [n, { inp, sel }] of Object.entries(inputs)) {
        if (this.shadowRoot.activeElement === inp) continue;
        if (sel.boolean) inp.checked = !!d[n];
        else inp.value = d[n] ?? "";
      }
    };
    return wrap;
  }

  _activeObj(c) {
    if (this._active.startsWith("line:")) return c.lines[Number(this._active.slice(5))];
    return c.flows[this._active];
  }

  _action(act) {
    if (act === "fit") {
      const r = this._card?.imageRatio;
      if (!r) return;
      this._mutate((c) => {
        c.aspect_ratio = Math.round(r * 1000) / 1000;
        c.image_position = { x: 0, y: 0, width: 100 };
      });
      return;
    }
    if (act === "add-line") {
      this._mutate((c) => c.lines.push({ points: [], color: "rgba(255,255,255,0.45)" }));
      this._active = `line:${this._config.lines.length - 1}`;
      this._tool = "draw";
      this._syncToolbar();
      return;
    }
    if (act === "del-line") {
      if (!this._active.startsWith("line:")) return;
      const i = Number(this._active.slice(5));
      this._active = "solar";
      this._mutate((c) => c.lines.splice(i, 1));
      return;
    }
    this._mutate((c) => {
      const o = this._activeObj(c);
      if (!o) return;
      if (act === "undo") o.points.pop();
      if (act === "clear") o.points = [];
      if (act === "reverse") o.points.reverse();
    });
  }

  _mutate(fn) {
    const c = efhClone(this._config);
    fn(c);
    this._emit(c, true);
  }

  _emit(config, updateCard) {
    this._config = efhNormalize(config);
    delete this._config.type;
    if (updateCard && this._card) this._card.setConfig(this._config);
    this._syncForms();
    this._syncToolbar();
    const out = { ...this._config };
    delete out.type;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: { type: "custom:energy-flow-house-card", ...out } },
        bubbles: true,
        composed: true,
      })
    );
  }

  _sync() {
    if (!this._built) return;
    if (this._card && !this._card._drag) this._card.setConfig(this._config);
    this._syncForms();
    this._syncToolbar();
  }

  _syncForms() {
    this._forms.forEach((f) => f._efhRefresh?.());
  }

  _syncToolbar() {
    const root = this.shadowRoot;
    if (!this._built) return;
    const c = this._config;
    if (this._active.startsWith("line:") && !c.lines[Number(this._active.slice(5))]) this._active = "solar";
    root.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === this._tool));
    root.querySelectorAll(".draw-only").forEach((r) => (r.style.display = this._tool === "draw" ? "" : "none"));
    const sel = root.querySelector(".active");
    const opts = [
      ...EFH_FLOWS.map((k) => [k, `Stroom: ${EFH_FLOW_NAMES[k]}`]),
      ...c.lines.map((_, i) => [`line:${i}`, `Extra lijn ${i + 1} (statisch)`]),
    ];
    sel.innerHTML = opts
      .map(([v, l]) => `<option value="${v}" ${v === this._active ? "selected" : ""}>${efhEsc(l)}</option>`)
      .join("");
    const o = this._activeObj(c);
    const col = o?.color;
    root.querySelector(".color").value = /^#[0-9a-f]{6}$/i.test(col || "") ? col : "#ffd23f";
    root.querySelector(".width").value = o?.width ?? "";
    root.querySelector(".width").placeholder = String(c.line_width);
    root.querySelector('[data-act="del-line"]').style.display = this._active.startsWith("line:") ? "" : "none";
    const isFlow = !this._active.startsWith("line:");
    root.querySelector(".help").innerHTML =
      this._tool === "move"
        ? `<b>Verplaatsen:</b> sleep de afbeelding, labels, het weer en de batterij-indicator naar de juiste plek.
           Met het blauwe hoekje rechtsonder pas je de grootte van de afbeelding of batterij-indicator aan.`
        : `<b>Tekenen:</b> klik op de kaart om een punt toe te voegen aan de gekozen lijn. Sleep een punt om het te verplaatsen,
           dubbelklik of rechtsklik om het te verwijderen. Houd <b>Shift</b> ingedrukt voor rechte lijnen.
           ${isFlow ? `Het <b style="color:#4cd964">groene</b> beginpunt is de bron: teken vanaf de bron (zon, net, batterij) richting het huis.
           De pijlen tonen de richting bij positieve waarden.` : ""}`;
    if (this._card) this._card.designOptions = { tool: this._tool, active: this._active };
  }
}

if (!customElements.get("energy-flow-house-card")) {
  customElements.define("energy-flow-house-card", EnergyFlowHouseCard);
}
if (!customElements.get("energy-flow-house-card-editor")) {
  customElements.define("energy-flow-house-card-editor", EnergyFlowHouseCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "energy-flow-house-card")) {
  window.customCards.push({
    type: "energy-flow-house-card",
    name: "Energy Flow House Card",
    description: "Geanimeerde energiestromen over een eigen afbeelding van je huis, met zelf getekende lijnen.",
    preview: true,
    documentationURL: "https://github.com/",
  });
}

console.info(
  `%c ENERGY-FLOW-HOUSE-CARD %c v${EFH_VERSION} `,
  "color:#1f232b;background:#ffd23f;font-weight:700",
  "color:#ffd23f;background:#1f232b"
);
