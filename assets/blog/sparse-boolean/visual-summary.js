const summary = document.querySelector(".visual-summary");

// runtime.js
/* Shared runtime. Every figure supplies build(root) and draw(t); the time t (seconds) fully determines the frame,
   so pausing, jumping to a step and replaying are all just changes to t. */
/* A section whose h2 has class "slides-only" appears only on the deck, one with "report-only" only in the report.
   Both stay in the file, so that the page can always be unpacked into its complete sources (build.js --unpack). */
(() => {
  const deck = summary.classList.contains("deck");
  summary.querySelectorAll(deck ? "h2.report-only" : "h2.slides-only").forEach(h => {
    for (let e = h, n; e && (e === h || e.tagName !== "H2"); e = n) { n = e.nextElementSibling; e.remove(); }
  });
})();

const AF = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const ICON = {
    Pause: '<svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><path d="M0 0h3.4v12H0zM6.6 0H10v12H6.6z" fill="currentColor"/></svg>',
    Play: '<svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><path d="M1 1l8.4 5L1 11z" fill="currentColor"/></svg>'
  };
  const set = (e, a) => { for (const k in a) e.setAttribute(k, a[k]); return e; };
  const mk = (p, tag, a) => set(p.appendChild(document.createElementNS(NS, tag)), a || {});
  const txt = (p, s, a) => { const e = mk(p, "text", a); e.textContent = s; return e; };
  // text made of styled runs: rich(p, [["plain "], ["t", {"font-style": "italic"}]], attrs)
  const rich = (p, parts, a) => { const e = mk(p, "text", a); parts.forEach(q => { mk(e, "tspan", q[1] || {}).textContent = q[0]; }); return e; };
  const clamp = u => Math.min(1, Math.max(0, u));
  const ease = u => { u = clamp(u); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
  const mix = (a, b, u) => a.map((v, i) => v + (b[i] - v) * u);
  // progress (0..1, eased) of the i-th item of a row whose items come in one after another: the first begins at `start`,
  // each next one `gap` seconds later, and each takes `dur` seconds. Use it wherever several things appear in one step.
  const stagger = (t, i, start, gap, dur) => ease((t - start - i * (gap === undefined ? 0.08 : gap)) / (dur || 0.35));
  const rgb = c => "rgb(" + c.map(Math.round).join(",") + ")";
  // point at fraction u on a quadratic curve from a to b whose middle is pushed sideways by h
  const arc = (a, b, h, u) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1, v = 1 - u;
    const mx = (a[0] + b[0]) / 2 + h * dy / n, my = (a[1] + b[1]) / 2 - h * dx / n;
    return [v * v * a[0] + 2 * v * u * mx + u * u * b[0], v * v * a[1] + 2 * v * u * my + u * u * b[1]];
  };
  // arrow along a polyline that can be drawn partially: returns f(fraction, opacity)
  const arrow = (p, color, pts, both) => {
    const g = mk(p, "g"), n = pts.length, a = pts[n - 2], b = pts[n - 1];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), deg = ang * 180 / Math.PI;
    const a0 = Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]);
    const q = pts.map(v => v.slice());
    q[n - 1] = [b[0] - 5 * Math.cos(ang), b[1] - 5 * Math.sin(ang)];
    if (both) q[0] = [pts[0][0] + 5 * Math.cos(a0), pts[0][1] + 5 * Math.sin(a0)];
    const path = mk(g, "path", {d: q.map((v, i) => (i ? "L" : "M") + v[0] + " " + v[1]).join(""), fill: "none", stroke: color,
      "stroke-width": 1.4, "stroke-linejoin": "round", pathLength: 1});
    const head = mk(g, "path", {d: "M0 0L-7 -3.6L-7 3.6Z", fill: color, transform: "translate(" + b[0] + "," + b[1] + ") rotate(" + deg + ")"});
    if (both) mk(g, "path", {d: "M0 0L7 -3.6L7 3.6Z", fill: color,
      transform: "translate(" + pts[0][0] + "," + pts[0][1] + ") rotate(" + a0 * 180 / Math.PI + ")"});
    return (u, op) => {
      set(path, {"stroke-dasharray": u + " 1"});
      set(head, {opacity: clamp((u - 0.8) / 0.2)});
      set(g, {opacity: u > 0.001 ? (op === undefined ? 1 : op) : 0});
    };
  };
  const caps = (p, s, x, y, fill, anchor) => txt(p, s, {x, y, "text-anchor": anchor || "middle", "font-size": 11, "font-weight": 700,
    "letter-spacing": 0.9, fill});

  /* Pacing. The authored timeline of a figure says what happens in which order; how long each step lasts on screen is
     worked out here from how much the step asks of the viewer:
       - motion is slowed by M = BASE + PER_STEP per step beyond three + up to DENSE when many shapes appear or change;
       - the step then lasts at least as long as it takes to read its caption plus the labels it reveals (WPS words a second),
         with the picture held still at the end of the step for whatever reading time the motion did not cover. */
  const PACE = {WPS: 5.5, BASE: 1.15, PER_STEP: 0.1, DENSE: 0.3, DENSE_AT: 60, MIN_HOLD: 1.2, MAX_HOLD: 7, END_HOLD: 1.2};
  let speed = 1, held = null;
  const setSpeed = v => { speed = v; };
  const hold = id => { held = id; };
  // hover note on an element: title (the symbol or term as drawn), body (plain sentences), src (where it comes from).
  // A small dot after the element's text shows that it opens; a group also gets an invisible pad so it is easy to hit.
  const note = (e, title, body, src) => {
    set(e, {"data-note-title": title, "data-note": body, tabindex: 0});
    if (src) e.setAttribute("data-note-src", src);
    e.classList.add("has-note");
    const label = e.tagName === "text" ? e : e.tagName === "g" ? [...e.querySelectorAll("text")].pop() : null;
    if (label) mk(label, "tspan", {class: "note-mark", dx: 2.5, dy: -3.5, "font-size": 8}).textContent = "•";
    if (e.tagName === "g") {
      const b = e.getBBox();
      if (b.width && b.height) e.insertBefore(set(document.createElementNS(NS, "rect"), {class: "note-pad", x: b.x - 3, y: b.y - 3,
        width: b.width + 6, height: b.height + 6, fill: "#fff", "fill-opacity": 0}), e.firstChild);
    }
    return e;
  };
  const words = s => (s.match(/[A-Za-z][A-Za-z’'*-]+/g) || []).length;

  function run(o) {
    const fig = document.getElementById(o.id);
    if (!fig) return;                         // its section belongs to the other output form
    const svg = fig.querySelector(".anim-stage svg");
    if (svg.querySelector("image")) fig.classList.add("pic");   // holds a picture from the source: night mode leaves it as it is
    const btn = fig.querySelector(".anim-play"), steps = [...fig.querySelectorAll(".anim-step")];
    const notes = [...fig.querySelectorAll(".anim-cap p")];
    const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const n = o.starts.length, ends = o.starts.map((s, k) => k + 1 < n ? o.starts[k + 1] : o.rest);
    const root = mk(svg, "g");
    o.build(root, svg);

    // what is on screen at timeline time t: element -> a signature of how it looks, or null if not visible
    const snap = t => {
      o.draw(t);
      const v = new Map();
      root.querySelectorAll("text,rect,circle,path,line").forEach(e => {
        let op = 1;
        for (let m = e; m !== root; m = m.parentNode) op *= +(m.getAttribute("opacity") ?? 1);
        v.set(e, op > 0.5 ? ["fill", "cx", "x", "width"].map(a => e.getAttribute(a)).join("|") + e.parentNode.getAttribute("transform") : null);
      });
      return v;
    };
    let wall = 0;
    const seg = o.starts.map((s, k) => {
      const a = k ? snap(s + 0.001) : new Map(), z = snap(ends[k] - 0.001), seen = new Set();
      let read = words(notes[k] ? notes[k].textContent : ""), shapes = 0;
      z.forEach((now, e) => {
        const was = a.get(e) ?? null;
        if (e.tagName === "text") { if (was === null && now !== null && !seen.has(e.textContent)) { seen.add(e.textContent); read += words(e.textContent); } }
        else if (was !== now) shapes++;
      });
      const M = PACE.BASE + PACE.PER_STEP * Math.max(0, n - 3) + PACE.DENSE * Math.min(1, shapes / PACE.DENSE_AT);
      const move = (ends[k] - s) * M;
      const total = Math.min(Math.max(move + PACE.MIN_HOLD, read / PACE.WPS), move + PACE.MAX_HOLD) + (k === n - 1 ? PACE.END_HOLD : 0);
      const g = {k, t0: s, t1: ends[k], w0: wall, M, move, total, read, shapes};
      wall += total;
      return g;
    });
    const W = wall + (o.T - o.rest);
    // wall-clock position tau -> timeline time, current step, progress through the step
    const at = tau => {
      if (tau >= wall) return {t: Math.min(o.T, o.rest + tau - wall), k: n - 1, p: 1};
      const g = seg.find(g => tau < g.w0 + g.total);
      return {t: tau < g.w0 + g.move ? g.t0 + (tau - g.w0) / g.M : g.t1 - 0.001, k: g.k, p: (tau - g.w0) / g.total};
    };

    let t = o.rest, tau = 0, playing = !still, visible = false, begun = false, raf = 0, prev = null, prog = 0;
    let limit = null, cur = 0;      // slides: the deck shows one step at a time, and the clock stops at `limit`
    let life = 0;                   // seconds this figure has been running. It keeps counting while a step is held, and is
                                    // passed to draw(t, life) for idle motion such as the sway of a scene with depth
    function render() {
      set(root, {opacity: Math.min(1, t / 0.4, (o.T - t) / 0.6)});
      o.draw(t, life);
      let k = 0;
      while (k + 1 < n && t >= o.starts[k + 1]) k++;
      steps.forEach((b, j) => {
        b.classList.toggle("on", j === k);
        b.setAttribute("aria-pressed", j === k);
        b.style.setProperty("--p", (j === k && playing ? prog * 100 : 0) + "%");
      });
      notes.forEach((c, j) => { c.hidden = j !== k; });
    }
    function tick(now) {
      if (prev !== null && held !== o.id) {                           // waits while one of its notes is open
        const dt = Math.min(0.1, (now - prev) / 1000);
        tau += dt * speed; life += dt;
      }
      prev = now;
      if (limit !== null && tau >= limit) { tau = limit; playing = !!o.idle; }   // a figure with idle motion keeps drawing
      else if (tau >= W) tau -= W;
      const s = at(tau);
      t = s.t; prog = limit === null ? s.p : 0;
      render();
      if (playing) raf = requestAnimationFrame(tick); else { raf = 0; sync(); }
    }
    function sync() {
      const label = playing ? "Pause" : "Play";
      btn.innerHTML = ICON[label];
      btn.setAttribute("aria-label", label);
      const on = playing && (visible || limit !== null);
      if (on && !raf) { prev = null; raf = requestAnimationFrame(tick); }
      if (!on && raf) { cancelAnimationFrame(raf); raf = 0; }
    }
    btn.addEventListener("click", () => { playing = !playing; sync(); render(); });
    // Slides: show(k, true) plays step k once and stops on its last frame; show(k) goes straight to that frame.
    function show(k, animate) {
      cur = k;
      limit = seg[k].w0 + seg[k].move;
      tau = animate && !still ? seg[k].w0 : limit;
      playing = tau < limit || (!!o.idle && !still);
      t = at(tau).t; prog = 0;
      render();
      sync();
    }
    steps.forEach((b, k) => b.addEventListener("click", () => {
      if (limit !== null) show(k, true);
      else if (playing) tau = seg[k].w0;                              // playing: replay from that step
      else { tau = seg[k].w0 + seg[k].move; t = at(tau).t; render(); }  // paused: show where that step ends
    }));
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(es => {
        visible = es[es.length - 1].isIntersecting;
        if (limit === null && visible && playing && !begun) { begun = true; tau = 0; }
        sync();
      }, {threshold: 0.3}).observe(fig);
    } else { visible = true; }
    (window.__frames = window.__frames || {})[o.id] = s => { playing = false; sync(); t = s; render(); };
    (window.__meta = window.__meta || {})[o.id] = {starts: o.starts, rest: o.rest, T: o.T, W, seg};
    (window.__figs = window.__figs || {})[o.id] = {n, show, get k() { return cur; }, stop() { playing = false; sync(); }};
    render();
    sync();
  }
  return {set, mk, txt, rich, clamp, ease, mix, stagger, rgb, arc, arrow, caps, note, run, setSpeed, hold};
})();

/* Default palette. Give each hue ONE meaning for the whole page and say so in the colour key (see SKILL.md).
   _S = soft, _T = tint, for fills behind text or for "the other value". */
const PAL = {
  RED: [182, 54, 41], RED_S: [233, 170, 161], RED_T: [246, 216, 211],
  BLUE: [36, 104, 176], BLUE_S: [168, 196, 230], BLUE_T: [220, 232, 245], BLUE_W: [246, 249, 253],
  AMB: [168, 110, 8], AMB_S: [228, 192, 122], AMB_T: [248, 235, 208],
  GRN: [52, 118, 86], GRN_S: [164, 205, 182], GRN_T: [222, 238, 228],
  KNOWN: [229, 231, 236], GREY: [238, 238, 238], WHITE: [255, 255, 255],
  INK: "#212121", MID: "#666666", SOFT: "#888888"
};

/* Small drawing pieces that recur. Put pieces specific to one page in a kit-page.js next to the figure files. */
const KIT = (() => {
  const {set, mk, txt, rgb} = AF;
  function lock(parent, x, y, color) {          // "hidden / private"
    const g = mk(parent, "g");
    mk(g, "path", {d: "M" + (x - 2.6) + " " + (y - 0.5) + "v-2.4a2.6 2.6 0 0 1 5.2 0v2.4", fill: "none", stroke: color, "stroke-width": 1.3});
    mk(g, "rect", {x: x - 4.3, y: y - 0.8, width: 8.6, height: 6.6, rx: 1.4, fill: color});
    return g;
  }
  function eye(parent, x, y, color) {           // "known / visible"
    const g = mk(parent, "g");
    mk(g, "path", {d: "M" + (x - 7) + " " + y + "Q" + x + " " + (y - 6.5) + " " + (x + 7) + " " + y + "Q" + x + " " + (y + 6.5) + " " + (x - 7) + " " + y + "Z",
      fill: "none", stroke: color, "stroke-width": 1.3, "stroke-linejoin": "round"});
    mk(g, "circle", {cx: x, cy: y, r: 2.1, fill: color});
    return g;
  }
  function bar(parent, x, y, w, color) {        // horizontal bar with its number: returns f(value 0..1, opacity)
    const g = mk(parent, "g");
    mk(g, "rect", {x, y, width: w, height: 10, rx: 5, fill: "#ededed"});
    const f = mk(g, "rect", {x, y, height: 10, rx: 5, fill: rgb(color)});
    const n = txt(g, "", {x: x + w + 10, y: y + 9.3, "font-size": 12.5, "font-weight": 700, fill: rgb(color)});
    return (v, op) => { set(f, {width: Math.max(10, w * v), opacity: v > 0.005 ? 1 : 0}); n.textContent = v.toFixed(2); set(g, {opacity: op}); };
  }
  // Pseudo-3D. Points [x, y, z] (y up, z toward the reader, in stage units about cx, cy) are turned by yaw and pitch and
  // projected onto the stage. It only computes where to draw. Use it wherever the geometry is the point (SKILL.md, "Depth").
  function space(cx, cy, persp) {
    let cw = 1, sw = 0, cp = 1, sp = 0;
    const s = {
      view(yaw, pitch) { cw = Math.cos(yaw); sw = Math.sin(yaw); cp = Math.cos(pitch); sp = Math.sin(pitch); return s; },
      // [yaw, pitch] of the view that looks straight at a plane with normal n
      facing(n) { return [Math.atan2(-n[0], n[2]), Math.asin(n[1] / Math.hypot(n[0], n[1], n[2]))]; },
      // -> [stage x, stage y, depth (larger is nearer), size factor (1 unless perspective is on)]
      pt(p) {
        const x = p[0] * cw + p[2] * sw, z = -p[0] * sw + p[2] * cw, y = p[1] * cp - z * sp, d = p[1] * sp + z * cp;
        const k = persp ? persp / (persp - d) : 1;
        return [cx + x * k, cy - y * k, d, k];
      },
      // path data through 3-D points
      path(pts, close) { return pts.map((p, i) => { const q = s.pt(p); return (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1); }).join("") + (close ? "Z" : ""); },
      // path data of a circle of radius r about c, lying in the plane of the perpendicular unit vectors u and v
      ring(c, r, u, v) {
        const pts = [];
        for (let i = 0; i < 48; i++) { const a = r * Math.cos(i * Math.PI / 24), b = r * Math.sin(i * Math.PI / 24); pts.push([0, 1, 2].map(j => c[j] + a * u[j] + b * v[j])); }
        return s.path(pts, true);
      },
      // nearer things on top: items = [[element, depth], ...]; the DOM is touched only when the order changes
      stack(parent, items) {
        const order = items.map((it, i) => [it[1], i]).sort((a, b) => a[0] - b[0]).map(o => o[1]), key = order.join();
        if (parent.__order !== key) { parent.__order = key; order.forEach(i => parent.appendChild(items[i][0])); }
      },
      // a shaded sphere of radius r about the origin (the only gradient the page allows)
      ball(parent, r) {
        if (!document.getElementById("ball-shade")) {
          const g = mk(mk(parent.ownerSVGElement, "defs"), "radialGradient", {id: "ball-shade", cx: "36%", cy: "30%", r: "72%"});
          mk(g, "stop", {offset: "0%", "stop-color": "#ffffff"});
          mk(g, "stop", {offset: "100%", "stop-color": "#e8e8e8"});
        }
        return mk(parent, "circle", {cx, cy, r, fill: "url(#ball-shade)", stroke: "#dcdcdc"});
      }
    };
    return s.view(-0.5, 0.35);
  }
  /* Annotating a picture taken from the source. The picture is an <image> in the figure's own svg (see body.html) and is
     never changed; these pieces sit on top of it. Coordinates are stage units: picture pixels x 680 / picture width. */
  // spot: dims the stage except one rectangle. Returns f([x, y, w, h], strength 0..1). Move the rectangle to move the light.
  function spot(parent, W, H) {
    const p = mk(parent, "path", {fill: "#fff", "fill-rule": "evenodd"});
    return (r, k) => set(p, {d: "M0 0H" + W + "V" + H + "H0ZM" + r[0] + " " + r[1] + "v" + r[3] + "h" + r[2] + "v" + (-r[3]) + "Z", "fill-opacity": 0.74 * k});
  }
  // lens: an enlarged copy of the region `from` = [x, y, w, h], shown in the box `to` (same proportions). Returns
  // f(u, opacity): at u = 0 the copy lies on the region itself, at u = 1 in the box, so the detail is seen to come out
  // of the picture. Put the box on a blank or uniform part of the picture.
  function lens(parent, svg, from, to) {
    const img = svg.querySelector("image"), g = mk(parent, "g");
    if (!img.id) img.id = "pic-" + svg.closest("figure").id;
    mk(g, "rect", {x: from[0], y: from[1], width: from[2], height: from[3], fill: "none", stroke: PAL.INK, "stroke-width": 1.1});
    const ties = mk(g, "path", {fill: "none", stroke: PAL.INK, "stroke-width": 0.8, "stroke-dasharray": "3 3"});
    const v = mk(g, "svg", {viewBox: from.join(" "), preserveAspectRatio: "none"});
    mk(v, "use", {href: "#" + img.id});
    const edge = mk(g, "rect", {fill: "none", stroke: PAL.INK, "stroke-width": 1.2});
    return (u, op) => {
      const b = from.map((a, i) => a + (to[i] - a) * u), box = {x: b[0], y: b[1], width: b[2], height: b[3]};
      set(v, box); set(edge, box);
      set(ties, {d: "M" + (from[0] + from[2]) + " " + from[1] + "L" + (b[0] + b[2]) + " " + b[1] + "M" + from[0] + " " + (from[1] + from[3]) + "L" + b[0] + " " + (b[1] + b[3]), opacity: u});
      set(g, {opacity: op === undefined ? 1 : op});
    };
  }
  // hot: an unseen area over part of the picture (an axis, a legend entry, the name of a metric) that carries a hover
  // note; a small dot at its corner shows that it opens
  function hot(parent, x, y, w, h, title, body, src) {
    const g = mk(parent, "g");
    mk(g, "rect", {x, y, width: w, height: h, fill: "#fff", "fill-opacity": 0});
    mk(g, "circle", {class: "note-mark", cx: x + w + 3, cy: y + 2, r: 2.2});
    return AF.note(g, title, body, src);
  }
  return {lock, eye, bar, space, spot, lens, hot};
})();

/* Night mode. By default it follows the clock: night from 19:00 to 07:00 local time, looked at again every minute. The
   button goes Auto -> Night -> Day -> Auto. The figures are drawn for the light page; the style sheet inverts them with
   their hues kept, and leaves pictures taken from the source as they are. Nothing is stored: a reload is back on Auto. */
(() => {
  const root = summary, H = [19, 7], order = ["auto", "night", "day"];
  const face = {auto: ["◐", "Auto"], night: ["☾", "Night"], day: ["☀", "Day"]};
  let mode = "auto";
  const dark = () => mode === "night" || (mode === "auto" && (h => h >= H[0] || h < H[1])(new Date().getHours()));
  const apply = () => {
    root.classList.toggle("night", dark());
    summary.querySelectorAll(".theme, .deck-theme").forEach(b => {
      b.textContent = b.classList.contains("theme") ? face[mode].join(" ") : face[mode][0];
      b.setAttribute("aria-label", "Colour theme: " + face[mode][1] + ". Press to change");
    });
  };
  window.__theme = m => { mode = order.includes(m) ? m : order[(order.indexOf(mode) + 1) % 3]; apply(); return mode; };
  summary.addEventListener("click", e => { if (e.target.closest && e.target.closest(".theme, .deck-theme")) window.__theme(); });
  setInterval(apply, 60000);
  apply();
})();

/* Speed control: folded to the current speed, opens on hover, focus or tap. */
(() => {
  const sp = summary.querySelector(".speed");
  if (!sp) return;
  const now = sp.querySelector(".speed-now"), opts = [...sp.querySelectorAll("[data-v]")];
  now.addEventListener("click", () => sp.classList.toggle("open"));
  opts.forEach(b => b.addEventListener("click", () => {
    AF.setSpeed(+b.dataset.v);
    opts.forEach(c => c.setAttribute("aria-pressed", c === b));
    now.textContent = "Speed " + b.textContent;
    sp.classList.remove("open");
  }));
})();

/* Hover notes. Any element carrying data-note (set by AF.note in a figure, or written by hand in the prose) opens a small
   card on hover, keyboard focus or tap. Elements that are not visible at that moment do not respond, and a figure's clock
   is held while one of its notes is open. */
(() => {
  const card = summary.appendChild(document.createElement("div"));
  card.className = "note-card";
  card.setAttribute("role", "tooltip");
  let open = null, timer = 0;
  const visible = e => { for (let n = e; n && n.getAttribute; n = n.parentNode) if (+(n.getAttribute("opacity") ?? 1) < 0.5) return false; return true; };
  const find = e => { const n = e.target.closest ? e.target.closest("[data-note]") : null; return n && summary.contains(n) && visible(n) ? n : null; };
  const hide = () => {
    clearTimeout(timer);
    if (open) { open = null; AF.hold(null); card.classList.remove("on"); }
  };
  const show = n => {
    const f = n.closest("figure.anim");
    open = n;
    AF.hold(f ? f.id : null);
    card.textContent = "";
    [["b", "data-note-title"], ["p", "data-note"], ["small", "data-note-src"]].forEach(([tag, a]) => {
      if (n.getAttribute(a)) card.appendChild(document.createElement(tag)).textContent = n.getAttribute(a);
    });
    const r = n.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight, vw = document.documentElement.clientWidth;
    card.style.left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), vw - w - 8) + "px";
    card.style.top = (r.top - h - 10 >= 8 ? r.top - h - 10 : r.bottom + 10) + "px";
    card.classList.add("on");
  };
  document.addEventListener("pointerover", e => {
    if (e.pointerType === "touch") return;
    const n = find(e);
    if (n === open) return;
    hide();
    if (n) timer = setTimeout(() => show(n), 140);
  });
  document.addEventListener("click", e => { const n = find(e); if (!n) hide(); else if (n !== open) { hide(); show(n); } });
  document.addEventListener("focusin", e => { const n = find(e); if (n && n !== open) { hide(); show(n); } });
  document.addEventListener("focusout", hide);
  document.addEventListener("keydown", e => { if (e.key === "Escape") hide(); });
  window.addEventListener("scroll", hide, {passive: true});
})();


// fig1.js
/* Fig. 1: the task. 12 invented input bits, a hidden subset B of 8, parity as the product of the bits in B,
   and its decomposition into a tree of two-bit products (Sec. 2.1, Eq. 1). All values are invented. */
(() => {
  const {set, mk, txt, rich, ease, rgb, caps, note, stagger} = AF, P = PAL;
  const X = [+1, -1, -1, +1, -1, +1, +1, -1, -1, +1, +1, -1];
  const B = [0, 2, 3, 5, 7, 8, 10, 11];
  const pairs = [[0, 2], [3, 5], [7, 8], [10, 11]];
  const bx = i => 96 + i * 44, BY = 236, CW = 32;
  const s = v => (v > 0 ? "+1" : "−1");
  let el;

  function build(root) {
    el = {bits: [], lines: [], nodes: [], levels: []};
    caps(root, "INPUT  x", 24, BY + 12, P.INK, "start");
    X.forEach((v, i) => {
      const g = mk(root, "g");
      const r = mk(g, "rect", {x: bx(i) - CW / 2, y: BY - 15, width: CW, height: 30, rx: 5, fill: rgb(P.KNOWN), stroke: "none", "stroke-width": 1.6});
      const t = txt(g, s(v), {x: bx(i), y: BY + 5, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: P.INK});
      txt(g, "x" + (i + 1), {x: bx(i), y: BY + 31, "text-anchor": "middle", "font-size": 10.5, fill: P.MID});
      el.bits.push({g, r, t, inB: B.includes(i)});
    });
    el.bLab = txt(root, "8 hidden positions B decide the answer", {x: 338, y: BY + 54, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: rgb(P.BLUE)});
    note(el.bLab, "Hidden subset B", "A k-sparse Boolean function depends on only k of the d input bits. Here k = 8 of d = 12; the experiment of Fig. 6 uses k = 16 of d = 20.", "Definition 2.1; App. D");

    // step 2: one model asked for the answer directly
    el.direct = mk(root, "g");
    X.forEach((v, i) => mk(el.direct, "line", {x1: bx(i), y1: BY - 17, x2: 338, y2: 108, stroke: rgb(P.RED_S), "stroke-width": 1, "stroke-dasharray": "3 3"}));
    mk(el.direct, "rect", {x: 270, y: 76, width: 136, height: 32, rx: 6, fill: "#fff", stroke: rgb(P.RED), "stroke-width": 1.4});
    txt(el.direct, "answer in one go", {x: 338, y: 96.5, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: rgb(P.RED)});
    el.hard = txt(root, "the gradient says almost nothing about which bits are in B", {x: 338, y: 56, "text-anchor": "middle", "font-size": 12.5, fill: rgb(P.RED)});
    note(el.hard, "Why one go is hard", "For parity, the gradient of an end-to-end objective barely depends on which subset is the target: with 2^d possible targets, the signal is exponentially small in d [2]. Proposition 3.2 shows the same for RL with only a final reward.", "Prop. 3.2");

    // step 3: the tree of two-bit products
    const L1 = pairs.map(([a, b]) => (bx(a) + bx(b)) / 2), L2 = [(L1[0] + L1[1]) / 2, (L1[2] + L1[3]) / 2], L3 = [(L2[0] + L2[1]) / 2];
    const v1 = pairs.map(([a, b]) => X[a] * X[b]), v2 = [v1[0] * v1[1], v1[2] * v1[3]], v3 = [v2[0] * v2[1]];
    const ys = [178, 124, 72];
    const levels = [[L1, v1, pairs.map(([a, b]) => [bx(a), bx(b)]), BY - 17], [L2, v2, [[L1[0], L1[1]], [L1[2], L1[3]]], ys[0] - 14],
                    [L3, v3, [[L2[0], L2[1]]], ys[1] - 14]];
    levels.forEach(([xs, vals, kids, ky], k) => {
      const g = mk(root, "g"), y = ys[k];
      xs.forEach((x, j) => {
        kids[j].forEach(cx => mk(g, "line", {x1: x, y1: y + 14, x2: cx, y2: ky, stroke: rgb(P.BLUE_S), "stroke-width": 1.4}));
        mk(g, "circle", {cx: x, cy: y, r: 14, fill: rgb(P.BLUE_T), stroke: rgb(P.BLUE), "stroke-width": 1.4});
        txt(g, s(vals[j]), {x, y: y + 4.5, "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: rgb(P.BLUE)});
      });
      const lab = txt(g, k === 2 ? "step 3 = answer" : "step " + (k + 1), {x: 24, y: y + 4.5, "font-size": 12.5, "font-weight": 700, fill: rgb(P.BLUE)});
      if (k === 0) note(lab, "One reasoning step per level", "Each node applies the same two-input function to its two children. For parity it is the product, so a node is +1 when its children agree. A chain of T = log2 k steps reaches the answer.", "Sec. 2.1, Eq. (1)");
      el.levels.push(g);
    });
    el.ans = rich(root, [["product of the bits in B = "], ["+1", {"font-weight": 700}]], {x: 420, y: 76, "font-size": 12.5, fill: rgb(P.BLUE)});
    note(el.ans, "k-PARITY", "The answer is +1 when an even number of the bits in B are −1, and −1 otherwise. The paper treats k-AND and k-OR in the same way, with other two-input functions.", "Definition 2.1, Table 1");
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    el.bits.forEach((b, i) => {
      set(b.g, {opacity: stagger(t, i, 0.2, 0.06, 0.3)});
      const hi = b.inB ? E(1.3, 1.8) : 0;
      set(b.r, {stroke: rgb(P.BLUE), "stroke-opacity": hi, fill: rgb(b.inB ? P.KNOWN.map((c, j) => c + (P.BLUE_T[j] - c) * hi) : P.KNOWN)});
      set(b.t, {fill: b.inB && hi > 0.5 ? rgb(P.BLUE) : P.INK});
    });
    set(el.bLab, {opacity: E(1.8, 2.2)});
    // step 2 (3.0 - 6.0): asked for directly, the target is hidden in the gradient
    const d = E(3.2, 3.8) * (1 - E(6.2, 6.7));
    set(el.direct, {opacity: d});
    set(el.hard, {opacity: E(4.0, 4.4) * (1 - E(6.2, 6.7))});
    // step 3 (6.2 - ): build the tree level by level
    el.levels.forEach((g, k) => set(g, {opacity: E(6.9 + k * 0.9, 7.4 + k * 0.9)}));
    set(el.ans, {opacity: E(9.6, 10.0)});
  }
  AF.run({id: "fig-task", starts: [0, 3.0, 6.2], rest: 10.6, T: 11.4, build, draw});
})();


// fig2.js
/* Fig. 2: what the one-layer transformer has to learn (Sec. 2.2, Eq. 3). The sequence of Fig. 1: 12 input bits,
   then empty slots for the three steps. One token of step 1 is followed: uniform attention at the start, attention
   1/2 on its two children at the goal; psi(z) = z^2 for parity (Table 1). Values are the invented ones of Fig. 1. */
(() => {
  const {set, mk, txt, rich, ease, rgb, caps, note, stagger} = AF, P = PAL;
  const X = [+1, -1, -1, +1, -1, +1, +1, -1, -1, +1, +1, -1];
  const kids = [3, 5];                                   // children of the followed token y(1)_2: x4 and x6
  const Y = 236, CW = 24;                                 // tokens 0..11 inputs, 12..15 step 1, 16..17 step 2, 18 step 3
  const XS = [...Array(12).keys()].map(i => 36 + 29 * i).concat([398, 427, 456, 485, 524, 553, 592]);
  const groups = [[12, 15, "step 1"], [16, 17, "step 2"], [18, 18, "step 3"]];
  const tokX = i => XS[i];
  const F = 13;                                          // the followed token: y(1)_2
  let el;

  function build(root) {
    el = {tok: [], arcs: []};
    // attention arcs from the followed token to every input (drawn first, under the tokens)
    for (let i = 0; i < 12; i++) {
      const x0 = tokX(F), x1 = tokX(i), h = 40 + Math.abs(x0 - x1) * 0.28;
      el.arcs.push(mk(root, "path", {d: `M${x0} ${Y - 16}C${x0} ${Y - 16 - h} ${x1} ${Y - 16 - h} ${x1} ${Y - 16}`, fill: "none", stroke: rgb(P.BLUE), "stroke-width": 1}));
    }
    for (let i = 0; i < 19; i++) {
      const g = mk(root, "g"), inp = i < 12;
      const r = mk(g, "rect", {x: tokX(i) - CW / 2, y: Y - 14, width: CW, height: 28, rx: 5,
        fill: inp ? rgb(P.KNOWN) : "#fff", stroke: inp ? "none" : rgb([190, 195, 203]), "stroke-dasharray": inp ? "none" : "3 2"});
      const t = txt(g, inp ? (X[i] > 0 ? "+1" : "−1") : (i === F ? "+1" : ""), {x: tokX(i), y: Y + 4.5, "text-anchor": "middle", "font-size": 11.5, "font-weight": 700, fill: inp ? P.INK : rgb(P.BLUE)});
      el.tok.push({g, r, t});
    }
    caps(root, "INPUT  x", (tokX(0) + tokX(11)) / 2, Y + 34, P.MID);
    groups.forEach(([a, b, s]) => txt(root, s, {x: (tokX(a) + tokX(b)) / 2, y: Y + 34, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: P.MID}));
    // step 2: what each step may read (the pretrained mask)
    el.mask = mk(root, "g");
    [[0, 11, 12, 15], [12, 15, 16, 17], [16, 17, 18, 18]].forEach(([a, b, c, d], k) => {
      const y = Y + 50 + k * 0;
      const x0 = (tokX(a) + tokX(b)) / 2, x1 = (tokX(c) + tokX(d)) / 2;
      mk(el.mask, "path", {d: `M${x1} ${Y + 40}Q${(x0 + x1) / 2} ${Y + 64} ${x0} ${Y + 40}`, fill: "none", stroke: P.SOFT, "stroke-width": 1.2});
      mk(el.mask, "path", {d: "M0 0L-6 -3.2L-6 3.2Z", fill: P.SOFT, transform: `translate(${x0},${Y + 40}) rotate(${k === 0 ? 230 : 215})`});
    });
    el.maskLab = txt(root, "each step reads only the step before it", {x: 400, y: Y + 76, "text-anchor": "middle", "font-size": 12, fill: P.MID});
    note(el.maskLab, "“Pretrained” mask", "A fixed mask lets a token of step t attend only to the tokens of step t − 1, and step 1 only to the input. We treat it as a stand-in for what pretraining provides: a structural prior, not something learned here.", "Sec. 2.2, Fig. 2b");
    // the followed token and its readout
    el.focus = mk(root, "rect", {x: tokX(F) - CW / 2 - 4, y: Y - 18, width: CW + 8, height: 36, rx: 7, fill: "none", stroke: rgb(P.BLUE), "stroke-width": 1.6});
    el.uni = txt(root, "start: 1/12 of its attention on every input", {x: 24, y: 40, "font-size": 12.5, "font-weight": 700, fill: rgb(P.RED)});
    note(el.uni, "Uniform attention", "At initialisation all attention scores are equal (W = 1), so the token averages all 12 inputs. The average is close to 0 whatever the answer, so its output carries no information.", "Theorem 3.1 setting");
    el.goal = txt(root, "goal: 1/2 on each of its two children, 0 elsewhere", {x: 24, y: 40, "font-size": 12.5, "font-weight": 700, fill: rgb(P.BLUE)});
    note(el.goal, "Attention to the children", "Learning the function means finding, for every token of the chain, the two positions it should read: the children of its node in the tree of Fig. 1.", "Sec. 3.1, W*");
    el.calc = rich(root, [["ξ = (x4 + x6)/2 = 1,   "], ["P(+1) = ψ(ξ) = ξ² = 1", {"font-weight": 700}], ["  → writes +1 = x4·x6"]],
      {x: 24, y: 64, "font-size": 12.5, fill: rgb(P.BLUE)});
    note(el.calc, "ψ for parity", "The token outputs +1 with probability ψ(ξ), where ξ is the attention-weighted average. With ψ(z) = z², agreeing children give ξ = ±1 and output +1; differing children give ξ = 0 and output −1. AND and OR use other ψ (Table 1).", "Eq. (3), Table 1");
    el.calc0 = rich(root, [["ξ = average of 12 bits ≈ 0,   "], ["P(+1) = ψ(ξ) ≈ 0", {"font-weight": 700}], ["  → output unrelated to the answer"]],
      {x: 24, y: 64, "font-size": 12.5, fill: rgb(P.RED)});
    el.att = txt(root, "attention", {x: 232, y: 100, "text-anchor": "middle", "font-size": 11, fill: rgb(P.BLUE)});
    note(el.att, "Attention over positions", "The key and query matrices are merged into one matrix W over positional encodings, so attention depends only on positions. Fine-tuning changes which positions each token reads.", "Sec. 2.2, Eq. (2)");
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    el.tok.forEach((k, i) => set(k.g, {opacity: stagger(t, i, 0.2, 0.05, 0.3)}));
    // step 2 (2.8 - 5.6): the mask
    set(el.mask, {opacity: E(3.0, 3.6)});
    set(el.maskLab, {opacity: E(3.4, 3.8)});
    // step 3 (5.6 - 8.8): follow one token, attention uniform
    const f = E(5.8, 6.2);
    set(el.focus, {opacity: f});
    const u = E(6.2, 7.0), g = E(9.2, 10.4);              // uniform arcs appear, then concentrate on the children
    el.arcs.forEach((a, i) => {
      const kid = kids.includes(i);
      const w = kid ? 1 + 3.2 * g : 1 * (1 - g);
      set(a, {opacity: u * (kid ? 1 : 0.85 * (1 - g)), "stroke-width": Math.max(0.01, w), stroke: rgb(kid ? P.BLUE : (g > 0.05 ? P.RED_S : P.BLUE))});
    });
    set(el.att, {opacity: u * (1 - g)});
    set(el.uni, {opacity: E(6.8, 7.2) * (1 - E(9.0, 9.4))});
    set(el.calc0, {opacity: E(7.4, 7.8) * (1 - E(9.0, 9.4))});
    // step 4 (8.8 - ): the goal
    set(el.goal, {opacity: E(9.4, 9.8)});
    set(el.calc, {opacity: E(10.6, 11.0)});
    el.tok.forEach((k, i) => {
      if (kids.includes(i)) set(k.r, {fill: rgb(P.KNOWN.map((c, j) => c + (P.BLUE_T[j] - c) * g)), stroke: rgb(P.BLUE), "stroke-opacity": g});
      if (i === F) { const w = E(11.0, 11.4); set(k.t, {opacity: w}); set(k.r, {fill: rgb([255, 255, 255].map((c, j) => c + (P.BLUE_T[j] - c) * w))}); }
    });
  }
  AF.run({id: "fig-model", starts: [0, 2.8, 5.6, 8.8], rest: 11.8, T: 12.6, build, draw});
})();


// fig3.js
/* Fig. 3: four ways to give feedback on a three-step chain, after Fig. 1 of the paper (our own drawing).
   RL with process reward (Eq. 5), RL with final reward (Prop. 3.2), SFT with teacher forcing (App. B, Q4),
   SFT without teacher forcing (Eq. 10-11). */
(() => {
  const {set, mk, txt, rich, ease, rgb, note, arrow} = AF, P = PAL;
  const AMB = rgb(P.AMB), GRN = rgb(P.GRN), BLUE = rgb(P.BLUE);
  const panels = [
    {x: 20, y: 10, title: "RL, reward for every step", hue: "amb", kind: "rlpr", foot: "each step scored, given the model’s own previous step"},
    {x: 20, y: 166, title: "RL, reward for the answer only", hue: "amb", kind: "rlfin", foot: "only the final answer is scored"},
    {x: 350, y: 10, title: "SFT with teacher forcing", hue: "grn", kind: "sfttf", foot: "each step is fed the correct previous step"},
    {x: 350, y: 166, title: "SFT on its own steps", hue: "grn", kind: "sftown", foot: "own previous steps, labels fixed by the input"}
  ];
  let el;

  function box(g, cx, cy, label, style) {
    const w = 46, h = 26;
    const fill = {gen: "#fff", gt: rgb(P.GRN_T), ok: rgb(P.BLUE_T), x: rgb(P.KNOWN)}[style];
    const stroke = {gen: rgb([150, 156, 166]), gt: GRN, ok: BLUE, x: "none"}[style];
    mk(g, "rect", {x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: 5, fill, stroke, "stroke-width": 1.2});
    const parts = label.split("|");
    return rich(g, parts.length > 1 ? [[parts[0], {"font-style": "italic"}], [parts[1], {"font-size": 9.5, dy: -5}]] : [[label, {"font-style": "italic"}]],
      {x: cx, y: cy + 4.5, "text-anchor": "middle", "font-size": 12.5, fill: style === "gt" ? GRN : style === "ok" ? BLUE : P.INK});
  }
  function badge(g, cx, cy, label, hue) {
    mk(g, "rect", {x: cx - 15, y: cy - 9, width: 30, height: 18, rx: 9, fill: hue === "amb" ? rgb(P.AMB_T) : rgb(P.GRN_T), stroke: hue === "amb" ? AMB : GRN, "stroke-width": 1});
    return rich(g, [[label[0], {"font-style": "italic"}], [label.slice(1), {"font-size": 9, dy: 3}]], {x: cx, y: cy + 3.5, "text-anchor": "middle", "font-size": 11.5, "font-weight": 700, fill: hue === "amb" ? AMB : GRN});
  }

  function build(root) {
    el = [];
    panels.forEach(p => {
      const g0 = mk(root, "g"), hue = p.hue === "amb" ? AMB : GRN;
      const g = mk(g0, "g"), gf = mk(g0, "g"), gn = mk(g0, "g");
      mk(g, "rect", {x: p.x, y: p.y, width: 310, height: 146, rx: 8, fill: p.hue === "amb" ? "#fdfaf3" : "#f6faf7", stroke: p.hue === "amb" ? rgb(P.AMB_S) : rgb(P.GRN_S), "stroke-width": 1});
      const title = txt(g, p.title, {x: p.x + 12, y: p.y + 21, "font-size": 12.5, "font-weight": 700, fill: hue});
      const X = [p.x + 36, p.x + 104, p.x + 172, p.x + 240], top = p.y + 48, low = p.y + 102, mid = (top + low) / 2;
      box(g, X[0], top, "x", "x");
      const genRow = p.kind !== "sfttf";
      for (let t = 1; t <= 3; t++) {
        // the model's step t: generated from its own previous step, or (teacher forcing) from the correct one
        box(g, X[t], top, "ŷ|(" + t + ")", "gen");
        if (genRow || t === 1) arrow(g, P.SOFT, [[X[t - 1] + 24, top], [X[t] - 24, top]])(1);
      }
      if (p.kind === "rlpr") {
        for (let t = 1; t <= 3; t++) {
          const lab = box(gf, X[t], low, "ȳ|(" + t + ")", "ok");
          arrow(gf, rgb(P.BLUE_S), [[X[t - 1] + 23, top + 8], [X[t] - 23, low - 8]])(1);
          badge(gf, X[t], mid, "r" + t, "amb");
          if (t === 1) note(lab, "ȳ(t): the step checked locally", "The correct value of step t given the model’s own previous step ŷ(t−1). A verifier checks each step locally, so the reward for step t is informative even when earlier steps are wrong.", "Eq. (5)");
        }
      } else if (p.kind === "rlfin") {
        const lab = box(gf, X[3], low, "Φ(x)", "ok");
        note(lab, "Φ(x): the true answer", "With only a final reward, the model is told whether its last step equals the true answer, and nothing about the steps before it.", "Prop. 3.2");
        badge(gf, X[3], mid, "r ", "amb");
        txt(gf, "no feedback on steps 1 and 2", {x: (X[1] + X[2]) / 2 - 4, y: mid + 4, "text-anchor": "middle", "font-size": 11.5, fill: rgb(P.RED)});
      } else {
        for (let t = 1; t <= 3; t++) {
          const lab = box(gf, X[t], low, "ỹ|(" + t + ")", "gt");
          badge(gf, X[t], mid, "L" + t, "grn");
          if (p.kind === "sfttf" && t < 3) arrow(gf, GRN, [[X[t] + 23, low - 8], [X[t + 1] - 23, top + 8]])(1);
          if (t === 1) note(lab, "ỹ(t): the ground-truth step", "The correct value of step t computed from the input x alone, as in a labelled chain of thought. It does not change with what the model generated before.", "Sec. 3.2");
        }
      }
      txt(gn, p.foot, {x: p.x + 12, y: p.y + 134, "font-size": 11.5, fill: P.MID});
      if (p.kind === "rlpr") note(title, "RL with verifiable process rewards", "The model samples a whole chain; each step earns a reward r_t that compares its tokens with ȳ(t). We analyse vanilla policy gradient with signed updates, as in reasoning models trained with process rewards [5][6].", "Sec. 3.1");
      if (p.kind === "rlfin") note(title, "RL with a final reward", "The reward depends only on the last step. For parity, Proposition 3.2 bounds how much the policy gradient can depend on the target, and the bound is exponentially small in d.", "Prop. 3.2");
      if (p.kind === "sfttf") note(title, "Teacher forcing", "Each step is generated from the correct previous step ỹ(t−1) rather than the model’s own, so all steps train on clean inputs. The paper treats it in App. B, Q4.", "App. B, Q4");
      if (p.kind === "sftown") note(title, "SFT without teacher forcing", "The model generates the whole chain itself, as it will at test time, and each generated step is compared with the fixed label ỹ(t) by a hinge loss L_t. No data augmentation or filtering.", "Eqs. (10)–(11)");
      el.push([g, gf, gn]);
    });
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    const on = [0.2, 3.4, 6.6, 9.8];
    el.forEach(([g, gf, gn], k) => {
      set(g, {opacity: E(on[k], on[k] + 0.4)});
      set(gf, {opacity: E(on[k] + 0.7, on[k] + 1.1)});
      set(gn, {opacity: E(on[k] + 1.3, on[k] + 1.7)});
    });
  }
  AF.run({id: "fig-supervision", starts: [0, 3.2, 6.4, 9.6], rest: 12.4, T: 13.2, build, draw});
})();


// fig4.js
/* Fig. 4 (depth): one token's attention as a point on the probability simplex, with its irrelevant positions merged into
   one corner (they keep equal scores under signed updates). The point moves along the median towards the edge of the
   two children. Attention on each child after one signed update of size eta, from Theorem 4.1 (RL, parity) with
   d_{t-1} visible positions: 1 / (2 + (d_{t-1} - 2) exp(-2 eta)). */
(() => {
  const {set, mk, txt, rich, ease, rgb, caps, note} = AF, P = PAL;
  const L = 170, S = KIT.space(220, 222);
  const A = [L, 0, 0], B = [0, 0, L], C = [0, L, 0];
  const at = sig => [sig * L, (1 - 2 * sig) * L, sig * L];          // attention (sig, sig, 1 - 2 sig) as a point
  const sigma = (eta, d) => 1 / (2 + (d - 2) * Math.exp(-2 * eta));
  const D = 20, ETAS = [1, 2, 3];
  const later = [[2, 8], [3, 4], [4, 2]];                            // step, visible positions
  let el;

  function build(root) {
    el = {};
    const g = mk(root, "g");
    el.axes = [A, B, C].map(() => mk(g, "line", {stroke: "#cdd1d7", "stroke-width": 1}));
    el.face = mk(g, "path", {fill: rgb(P.KNOWN), "fill-opacity": 0.55, stroke: "#9aa1ab", "stroke-width": 1.2, "stroke-linejoin": "round"});
    el.childEdge = mk(g, "path", {stroke: rgb(P.BLUE), "stroke-width": 2.6, fill: "none"});
    el.median = mk(g, "path", {stroke: rgb(P.BLUE_S), "stroke-width": 1.2, "stroke-dasharray": "4 3", fill: "none"});
    el.ticks = ETAS.map(() => mk(g, "circle", {r: 2.6, fill: rgb(P.BLUE)}));
    el.tickLab = ETAS.map(e => txt(g, "η = " + e, {"font-size": 10.5, fill: rgb(P.BLUE), "text-anchor": "end"}));
    el.trail = mk(g, "path", {stroke: rgb(P.BLUE), "stroke-width": 2.2, fill: "none"});
    el.arrow = mk(g, "path", {stroke: P.INK, "stroke-width": 1.5, fill: "none"});
    el.head = mk(g, "path", {d: "M0 0L-7 -3.6L-7 3.6Z", fill: P.INK});
    el.target = mk(g, "circle", {r: 9, fill: "none", stroke: rgb(P.BLUE), "stroke-width": 1.6});
    el.later = later.map(() => mk(g, "circle", {r: 4.5, fill: "#fff", stroke: P.INK, "stroke-width": 1.4}));
    el.laterLab = later.map(([s]) => txt(g, "step " + s, {"font-size": 10.5, fill: P.MID}));
    el.dot = mk(g, "circle", {r: 6, fill: P.INK, stroke: "#fff", "stroke-width": 1.5});
    // corner labels, flat and upright at projected points
    el.labA = txt(root, "child 1", {"font-size": 12.5, "font-weight": 700, fill: rgb(P.BLUE)});
    el.labB = txt(root, "child 2", {"font-size": 12.5, "font-weight": 700, fill: rgb(P.BLUE), "text-anchor": "end"});
    el.labC = txt(root, "all other positions", {"font-size": 12.5, "font-weight": 700, fill: rgb(P.RED), "text-anchor": "middle"});
    note(el.labA, "Children", "The two positions this token must read: the children of its node in the tree of Fig. 1. At this corner all attention is on child 1.");
    note(el.labC, "The other positions", "All positions that are not children, merged into one corner. A token of step 1 sees 20 inputs, so 18 positions sit here; under the signed update they keep equal scores, so three numbers describe the attention.", "Theorem 4.1");
    el.startLab = txt(root, "start: 1/20 on every input", {"font-size": 12, fill: P.INK});
    note(el.startLab, "Uniform start", "At initialisation all scores are equal, so a step-1 token puts 1/20 of its attention on each of the 20 inputs: 0.05 on each child and 0.90 on the rest.", "Theorem 3.1 setting");
    el.gradLab = mk(root, "g");
    txt(el.gradLab, "signed gradient:", {x: 0, y: 0, "font-size": 12, fill: P.INK});
    rich(el.gradLab, [["+", {"font-weight": 700, fill: rgb(P.BLUE)}], [" at the children,"]], {x: 0, y: 16, "font-size": 12, fill: P.INK});
    rich(el.gradLab, [["−", {"font-weight": 700, fill: rgb(P.RED)}], [" elsewhere"]], {x: 0, y: 32, "font-size": 12, fill: P.INK});
    note(el.gradLab, "The separation condition", "The critical gradient component γ is larger, in expectation, at a token’s children than at any other position. Then the sign of the gradient is + at the children and − elsewhere, which points attention straight at the children’s edge.", "Eqs. (7)–(8), (12)");
    el.targetLab = txt(root, "target: ½ on each child", {"font-size": 12, "font-weight": 700, fill: rgb(P.BLUE)});
    // right-hand readout
    const R = mk(root, "g");
    el.head1 = caps(R, "ONE UPDATE OF SIZE η", 452, 52, P.INK, "start");
    el.rows = [["start", sigma(0, D)], ...ETAS.map(e => ["η = " + e, sigma(e, D)])].map(([a, v], i) => {
      const r = mk(R, "g");
      txt(r, a, {x: 452, y: 94 + i * 22, "font-size": 12.5, fill: P.INK});
      txt(r, v.toFixed(2), {x: 640, y: 94 + i * 22, "text-anchor": "end", "font-size": 12.5, "font-weight": 700, fill: rgb(P.BLUE)});
      return r;
    });
    el.rowHead = txt(R, "attention on each child", {x: 452, y: 70, "font-size": 10.5, fill: P.MID});
    note(el.rowHead, "Theorem 4.1", "For parity under RL, attention on each child after s signed updates of size η is 1 / (2 + (d − 2) e^(−2ηs)), where d = 20 is the number of positions a step-1 token sees. A step of size of order ln(d/ε) lands within ε of the target in one update.", "Theorem 4.1, Theorem 3.1");
    el.steps = mk(root, "g");
    caps(el.steps, "WHERE EACH STEP STARTS", 452, 206, P.INK, "start");
    [[1, 20], ...later].forEach(([s, d], i) => {
      txt(el.steps, "step " + s + " · sees " + d, {x: 452, y: 232 + i * 22, "font-size": 12.5, fill: P.INK});
      txt(el.steps, (1 / d).toFixed(d === 8 ? 3 : 2), {x: 640, y: 232 + i * 22, "text-anchor": "end", "font-size": 12.5, "font-weight": 700, fill: rgb(P.BLUE)});
    });
    el.root = g;
  }

  function draw(t, life = 0) {
    const E = (a, b) => ease((t - a) / (b - a));
    S.view(-0.78 + 0.07 * Math.sin(0.8 * life), 0.38);
    const q = p => S.pt(p);
    const [a, b, c, o] = [q(A), q(B), q(C), q([0, 0, 0])];
    el.axes.forEach((ln, i) => { const v = [a, b, c][i]; set(ln, {x1: o[0], y1: o[1], x2: v[0], y2: v[1], opacity: E(0.2, 0.8)}); });
    set(el.face, {d: S.path([A, B, C], true), opacity: E(0.3, 1.0)});
    set(el.childEdge, {d: S.path([A, B]), opacity: E(0.9, 1.4)});
    set(el.labA, {x: a[0] + 8, y: a[1] + 18, opacity: E(1.0, 1.4)});
    set(el.labB, {x: b[0] - 8, y: b[1] + 18, opacity: E(1.2, 1.6)});
    set(el.labC, {x: c[0], y: c[1] - 12, opacity: E(1.4, 1.8)});
    const mAB = [L / 2, 0, L / 2], s0 = sigma(0, D);
    set(el.median, {d: S.path([C, mAB]), opacity: E(4.0, 4.6) * 0.9});
    // the step-1 token: start, then one large signed update
    const eta = 3 * E(6.9, 9.9), sNow = sigma(eta, D), pNow = q(at(sNow)), p0 = q(at(s0));
    set(el.dot, {cx: pNow[0], cy: pNow[1], opacity: E(2.0, 2.4)});
    set(el.startLab, {x: p0[0] + 16, y: p0[1] - 6, opacity: E(2.3, 2.7)});
    set(el.trail, {d: `M${p0[0]} ${p0[1]}L${pNow[0]} ${pNow[1]}`, opacity: eta > 0.01 ? 1 : 0});
    ETAS.forEach((e, i) => {
      const p = q(at(sigma(e, D))), seen = E(6.9 + (9.9 - 6.9) * e / 3 - 0.2, 6.9 + (9.9 - 6.9) * e / 3);
      set(el.ticks[i], {cx: p[0], cy: p[1], opacity: seen});
      set(el.tickLab[i], {x: p[0] - (i === 2 ? 16 : 8), y: p[1] + (i === 2 ? -5 : 4), opacity: seen});
      set(el.rows[i + 1], {opacity: seen});
    });
    set(el.rows[0], {opacity: E(2.4, 2.8)});
    set(el.rowHead, {opacity: E(2.4, 2.8)});
    set(el.head1, {opacity: E(2.3, 2.7)});
    // step 2: the direction of the signed gradient, and the target
    const tgt = q(mAB), u = E(3.8, 4.6), aim = q(at(s0 + (0.5 - s0) * 0.42));
    const tip = [p0[0] + (aim[0] - p0[0]) * u, p0[1] + (aim[1] - p0[1]) * u];
    set(el.arrow, {d: `M${p0[0] + 10} ${p0[1]}L${tip[0] + 10} ${tip[1]}`, opacity: u > 0.01 ? (1 - E(6.7, 7.1)) : 0});
    const ang = Math.atan2(aim[1] - p0[1], aim[0] - p0[0]) * 180 / Math.PI;
    set(el.head, {transform: `translate(${tip[0] + 10},${tip[1]}) rotate(${ang})`, opacity: AF.ease((u - 0.15) / 0.3) * (1 - E(6.7, 7.1))});
    set(el.gradLab, {transform: `translate(${p0[0] + 66},${(p0[1] + aim[1]) / 2 - 12})`, opacity: E(4.4, 4.8) * (1 - E(6.7, 7.1))});
    set(el.target, {cx: tgt[0], cy: tgt[1], opacity: E(5.0, 5.4)});
    set(el.targetLab, {x: tgt[0] + 14, y: tgt[1] + 30, opacity: E(5.2, 5.6)});
    // step 4: where the tokens of later steps start; under RL they all move in the same update
    later.forEach(([s, d], i) => {
      const p = q(at(1 / d)), v = E(11.0 + i * 0.4, 11.4 + i * 0.4);
      set(el.later[i], {cx: p[0], cy: p[1], opacity: s === 4 ? 0 : v});
      set(el.laterLab[i], {x: p[0] + (s === 4 ? 14 : 10), y: p[1] + (s === 4 ? -8 : 4), opacity: v});
    });
    set(el.steps, {opacity: E(10.8, 11.3)});
  }
  AF.run({id: "fig-simplex", starts: [0, 3.4, 6.6, 10.6], rest: 13.4, T: 14.2, build, draw, idle: true});
})();


// fig5.js
/* Fig. 5: which steps of a four-step chain have their attention on target before training and after each signed
   update, for the four kinds of feedback of Fig. 3 (same layout). Schematic summary of Theorem 3.1 (RL, process reward:
   all steps after one update), App. B Q4 (SFT with teacher forcing: all at once), Theorem 3.3 (SFT on its own steps:
   one step per update, at most T updates), Proposition 3.2 (RL with final reward: for parity the gradient carries
   almost no information about the target). The last step has one token that reads only its two children, so its
   attention is on target from the start (dashed cells), in every setting; this is why Fig. 7 needs only three updates. */
(() => {
  const {set, mk, txt, rich, ease, rgb, note} = AF, P = PAL;
  const AMB = rgb(P.AMB), GRN = rgb(P.GRN), BLUE = rgb(P.BLUE);
  const T = 4, U = 4, CW = 30, CH = 16;                     // four steps; columns: before training, then updates 1-3
  const panels = [
    {x: 20, y: 10, title: "RL, reward for every step", hue: "amb", learned: (step, upd) => upd >= 1, verdict: "all steps after one update",
     why: ["Theorem 3.1", "Each step’s reward checks it against the right value given the model’s own previous step, so every step gets a useful gradient at once. One signed update with a large enough step learns the whole chain."]},
    {x: 20, y: 166, title: "RL, reward for the answer only", hue: "amb", learned: () => false, verdict: "for parity, almost no signal",
     why: ["Proposition 3.2", "With only a final reward, the policy gradient barely depends on which parity is the target: its variance across the 2^d targets is at most M/2^d. The figure shows no step learned; the theory gives a hardness bound, not a schedule."]},
    {x: 350, y: 10, title: "SFT with teacher forcing", hue: "grn", learned: (step, upd) => upd >= 1, verdict: "all steps after one update",
     why: ["App. B, Q4", "Every step trains on the correct previous step, so the separation condition holds for all steps at the first update, as for RL with process rewards."]},
    {x: 350, y: 166, title: "SFT on its own steps", hue: "grn", learned: (step, upd) => upd >= step, verdict: "one step per update",
     why: ["Theorem 3.3", "A later step’s fixed label only matches a correct prefix once the earlier steps are right, so each update learns the next step. Theorem 3.3 allows T updates for T steps; here the last step is right from the start, so three are enough."]}
  ];
  const ups = [0.9, 1.9, 4.6, 7.8];                        // when each column fills: before training, updates 1, 2, 3
  const ok = (p, s, u) => s === T || p.learned(s, u);      // the last step is on target from the start
  let el;

  function build(root) {
    el = [];
    panels.forEach(p => {
      const g = mk(root, "g"), hue = p.hue === "amb" ? AMB : GRN;
      mk(g, "rect", {x: p.x, y: p.y, width: 310, height: 146, rx: 8, fill: p.hue === "amb" ? "#fdfaf3" : "#f6faf7", stroke: p.hue === "amb" ? rgb(P.AMB_S) : rgb(P.GRN_S), "stroke-width": 1});
      const title = txt(g, p.title, {x: p.x + 12, y: p.y + 21, "font-size": 12.5, "font-weight": 700, fill: hue});
      note(title, p.why[0], p.why[1], p.why[0]);
      const gx = p.x + 74, gy = p.y + 32;
      const cells = [];
      for (let s = 1; s <= T; s++) {
        const y = gy + (T - s) * (CH + 3);
        txt(g, "step " + s, {x: gx - 10, y: y + 12, "text-anchor": "end", "font-size": 11, fill: P.MID});
        for (let u = 0; u < U; u++) {
          const r = mk(g, "rect", {x: gx + u * (CW + 4), y, width: CW, height: CH, rx: 3, fill: rgb(P.KNOWN)});
          if (s === T) set(r, {"stroke-dasharray": "3 2"});
          cells.push({r, s, u});
        }
      }
      ["start", "1", "2", "3"].forEach((a, u) => txt(g, a, {x: gx + u * (CW + 4) + CW / 2, y: gy + T * (CH + 3) + 11, "text-anchor": "middle", "font-size": 10.5, fill: P.MID}));
      txt(g, "update", {x: gx + U * (CW + 4) + 4, y: gy + T * (CH + 3) + 11, "font-size": 10.5, fill: P.MID});
      const v = txt(g, p.verdict, {x: p.x + 12, y: p.y + 134, "font-size": 12.5, "font-weight": 700, fill: p.learned(1, 3) ? BLUE : rgb(P.RED)});
      el.push({g, cells, p, v});
    });
    el.key = mk(root, "g");
    mk(el.key, "rect", {x: 20, y: 326, width: 14, height: 10, rx: 2, fill: rgb(P.BLUE_T), stroke: BLUE, "stroke-width": 1});
    txt(el.key, "learned: attention on the right two positions", {x: 40, y: 335, "font-size": 11.5, fill: P.MID});
    const k2 = mk(el.key, "g");
    mk(k2, "rect", {x: 318, y: 326, width: 14, height: 10, rx: 2, fill: rgb(P.BLUE_T), stroke: BLUE, "stroke-width": 1, "stroke-dasharray": "3 2"});
    txt(k2, "right from the start: step 4 sees only its two children", {x: 338, y: 335, "font-size": 11.5, fill: P.MID});
    note(k2, "Step 4", "The last step has one token, which reads only the two tokens of step 3, both of them its children. Its attention is uniform over them from the start, which is already the target, so it has nothing to learn. Fig. 7 shows the same.", "Sec. 2.2 and App. D of the paper");
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    el.forEach(({g, cells, p, v}, k) => {
      set(g, {opacity: E(0.1 + k * 0.15, 0.5 + k * 0.15)});
      cells.forEach(({r, s, u}) => {
        // a cell shows whether step s is on target after update u (u = 0: before training); it fills when that column does
        const fresh = u > 0 && !ok(p, s, u - 1), d = fresh ? 0.08 * s : 0;
        const on = ok(p, s, u) ? E(ups[u] - 0.6 + d, ups[u] - 0.2 + d) : 0;
        const c = P.KNOWN.map((x, j) => x + (P.BLUE_T[j] - x) * on);
        set(r, {fill: rgb(c), stroke: BLUE, "stroke-width": 1, "stroke-opacity": on});
      });
      const done = p.learned(1, 1) || !p.learned(1, 3) ? ups[1] : ups[3];
      set(v, {opacity: E(done, done + 0.4)});
    });
    set(el.key, {opacity: E(0.6, 1.0)});
  }
  AF.run({id: "fig-order", starts: [0, 3.4, 6.6], rest: 9.6, T: 10.4, build, draw});
})();


// fig6.js
/* Fig. 6: Figure 5 of the paper, reproduced unchanged as the picture orig-fig5.png (1090 x 790 px, placed at x 135.8,
   y 44, height 296). Our guide on top: a light that moves from panel (a) to panel (b), amber outlines on the blocks of
   steps 1-3 in (b), and an enlarged copy of the blocks of steps 2-3, placed so that its ties cross only grey cells. Panel frames and cells were measured on the picture:
   (a) frame x 55-343, y 10-682 px; (b) x 790-1078; 15 columns x 35 rows of 19.2 px. */
(() => {
  const {set, mk, txt, ease, rgb, note} = AF, P = PAL;
  const SC = 296 / 790, PX = 135.8, PY = 44;
  const sx = v => PX + v * SC, sy = v => PY + v * SC;
  const cell = 19.2, FA = [55, 10], FB = [790, 10];
  const blk = (f, c0, c1, r0, r1) => [sx(f[0] + c0 * cell), sy(f[1] + r0 * cell), (c1 - c0) * cell * SC, (r1 - r0) * cell * SC];
  const regA = [sx(0), sy(0), 372 * SC, 790 * SC], regB = [sx(718), sy(0), 372 * SC, 790 * SC];
  const blocks = [blk(FB, 0, 8, 0, 20), blk(FB, 8, 12, 20, 28), blk(FB, 12, 14, 28, 32)];
  let el;

  function build(root, svg) {
    el = {};
    el.spot = KIT.spot(root, 680, 350);
    el.outs = blocks.map(b => mk(root, "rect", {x: b[0] - 1.5, y: b[1] - 1.5, width: b[2] + 3, height: b[3] + 3, rx: 2, fill: "none", stroke: rgb(P.AMB), "stroke-width": 1.8}));
    el.labA = txt(root, "target attention", {x: sx(199), y: 30, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: P.INK});
    el.labB = txt(root, "RL: sign of the first gradient", {x: sx(934), y: 30, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: rgb(P.AMB)});
    el.lens = KIT.lens(root, svg, blk(FB, 8, 14, 20, 32), [558, 110, 90, 180]);
    el.lensLab = mk(root, "g");
    txt(el.lensLab, "steps 2 and 3,", {x: 603, y: 305, "text-anchor": "middle", "font-size": 10.5, fill: P.MID});
    txt(el.lensLab, "enlarged", {x: 603, y: 318, "text-anchor": "middle", "font-size": 10.5, fill: P.MID});
    el.all = mk(root, "g");
    txt(el.all, "steps 1, 2 and 3:", {x: 603, y: 62, "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: rgb(P.AMB)});
    txt(el.all, "right sign at once", {x: 603, y: 78, "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: rgb(P.AMB)});
    note(el.all, "Steps 1, 2 and 3", "In every block of (b) the sign matches the target: white where (a) is white, black elsewhere. Step 4’s column is grey because the last token sees only the two tokens of step 3, both of them its children, so its gradient is zero from the start.", "Figure 5 and App. D of the paper");
    KIT.hot(root, sx(0), sy(10), 52 * SC, 672 * SC, "Rows: positions a token can read", "The 20 inputs x1–x20, then the 15 tokens of the chain. In (a) each column has 0.5 on two rows, the token’s children, and 0 elsewhere.", "Figure 5 of the paper");
    KIT.hot(root, sx(55), sy(690), 288 * SC, 70 * SC, "Columns: tokens being written", "The 15 tokens of the chain: 8 for step 1, 4 for step 2, 2 for step 3 and 1 for step 4. Here d = 20 and k = 16.", "App. D");
    KIT.hot(root, sx(790), sy(752), 288 * SC, 36 * SC, "Sign of the policy gradient", "White: +1, the update raises this attention score. Black: −1, it lowers it. Grey: 0, mostly where the causal and pretrained masks forbid attention.", "Figure 5b of the paper");
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    const m = E(3.4, 4.4);                                   // the light travels from (a) to (b)
    const r = regA.map((v, i) => v + (regB[i] - v) * m);
    el.spot(r, E(0.3, 0.9));
    set(el.labA, {opacity: E(0.6, 1.0) * (1 - 0.6 * E(3.4, 4.0))});
    set(el.labB, {opacity: E(4.2, 4.6)});
    el.outs.forEach((o, i) => set(o, {opacity: E(6.8 + i * 0.5, 7.2 + i * 0.5)}));
    el.lens(E(8.4, 9.4), E(8.3, 8.6));
    set(el.lensLab, {opacity: E(9.2, 9.6)});
    set(el.all, {opacity: E(7.0, 7.4)});
  }
  AF.run({id: "fig-rl-exp", starts: [0, 3.2, 6.4], rest: 10.4, T: 11.2, build, draw});
})();


// fig7.js
/* Fig. 7: Figure 6 of the paper, reproduced unchanged as the picture orig-fig6.png (1480 x 989 px, placed at x 118.5,
   y 44, height 296). Our guide on top: a light that moves across the three panels (s = 0, 1, 2), one green outline that
   travels to the only non-zero block of each panel, and enlarged copies of the small blocks. Measured on the picture:
   panel frames at x 57-425, 577-945, 1097-1465 and y 11-868 px; 15 columns x 35 rows of about 24.5 px. */
(() => {
  const {set, mk, txt, ease, rgb, note} = AF, P = PAL;
  const SC = 296 / 989, PX = 118.5, PY = 44;
  const sx = v => PX + v * SC, sy = v => PY + v * SC;
  const cw = 368 / 15, ch = 857 / 35, F = [[57, 11], [577, 11], [1097, 11]];
  const blk = (f, c0, c1, r0, r1) => [sx(f[0] + c0 * cw), sy(f[1] + r0 * ch), (c1 - c0) * cw * SC, (r1 - r0) * ch * SC];
  const regs = [[0, 488], [512, 1000], [1032, 1480]].map(([a, b]) => [sx(a), sy(0), (b - a) * SC, 989 * SC]);
  const blocks = [blk(F[0], 0, 8, 0, 20), blk(F[1], 8, 12, 20, 28), blk(F[2], 12, 14, 28, 32)];
  const at = [[0.3, 1.0], [3.6, 5.0], [6.8, 8.2]];         // when the light and the outline move to each panel
  let el;

  function build(root, svg) {
    el = {};
    el.spot = KIT.spot(root, 680, 346);
    el.out = mk(root, "rect", {fill: "none", stroke: rgb(P.GRN), "stroke-width": 1.8, rx: 2});
    el.labs = ["update 1: step 1 only", "update 2: step 2 only", "update 3: step 3 only"].map((s, i) =>
      txt(root, s, {x: regs[i][0] + regs[i][2] / 2, y: 30, "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: rgb(P.GRN)}));
    el.lensB = KIT.lens(root, svg, blocks[1], [570, 124, 88, 176]);
    el.lensC = KIT.lens(root, svg, blocks[2], [570, 124, 88, 176]);
    el.lensLab = txt(root, "enlarged", {x: 614, y: 316, "text-anchor": "middle", "font-size": 10.5, fill: P.MID});
    KIT.hot(root, sx(0), sy(11), 55 * SC, 857 * SC, "Rows: positions a token can read", "The 20 inputs x1–x20, then the 15 tokens of the chain, as in Fig. 6.", "Figure 6 of the paper");
    KIT.hot(root, sx(57), sy(940), 368 * SC, 49 * SC, "s counts updates", "s = 0 is the gradient at initialisation, which makes the first update; s = 1 is computed after it, and so on.", "Figure 6 of the paper");
    KIT.hot(root, sx(577), sy(940), 368 * SC, 49 * SC, "Sign of the negative SFT gradient", "White: +1, the update raises this attention score. Black: −1, it lowers it. Grey: 0. At each s only one step’s block is not grey.", "Figure 6 of the paper");
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    const m1 = E(...at[1]), m2 = E(...at[2]);
    const lerp = (a, b, u) => a.map((v, i) => v + (b[i] - v) * u);
    el.spot(lerp(lerp(regs[0], regs[1], m1), regs[2], m2), E(0.3, 0.9));
    const b = lerp(lerp(blocks[0], blocks[1], m1), blocks[2], m2);
    set(el.out, {x: b[0] - 1.5, y: b[1] - 1.5, width: b[2] + 3, height: b[3] + 3, opacity: E(1.0, 1.4)});
    set(el.labs[0], {opacity: E(1.2, 1.6) * (1 - 0.6 * m1)});
    set(el.labs[1], {opacity: E(5.0, 5.4) * (1 - 0.6 * m2)});
    set(el.labs[2], {opacity: E(8.2, 8.6)});
    el.lensB(E(5.2, 6.4), E(5.1, 5.4) * (1 - E(7.0, 7.4)));
    el.lensC(E(8.4, 9.6), E(8.3, 8.6));
    set(el.lensLab, {opacity: E(6.2, 6.6) * (1 - E(7.0, 7.4)) + E(9.4, 9.8)});
  }
  AF.run({id: "fig-sft-exp", starts: [0, 3.4, 6.6], rest: 10.6, T: 11.4, build, draw});
})();


// fig8.js
/* Fig. 8 (theory part): Lemma E.2 at work for one token of step 1 in the parity experiment (d = 20 inputs, k = 16),
   at W(0) = 1 (uniform attention 1/20). E[gamma^p] (Eq. 7) is 4/((k-1)d) at each child and 0 elsewhere, since a product
   of distinct uniform bits averages to 0. Gradient (Eq. 19): (gamma^p - sum_q sigma_q gamma^q) sigma_p, i.e. +9 units at
   each child and -1 at each of the 18 others (units of 1/15000), summing to 0. Signed step: +eta / -eta. Softmax after
   one update with eta = 3 (Eq. 64): 1/(2 + 18 e^-6) = 0.489 at each child, 1/(18 + 2 e^6) = 0.0012 elsewhere,
   l1 distance 1/(1/2 + e^6/18) = 0.044. The children are placed at x4 and x6 for illustration. */
(() => {
  const {set, mk, txt, rich, ease, rgb, caps, note, stagger} = AF, P = PAL;
  const D = 20, KIDS = [3, 5], BASE = 176, BW = 11;
  const X = p => 52 + p * 19.5;
  const kid = p => KIDS.includes(p);
  // bar heights in px for the four stages (up is positive)
  const hA = p => kid(p) ? 100 : 0;
  const hB = p => kid(p) ? 90 : -10;
  const hC = p => kid(p) ? 60 : -60;
  const sc = 1 / (2 + 18 * Math.exp(-6)), so = 1 / (18 + 2 * Math.exp(6));
  const hD = p => (kid(p) ? sc : so) / 0.5 * 108;
  let el;

  function build(root) {
    el = {bars: []};
    mk(root, "line", {x1: 40, x2: 436, y1: BASE, y2: BASE, stroke: "#b9bec6", "stroke-width": 1});
    el.mean = mk(root, "g");
    mk(el.mean, "line", {x1: 40, x2: 436, y1: BASE - 10, y2: BASE - 10, stroke: P.INK, "stroke-width": 1, "stroke-dasharray": "4 3"});
    rich(el.mean, [["weighted mean Σ σ"], ["q", {"font-size": 8.5, dy: 3}], [" γ", {dy: -3}], ["q", {"font-size": 8.5, dy: -4}]], {x: 436, y: BASE - 15, "text-anchor": "end", "font-size": 10.5, fill: P.MID});
    el.target = mk(root, "g");
    mk(el.target, "line", {x1: 40, x2: 436, y1: BASE - 108, y2: BASE - 108, stroke: rgb(P.BLUE), "stroke-width": 1, "stroke-dasharray": "4 3"});
    txt(el.target, "target ½", {x: 436, y: BASE - 113, "text-anchor": "end", "font-size": 10.5, fill: rgb(P.BLUE)});
    for (let p = 0; p < D; p++) el.bars.push(mk(root, "rect", {x: X(p) - BW / 2, width: BW, rx: 2}));
    // position labels
    [[0, "x1"], [3, "x4"], [5, "x6"], [19, "x20"]].forEach(([p, s]) =>
      txt(root, s, {x: X(p), y: 258, "text-anchor": "middle", "font-size": 11, "font-weight": kid(p) ? 700 : 400, fill: kid(p) ? rgb(P.BLUE) : P.MID}));
    el.kidLab = txt(root, "children", {x: (X(3) + X(5)) / 2, y: 274, "text-anchor": "middle", "font-size": 10.5, fill: rgb(P.BLUE)});
    note(el.kidLab, "The two children", "The two inputs this token must read, here put at x4 and x6. The other 18 inputs are irrelevant to it.", "invented placement");
    // what the bars mean, one title per stage
    const T1 = (s, a) => { const e = rich(root, s, {x: 40, y: 38, "font-size": 12.5, "font-weight": 700, fill: P.INK}); if (a) note(e, ...a); return e; };
    el.titles = [
      T1([["𝔼[γ"], ["p", {"font-size": 9.5, dy: -5}], ["]", {dy: 5}], [" at each input"]], ["Critical gradient component", "γ^p = 2/(k − 1) · ψ′(ξ) · ϕ₂(children) · value at p. For parity ψ′(ξ) = 2ξ and ϕ₂ is the product of the two children, so the average keeps only terms in which every bit appears twice.", "Eq. (7)"]),
      T1([["gradient: (γ"], ["p", {"font-size": 9.5, dy: -5}], [" − Σ σ", {dy: 5}], ["q", {"font-size": 9.5, dy: 3}], [" γ", {dy: -3}], ["q", {"font-size": 9.5, dy: -5}], [") σ", {dy: 5}], ["p", {"font-size": 9.5, dy: 3}]], ["Lemma E.2", "The gradient on the token’s score W_p is the expectation of γ^p minus its attention-weighted mean, times σ_p. While all scores are equal, σ_p = 1/d for every p, so it only rescales.", "Eq. (19)"]),
      T1([["sign of the gradient"]], ["Signed update", "W(s + 1) = W(s) + η sign(∇R). Only the sign of each entry is kept, so every score moves by exactly η.", "Theorem 3.1"]),
      T1([["attention after one update, η = 3"]], ["After one signed update", "Scores 1 + η at the children and 1 − η elsewhere give attention 1/(2 + (d − 2)e^(−2η)) on each child and 1/(d − 2 + 2e^(2η)) on each other input.", "Eq. (64)"])
    ];
    // right-hand readout, one block per stage
    const block = (head, rows) => {
      const g = mk(root, "g");
      caps(g, head, 470, 62, P.INK, "start");
      rows.forEach(([a, v, c], i) => {
        txt(g, a, {x: 470, y: 92 + i * 24, "font-size": 12, fill: P.INK});
        txt(g, v, {x: 650, y: 92 + i * 24, "text-anchor": "end", "font-size": 12, "font-weight": 700, fill: c});
      });
      return g;
    };
    const B = rgb(P.BLUE), R = rgb(P.RED), M = P.MID;
    el.blocks = [
      block("EXPECTED γ", [["each child", "4/((k−1)d) = 0.013", B], ["every other input", "0", M]]),
      block("GRADIENT", [["each child", "+0.60 × 10⁻³", B], ["every other input", "−0.067 × 10⁻³", R], ["sum over all 20", "0", M]]),
      block("SIGNED STEP", [["each child", "score 1 + η", B], ["every other input", "score 1 − η", R]]),
      block("ATTENTION", [["each child", "0.489", B], ["every other input", "0.0012", R], ["ℓ1 distance to target", "0.044", M]])
    ];
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    const uB = E(4.0, 5.0), uC = E(7.0, 8.0), uD = E(10.2, 11.2);
    el.bars.forEach((r, p) => {
      const g = stagger(t, p, 0.5, 0.04, 0.5);
      const lerp = (a, b, u) => a + (b - a) * u;
      let h = lerp(lerp(lerp(hA(p) * g, hB(p), uB), hC(p), uC), hD(p), uD);
      const hh = Math.max(Math.abs(h), 1.5);
      const red = kid(p) ? 0 : Math.max(E(4.2, 4.8), 0);
      const col = kid(p) ? rgb(P.BLUE) : rgb(PAL.KNOWN.map((v, j) => v + ([200, 92, 80][j] - v) * red));
      set(r, {y: h >= 0 ? BASE - hh : BASE, height: hh, fill: col, opacity: g});
    });
    set(el.mean, {opacity: E(3.5, 3.9) * (1 - E(5.4, 5.8))});
    set(el.target, {opacity: E(10.8, 11.2)});
    const win = [[0.2, 3.4], [3.6, 6.6], [6.8, 9.8], [10.0, 99]];
    el.titles.forEach((e, i) => set(e, {opacity: E(win[i][0], win[i][0] + 0.4) * (1 - E(win[i][1], win[i][1] + 0.3))}));
    const rwin = [[1.2, 3.4], [4.8, 6.6], [7.8, 9.8], [11.0, 99]];
    el.blocks.forEach((g, i) => set(g, {opacity: E(rwin[i][0], rwin[i][0] + 0.4) * (1 - E(rwin[i][1], rwin[i][1] + 0.3))}));
    set(el.kidLab, {opacity: E(1.0, 1.4)});
  }
  AF.run({id: "fig-anatomy", starts: [0, 3.2, 6.6, 9.8], rest: 12.6, T: 13.4, build, draw});
})();


// fig9.js
/* Fig. 9 (theory part): why a token of step 2 gets no SFT gradient until step 1 is right (proof of Theorem 3.3,
   Lemmas F.1 and F.2), with the invented input of Fig. 1: six of its twelve bits are +1, so at W(0) every step-1 token
   averages to xi = 0 and writes sign(2 psi(0) - 1) = -1 (Eq. 75: all step-1 tokens write the same value). The followed
   step-2 token has children = step-1 tokens 1 and 2 and label (-1)(+1) = -1 (Fig. 1).
   Bars: the population descent direction -dL_t/dW_p (Eq. 54). At the start it is exactly 0 for every input, since the
   written values are the same at every position. Once step 1 is written correctly (and for teacher forcing from the
   start), for parity with uniform attention over 4 positions: E[gamma] = 1/(k-1) at the children and 0 elsewhere, so the
   direction is +1/(8(k-1)) at each child and -1/(8(k-1)) at each other position: equal and opposite. */
(() => {
  const {set, mk, txt, rich, ease, rgb, caps, note, stagger} = AF, P = PAL;
  const XS = [80, 140, 200, 260], CY = 70, CW = 44, CH = 28, TOK = 430, BASE = 222;
  const OWN0 = [-1, -1, -1, -1], TRUE = [-1, +1, +1, -1];
  const v = a => a > 0 ? "+1" : "−1";
  let el;

  function build(root) {
    el = {cells: [], v0: [], v1: [], arcs: [], bars: []};
    el.head = [caps(root, "STEP 1, AS THE MODEL WRITES IT", 40, 24, P.MID, "start"), caps(root, "STEP 1, FED BY TEACHER FORCING", 40, 24, rgb(P.GRN), "start")];
    // attention arcs from the step-2 token to the four step-1 tokens: uniform, 1/4 each
    XS.forEach(x => {
      const h = 12 + (TOK - x) * 0.04;
      el.arcs.push(mk(root, "path", {d: `M${TOK} ${CY - CH / 2}C${TOK} ${CY - CH / 2 - h} ${x} ${CY - CH / 2 - h} ${x} ${CY - CH / 2}`, fill: "none", stroke: "#b9bec6", "stroke-width": 1.2}));
    });
    XS.forEach((x, i) => {
      const r = mk(root, "rect", {x: x - CW / 2, y: CY - CH / 2, width: CW, height: CH, rx: 5, "stroke-width": 1.3});
      el.cells.push(r);
      el.v0.push(txt(root, v(OWN0[i]), {x, y: CY + 5, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: P.INK}));
      el.v1.push(txt(root, v(TRUE[i]), {x, y: CY + 5, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: rgb(P.BLUE)}));
    });
    el.kids = mk(root, "g");
    [0, 1].forEach(i => txt(el.kids, "child", {x: XS[i], y: CY + 30, "text-anchor": "middle", "font-size": 10.5, "font-weight": 700, fill: rgb(P.BLUE)}));
    // the followed token of step 2 and its fixed label
    el.tok = mk(root, "g");
    mk(el.tok, "rect", {x: TOK - CW / 2, y: CY - CH / 2, width: CW, height: CH, rx: 5, fill: "#fff", stroke: "#b9bec6", "stroke-dasharray": "3 2", "stroke-width": 1.3});
    txt(el.tok, "step 2", {x: TOK, y: CY + 5, "text-anchor": "middle", "font-size": 11, fill: P.MID});
    el.lab = rich(root, [["label ỹ = −1", {"font-weight": 700}], ["  fixed by the input"]], {x: TOK - CW / 2, y: CY + 34, "font-size": 11.5, fill: rgb(P.GRN)});
    note(el.lab, "The step-2 label", "ỹ = ϕ₂ of the true values of its two children, here (−1)(+1) = −1. It is computed from x and does not change with what the model writes.", "Sec. 3.2");
    // gradient bars, one per position
    el.gHead = caps(root, "DESCENT DIRECTION ON EACH OF ITS SCORES", 40, 148, P.MID, "start");
    note(el.gHead, "−∂L/∂W_p", "The population gradient of the step-2 loss on the token’s four attention scores, with the sign used for descent. While the scores are equal it equals (γ^p − Σ σ_q γ^q)/4, with γ built from the values written at step 1 and the fixed label.", "Lemma F.1, Eq. (54)");
    mk(root, "line", {x1: 50, x2: 290, y1: BASE, y2: BASE, stroke: "#b9bec6", "stroke-width": 1});
    XS.forEach(x => el.bars.push(mk(root, "rect", {x: x - 13, width: 26, rx: 2})));
    el.when = [
      caps(root, "AT THE FIRST UPDATE", 340, 164, P.MID, "start"),
      caps(root, "AT THE SECOND UPDATE", 340, 164, P.MID, "start"),
      caps(root, "AT THE FIRST UPDATE", 340, 164, rgb(P.GRN), "start")
    ];
    // readout, one block per step
    const block = (lines) => {
      const g = mk(root, "g");
      lines.forEach(([s, c, w], i) => txt(g, s, {x: 340, y: 186 + i * 22, "font-size": 12, "font-weight": w || 400, fill: c}));
      return g;
    };
    el.read = [
      block([["every step-1 token wrote the same value", rgb(P.RED), 700], ["so no position stands out: gradient 0", P.INK], ["sign 0: the scores stay equal", P.MID]]),
      block([["step 1 now writes the true values", rgb(P.BLUE), 700], ["+ at the children, − elsewhere", P.INK], ["update 2 teaches step 2", P.MID]]),
      block([["the true values are fed in", rgb(P.GRN), 700], ["the same pattern from the start", P.INK], ["update 1 teaches every step", P.MID]])
    ];
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    const u1 = E(3.8, 4.4), u2 = E(7.2, 7.8);
    el.cells.forEach((r, i) => {
      const on = stagger(t, i, 0.2, 0.08, 0.4);
      const fill = rgb(PAL.WHITE.map((x, j) => x + (P.GRN_T[j] - x) * u2));
      const st = u2 > 0 ? rgb(P.BLUE.map((x, j) => x + (P.GRN[j] - x) * u2)) : rgb([190, 195, 203].map((x, j) => x + (P.BLUE[j] - x) * u1));
      set(r, {fill, stroke: st, opacity: on});
      set(el.v0[i], {opacity: on * (1 - E(3.8, 4.1))});
      set(el.v1[i], {opacity: E(4.1, 4.4), fill: rgb(P.BLUE.map((x, j) => x + (P.GRN[j] - x) * u2))});
    });
    el.arcs.forEach((a, i) => set(a, {opacity: stagger(t, i, 0.8, 0.06, 0.4)}));
    set(el.tok, {opacity: E(0.6, 1.0)});
    set(el.kids, {opacity: E(1.0, 1.4)});
    set(el.lab, {opacity: E(1.2, 1.6)});
    set(el.head[0], {opacity: E(0.2, 0.6) * (1 - u2)});
    set(el.head[1], {opacity: u2});
    set(el.gHead, {opacity: E(1.6, 2.0)});
    const g = E(4.6, 5.4);
    el.bars.forEach((r, i) => {
      const h = (i < 2 ? 1 : -1) * 46 * g, hh = Math.max(Math.abs(h), 1.5);
      set(r, {y: h >= 0 ? BASE - hh : BASE, height: hh, fill: g < 0.02 ? "#9aa1ab" : (i < 2 ? rgb(P.BLUE) : rgb(P.RED)), opacity: E(1.8, 2.2)});
    });
    const win = [[1.9, 3.6], [4.8, 7.0], [7.8, 99]];
    el.when.forEach((e, i) => set(e, {opacity: E(win[i][0], win[i][0] + 0.4) * (1 - E(win[i][1], win[i][1] + 0.3))}));
    const rw = [[2.2, 3.6], [5.4, 7.0], [8.2, 99]];
    el.read.forEach((e, i) => set(e, {opacity: E(rw[i][0], rw[i][0] + 0.4) * (1 - E(rw[i][1], rw[i][1] + 0.3))}));
  }
  AF.run({id: "fig-sft-wait", starts: [0, 3.4, 6.8], rest: 10.0, T: 10.8, build, draw});
})();
