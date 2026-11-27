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

// kit-page.js
/* Page kit: one stylised road map (illustrative, not a real data set) shared by Figs 1, 3, 4 and 5.
   Map units: 300 x 200, origin top left. A map is drawn through a function f([mx, my]) -> [stage x, stage y], so the
   same map can be drawn flat (an affine f) or inside a scene with depth (f = a projection). */
Object.assign(KIT, (() => {
  const {set, mk, rgb} = AF;
  const ring = (a, rx, ry) => [150 + (rx || 112) * Math.cos(a * Math.PI / 180), 100 + (ry || 70) * Math.sin(a * Math.PI / 180)];
  const ringLine = [];
  for (let a = 0; a <= 360; a += 10) ringLine.push(ring(a));
  const ROADS = [
    ringLine,                                        // ring road
    [[0, 100], [300, 100]],                          // east-west road
    [[150, 4], [150, 198]],                          // north-south road
    [[196, 198], [228, 150], [268, 62], [292, 6]]    // a diagonal road
  ];
  const NODES = [ring(-30), ring(30), ring(80), ring(140), ring(200), ring(250), [12, 100], [92, 100], [218, 100], [290, 100], [150, 100], [150, 188]];
  const SPEED = [62, 58, 41, 66, 55, 38, 70, 47, 52, 64, 35, 60];          // illustrative readings, km/h
  // edges: w_ij = exp(-d_ij^2 / sigma^2) kept when >= epsilon (Eq. 10, sigma^2 = 10, epsilon = 0.5); d in illustrative km
  const KM = 1 / 36, EDGES = [];
  for (let i = 0; i < NODES.length; i++) for (let j = i + 1; j < NODES.length; j++) {
    const d = Math.hypot(NODES[i][0] - NODES[j][0], NODES[i][1] - NODES[j][1]) * KM, w = Math.exp(-d * d / 10);
    if (w >= 0.5) EDGES.push([i, j, w, d]);
  }
  // hop distance from a node, along the edges
  const hops = c => {
    const h = NODES.map(() => -1); h[c] = 0;
    for (let f = [c], k = 1; f.length; k++) {
      const nf = [];
      f.forEach(u => EDGES.forEach(([a, b]) => { const v = a === u ? b : b === u ? a : -1; if (v >= 0 && h[v] < 0) { h[v] = k; nf.push(v); } }));
      f = nf;
    }
    return h;
  };
  // point at fraction u (0..1) along road r
  const along = (r, u) => {
    const L = ROADS[r], seg = [];
    let tot = 0;
    for (let i = 1; i < L.length; i++) { const d = Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]); seg.push(d); tot += d; }
    let s = ((u % 1) + 1) % 1 * tot;
    for (let i = 0; i < seg.length; i++) {
      if (s <= seg[i]) { const k = s / seg[i]; return [L[i][0] + (L[i + 1][0] - L[i][0]) * k, L[i][1] + (L[i + 1][1] - L[i][1]) * k]; }
      s -= seg[i];
    }
    return L[L.length - 1];
  };
  // draw the map into parent; returns handles. opts: {node: radius, edges: bool, road: stroke width}
  function roadMap(parent, opts) {
    opts = opts || {};
    const g = mk(parent, "g");
    const roads = ROADS.map(() => mk(g, "path", {fill: "none", stroke: "#d6d6d6", "stroke-width": opts.road || 5, "stroke-linecap": "round", "stroke-linejoin": "round"}));
    const edges = opts.edges ? EDGES.map(e => mk(g, "line", {stroke: rgb(PAL.BLUE), "stroke-width": 0.8 + 2.6 * (e[2] - 0.5) / 0.5, "stroke-linecap": "round"})) : [];
    const nodes = NODES.map(() => mk(g, "circle", {r: opts.node || 5, fill: rgb(PAL.BLUE), stroke: "#fff", "stroke-width": 1.4}));
    const place = f => {
      ROADS.forEach((L, i) => set(roads[i], {d: L.map((p, k) => { const q = f(p); return (k ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1); }).join("")}));
      const P = NODES.map(f);
      edges.forEach((e, i) => { const [a, b] = EDGES[i]; set(e, {x1: P[a][0], y1: P[a][1], x2: P[b][0], y2: P[b][1]}); });
      nodes.forEach((n, i) => set(n, {cx: P[i][0], cy: P[i][1]}));
      return P;
    };
    return {g, roads, edges, nodes, place};
  }
  const flat = (ox, oy, s) => p => [ox + p[0] * s, oy + p[1] * s];
  return {ROADS, NODES, SPEED, EDGES, hops, along, roadMap, flat};
})());

// fig1.js
/* Fig 1: the road map becomes a weighted graph, then a stack of frames along time, then the frames to predict. Depth. */
(() => {
  const {set, mk, txt, rich, ease, stagger, rgb, note} = AF, P = PAL, lerp = (a, b, u) => a + (b - a) * u;
  const it = {"font-style": "italic"}, sub = {"font-size": 9.5, dy: 3}, sup = {"font-size": 9, dy: -5}, up = d => ({dy: d});
  const NP = 12, NF = 3, DZ = 30;           // past frames, future frames, spacing along time
  const CARS = [[0, 0.02, 0.22], [0, 0.35, 0.18], [0, 0.7, 0.2], [1, 0.1, 0.28], [1, 0.6, -0.18], [2, 0.15, 0.26], [2, 0.85, -0.26], [3, 0.08, 0.28], [0, 0.52, -0.16]];
  const S = KIT.space(0, 0);
  let el;

  function build(root) {
    el = {};
    el.w = rich(root, [["W", it], [": weighted adjacency,  "], ["w", it], ["ij", sub], [" = exp(−", up(-3)], ["d", it], ["ij", sub], ["2", sup], ["/σ", up(5)], ["2", sup], [")", up(5)]],
      {x: 660, y: 32, "font-size": 12.5, fill: rgb(P.BLUE), "text-anchor": "end"});
    note(el.w, "W, wij", "W is the n × n weighted adjacency matrix of the sensor graph. Its entry wij = exp(−dij²/σ²) falls with the distance dij between stations i and j, and is set to 0 when i = j or when it would fall below ε. The paper uses σ² = 10 and ε = 0.5, so the matrix is sparse.", "Eq. 10 of the paper");
    el.scene = mk(root, "g");
    el.frames = [];
    for (let k = 0; k < NP + NF; k++) {
      const g = mk(el.scene, "g"), fut = k >= NP;
      const card = mk(g, "path", {fill: fut ? rgb(P.RED_T) : "#fff", "fill-opacity": fut ? 0.25 : 0.9, stroke: fut ? rgb(P.RED) : "#c9c9c9",
        "stroke-width": fut ? 1.6 : 1, "stroke-dasharray": fut ? "5 3" : "none", "stroke-linejoin": "round"});
      const map = fut ? null : KIT.roadMap(g, {edges: true, node: k ? 2.4 : 6, road: k ? 2.2 : 5});
      if (map && k) map.edges.forEach(e => set(e, {"stroke-width": +e.getAttribute("stroke-width") * 0.45, "stroke-opacity": 0.7}));
      el.frames.push({g, card, map, w0: map ? map.edges.map(e => +e.getAttribute("stroke-width")) : []});
    }
    el.front = el.frames[0];
    const fm = el.front.map, first = fm.edges[0];
    el.cars = CARS.map(() => fm.g.insertBefore(AF.set(document.createElementNS("http://www.w3.org/2000/svg", "circle"), {r: 3, fill: "#8a8a8a", stroke: "#fff", "stroke-width": 0.8}), first));
    el.read = KIT.NODES.map(() => txt(root, "", {"font-size": 10.5, "font-weight": 700, fill: rgb(P.BLUE), "text-anchor": "middle",
      stroke: "#fff", "stroke-width": 3, "paint-order": "stroke", "stroke-linejoin": "round"}));
    // legends of steps 1 and 2 (right column)
    el.leg = mk(root, "g");
    mk(el.leg, "circle", {cx: 512, cy: 104, r: 5, fill: rgb(P.BLUE), stroke: "#fff", "stroke-width": 1.4});
    txt(el.leg, "sensor = graph node", {x: 524, y: 108, "font-size": 12.5, fill: P.INK});
    txt(el.leg, "62", {x: 505, y: 131, "font-size": 10.5, "font-weight": 700, fill: rgb(P.BLUE)});
    txt(el.leg, "speed, km/h", {x: 524, y: 131, "font-size": 12.5, fill: P.INK});
    mk(el.leg, "circle", {cx: 512, cy: 150, r: 2.8, fill: "#9a9a9a"});
    txt(el.leg, "a car", {x: 524, y: 154, "font-size": 12.5, fill: P.MID});
    el.leg2 = mk(root, "g");
    mk(el.leg2, "line", {x1: 504, y1: 190, x2: 520, y2: 190, stroke: rgb(P.BLUE), "stroke-width": 3.4, "stroke-linecap": "round"});
    rich(el.leg2, [["edge width = "], ["w", it], ["ij", sub]], {x: 528, y: 194, "font-size": 12.5, fill: P.INK});
    note(rich(el.leg2, [["no edge if "], ["w", it], ["ij", sub], [" < ε", up(-3)]], {x: 504, y: 216, "font-size": 10.5, fill: P.MID}),
      "σ², ε", "σ² sets how fast the weight falls with distance and ε is the cut-off below which no edge is kept. The paper uses σ² = 10 and ε = 0.5; the distances on this map are invented.", "Eq. 10 and Section 4.2 of the paper");
    // time axis and labels of steps 3 and 4
    el.axis = mk(root, "path", {fill: "none", stroke: rgb(P.AMB), "stroke-width": 1.8, "stroke-linecap": "round"});
    el.head = mk(root, "path", {d: "M0 0L-8 -4L-8 4Z", fill: rgb(P.AMB)});
    el.timeLab = txt(root, "time", {"font-size": 12.5, "font-weight": 700, fill: rgb(P.AMB), "text-anchor": "middle"});
    el.vt = rich(root, [["v", it], ["t", sub]], {"font-size": 12.5, "font-weight": 700, fill: rgb(P.AMB), "text-anchor": "middle"});
    note(el.vt, "vt", "The readings of all n sensors at time t, a vector in R^n. Here n = 12, as in BJER4; PeMSD7(M) has n = 228 and PeMSD7(L) n = 1,026.", "Section 2.1 and 4.1 of the paper");
    el.vb = rich(root, [["v", it], ["t−11", sub]], {"font-size": 12.5, "font-weight": 700, fill: rgb(P.AMB), "text-anchor": "middle"});
    el.M = rich(root, [["M", it], [" = 12 frames = 60 min"]], {"font-size": 12.5, fill: rgb(P.AMB), "text-anchor": "middle"});
    note(el.M, "M", "The number of past frames the model reads. Readings are averaged over 5-minute intervals, so each sensor has 288 points per day, and M = 12 frames cover the last hour.", "Sections 4.2 and 4.3 of the paper");
    el.past = txt(root, "observed", {"font-size": 10.5, fill: P.MID, "text-anchor": "middle"});
    el.fut = rich(root, [["v̂", it], ["t+1", sub], [" … ", up(-3)], ["v̂", it], ["t+3", sub]], {x: 552, y: 92, "font-size": 12.5, "font-weight": 700, fill: rgb(P.RED)});
    note(el.fut, "v̂t+1 … v̂t+H", "The frames to predict: the speed at every sensor 1 to H steps ahead, given the last M frames. The paper writes the task as the most likely v̂t+1, …, v̂t+H given vt−M+1, …, vt.", "Eq. 1 of the paper");
    el.H = rich(root, [["H", it], [" = 3 (15 min)"]], {x: 552, y: 114, "font-size": 12.5, fill: rgb(P.RED)});
    note(el.H, "H", "The forecast horizon in 5-minute steps. The paper reports H = 3, 6 and 9, that is 15, 30 and 45 minutes ahead.", "Section 4.3 of the paper");
    el.H2 = txt(root, "paper also predicts", {x: 552, y: 133, "font-size": 10.5, fill: P.MID});
    el.H3 = txt(root, "6 and 9 steps", {x: 552, y: 147, "font-size": 10.5, fill: P.MID});
  }

  function draw(t, life = 0) {
    const E = (a, b) => ease((t - a) / (b - a));
    const tilt = E(7.8, 9.4);
    const s = lerp(1, 0.56, tilt), ox = lerp(340, 402, tilt), oy = lerp(172, 168, tilt);
    const sway = (0.35 + 0.65 * tilt) * 0.05 * Math.sin(0.8 * life);
    S.view(0.82 * tilt + sway, 0.27 * tilt + 0.012 * Math.sin(0.55 * life));
    const z = k => {
      if (k === 0) return 0;
      if (k < NP) return -k * DZ * E(9.3, 10.7);
      const j = k - NP + 1;
      return j * DZ * stagger(t, j - 1, 12.3, 0.35, 0.7);
    };
    const proj = (p, zz) => { const q = S.pt([(p[0] - 150) * s, -(p[1] - 100) * s, zz]); return [ox + q[0], oy + q[1], q[2]]; };
    const corners = [[-4, -4], [304, -4], [304, 204], [-4, 204]];
    const depth = [];
    el.frames.forEach((f, k) => {
      const zz = z(k), fn = p => proj(p, zz);
      set(f.card, {d: corners.map((c, i) => { const q = fn(c); return (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1); }).join("") + "Z"});
      if (f.map) f.map.place(fn);
      let op;
      if (k === 0) op = E(0.1, 0.6);
      else if (k < NP) op = stagger(t, k, 9.3, 0.11, 0.35) * (1 - 0.035 * k);
      else op = stagger(t, k - NP, 12.3, 0.35, 0.35);
      set(f.g, {opacity: op});
      depth.push([f.g, fn([150, 100])[2]]);
    });
    S.stack(el.scene, depth);
    // the front frame: roads, nodes and edges arrive one after another; sizes shrink with the tilt
    const F = el.front.map;
    F.roads.forEach((r, i) => set(r, {opacity: stagger(t, i, 0.2, 0.15, 0.4), "stroke-width": 5 * lerp(1, 0.55, tilt)}));
    F.nodes.forEach((n, i) => set(n, {r: lerp(6, 3, tilt), opacity: stagger(t, i, 0.6, 0.06, 0.3)}));
    F.edges.forEach((e, i) => set(e, {opacity: stagger(t, i, 4.3, 0.08, 0.35), "stroke-width": el.front.w0[i] * lerp(1, 0.55, tilt)}));
    set(el.front.card, {opacity: 1});
    // cars (step 1 only)
    const carOp = E(0.7, 1.0) * (1 - E(3.3, 3.7)), drive = Math.min(Math.max(t - 0.7, 0), 3.0);
    el.cars.forEach((c, i) => {
      const [r, u0, v] = CARS[i], q = proj(KIT.along(r, u0 + v * drive), 0);
      set(c, {cx: q[0], cy: q[1], opacity: carOp});
    });
    // readings settle as the cars pass, then leave when the scene tilts
    const settle = E(1.0, 3.6), P0 = KIT.NODES.map(p => proj(p, 0));
    el.read.forEach((r, i) => {
      r.textContent = Math.round(KIT.SPEED[i] + 9 * Math.sin(4.7 * t + 1.9 * i) * (1 - settle));
      const d = KIT.NODES[i], dx = d[0] - 150, dy = d[1] - 100, n = Math.hypot(dx, dy) || 1, u = n < 2 ? [0.6, -0.8] : [dx / n, dy / n];
      set(r, {x: P0[i][0] + 15 * u[0], y: P0[i][1] + 15 * u[1] + 4, opacity: stagger(t, i, 0.8, 0.06, 0.3) * (1 - E(7.5, 7.8))});
    });
    set(el.w, {opacity: E(4.6, 5.0)});
    set(el.leg, {opacity: E(1.2, 1.6) * (1 - E(7.5, 7.8))});
    set(el.leg2, {opacity: E(5.6, 6.0) * (1 - E(7.5, 7.8))});
    // time axis below the stack: from the oldest frame to the newest, then on through the frames to predict
    const reach = lerp(lerp(-NP * DZ + 10, 14, E(10.4, 11.4)), 4 * DZ + 6, E(12.4, 13.6));
    const A = proj([-14, 222], -NP * DZ + 10), B = proj([-14, 222], reach);
    set(el.axis, {d: "M" + A[0].toFixed(1) + " " + A[1].toFixed(1) + "L" + B[0].toFixed(1) + " " + B[1].toFixed(1), opacity: E(10.3, 10.5)});
    set(el.head, {transform: "translate(" + B[0].toFixed(1) + "," + B[1].toFixed(1) + ") rotate(" + (Math.atan2(B[1] - A[1], B[0] - A[0]) * 180 / Math.PI).toFixed(1) + ")", opacity: E(10.3, 10.5)});
    const Tl = proj([-14, 222], 4 * DZ + 6);
    set(el.timeLab, {x: Tl[0] + 26, y: Tl[1] + 12, opacity: E(13.4, 13.8)});
    const Fb = proj([40, -4], 0), Bt = proj([-4, -4], -(NP - 1) * DZ);
    set(el.vt, {x: Fb[0], y: Fb[1] - 9, opacity: E(10.6, 11.0)});
    set(el.vb, {x: Bt[0], y: Bt[1] - 9, opacity: E(10.8, 11.2)});
    const Mm = proj([-14, 222], -5.5 * DZ);
    set(el.M, {x: Mm[0] - 20, y: Mm[1] + 26, opacity: E(11.2, 11.6)});
    set(el.past, {x: Mm[0] - 20, y: Mm[1] + 41, opacity: E(11.4, 11.8)});
    set(el.fut, {opacity: E(13.4, 13.8)});
    set(el.H, {opacity: E(13.8, 14.2)});
    set(el.H2, {opacity: E(14.1, 14.5)});
    set(el.H3, {opacity: E(14.2, 14.6)});
  }

  AF.run({id: "fig-graph", T: 15.8, starts: [0, 4.0, 7.5, 12.0], rest: 15.0, build, draw, idle: true});
})();

// fig2.js
/* Fig 2: what per-series models, grid CNNs and recurrent chains miss, and what STGCN keeps. Flat, four panels. */
(() => {
  const {set, mk, txt, caps, ease, stagger, rgb, note} = AF, P = PAL;
  const X = [20, 182, 344, 506], PW = 154, GREY = "#9a9a9a", DK = "#6f6f6f";
  const SER = [52, 56, 49, 58, 63, 55, 60, 66, 61, 57, 64, 68];
  let el;
  const lines = (g, x, y, arr, a) => arr.map((s, i) => txt(g, s, Object.assign({x, y: y + i * 16, "font-size": 12.5, "text-anchor": "middle", fill: P.INK}, a || {})));

  function build(root) {
    el = {panels: []};
    X.forEach((x, i) => {
      const g = mk(root, "g");
      mk(g, "rect", {x, y: 40, width: PW, height: 176, rx: 7, fill: i === 3 ? rgb(P.RED_T) : "#f6f6f6", "fill-opacity": i === 3 ? 0.35 : 1, stroke: i === 3 ? rgb(P.RED_S) : "#e2e2e2"});
      el.panels.push(g);
    });
    const [p1, p2, p3, p4] = el.panels;
    // panel 1: one series at a time
    caps(p1, "PER SERIES", 97, 30, DK);
    el.n1 = txt(p1, "ARIMA · HA", {x: 97, y: 60, "font-size": 10.5, fill: P.MID, "text-anchor": "middle"});
    note(el.n1, "ARIMA, HA", "Auto-regressive integrated moving average and the historical average. Both forecast each sensor from its own past only; the paper uses them as baselines.", "Section 4.3 of the paper");
    const C = [97, 96], nb = [[52, 78], [140, 80], [60, 122], [138, 120]];
    el.ghost = nb.map(q => {
      const g = mk(p1, "g");
      mk(g, "line", {x1: C[0], y1: C[1], x2: q[0], y2: q[1], stroke: "#c8c8c8", "stroke-width": 1.2, "stroke-dasharray": "3 3"});
      mk(g, "circle", {cx: q[0], cy: q[1], r: 4.5, fill: "#d6d6d6"});
      return g;
    });
    el.lone = mk(p1, "circle", {cx: C[0], cy: C[1], r: 6, fill: GREY, stroke: "#fff", "stroke-width": 1.5});
    el.spark = mk(p1, "path", {fill: "none", stroke: GREY, "stroke-width": 1.8, "stroke-linejoin": "round", pathLength: 1,
      d: SER.map((v, k) => (k ? "L" : "M") + (34 + k * 8.4) + " " + (205 - (v - 45) * 2.6)).join("")});
    el.fc = mk(p1, "path", {fill: "none", stroke: GREY, "stroke-width": 1.8, "stroke-dasharray": "3 3", pathLength: 1,
      d: "M" + (34 + 11 * 8.4) + " " + (205 - 23 * 2.6) + "L" + (34 + 14 * 8.4) + " " + (205 - 24 * 2.6)});
    el.l1 = lines(p1, 97, 238, ["no spatial", "dependency"], {fill: DK});
    // panel 2: grids, not graphs
    caps(p2, "GRID CNN", 259, 30, DK);
    el.n2 = txt(p2, "CNN · ConvLSTM", {x: 259, y: 60, "font-size": 10.5, fill: P.MID, "text-anchor": "middle"});
    note(el.n2, "Grid restriction", "Standard convolution, also inside ConvLSTM (Shi et al. 2015), slides a square kernel over a regular grid such as an image. The paper notes that this restricts such models to grid structures, so a road network must first be cut into cells, which loses its topology.", "Section 1 of the paper");
    el.map2 = KIT.roadMap(p2, {node: 3.6, road: 2.4});
    el.map2.place(KIT.flat(195, 78, 0.43));
    el.grid = mk(p2, "g");
    for (let i = 0; i <= 6; i++) mk(el.grid, "line", {x1: 195 + i * 21.5, y1: 74, x2: 195 + i * 21.5, y2: 168, stroke: "#c3c3c3", "stroke-width": 0.8});
    for (let j = 0; j <= 4; j++) mk(el.grid, "line", {x1: 195, y1: 74 + j * 23.5, x2: 324, y2: 74 + j * 23.5, stroke: "#c3c3c3", "stroke-width": 0.8});
    el.kern = mk(p2, "g");
    mk(el.kern, "rect", {x: 0, y: 0, width: 64.5, height: 70.5, fill: "none", stroke: DK, "stroke-width": 2, rx: 2});
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) mk(el.kern, "circle", {cx: 10.75 + i * 21.5, cy: 11.75 + j * 23.5, r: 2, fill: DK});
    el.off = txt(p2, "sensors sit between cells", {x: 259, y: 196, "font-size": 10.5, fill: P.MID, "text-anchor": "middle"});
    el.l2 = lines(p2, 259, 238, ["standard convolution", "needs a grid"], {fill: DK});
    // panel 3: chains are slow
    caps(p3, "RECURRENT", 421, 30, DK);
    el.n3 = txt(p3, "FC-LSTM · GCGRU", {x: 421, y: 60, "font-size": 10.5, fill: P.MID, "text-anchor": "middle"});
    note(el.n3, "FC-LSTM, GCGRU", "Recurrent baselines of the paper: a fully connected LSTM (Sutskever et al. 2014) and a graph-convolutional GRU after Li et al. [4]. Each carries a hidden state from one time step to the next, so the 12 steps must be computed in order.", "Sections 1 and 4.3 of the paper");
    el.box = [];
    const bx = k => 355 + (k % 6) * 23, by = k => (k < 6 ? 82 : 136);
    for (let k = 0; k < 12; k++) {
      if (k % 6) mk(p3, "line", {x1: bx(k) - 5, y1: by(k) + 9, x2: bx(k), y2: by(k) + 9, stroke: "#bdbdbd", "stroke-width": 1.2});
      el.box.push(mk(p3, "rect", {x: bx(k), y: by(k), width: 18, height: 18, rx: 3, fill: "#e6e6e6", stroke: "#bdbdbd"}));
    }
    mk(p3, "path", {d: "M" + (bx(5) + 9) + " 100V118H" + (bx(6) + 9) + "V136", fill: "none", stroke: "#bdbdbd", "stroke-width": 1.2});
    txt(p3, "step 1", {x: bx(0) + 9, y: 76, "font-size": 10.5, fill: P.MID, "text-anchor": "middle"});
    txt(p3, "step 12", {x: bx(11) + 9, y: 168, "font-size": 10.5, fill: P.MID, "text-anchor": "middle"});
    el.err = mk(p3, "circle", {r: 5, fill: "none", stroke: DK, "stroke-width": 1.2, "stroke-dasharray": "2 2"});
    el.tok = mk(p3, "circle", {r: 4, fill: DK});
    el.cnt = txt(p3, "", {x: 421, y: 198, "font-size": 10.5, fill: P.MID, "text-anchor": "middle"});
    el.l3 = lines(p3, 421, 238, ["iterative, error", "accumulates,", "slow to react"], {fill: DK});
    // panel 4: what STGCN keeps
    caps(p4, "STGCN", 583, 30, rgb(P.RED));
    el.map4 = KIT.roadMap(p4, {node: 3.6, road: 2.4, edges: true});
    el.map4.place(KIT.flat(518, 56, 0.43));
    el.map4.edges.forEach(e => set(e, {"stroke-width": +e.getAttribute("stroke-width") * 0.6}));
    el.gtag = txt(p4, "graph conv", {x: 583, y: 160, "font-size": 10.5, fill: rgb(P.BLUE), "text-anchor": "middle"});
    el.cells = [];
    for (let k = 0; k < 12; k++) el.cells.push(mk(p4, "rect", {x: 517 + k * 11, y: 172, width: 9, height: 14, rx: 2, fill: rgb(P.AMB_T), stroke: rgb(P.AMB_S)}));
    el.win = mk(p4, "rect", {y: 169, width: 31, height: 20, rx: 3, fill: "none", stroke: rgb(P.AMB), "stroke-width": 1.8});
    el.ttag = txt(p4, "time conv", {x: 583, y: 203, "font-size": 10.5, fill: rgb(P.AMB), "text-anchor": "middle"});
    el.l4 = lines(p4, 583, 238, ["convolution in both", "directions, no recurrence"], {fill: rgb(P.RED)});
    el.l4b = txt(p4, "→ Figs 3 and 4", {x: 583, y: 272, "font-size": 10.5, fill: P.MID, "text-anchor": "middle"});
    note(el.l4[0], "Both directions", "STGCN applies a graph convolution across the sensors and a gated convolution along time, both in parallel, and uses no recurrent unit. Fig. 3 shows the graph side, Fig. 4 the time side.", "Sections 3.2 and 3.3 of the paper");
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    const dim = k => 1 - 0.45 * E([3.5, 7.0, 11.0][k] + 0.1, [3.5, 7.0, 11.0][k] + 0.5);
    // panel 1
    set(el.panels[0], {opacity: E(0.1, 0.5) * dim(0)});
    set(el.lone, {opacity: E(0.4, 0.8)});
    el.ghost.forEach((g, i) => set(g, {opacity: 0.25 + 0.75 * stagger(t, i, 0.6, 0.1, 0.3) * (1 - 0.6 * E(2.4, 2.8))}));
    set(el.spark, {"stroke-dasharray": E(0.9, 2.2) + " 1"});
    set(el.fc, {"stroke-dasharray": "0.08 0.06", opacity: E(2.2, 2.6)});
    el.l1.forEach((l, i) => set(l, {opacity: stagger(t, i, 2.6, 0.15, 0.3)}));
    // panel 2
    set(el.panels[1], {opacity: E(3.6, 4.0) * dim(1)});
    set(el.grid, {opacity: E(4.0, 4.4)});
    set(el.kern, {transform: "translate(" + (195 + 64.5 * E(4.6, 6.0)) + "," + 74 + ")", opacity: E(4.4, 4.7)});
    set(el.off, {opacity: E(5.4, 5.7)});
    el.l2.forEach((l, i) => set(l, {opacity: stagger(t, i, 5.8, 0.15, 0.3)}));
    // panel 3: the token visits the 12 cells one after another; its error ring grows
    set(el.panels[2], {opacity: E(7.1, 7.5) * dim(2)});
    const run = Math.min(Math.max((t - 7.6) / 2.6, 0), 1), k = Math.min(11, Math.floor(run * 12)), f = run * 12 - k;
    const bx = j => 355 + (j % 6) * 23 + 9, by = j => (j < 6 ? 82 : 136) + 9;
    const nx = Math.min(11, k + 1), u = ease(Math.min(1, f * 1.6));
    let tx = bx(k) + (bx(nx) - bx(k)) * (run < 1 ? u : 0), ty = by(k) + (by(nx) - by(k)) * (run < 1 ? u : 0);
    if (k === 5 && run < 1) {                       // from the end of the first row down the connector to the second row
      const pts = [[bx(5), by(5)], [bx(5), 127], [bx(6), 127], [bx(6), by(6)]], L = [18, bx(5) - bx(6), 18], tot = L[0] + L[1] + L[2];
      let d = u * tot, j = 0; while (j < 2 && d > L[j]) { d -= L[j]; j++; }
      const r = Math.min(1, d / L[j]); tx = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * r; ty = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * r;
    }
    set(el.tok, {cx: tx, cy: ty, opacity: E(7.5, 7.7)});
    set(el.err, {cx: tx, cy: ty, r: 5 + 7 * run, opacity: E(7.6, 7.9)});
    el.box.forEach((b, j) => set(b, {fill: j <= run * 12 && t > 7.6 ? "#cfcfcf" : "#e6e6e6"}));
    el.cnt.textContent = t < 7.6 ? "" : run < 1 ? "step " + (k + 1) + " of 12, in order" : "12 steps, one after another";
    set(el.cnt, {opacity: E(7.6, 7.9)});
    el.l3.forEach((l, i) => set(l, {opacity: stagger(t, i, 10.0, 0.15, 0.3)}));
    // panel 4: graph and time convolutions, all positions at once
    set(el.panels[3], {opacity: E(11.1, 11.5)});
    el.map4.edges.forEach((e, i) => set(e, {opacity: stagger(t, i, 11.5, 0.03, 0.3)}));
    set(el.gtag, {opacity: E(11.9, 12.2)});
    el.cells.forEach((c, i) => set(c, {opacity: stagger(t, i, 12.1, 0.03, 0.25), fill: rgb(AF.mix(P.AMB_T, P.AMB_S, E(13.0, 13.4) * (i >= 2 ? 1 : 0)))}));
    set(el.win, {x: 515 + 11 * 9 * E(12.5, 13.2), opacity: E(12.4, 12.6) * (1 - E(13.4, 13.7))});
    set(el.ttag, {opacity: E(12.6, 12.9)});
    el.l4.forEach((l, i) => set(l, {opacity: stagger(t, i, 13.4, 0.15, 0.3)}));
    set(el.l4b, {opacity: E(13.8, 14.1)});
  }

  AF.run({id: "fig-gap", T: 15.3, starts: [0, 3.5, 7.0, 11.0], rest: 14.5, build, draw});
})();

// fig3.js
/* Fig 3: spatial graph convolution on the shared map: Chebyshev kernel, hops, first-order layers, all frames. Flat. */
(() => {
  const {set, mk, txt, rich, caps, ease, stagger, rgb, note} = AF, P = PAL;
  const it = {"font-style": "italic"}, sub = {"font-size": 9.5, dy: 3}, sup = {"font-size": 9, dy: -6}, up = d => ({dy: d});
  const halo = {stroke: "#fff", "stroke-width": 3, "paint-order": "stroke", "stroke-linejoin": "round"};
  const C = 7, H = KIT.hops(C), f = KIT.flat(30, 84, 0.95), PT = KIT.NODES.map(f);
  const ring = k => H.map((h, i) => h === k ? i : -1).filter(i => i >= 0);
  // for each node within two hops, the neighbour one hop closer to the centre
  const toward = H.map((h, i) => { if (h < 1) return -1; const e = KIT.EDGES.find(([a, b]) => (a === i && H[b] === h - 1) || (b === i && H[a] === h - 1)); return e[0] === i ? e[1] : e[0]; });
  let el;

  function build(root) {
    el = {};
    el.ghost = [3, 2, 1].map(k => mk(root, "rect", {x: 26 + 7 * k, y: 80 - 7 * k, width: 293, height: 198, rx: 4, fill: "#fff", stroke: "#cfcfcf"}));
    el.card = mk(root, "rect", {x: 26, y: 80, width: 293, height: 198, rx: 4, fill: "#fff", stroke: "#cfcfcf"});
    el.halo = KIT.NODES.map((p, i) => mk(root, "circle", {cx: PT[i][0], cy: PT[i][1], r: 11, fill: rgb(H[i] === 1 ? P.BLUE_S : P.BLUE_T), stroke: rgb(P.BLUE_S), "stroke-width": 1}));
    el.map = KIT.roadMap(root, {edges: true, node: 5.5, road: 4.5});
    el.map.place(f);
    el.dots = KIT.NODES.map(() => mk(root, "circle", {r: 3.2, fill: rgb(P.BLUE), stroke: "#fff", "stroke-width": 1.2}));
    el.ring = mk(root, "circle", {cx: PT[C][0], cy: PT[C][1], r: 12, fill: "none", stroke: rgb(P.BLUE), "stroke-width": 2.2});
    el.out = txt(root, "not reached", Object.assign({x: 266, y: 124, "font-size": 10.5, fill: P.MID, "text-anchor": "middle"}, halo));
    note(el.out, "Outside the kernel", "These three nodes are three hops from the ringed node. A Chebyshev kernel with K = 3 has terms up to T2 and so cannot reach them in one layer.", "illustrative map; Section 3.2 of the paper");
    // right column, Chebyshev
    el.hc = caps(root, "CHEBYSHEV KERNEL", 360, 54, rgb(P.BLUE), "start");
    el.cheb = rich(root, [["Θ", it], [" *", up(0)], ["G", sub], [" x ≈ Σ", up(-3)], ["k=0", {"font-size": 9.5, dy: 4}], ["K−1", {"font-size": 9.5, dx: -16, dy: -12}],
      [" θ", Object.assign({dy: 8, dx: 2}, it)], ["k", sub], [" T", Object.assign({dy: -3}, it)], ["k", sub], ["(", up(-3)], ["L̃", it], [") ", {}], ["x", it]],
      {x: 360, y: 80, "font-size": 13.5, fill: rgb(P.BLUE)});
    note(el.cheb, "Θ *G x, Tk, θk, L̃", "A graph filter is defined in the spectral domain, Θ(L)x = UΘ(Λ)Uᵀx, with L = I − D^−1/2 W D^−1/2 the normalised Laplacian (Eq. 2). The paper approximates it by Chebyshev polynomials Tk of the rescaled Laplacian L̃ = 2L/λmax − I, each with a learned weight θk (Eq. 3), after Defferrard et al. [1].", "Eqs. 2 and 3 of the paper");
    el.leg = [0, 1, 2].map(k => {
      const g = mk(root, "g"), y = 108 + 21 * k;
      mk(g, "circle", {cx: 368, cy: y - 4, r: 7, fill: rgb(k === 0 ? P.WHITE : k === 1 ? P.BLUE_S : P.BLUE_T), stroke: rgb(k === 0 ? P.BLUE : P.BLUE_S), "stroke-width": k === 0 ? 2 : 1});
      rich(g, [["k", it], [" = " + k + ":  "], ["T", it], ["" + k, sub], [["the node itself", "one hop away", "two hops away"][k], {dy: -3, dx: 6}]], {x: 382, y, "font-size": 12.5, fill: P.INK});
      return g;
    });
    el.K1 = rich(root, [["K", it], [" = 3 in the paper: terms up to "], ["T", it], ["2", sub]], {x: 360, y: 182, "font-size": 12.5, fill: rgb(P.BLUE)});
    el.K2 = txt(root, "so the kernel sees 2 hops", {x: 360, y: 198, "font-size": 12.5, fill: rgb(P.BLUE)});
    note(el.K1, "K", "The paper calls K the kernel size of the graph convolution: it fixes the largest radius, K − 1 hops, that one layer can reach from a central node. The Chebyshev form costs O(K|E|) instead of O(n²) for the full spectral filter.", "Section 3.2 of the paper");
    // right column, first order
    el.hf = caps(root, "FIRST ORDER", 360, 228, rgb(P.BLUE), "start");
    el.first = rich(root, [["Θ", it], [" *", up(0)], ["G", sub], [" x ≈ θ(", up(-3)], ["D̃", it], ["−½", sup], [" W̃", Object.assign({dy: 6}, it)], [" D̃", it], ["−½", sup], [") ", {dy: 6}], ["x", it]],
      {x: 360, y: 252, "font-size": 13.5, fill: rgb(P.BLUE)});
    note(el.first, "1st-order approximation", "With λmax ≈ 2 and a single weight θ = θ0 = −θ1, the kernel becomes θ(I + D^−1/2 W D^−1/2)x, renormalised as θ(D̃^−1/2 W̃ D̃^−1/2)x with W̃ = W + I, after Kipf and Welling [2]. One layer reaches one hop; the paper's STGCN(1st) uses it.", "Eqs. 4 and 5 of the paper");
    el.lay = rich(root, [["layer 1: 1 hop,  "], ["layer 2: 2 hops", {}]], {x: 360, y: 274, "font-size": 12.5, fill: P.INK});
    el.stackLab = txt(root, "stack layers to reach further", {x: 360, y: 293, "font-size": 10.5, fill: P.MID});
    note(el.stackLab, "Stacking", "Stacking first-order layers vertically reaches the same (K − 1)-hop neighbourhood that one K-localised kernel reaches horizontally, without being tied to a polynomial form.", "Section 3.2 of the paper");
    // step 4: all frames, all channels
    el.M = rich(root, [["same kernel on all "], ["M", it], [" = 12 frames"]], {x: 30, y: 44, "font-size": 12.5, fill: rgb(P.AMB)});
    note(el.M, "× M frames", "The graph convolution is applied to each of the M input frames in parallel, written Θ *G X with X ∈ R^(M×n×Ci). Here only 4 of the 12 frames are drawn.", "Section 3.2 of the paper");
    el.ch = rich(root, [["C", it], ["i", sub], [" → ", up(-3)], ["C", it], ["o", sub], [" channels per node (Eq. 6)", up(-3)]], {x: 30, y: 302, "font-size": 12.5, fill: rgb(P.BLUE)});
    note(el.ch, "Ci → Co", "Each node can carry several features (channels). The kernel then holds Ci × Co sets of Chebyshev coefficients and maps a Ci-channel input to a Co-channel output at every node.", "Eq. 6 of the paper");
  }

  function flow(t, a, b) { const u = (t - a) / (b - a); return u >= 0 && u <= 1 ? ease(u) : null; }
  function fade(t, a, b) { const u = (t - a) / (b - a); return Math.min(1, u / 0.2, (1 - u) / 0.2); }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    set(el.card, {opacity: E(0.1, 0.4)});
    el.map.roads.forEach(r => set(r, {opacity: E(0.1, 0.5)}));
    el.map.edges.forEach((e, i) => set(e, {opacity: 0.35 + 0.65 * stagger(t, i, 0.3, 0.03, 0.3)}));
    set(el.ring, {opacity: E(0.9, 1.3), r: 12 + 4 * Math.max(0, 1 - Math.abs(t - 1.3) / 0.3)});
    set(el.hc, {opacity: E(1.3, 1.7)});
    set(el.cheb, {opacity: E(1.5, 2.0)});
    set(el.hf, {opacity: E(8.6, 8.9)});
    // hop rings, step 2: k = 1 then k = 2; step 3: they clear, layer 1 relights k = 1, layer 2 relights k = 2
    const on1 = E(4.0, 4.4), on2 = E(5.6, 6.0), clear = E(8.6, 9.0), l1 = E(9.2, 9.6), l2 = E(10.6, 11.0);
    el.halo.forEach((h, i) => {
      const op = H[i] === 1 ? on1 * (1 - clear) + l1 : H[i] === 2 ? on2 * (1 - clear) + l2 : 0;
      set(h, {opacity: Math.min(1, op)});
    });
    const unread = E(6.6, 7.0);
    el.map.nodes.forEach((n, i) => set(n, {fill: rgb(H[i] === 3 ? AF.mix(P.BLUE, [189, 189, 189], unread) : P.BLUE), opacity: stagger(t, i, 0.4, 0.04, 0.3)}));
    set(el.out, {opacity: unread});
    // dots flow inward: from k = 1 nodes to the centre, from k = 2 nodes to their k = 1 neighbour and then on
    el.dots.forEach((d, i) => {
      let u = null, a = i, b = toward[i];
      let o = 1;
      if (H[i] === 1) { u = flow(t, 4.5, 5.3) ?? flow(t, 9.7, 10.4); o = t < 7 ? fade(t, 4.5, 5.3) : fade(t, 9.7, 10.4); }
      if (H[i] === 2) {
        const v = flow(t, 6.0, 6.8) ?? flow(t, 11.1, 11.8);
        const w = flow(t, 6.8, 7.5) ?? flow(t, 11.8, 12.5);
        if (v !== null) { u = v; o = Math.min(1, (t < 9 ? t - 6.0 : t - 11.1) / 0.16); } else if (w !== null) { u = w; a = toward[i]; b = C; o = Math.min(1, ((t < 9 ? 7.5 : 12.5) - t) / 0.14); }
      }
      if (u === null || b < 0) { set(d, {opacity: 0}); return; }
      set(d, {cx: PT[a][0] + (PT[b][0] - PT[a][0]) * u, cy: PT[a][1] + (PT[b][1] - PT[a][1]) * u, opacity: Math.max(0, o)});
    });
    const dimC = 1 - 0.55 * E(8.5, 8.9);
    el.leg.forEach((g, k) => set(g, {opacity: (k === 0 ? E(3.6, 3.9) : k === 1 ? E(4.1, 4.4) : E(5.7, 6.0)) * dimC}));
    set(el.K1, {opacity: E(7.1, 7.5) * dimC});
    set(el.K2, {opacity: E(7.3, 7.7) * dimC});
    set(el.first, {opacity: E(8.7, 9.1)});
    set(el.lay, {opacity: E(10.4, 10.8)});
    set(el.stackLab, {opacity: E(12.0, 12.4)});
    // step 4: frames behind, channels
    el.ghost.forEach((g, k) => set(g, {opacity: stagger(t, 2 - k, 13.1, 0.25, 0.4)}));
    set(el.M, {opacity: E(14.0, 14.4)});
    set(el.ch, {opacity: E(14.8, 15.2)});
  }

  AF.run({id: "fig-spatial", T: 16.8, starts: [0, 3.4, 8.4, 12.8], rest: 16.0, build, draw});
})();

// fig4.js
/* Fig 4: temporal gated convolution on one sensor's sequence: causal window, P and Q, the gate, all nodes. Flat. */
(() => {
  const {set, mk, txt, rich, ease, stagger, rgb, mix, note} = AF, P = PAL;
  const it = {"font-style": "italic"}, sub = {"font-size": 9.5, dy: 3}, up = d => ({dy: d});
  const X0 = 110, CW = 34, ST = 38, cx = k => X0 + k * ST;
  const YI = 50, YP = 100, YQ = 140, YO = 196, CH = 24;
  const VIN = [0.35, 0.5, 0.3, 0.6, 0.8, 0.55, 0.7, 0.9, 0.75, 0.5, 0.8, 0.95];   // invented shading
  const VP = [0.6, 0.8, 0.5, 0.9, 0.7, 0.4, 0.85, 0.65, 0.75, 0.9];
  const G = [0.9, 0.2, 0.7, 0.9, 0.4, 0.1, 0.8, 0.6, 0.3, 0.8];                   // invented gate openings
  const lab = (p, s, y, a) => txt(p, s, Object.assign({x: 96, y, "font-size": 12.5, "text-anchor": "end", fill: rgb(P.AMB)}, a || {}));
  let el;

  function build(root) {
    el = {};
    // step 4 replicas behind the input and output rows
    el.ghost = [3, 2, 1].map(k => {
      const g = mk(root, "g");
      [[YI, 0], [YO, 2]].forEach(([y, s]) => mk(g, "rect", {x: X0 + s * ST + 6 * k, y: y - 6 * k, width: (12 - s) * ST - 4, height: CH, rx: 3, fill: "#fff", stroke: rgb(P.AMB_S)}));
      return g;
    });
    el.inp = VIN.map((v, k) => mk(root, "rect", {x: cx(k), y: YI, width: CW, height: CH, rx: 3, fill: rgb(mix(P.AMB_T, P.AMB_S, v)), stroke: rgb(P.AMB_S)}));
    el.lIn = lab(root, "input", YI + 17);
    note(el.lIn, "Input Y", "One sensor's sequence of M = 12 frames with Ci channels, Y ∈ R^(M×Ci). Shading stands for invented values.", "Section 3.3 of the paper");
    el.tl = txt(root, "time →", {x: cx(11) + CW, y: YI + CH + 15, "font-size": 10.5, fill: P.MID, "text-anchor": "end"});
    el.win = mk(root, "rect", {y: YI - 4, width: 3 * ST + 4, height: CH + 8, rx: 5, fill: "none", stroke: rgb(P.AMB), "stroke-width": 2.2});
    el.wl = rich(root, [["K", it], ["t", sub], [" = 3", up(-3)]], {y: YI - 10, "font-size": 12.5, "font-weight": 700, fill: rgb(P.AMB), "text-anchor": "middle"});
    note(el.wl, "Kt, Γ", "The temporal kernel Γ ∈ R^(Kt×Ci×2Co) has width Kt = 3. It is causal: each output looks only at the current frame and the two before it. With no padding the sequence shortens by Kt − 1 per layer.", "Eq. 7 and Section 4.3 of the paper");
    el.lost = [0, 1].map(k => mk(root, "rect", {x: cx(k), y: (YP + YQ) / 2, width: CW, height: CH, rx: 3, fill: "none", stroke: "#bdbdbd", "stroke-dasharray": "3 3"}));
    el.lostL = txt(root, "lost", {x: (cx(0) + cx(1) + CW) / 2, y: (YP + YQ) / 2 + 40, "font-size": 10.5, fill: P.MID, "text-anchor": "middle"});
    // the convolution output: each cell is a P half and a Q half that separate in step 2
    el.P = VP.map(v => mk(root, "rect", {width: CW, rx: 3, fill: rgb(mix(P.AMB_T, P.AMB_S, v)), stroke: rgb(P.AMB_S)}));
    el.Q = G.map(() => mk(root, "rect", {width: CW, rx: 3, fill: rgb(P.AMB_T), stroke: rgb(P.AMB_S)}));
    el.gate = G.map(() => mk(root, "rect", {width: CW - 6, rx: 2, fill: rgb(P.AMB)}));
    el.gv = G.map(g => txt(root, g.toFixed(1), {"font-size": 10.5, "text-anchor": "middle", fill: P.INK}));
    el.lConv = lab(root, "conv out", (YP + YQ) / 2 + 17);
    el.lP = lab(root, "P", YP + 17, {"font-style": "italic", "font-weight": 700});
    note(el.lP, "P", "The first half of the 2Co output channels: the candidate values that the gate lets through.", "Eq. 7 of the paper");
    el.lQ = lab(root, "Q", YQ + 17, {"font-style": "italic", "font-weight": 700});
    el.lS = rich(root, [["σ(", {}], ["Q", it], [")", {}]], {x: 96, y: YQ + 17, "font-size": 12.5, "font-weight": 700, "text-anchor": "end", fill: rgb(P.AMB)});
    note(el.lS, "Q, σ(Q)", "The second half of the channels. A sigmoid maps it to gates between 0 and 1 that decide how much of each P passes. Gate values here are invented.", "Eq. 7 of the paper");
    el.split = rich(root, [["2"], ["C", it], ["o", sub], [" channels, split in half", up(-3)]], {x: cx(2), y: YQ + CH + 22, "font-size": 10.5, fill: P.MID});
    note(el.split, "2Co", "The kernel produces twice the Co output channels, and the result [P Q] is split into two halves of the same size.", "Eq. 7 of the paper");
    // output
    el.tok = VP.map(() => mk(root, "circle", {r: 3.4, fill: rgb(P.AMB), stroke: "#fff", "stroke-width": 1}));
    el.out = VP.map(() => mk(root, "rect", {y: YO, width: CW, height: CH, rx: 3, stroke: rgb(P.AMB)}));
    el.lO = lab(root, "output", YO + 17);
    el.glu = rich(root, [["P", it], [" ⊙ σ("], ["Q", it], ["), a GLU [3]"]], {x: cx(2), y: YO + CH + 22, "font-size": 12.5, fill: rgb(P.AMB), "font-weight": 700});
    note(el.glu, "GLU", "Gated linear unit, after Gehring et al. [3]: the output is P ⊙ σ(Q), ⊙ being element-wise multiplication. The gates select which parts of the input matter for the dynamics.", "Eq. 7 of the paper");
    el.pad = rich(root, [["no padding: 12 → 10 ("], ["K", it], ["t", sub], [" − 1 = 2 lost)", up(-3)]], {x: cx(2), y: (YP + YQ) / 2 + CH + 22, "font-size": 12.5, fill: rgb(P.AMB)});
    // residual and replication
    el.res = mk(root, "path", {d: `M${cx(11) + CW + 2} ${YI + CH - 3}H${cx(11) + CW + 34}V${YO + CH - 3}H${cx(11) + CW + 8}`, fill: "none", stroke: P.SOFT, "stroke-width": 1.4, pathLength: 1});
    el.resH = mk(root, "path", {d: `M${cx(11) + CW + 2} ${YO + CH - 3}l7 -3.6v7.2z`, fill: P.SOFT});
    el.resL = txt(root, "residual", {x: cx(11) + CW + 40, y: (YI + YO) / 2 + 16, "font-size": 10.5, fill: P.MID});
    note(el.resL, "Residual", "A residual connection adds the layer's input to its output, so stacked temporal layers learn corrections. The paper uses residual connections among stacked temporal layers.", "Section 3.3 of the paper");
    el.nn = rich(root, [["× "], ["n", it], [" nodes"]], {x: cx(0) + 24, y: YI - 24, "font-size": 12.5, fill: rgb(P.BLUE), "font-weight": 700});
    note(el.nn, "× n nodes", "The same kernel Γ is applied to every node's sequence, written Γ *τ Y with Y ∈ R^(M×n×Ci). Only the row of one sensor is drawn; the rows behind stand for the other n − 1.", "Section 3.3 of the paper");
    el.par = txt(root, "parallel over nodes and over time", {x: cx(2), y: YO + CH + 44, "font-size": 12.5, fill: rgb(P.RED)});
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    el.inp.forEach((c, k) => set(c, {opacity: stagger(t, k, 0.2, 0.04, 0.3)}));
    set(el.lIn, {opacity: E(0.2, 0.5)});
    set(el.tl, {opacity: E(0.5, 0.8)});
    // step 1: the window slides; at each position one output cell (P and Q together) appears below its last frame
    const pos = Math.min(9, Math.max(0, (t - 1.0) / 0.28));
    const winOp = E(0.8, 1.0) * (1 - E(4.0, 4.3));
    set(el.win, {x: cx(pos) - 4, opacity: winOp});
    set(el.wl, {x: cx(pos) + ST * 1.5 - 2, opacity: winOp});
    const sep = E(4.6, 5.6);
    el.P.forEach((c, k) => {
      const op = E(1.0 + 0.28 * k + 0.05, 1.0 + 0.28 * k + 0.3);
      set(c, {x: cx(k + 2), y: (YP + YQ) / 2 - ((YP + YQ) / 2 - YP) * sep, height: CH / 2 + CH / 2 * sep, opacity: op});
    });
    el.Q.forEach((c, k) => {
      const op = E(1.0 + 0.28 * k + 0.05, 1.0 + 0.28 * k + 0.3);
      set(c, {x: cx(k + 2), y: (YP + YQ) / 2 + CH / 2 + (YQ - (YP + YQ) / 2 - CH / 2) * sep, height: CH / 2 + CH / 2 * sep, opacity: op});
    });
    el.lost.forEach((c, k) => set(c, {opacity: E(3.6, 3.9) * (1 - E(4.4, 4.7))}));
    set(el.lostL, {opacity: E(3.6, 3.9) * (1 - E(4.4, 4.7))});
    set(el.pad, {opacity: E(3.4, 3.8) * (1 - E(4.4, 4.7))});
    set(el.lConv, {opacity: E(1.2, 1.5) * (1 - E(4.5, 4.8))});
    set(el.lP, {opacity: E(5.4, 5.8)});
    set(el.lQ, {opacity: E(5.6, 6.0) * (1 - E(7.4, 7.7))});
    set(el.split, {opacity: E(6.0, 6.4) * (1 - E(9.0, 9.3))});
    // step 3: the Q cells become gauges, then each P passes through its gate into the output row
    el.gate.forEach((g, k) => {
      const u = stagger(t, k, 7.6, 0.08, 0.5), h = (CH - 6) * G[k] * u;
      set(g, {x: cx(k + 2) + 3, y: YQ + CH - 3 - h, height: Math.max(0.01, h), opacity: Math.min(1, u * 4)});
    });
    el.gv.forEach((v, k) => set(v, {x: cx(k + 2) + CW / 2, y: YQ - 4, opacity: stagger(t, k, 7.9, 0.08, 0.3)}));
    set(el.lS, {opacity: E(7.5, 7.8)});
    el.tok.forEach((d, k) => {
      const u = (t - (9.0 + 0.14 * k)) / 0.7;
      const y = YP + CH / 2 + (YO + CH / 2 - YP - CH / 2) * ease(u);
      set(d, {cx: cx(k + 2) + CW / 2, cy: y, opacity: u > 0 && u < 1 ? Math.min(1, u / 0.2, (1 - u) / 0.2) : 0});
    });
    el.out.forEach((c, k) => {
      const u = E(9.6 + 0.14 * k, 9.9 + 0.14 * k);
      set(c, {x: cx(k + 2), fill: rgb(mix(P.AMB_T, P.AMB, VP[k] * G[k])), opacity: u});
    });
    set(el.lO, {opacity: E(9.5, 9.8)});
    set(el.glu, {opacity: E(10.6, 11.0)});
    // step 4: every node, and the residual path
    el.ghost.forEach((g, k) => set(g, {opacity: stagger(t, 2 - k, 11.5, 0.25, 0.4)}));
    set(el.nn, {opacity: E(12.2, 12.5)});
    set(el.res, {"stroke-dasharray": E(12.7, 13.4) + " 1", opacity: E(12.7, 12.8)});
    set(el.resH, {opacity: E(13.3, 13.5)});
    set(el.resL, {opacity: E(13.3, 13.6)});
    set(el.par, {opacity: E(13.7, 14.1)});
  }

  AF.run({id: "fig-temporal", T: 15.4, starts: [0, 4.4, 7.2, 11.2], rest: 14.6, build, draw});
})();

// fig5.js
/* Fig 5: a stack of frame cards passes through the ST-Conv layers and the output layer. Depth with sway. */
(() => {
  const {set, mk, txt, rich, ease, stagger, rgb, mix, note, arrow} = AF, P = PAL;
  const it = {"font-style": "italic"}, sub = {"font-size": 9.5, dy: 3}, up = d => ({dy: d});
  const lerp = (a, b, u) => a + (b - a) * u, clamp = u => Math.min(1, Math.max(0, u));
  const BX = [70, 178, 286, 394, 502, 610], BW = 96, BY = 258, BH = 42, DZ = 9.5, A = 49, OY = 145;
  const HC = c => c === 1 ? 34 : c === 16 ? 47 : 63;       // half-height of a card per channel count (not to scale)
  const S = KIT.space(0, 0);
  const BOX = [["input", "12 frames", "#f1f1f1", "#cfcfcf"], ["temporal", "gated conv", P.AMB_T, P.AMB_S], ["spatial", "graph conv", P.BLUE_T, P.BLUE_S],
    ["temporal", "+ layer norm", P.AMB_T, P.AMB_S], ["ST-Conv", "block 2", "#f1f1f1", "#cfcfcf"], ["output", "temporal + FC", P.RED_T, P.RED_S]];
  // the state of the stack along the timeline: x position, frame count, channels and the moments of change
  const MOVES = [[3.3, 4.3, 0, 1], [6.7, 7.5, 1, 2], [10.2, 11.0, 2, 3], [13.7, 14.5, 3, 4], [16.2, 17.0, 4, 5]];
  const COUNT = [[4.4, 5.2, 12, 10], [11.1, 11.9, 10, 8], [14.6, 15.1, 8, 6], [15.5, 16.0, 6, 4], [17.1, 17.8, 4, 1]];
  const CHAN = [[4.4, 5.2, 1, 64], [8.9, 9.5, 64, 16], [11.1, 11.9, 16, 64], [17.4, 18.0, 64, 1]];
  const LABELS = [[0, "12 frames", "1"], [4.8, "10 frames", "64"], [9.2, "10 frames", "16"], [11.5, "8 frames", "64"], [14.9, "6 frames", "64"], [15.8, "4 frames", "64"], [17.6, "1 frame", "1"]];
  let el;

  function build(root) {
    el = {};
    el.boxes = BOX.map((b, i) => {
      const g = mk(root, "g");
      el["r" + i] = mk(g, "rect", {x: BX[i] - BW / 2, y: BY, width: BW, height: BH, rx: 6, fill: typeof b[2] === "string" ? b[2] : rgb(b[2]), stroke: typeof b[3] === "string" ? b[3] : rgb(b[3])});
      txt(g, b[0], {x: BX[i], y: BY + 17, "font-size": 12, "font-weight": 700, "text-anchor": "middle", fill: P.INK});
      txt(g, b[1], {x: BX[i], y: BY + 32, "font-size": 11, "text-anchor": "middle", fill: P.MID});
      return g;
    });
    el.arr = [0, 1, 2, 3, 4].map(i => arrow(root, P.SOFT, [[BX[i] + BW / 2 + 1, BY + BH / 2], [BX[i + 1] - BW / 2 - 1, BY + BH / 2]]));
    note(el.boxes[0], "Input", "M = 12 frames of the n sensors, one channel (speed) each: a tensor of size 12 × n × 1.", "Sections 3.4 and 4.3 of the paper");
    note(el.boxes[1], "Temporal gated conv", "The layer of Fig. 4 (Γ0 in Eq. 8): a width-3 causal convolution with a GLU, applied to every node. Output 64 channels; the frame count drops by Kt − 1 = 2.", "Sections 3.3 and 4.3 of the paper");
    note(el.boxes[2], "Spatial graph conv", "The layer of Fig. 3 (Θ in Eq. 8), followed by ReLU, applied to every frame. It squeezes the channels from 64 to 16 and the next layer expands them again: the paper's bottleneck strategy.", "Sections 3.2 and 3.4 of the paper");
    note(el.boxes[3], "Temporal + layer norm", "A second gated temporal layer (Γ1 in Eq. 8) brings the channels back to 64; layer normalisation inside every block guards against overfitting.", "Section 3.4 of the paper");
    note(el.boxes[5], "Output layer", "One more temporal convolution maps the last block's frames to a single step, then a fully connected layer turns Z ∈ R^(n×c) into the forecast v̂ = Zw + b, one value per node.", "Section 3.4 of the paper");
    el.scene = mk(root, "g");
    el.cards = [];
    for (let k = 0; k < 12; k++) el.cards.push(mk(el.scene, "g"));
    el.cardR = el.cards.map(g => mk(g, "path", {"stroke-width": 1.1, "stroke-linejoin": "round", "fill-opacity": 0.93}));
    el.map = KIT.roadMap(el.cards[0], {node: 2.4, road: 1.8, edges: true});
    el.map.edges.forEach(e => set(e, {"stroke-width": 0.95}));
    el.lab = rich(root, [["", {"font-weight": 700}], [" · ", {}], ["n", it], [" × ", {}], ["", {}]], {y: 58, "font-size": 14, "text-anchor": "middle", fill: rgb(P.AMB)});
    note(el.lab, "frames · n × C", "How many frames are left, and the size of each: n sensors times C channels. With Kt = 3 every temporal layer removes two frames, so 12 become 10, 8, 6, 4, and the output layer maps 4 to 1.", "Eq. 8 of the paper; counts follow from M = 12, Kt = 3");
    el.lab1 = el.lab.childNodes[0]; el.lab2 = el.lab.childNodes[4];
    el.vhat = rich(root, [["v̂", it], [" = forecast", {}]], {x: 584, y: 36, "font-size": 14, "font-weight": 700, "text-anchor": "middle", fill: rgb(P.RED)});
    el.bott = txt(root, "bottleneck", {x: BX[2], y: 36, "font-size": 14, "font-weight": 700, "text-anchor": "middle", fill: rgb(P.BLUE)});
    el.brace = mk(root, "path", {d: `M${BX[1] - BW / 2} ${BY + BH + 6}v6H${BX[3] + BW / 2}v-6M${BX[2]} ${BY + BH + 12}v5`, fill: "none", stroke: rgb(P.RED), "stroke-width": 1.3});
    el.blk = txt(root, "ST-Conv block (Eq. 8)", {x: BX[2], y: BY + BH + 32, "font-size": 12.5, "font-weight": 700, "text-anchor": "middle", fill: rgb(P.RED)});
    note(el.blk, "ST-Conv block", "v^(l+1) = Γ1 *τ ReLU(Θ *G (Γ0 *τ v^l)): temporal, spatial, temporal, with 64, 16 and 64 channels. Two blocks and the output layer make the whole model, 4.54 × 10^5 parameters.", "Eq. 8 and Sections 4.3 and 4.4 of the paper");
    el.loss = txt(root, "L2 loss (Eq. 9)", {x: BX[5], y: BY + BH + 32, "font-size": 12.5, "text-anchor": "middle", fill: rgb(P.RED)});
    note(el.loss, "Training", "The loss is the squared error between v̂ and the true next frame (Eq. 9). Training: RMSprop, 50 epochs, batch size 50, learning rate 10^−3 decayed by 0.7 every 5 epochs.", "Eq. 9 and Section 4.3 of the paper");
  }

  const pw = (t, list, v0) => { let v = v0; for (const [a, b, x, y] of list) { if (t >= b) v = y; else if (t > a) return lerp(x, y, ease((t - a) / (b - a))); } return v; };

  function draw(t, life = 0) {
    const E = (a, b) => ease((t - a) / (b - a));
    el.boxes.forEach((g, i) => set(g, {opacity: stagger(t, i, 0.1, 0.12, 0.35)}));
    el.arr.forEach((f, i) => f(stagger(t, i, 0.3, 0.12, 0.35)));
    const pos = pw(t, MOVES, 0), sx = lerp(BX[Math.floor(pos)], BX[Math.min(5, Math.floor(pos) + 1)], pos - Math.floor(pos));
    el.boxes.forEach((g, i) => set(el["r" + i], {"stroke-width": 1 + 1.2 * clamp(1 - Math.abs(pos - i) * 1.5)}));
    const N = pw(t, COUNT, 12), C = pw(t, CHAN, 1);
    const h = C <= 1 ? HC(1) : C <= 16 ? lerp(HC(1), HC(16), (C - 1) / 15) : lerp(HC(16), HC(64), (C - 16) / 48);
    S.view(0.65 + 0.07 * Math.sin(0.8 * life), 0.2 + 0.03 * Math.sin(0.55 * life));
    // keep the whole stack 20 px or more inside the stage: its projected width grows with the frame count
    const span = 2 * A * 0.8 + (Math.max(1, N) - 1) * DZ * 0.61, sc = Math.min(Math.max(sx, 24 + span / 2), 656 - span / 2);
    const off = (Math.max(1, N) - 1) * DZ * 0.3, pt = p => { const q = S.pt(p); return [sc + q[0] + off, OY + q[1], q[2]]; };
    const red = E(17.6, 18.2), depth = [];
    el.cards.forEach((g, k) => {
      const z = -Math.min(k, Math.max(0, N - 1)) * DZ;
      const path = [[-A, -h], [A, -h], [A, h], [-A, h]].map((c, i) => { const q = pt([c[0], c[1], z]); return (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1); }).join("") + "Z";
      // spatial step: cards flash blue one after another (block 1 and block 2)
      const fl = Math.max(clamp(1 - Math.abs(t - (7.7 + 0.12 * k)) / 0.35), clamp(1 - Math.abs(t - (15.15 + 0.05 * k)) / 0.2));
      let fill = mix(mix(P.AMB_T, P.BLUE_S, fl), P.RED_T, k === 0 ? red : 0);
      const stroke = mix(mix(P.AMB_S, P.BLUE, fl), P.RED, k === 0 ? red : 0);
      set(el.cardR[k], {d: path, fill: rgb(fill), stroke: rgb(stroke)});
      set(g, {opacity: stagger(t, 11 - k, 0.6, 0.07, 0.3) * clamp(N - k)});
      depth.push([g, pt([0, 0, z])[2]]);
    });
    S.stack(el.scene, depth);
    const ms = 0.26;
    el.map.place(p => pt([(p[0] - 150) * ms, -(p[1] - 100) * ms, 0.5]));
    set(el.map.g, {opacity: E(1.2, 1.6)});
    // label above the stack: frame count and size of each frame; it dips while it changes
    let L = LABELS[0], dip = 1;
    LABELS.forEach(l => { if (t >= l[0]) L = l; if (l[0] > 0) dip = Math.min(dip, clamp(Math.abs(t - l[0]) / 0.18)); });
    el.lab1.textContent = L[1]; el.lab2.textContent = L[2];
    set(el.lab, {x: Math.min(sc, 584), opacity: E(1.6, 2.0) * dip, fill: rgb(mix(P.AMB, P.RED, red))});
    set(el.bott, {opacity: E(9.2, 9.6) * (1 - E(10.1, 10.4))});
    set(el.brace, {opacity: E(12.2, 12.6)});
    set(el.blk, {opacity: E(12.5, 12.9)});
    set(el.vhat, {opacity: E(18.0, 18.4)});
    set(el.loss, {opacity: E(18.3, 18.7)});
  }

  AF.run({id: "fig-block", T: 19.8, starts: [0, 3.0, 6.5, 10.0, 13.5], rest: 19.0, build, draw, idle: true});
})();

// fig6.js
/* Fig 6: MAE of eight methods on PeMSD7 at 15, 30, 45 min (228 sensors) and 45 min (1,026 sensors). From Table 2. */
(() => {
  const {set, mk, txt, caps, ease, stagger, rgb, note} = AF, P = PAL;
  const NAMES = [["HA"], ["LSVR"], ["ARIMA"], ["FNN"], ["FC-LSTM"], ["GCGRU"], ["STGCN", "(Cheb)"], ["STGCN", "(1st)"]];
  const FULL = ["HA", "LSVR", "ARIMA", "FNN", "FC-LSTM", "GCGRU", "STGCN(Cheb)", "STGCN(1st)"];
  // Table 2 of the paper: [MAE, MAPE %, RMSE] per method; M = PeMSD7(M) at 15/30/45 min, L = PeMSD7(L) at 45 min
  const M15 = [[4.01, 10.61, 7.20], [2.50, 5.81, 4.55], [5.55, 12.92, 9.00], [2.74, 6.38, 4.75], [3.57, 8.60, 6.20], [2.37, 5.54, 4.21], [2.25, 5.26, 4.04], [2.26, 5.24, 4.07]];
  const M30 = [[4.01, 10.61, 7.20], [3.63, 8.88, 6.67], [5.86, 13.94, 9.13], [4.02, 9.72, 6.98], [3.94, 9.55, 7.03], [3.31, 8.06, 5.96], [3.03, 7.33, 5.70], [3.09, 7.39, 5.77]];
  const M45 = [[4.01, 10.61, 7.20], [4.54, 11.50, 8.28], [6.27, 15.20, 9.38], [5.04, 12.38, 8.58], [4.16, 10.10, 7.51], [4.01, 9.99, 7.13], [3.57, 8.69, 6.77], [3.79, 9.12, 7.03]];
  const L45 = [[4.60, 12.50, 8.05], [4.79, 12.42, 8.72], [6.30, 14.85, 9.39], [4.78, 13.56, 8.46], [4.66, 11.69, 8.20], [4.12, 10.51, 7.49], [3.97, 9.73, 7.45], [4.01, 10.12, 7.81]];
  const SETS = [M15, M30, M45, L45], TAGS = ["PeMSD7(M), 15 min", "PeMSD7(M), 30 min", "PeMSD7(M), 45 min", "PeMSD7(L), 45 min"];
  const HEAD = ["PEMSD7(M) · 228 SENSORS · 15 MIN AHEAD", "PEMSD7(M) · 228 SENSORS · 30 MIN AHEAD", "PEMSD7(M) · 228 SENSORS · 45 MIN AHEAD", "PEMSD7(L) · 1,026 SENSORS · 45 MIN AHEAD"];
  const SW = [0, 3.6, 7.2, 11.0];       // when each step's values take over
  const X = i => 120 + i * 73, BW = 38, Y0 = 268, K = 29;
  let el;

  function build(root) {
    el = {};
    for (let v = 0; v <= 6; v += 2) {
      mk(root, "line", {x1: 70, x2: 650, y1: Y0 - v * K, y2: Y0 - v * K, stroke: v ? "#ececec" : "#bdbdbd", "stroke-width": 1});
      txt(root, v, {x: 62, y: Y0 - v * K + 4, "font-size": 10.5, fill: P.MID, "text-anchor": "end"});
    }
    el.axis = txt(root, "MAE", {x: 62, y: Y0 - 6.9 * K, "font-size": 10.5, "font-weight": 700, fill: P.MID, "text-anchor": "end"});
    el.head = caps(root, HEAD[0], 20, 30, P.INK, "start");
    el.bars = FULL.map((n, i) => mk(root, "rect", {x: X(i) - BW / 2, width: BW, rx: 3, fill: rgb(i >= 6 ? P.RED : [190, 190, 190])}));
    el.vals = FULL.map((n, i) => txt(root, "", {x: X(i), "font-size": 11.5, "font-weight": 700, "text-anchor": "middle", fill: i >= 6 ? rgb(P.RED) : P.MID}));
    NAMES.forEach((n, i) => n.forEach((s, j) => txt(root, s, {x: X(i), y: Y0 + 17 + j * 13, "font-size": j ? 10.5 : 11.5, "text-anchor": "middle", fill: i >= 6 ? rgb(P.RED) : P.INK, "font-weight": i >= 6 && !j ? 700 : 400})));
    el.bars.forEach((b, i) => note(b, FULL[i], "", "Table 2 of the paper"));
    el.cls = txt(root, "classical models hold at 15 min and fall behind at 45 min", {x: 650, y: 54, "font-size": 12.5, "text-anchor": "end", fill: P.MID});
    el.star = txt(root, "* GCGRU trained with half the batch size", {x: 650, y: 72, "font-size": 10.5, "text-anchor": "end", fill: P.MID});
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    let s = 0; while (s < 3 && t >= SW[s + 1]) s++;
    const grow = i => stagger(t, i, 0.4, 0.15, 0.5);
    const mv = s ? E(SW[s] + 0.3, SW[s] + 1.3) : 1;
    el.head.textContent = HEAD[s];
    set(el.head, {opacity: Math.min(E(0.1, 0.4), s ? Math.min(1, Math.abs(t - SW[s] - 0.15) / 0.15) : 1)});
    el.bars.forEach((b, i) => {
      const prev = s ? SETS[s - 1][i][0] : 0, cur = SETS[s][i][0];
      const v = s ? prev + (cur - prev) * mv : cur * grow(i);
      const h = Math.max(0.01, v * K);
      set(b, {y: Y0 - h, height: h, "data-note-title": FULL[i] + ", " + TAGS[s],
        "data-note": "MAE " + cur.toFixed(2) + ", MAPE " + SETS[s][i][1].toFixed(2) + "%, RMSE " + SETS[s][i][2].toFixed(2) + "." +
          (i === 0 ? " The historical average gives one value for all horizons." : "") + (i === 5 && s === 3 ? " Marked * in the paper: trained with half the batch size because GPU memory ran out." : "") +
          (i === 6 ? " STGCN(Cheb): Chebyshev kernel, K = 3." : i === 7 ? " STGCN(1st): first-order kernel." : "")});
      // labels only ever show table values: the old one until the bar is halfway, then the new one
      const shown = s && mv < 0.5 ? prev : cur;
      el.vals[i].textContent = shown.toFixed(2) + (i === 5 && s === 3 && mv >= 0.5 ? "*" : "");
      set(el.vals[i], {y: Y0 - h - 6, opacity: s ? Math.min(1, Math.abs(mv - 0.5) / 0.25) : E(0.6 + 0.15 * i + 0.3, 0.6 + 0.15 * i + 0.6)});
    });
    set(el.cls, {opacity: E(8.8, 9.2)});
    set(el.star, {opacity: E(12.6, 13.0)});
  }

  AF.run({id: "fig-results", T: 14.8, starts: [0, 3.6, 7.2, 11.0], rest: 14.0, build, draw});
})();

// fig7.js
/* Fig 7: training time from Table 3 as a race at constant speed, then STGCN's parameter count. */
(() => {
  const {set, mk, txt, rich, caps, ease, rgb, note} = AF, P = PAL;
  const it = {"font-style": "italic"};
  const NAMES = ["STGCN(Cheb)", "STGCN(1st)", "GCGRU"];
  const SEC = {M: [272.34, 271.18, 3824.54], L: [1926.81, 1554.37, 19511.92]};
  const X0 = 134, LEN = 420, RACE = 3.0;
  const G = [{k: "M", head: "PEMSD7(M) · 228 SENSORS", y: 36, t0: 0.6, ticks: [0, 1000, 2000, 3000]},
             {k: "L", head: "PEMSD7(L) · 1,026 SENSORS", y: 134, t0: 4.6, ticks: [0, 5000, 10000, 15000]}];
  const fmt = v => v.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2}) + " s";
  let el;

  function build(root) {
    el = {groups: []};
    G.forEach((g, gi) => {
      const grp = mk(root, "g"), max = SEC[g.k][2], o = {grp, bars: [], vals: []};
      o.head = caps(grp, g.head, 20, g.y - 10, P.INK, "start");
      NAMES.forEach((n, i) => {
        const y = g.y + i * 18, red = i < 2;
        txt(grp, n, {x: 124, y: y + 10, "font-size": 11.5, "text-anchor": "end", fill: red ? rgb(P.RED) : P.INK, "font-weight": red ? 700 : 400});
        o.bars.push(mk(grp, "rect", {x: X0, y, height: 12, rx: 3, fill: red ? rgb(P.RED) : "#bebebe"}));
        o.vals.push(txt(grp, fmt(SEC[g.k][i]) + (gi && i === 2 ? "*" : ""), {y: y + 10, "font-size": 11.5, "font-weight": 700, fill: red ? rgb(P.RED) : P.MID}));
      });
      const ay = g.y + 54;
      mk(grp, "line", {x1: X0, x2: X0 + LEN, y1: ay, y2: ay, stroke: "#bdbdbd"});
      g.ticks.forEach(v => {
        const x = X0 + LEN * v / max;
        mk(grp, "line", {x1: x, x2: x, y1: ay, y2: ay + 4, stroke: "#bdbdbd"});
        txt(grp, v.toLocaleString("en-US") + (v === g.ticks[g.ticks.length - 1] ? " s" : ""), {x, y: ay + 15, "font-size": 10, "text-anchor": "middle", fill: P.MID});
      });
      el.groups.push(o);
    });
    note(el.groups[0].head, "PeMSD7(M)", "228 stations of Caltrans PeMS, District 7 of California, weekdays of May and June 2012. Times are for the whole training run on an Intel Xeon E5-2620 v4 CPU with an NVIDIA GTX 1080 GPU.", "Sections 4.1, 4.3 and Table 3 of the paper");
    note(el.groups[1].head, "PeMSD7(L)", "1,026 stations of the same district. GCGRU had to use half the batch size because its GPU memory use exceeded one card (marked *); STGCN only doubled the channels in the middle of its blocks.", "Section 4.4 and Table 3 of the paper");
    el.x14 = txt(root, "14× faster", {x: 330, y: 51, "font-size": 12.5, "font-weight": 700, fill: rgb(P.RED)});
    note(el.x14, "14 times", "The paper's words: STGCN consumes 272 seconds and GCGRU 3,824 seconds on PeMSD7(M), a 14 times acceleration it credits to temporal convolution, which trains fully in parallel instead of step by step.", "Section 4.4 of the paper");
    el.p20 = txt(root, "1st-order about 20% faster than Chebyshev", {x: 330, y: 149, "font-size": 12.5, fill: rgb(P.RED)});
    note(el.p20, "About 20%", "STGCN(1st) trains in 1,554.37 s against 1,926.81 s for STGCN(Cheb) on the larger graph; the paper says it speeds up around 20% with a satisfactory performance.", "Table 3 and Section 4.4 of the paper");
    el.par = mk(root, "g");
    mk(el.par, "rect", {x: 20, y: 214, width: 640, height: 52, rx: 7, fill: rgb(P.RED_T), "fill-opacity": 0.6});
    el.pn = rich(el.par, [["4.54 × 10", {}], ["5", {"font-size": 9.5, dy: -6}], [" parameters in STGCN", {dy: 6}]], {x: 34, y: 237, "font-size": 14, "font-weight": 700, fill: rgb(P.RED)});
    txt(el.par, "about two thirds of GCGRU, over 95% fewer than FC-LSTM (the paper's ratios; no counts given)", {x: 34, y: 255, "font-size": 10.5, fill: P.MID});
    note(el.pn, "Parameters", "The paper gives 4.54 × 10^5 parameters for STGCN and states only ratios for the others: around two thirds of GCGRU, and over 95% saved compared to FC-LSTM. So no bars are drawn for them.", "Section 4.4 of the paper");
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    G.forEach((g, gi) => {
      const o = el.groups[gi], max = SEC[g.k][2];
      set(o.grp, {opacity: E(g.t0 - 0.5, g.t0 - 0.2)});
      SEC[g.k].forEach((s, i) => {
        const run = Math.max(0, t - g.t0) / RACE * max, w = Math.min(s, run), done = run >= s;
        set(o.bars[i], {width: Math.max(0.01, LEN * w / max), opacity: t > g.t0 ? 1 : 0});
        set(o.vals[i], {x: X0 + LEN * s / max + 8, opacity: done ? E(g.t0 + RACE * s / max, g.t0 + RACE * s / max + 0.3) : 0});
      });
    });
    set(el.x14, {opacity: E(3.8, 4.1)});
    set(el.p20, {opacity: E(7.8, 8.1)});
    set(el.par, {opacity: E(8.7, 9.1)});
  }

  AF.run({id: "fig-cost", T: 11.8, starts: [0, 4.2, 8.5], rest: 11.0, build, draw});
})();

// fig8.js
/* Fig 8: citations per year (OpenAlex) and totals across databases. Not from the paper. */
(() => {
  const {set, mk, txt, caps, ease, stagger, rgb, note} = AF, P = PAL;
  const YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  const CIT = [15, 90, 322, 537, 766, 995, 1251, 1636, 1948];       // OpenAlex, retrieved 26 Nov 2026
  const X = i => 70 + i * 42, BW = 28, Y0 = 250, K = 0.092;
  const STEP = [0.4, 3.5, 6.3];                                    // when each group of three years grows
  const ROWS = [["7,561", "OpenAlex citations", 7561, "OpenAlex", "Counts works in OpenAlex that cite the paper (DOI 10.24963/ijcai.2018/505), including preprints and theses it indexes. The yearly bars use the same source."],
    ["5,838", "Semantic Scholar, 669 highly influential", 5838, "Semantic Scholar", "Counts citing papers in its own corpus. It marks 669 of them as highly influential, meaning they cite the paper several times or build on it directly."],
    ["3,297", "Crossref citations", 3297, "Crossref", "Counts only citations from works whose publishers deposit reference lists with Crossref, so it is usually the lowest of the three."],
    ["1,249 stars · 325 forks", "official code (TensorFlow)", 0, "github.com/VeritasYin/STGCN_IJCAI-18", "The authors' repository, created 15 April 2018 and last pushed 14 June 2026. Stars and forks count GitHub users who bookmarked or copied it."],
    ["706 stars · 131 forks", "PyTorch port (hazdzz/STGCN)", 0, "github.com/hazdzz/STGCN", "A widely used PyTorch re-implementation. The block also ships as the STConv layer of PyTorch Geometric Temporal (Rozemberczki et al., CIKM 2021)."]];
  let el;

  function build(root) {
    el = {};
    const pat = mk(mk(root, "defs"), "pattern", {id: "hatch26", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)"});
    mk(pat, "rect", {width: 6, height: 6, fill: rgb(P.GRN_T)});
    mk(pat, "line", {x1: 0, y1: 0, x2: 0, y2: 6, stroke: rgb(P.GRN_S), "stroke-width": 3});
    el.head = caps(root, "OPENALEX · CITING WORKS PER YEAR", 20, 30, rgb(P.GRN), "start");
    note(el.head, "OpenAlex, per year", "Works citing the paper, by year of the citing work, from api.openalex.org on 26 November 2026. One citing work dates from 2017, when the paper was an arXiv preprint (September 2017).", "OpenAlex API");
    mk(root, "line", {x1: 44, x2: 432, y1: Y0, y2: Y0, stroke: "#bdbdbd"});
    el.bars = CIT.map((c, i) => mk(root, "rect", {x: X(i) - BW / 2, width: BW, rx: 3, fill: i === 8 ? "url(#hatch26)" : rgb(P.GRN), stroke: i === 8 ? rgb(P.GRN) : "none", "stroke-dasharray": "4 2"}));
    el.vals = CIT.map((c, i) => txt(root, c.toLocaleString("en-US"), {x: X(i), "font-size": 11, "font-weight": 700, "text-anchor": "middle", fill: rgb(P.GRN)}));
    el.yrs = YEARS.map((y, i) => txt(root, y, {x: X(i), y: Y0 + 16, "font-size": 10.5, "text-anchor": "middle", fill: P.MID}));
    el.nov = txt(root, "to 26 Nov", {x: X(8), y: Y0 + 30, "font-size": 10.5, "text-anchor": "middle", fill: rgb(P.GRN)});
    note(el.bars[8], "2026, partial year", "Counted up to 26 November 2026, with about five weeks of the year left, so the final 2026 count will be higher.", "OpenAlex API");
    el.l1 = txt(root, "IJCAI 2018; preprint Sept 2017", {x: 52, y: 150, "font-size": 12.5, fill: P.MID});
    el.l3 = txt(root, "still rising: 1,948 in 2026 with five weeks left", {x: 52, y: 54, "font-size": 12.5, fill: rgb(P.GRN), "font-weight": 700});
    // right: totals across databases
    el.sh = caps(root, "ACROSS DATABASES", 456, 30, rgb(P.GRN), "start");
    note(el.sh, "Which count?", "Each database indexes a different set of works, so totals differ. Google Scholar, usually the highest, could not be read automatically. The alphaxiv page shows about 9k citations without naming its source, so that figure is not used here.", "retrieved 26 November 2026");
    el.rows = ROWS.map((r, i) => {
      const g = mk(root, "g"), y = 58 + i * 40;
      txt(g, r[0], {x: 456, y, "font-size": i < 3 ? 15 : 13, "font-weight": 700, fill: rgb(P.GRN)});
      const lab = txt(g, r[1], {x: 456, y: y + 15, "font-size": 10.5, fill: P.MID});
      const bar = r[2] ? mk(g, "rect", {x: 540, y: y - 10, height: 9, rx: 3, fill: rgb(P.GRN_S)}) : null;
      note(lab, r[3], r[4], "retrieved 26 November 2026");
      return {g, bar, w: r[2] / 7561 * 118};
    });
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    set(el.head, {opacity: E(0.1, 0.4)});
    CIT.forEach((c, i) => {
      const u = stagger(t, i % 3, STEP[Math.floor(i / 3)], 0.35, 0.8), h = Math.max(0.01, c * K * u);
      set(el.bars[i], {y: Y0 - h, height: h, opacity: u > 0 ? 1 : 0});
      const end = STEP[Math.floor(i / 3)] + (i % 3) * 0.35 + 0.8;
      set(el.vals[i], {y: Y0 - c * K - 6, opacity: E(end - 0.1, end + 0.2)});
      set(el.yrs[i], {opacity: stagger(t, i % 3, STEP[Math.floor(i / 3)], 0.35, 0.3)});
    });
    set(el.nov, {opacity: E(7.4, 7.7)});
    set(el.l1, {opacity: E(1.8, 2.2)});
    set(el.l3, {opacity: E(8.0, 8.4)});
    set(el.sh, {opacity: E(9.4, 9.7)});
    el.rows.forEach((r, i) => {
      set(r.g, {opacity: stagger(t, i, 9.7, 0.4, 0.35)});
      if (r.bar) set(r.bar, {width: Math.max(0.01, r.w * stagger(t, i, 9.9, 0.4, 0.8))});
    });
  }

  AF.run({id: "fig-citations", T: 13.8, starts: [0, 3.2, 6.0, 9.2], rest: 13.0, build, draw});
})();

// fig9.js
/* Fig 9: timeline of what grew from STGCN. Models above the line (filled), applications, tools and surveys below (hollow). */
(() => {
  const {set, mk, txt, caps, ease, rgb, note} = AF, P = PAL;
  const X = y => 70 + 63.75 * (y - 2018), TY = 192;
  const UP = [167, 135, 103, 71, 39], DN = [228, 257, 286, 315];
  const GREY = "#9a9a9a";
  // [name, venue line, year, side (1 above, -1 below), row, label side (1 right, -1 left), kind, reveal time, note title, note body]
  const ITEMS = [
    ["DCRNN", "ICLR 2018", 2018, 1, 1, 1, "grey", 1.4, "DCRNN [4]", "Diffusion Convolutional Recurrent Neural Network: Data-Driven Traffic Forecasting. Li et al., ICLR 2018; 5,827 citations (OpenAlex). Graph diffusion convolution inside a GRU encoder-decoder: a contemporaneous recurrent alternative that STGCN's GCGRU baseline follows, not a descendant."],
    ["ASTGCN", "AAAI 2019", 2019, 1, 0, 1, "model", 2.0, "ASTGCN", "Attention Based Spatial-Temporal Graph Convolutional Networks for Traffic Flow Forecasting. Guo et al., AAAI 2019; 4,201 citations. Adds spatial and temporal attention to the ST block."],
    ["Graph WaveNet", "IJCAI 2019", 2019, 1, 4, 1, "model", 2.6, "Graph WaveNet [5]", "Graph WaveNet for Deep Spatial-Temporal Graph Modeling. Wu et al., IJCAI 2019; 4,641 citations. Keeps temporal convolution plus graph convolution, adds a self-adaptive adjacency matrix learned from data and dilated causal convolutions."],
    ["STSGCN", "AAAI 2020", 2020, 1, 0, 1, "model", 3.8, "STSGCN", "Spatial-Temporal Synchronous Graph Convolutional Networks: A New Framework for Spatial-Temporal Network Data Forecasting. Song et al., AAAI 2020; 2,223 citations. Builds one graph over space and adjacent time steps together."],
    ["GMAN", "AAAI 2020", 2020, 1, 1, 1, "model", 4.3, "GMAN", "GMAN: A Graph Multi-Attention Network for Traffic Prediction. Zheng et al., AAAI 2020; 2,530 citations. An encoder-decoder built from graph multi-attention blocks."],
    ["AGCRN", "NeurIPS 2020", 2020, 1, 2, 1, "model", 4.8, "AGCRN", "Adaptive Graph Convolutional Recurrent Network for Traffic Forecasting. Bai et al., NeurIPS 2020; 2,450 citations. Node-adaptive parameters and a learned graph inside a recurrent cell."],
    ["MTGNN", "KDD 2020", 2020, 1, 3, 1, "key", 5.4, "MTGNN [6]", "Connecting the Dots: Multivariate Time Series Forecasting with Graph Neural Networks. Wu et al., KDD 2020; 3,210 citations. Learns the graph from the series themselves, so any multivariate time series, with no road map, gets the STGCN-style treatment."],
    ["STGODE", "KDD 2021", 2021, 1, 0, 1, "model", 7.8, "STGODE", "Spatial-Temporal Graph ODE Networks for Traffic Flow Forecasting. Fang et al., KDD 2021; 947 citations. Replaces stacked layers by a continuous-depth graph ODE."],
    ["STG-NCDE", "AAAI 2022", 2022, 1, 0, 1, "model", 8.4, "STG-NCDE", "Graph Neural Controlled Differential Equations for Traffic Forecasting. Choi et al., AAAI 2022; 451 citations. Uses neural controlled differential equations over the graph."],
    ["STConv", "PyG-Temporal 2021", 2021, -1, 2, 1, "app", 10.3, "PyG-Temporal STConv", "PyTorch Geometric Temporal (Rozemberczki et al., CIKM 2021) ships the STGCN block as its STConv layer, so it can be used off the shelf."],
    ["Survey", "TPAMI 2024", 2024, -1, 0, -1, "app", 10.9, "TPAMI survey [7]", "A Survey on Graph Neural Networks for Time Series. Jin et al., TPAMI 2024; 937 citations. Lists STGCN as a 2018 spectral-GNN forecaster with convolutional time modelling, whose structure became a building block for later models."],
    ["E-STGCN", "air quality, 2024", 2024, -1, 1, -1, "app", 11.4, "E-STGCN", "Panja et al., arXiv 2024 (v2 2025). STGCN combined with extreme-value theory to forecast air quality at 37 stations in Delhi."],
    ["RS-STGCN", "EEG, 2025", 2025, -1, 2, 1, "app", 11.9, "RS-STGCN", "Han et al., Frontiers in Neuroscience 2025. The STGCN block with a learned EEG electrode graph for emotion recognition: 88.00% on SEED and 85.43% on SEED-IV, subject-independent."],
    ["Review", "Neural Netw. 2025", 2025, -1, 3, 1, "app", 12.4, "Neural Networks review [8]", "Corradini et al., Neural Networks 2025, reviewing 366 papers on spatio-temporal GNNs. STGCN is the most popular GNN benchmark in the energy group and a common one in the environment group."],
    ["Dengue", "Sci Rep 2026", 2026, -1, 0, 1, "app", 12.9, "Dengue forecasting [9]", "Siabi et al., Scientific Reports 2026. STGCN adapted to weekly dengue cases in nine Central and South American countries, 2014 to 2022, 1 to 4 weeks ahead."],
    ["Depth study", "ITSC 2026", 2026, -1, 1, 1, "app", 13.4, "STGCN depth study [10]", "Lone et al., accepted at IEEE ITSC 2026. Compares 1, 2 and 3 ST-Conv blocks on four traffic data sets: one block is best at the 10-minute horizon on three of four, and two blocks cost 61% more CPU latency."]
  ];
  let el;

  function build(root) {
    el = {};
    el.trunk = mk(root, "line", {x1: 38, y1: TY, y2: TY, stroke: rgb(P.GRN_S), "stroke-width": 3, "stroke-linecap": "round"});
    el.ticks = [];
    for (let y = 2018; y <= 2026; y++) {
      const g = mk(root, "g");
      mk(g, "line", {x1: X(y), x2: X(y), y1: TY - 3, y2: TY + 3, stroke: rgb(P.GRN_S), "stroke-width": 1.5});
      txt(g, y, {x: X(y), y: TY + 16, "font-size": 10.5, "text-anchor": "middle", fill: P.MID});
      el.ticks.push(g);
    }
    // risers, one per year and side
    el.risers = {};
    ITEMS.forEach(it => { const k = it[2] + "/" + it[3]; if (!el.risers[k]) el.risers[k] = mk(root, "line", {x1: X(it[2]), x2: X(it[2]), stroke: it[6] === "grey" ? "#c4c4c4" : rgb(P.GRN_S), "stroke-width": 1.5, "stroke-dasharray": it[6] === "grey" ? "3 3" : "none"}); });
    el.items = ITEMS.map(it => {
      const [name, venue, yr, side, row, ls, kind] = it, x = X(yr), y = side > 0 ? UP[row] : DN[row];
      const g = mk(root, "g"), col = kind === "grey" ? GREY : rgb(P.GRN);
      if (kind === "key") mk(g, "circle", {cx: x, cy: y - 4, r: 9, fill: rgb(P.GRN_T), stroke: rgb(P.GRN), "stroke-width": 1.5});
      mk(g, "circle", {cx: x, cy: y - 4, r: 5, fill: kind === "app" ? "#fff" : col, stroke: col, "stroke-width": 2});
      const tx = x + ls * (kind === "key" ? 13 : 8), anchor = ls > 0 ? "start" : "end";
      txt(g, venue, {x: tx, y: y + 13, "font-size": 10, "text-anchor": anchor, fill: P.MID});
      if (kind === "grey") txt(g, "recurrent", {x: tx, y: y + 26, "font-size": 10, "font-style": "italic", "text-anchor": anchor, fill: GREY});
      txt(g, name, {x: tx, y, "font-size": 11, "font-weight": 700, "text-anchor": anchor, fill: kind === "grey" ? P.MID : rgb(P.GRN)});
      note(g, it[8], it[9], "OpenAlex citations as of 26 November 2026");
      return {g, y};
    });
    el.key = txt(root, "learns the graph: no map needed", {x: X(2020) + 64, y: UP[3], "font-size": 12.5, "font-weight": 700, fill: rgb(P.GRN)});
    el.stgcn = mk(root, "g");
    mk(el.stgcn, "circle", {cx: 30, cy: TY, r: 8, fill: rgb(P.RED), stroke: "#fff", "stroke-width": 2});
    txt(el.stgcn, "IJCAI 2018", {x: 16, y: TY - 14, "font-size": 10, fill: rgb(P.RED)});
    txt(el.stgcn, "STGCN", {x: 16, y: TY - 28, "font-size": 12.5, "font-weight": 700, fill: rgb(P.RED)});
    note(el.stgcn, "STGCN", "Spatio-Temporal Graph Convolutional Networks: A Deep Learning Framework for Traffic Forecasting. Yu, Yin and Zhu, IJCAI 2018 (arXiv September 2017); 7,561 citations (OpenAlex).", "OpenAlex, 26 November 2026");
    el.capU = caps(root, "FOLLOW-UP MODELS", 660, 30, rgb(P.GRN), "end");
    el.capD = caps(root, "APPLICATIONS, TOOLS, SURVEYS", 30, 332, rgb(P.GRN), "start");
    el.same = txt(root, "same block, new graphs", {x: 30, y: 246, "font-size": 12.5, "font-weight": 700, fill: rgb(P.GRN)});
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    set(el.stgcn, {opacity: E(0.1, 0.4)});
    set(el.trunk, {x2: 38 + (650 - 38) * E(0.3, 1.2)});
    el.ticks.forEach((g, i) => set(g, {opacity: E(0.4 + i * 0.09, 0.7 + i * 0.09)}));
    set(el.capU, {opacity: E(1.2, 1.5)});
    // each riser grows to its farthest revealed item
    const ends = {};
    ITEMS.forEach((it, i) => {
      const k = it[2] + "/" + it[3], u = E(it[7], it[7] + 0.4), y = el.items[i].y - 4, base = it[3] > 0 ? TY - 3 : TY + 21;
      const prev = ends[k] === undefined ? base : ends[k];
      ends[k] = u > 0 ? prev + (y - prev) * u : prev;
      ends[k + "b"] = base;
      set(el.items[i].g, {opacity: E(it[7] + 0.3, it[7] + 0.6)});
    });
    Object.keys(el.risers).forEach(k => set(el.risers[k], {y1: ends[k + "b"], y2: ends[k], opacity: ends[k] !== ends[k + "b"] ? 1 : 0}));
    set(el.key, {opacity: E(6.2, 6.6)});
    set(el.capD, {opacity: E(10.1, 10.4)});
    set(el.same, {opacity: E(14.0, 14.4)});
  }

  AF.run({id: "fig-lineage", T: 15.8, starts: [0, 3.5, 7.5, 10.0], rest: 15.0, build, draw});
})();
