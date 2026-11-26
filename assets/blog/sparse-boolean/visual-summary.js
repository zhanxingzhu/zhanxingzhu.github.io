// runtime.js
/* Shared runtime. Every figure supplies build(root) and draw(t); the time t (seconds) fully determines the frame,
   so pausing, jumping to a step and replaying are all just changes to t. */
/* A section whose h2 has class "slides-only" appears only on the deck, one with "report-only" only in the report.
   Both stay in the file, so that the page can always be unpacked into its complete sources (build.js --unpack). */
(() => {
  const deck = document.documentElement.classList.contains("deck");
  document.querySelectorAll(deck ? "h2.report-only" : "h2.slides-only").forEach(h => {
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
  // projected onto the stage. It only computes where to draw. Use it only where the geometry is the point (SKILL.md, "Depth").
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

/* Speed control: folded to the current speed, opens on hover, focus or tap. */
(() => {
  const sp = document.querySelector(".speed");
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
  const card = document.querySelector(".visual-summary").appendChild(document.createElement("div"));
  card.className = "note-card";
  card.setAttribute("role", "tooltip");
  let open = null, timer = 0;
  const visible = e => { for (let n = e; n && n.getAttribute; n = n.parentNode) if (+(n.getAttribute("opacity") ?? 1) < 0.5) return false; return true; };
  const find = e => { const n = e.target.closest ? e.target.closest("[data-note]") : null; return n && visible(n) ? n : null; };
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
/* Pieces shared by the figures of this page. The running example: 12 input bits, 8 of them relevant, 3 steps. */
Object.assign(KIT, {
  X: [1, -1, -1, -1, 1, 1, -1, 1, 1, 1, -1, 1],              // the input (invented)
  B: [0, 2, 3, 5, 6, 8, 9, 11],                               // the relevant positions, paired in this order
  Y1: [-1, -1, -1, 1], Y2: [1, -1], Y3: [-1],                 // the three steps for this input (products of pairs)
  sgn: v => v > 0 ? "+1" : "−1",
  // a value cell: rounded box with a label. Returns {g, box, lab}
  cell(parent, cx, y, w, h, s, fill, ink, size) {
    const g = AF.mk(parent, "g");
    const box = AF.mk(g, "rect", {x: cx - w / 2, y, width: w, height: h, rx: 5, fill});
    const lab = AF.txt(g, s, {x: cx, y: y + h / 2 + (size || 12.5) * 0.36, "text-anchor": "middle", "font-size": size || 12.5, fill: ink});
    return {g, box, lab};
  }
});

// fig1.js
/* Fig. 1: the task. Twelve bits, eight relevant; hard end to end; a tree of two-input steps. */
(() => {
  const {set, mk, txt, ease, mix, rgb, arrow, stagger, note} = AF, P = PAL, K = KIT;
  const cx = i => 127 + i * 42, rel = i => K.B.includes(i);
  const n1 = [169, 295, 421, 547], n2 = [232, 484], n3 = [358];
  let el;

  function build(root) {
    el = {bits: [], lv: [[], [], []], ed: [[], [], []], lab: []};
    el.edges = mk(root, "g");
    K.X.forEach((v, i) => el.bits.push(K.cell(root, cx(i), 236, 34, 26, K.sgn(v), rgb(P.KNOWN), P.INK)));
    el.rowLab = txt(root, "input x", {x: 18, y: 253, "font-size": 10.5, fill: P.MID});
    el.setLab = txt(root, "8 of the 12 bits matter: the hidden set B", {x: 358, y: 283, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: rgb(P.BLUE)});
    el.phi = txt(root, "answer = product of the 8 = −1", {x: 662, y: 30, "text-anchor": "end", "font-size": 12.5, fill: P.INK});
    // step 2: straight to the answer
    el.q = K.cell(root, 358, 40, 38, 26, "?", rgb(P.RED_T), rgb(P.RED));
    el.direct = arrow(root, rgb(P.RED), [[358, 228], [358, 72]]);
    el.hard1 = txt(root, "in one go: the gradient says almost nothing", {x: 372, y: 142, "font-size": 12.5, "font-weight": 700, fill: rgb(P.RED)});
    el.hard2 = txt(root, "about which bits matter", {x: 372, y: 159, "font-size": 12.5, "font-weight": 700, fill: rgb(P.RED)});
    // step 3: the tree
    const lvl = [[n1, 168, K.Y1, K.B.map(cx), 236], [n2, 104, K.Y2, n1, 168], [n3, 40, K.Y3, n2, 104]];
    lvl.forEach(([xs, y, vals, kids, ky], L) => xs.forEach((x, j) => {
      [kids[2 * j], kids[2 * j + 1]].forEach(kx => el.ed[L].push(mk(el.edges, "line", {x1: kx, y1: ky - 2, x2: x, y2: y + 28, stroke: rgb(P.BLUE_S), "stroke-width": 1.4, pathLength: 1})));
      el.lv[L].push(K.cell(root, x, y, 38, 26, K.sgn(vals[j]), rgb(P.BLUE_T), rgb(P.BLUE)));
    }));
    ["step 1", "step 2", "step 3"].forEach((s, L) => el.lab.push(txt(root, s, {x: 18, y: [185, 121, 57][L], "font-size": 10.5, fill: P.MID})));
    el.ans = txt(root, "= the answer", {x: 18, y: 71, "font-size": 10.5, fill: P.MID});
    el.rule = txt(root, "every node: the product of its two children", {x: 662, y: 49, "text-anchor": "end", "font-size": 12.5, fill: rgb(P.BLUE)});
    note(el.setLab, "The hidden set B", "A k-sparse Boolean function reads d bits but depends on only k of them. Which k is not told to the learner; finding them is the task. Here d = 12 and k = 8.", "Definition 2.1 of the paper");
    note(el.phi, "k-PARITY", "The product of the k relevant bits: +1 if an even number of them are −1, and −1 otherwise. The paper also treats k-AND and k-OR, which decompose in the same way with a different two-input function.", "Sec. 2.1 of the paper");
    note(el.hard2, "Why it is hard", "For parity, the gradient of an end-to-end objective is nearly the same whichever subset is the true one, so it carries a negligible amount of information about the target.", "Shalev-Shwartz et al. [2], as cited in Sec. 2.1");
    note(el.rule, "Recursive decomposition", "With k = 2^T relevant bits the function is computed by a complete binary tree of height T. Level t is the t-th reasoning step and has k / 2^t tokens. The paper also covers a serial version in which one bit is folded in per step.", "Fig. 2a and Appendix I of the paper");
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    // step 1 (0 - 3.4): the bits come in one after another, then the relevant ones are marked
    el.bits.forEach((c, i) => {
      set(c.g, {opacity: stagger(t, i, 0.3, 0.07, 0.3)});
      const u = rel(i) ? stagger(t, K.B.indexOf(i), 1.5, 0.07, 0.35) : 0;
      set(c.box, {fill: rgb(mix(P.KNOWN, P.BLUE_T, u)), stroke: rgb(P.BLUE), "stroke-opacity": u, "stroke-width": 1.3});
    });
    set(el.rowLab, {opacity: E(0.3, 0.7)});
    set(el.setLab, {opacity: E(2.1, 2.5)});
    set(el.phi, {opacity: E(2.6, 3.0)});
    // step 2 (3.4 - 6.4): straight to the answer does not work
    const gone = 1 - E(6.5, 7.0);
    el.direct(E(3.7, 4.5), gone);
    set(el.q.g, {opacity: Math.min(E(4.3, 4.7), gone)});
    set(el.hard1, {opacity: Math.min(E(4.9, 5.3), gone)});
    set(el.hard2, {opacity: Math.min(E(4.9, 5.3), gone)});
    // step 3 (6.4 - 11.2): level by level
    [7.1, 8.5, 9.8].forEach((t0, L) => {
      el.ed[L].forEach((e, i) => { const u = stagger(t, i >> 1, t0, 0.12, 0.4); set(e, {"stroke-dasharray": u + " 1", opacity: u > 0.01 ? 1 : 0}); });
      el.lv[L].forEach((c, j) => set(c.g, {opacity: stagger(t, j, t0 + 0.3, 0.12, 0.35)}));
      set(el.lab[L], {opacity: E(t0, t0 + 0.4)});
    });
    set(el.ans, {opacity: E(10.1, 10.5)});
    set(el.rule, {opacity: E(8.0, 8.4)});
  }

  AF.run({id: "fig-task", T: 12.0, starts: [0, 3.4, 6.4], rest: 11.2, build, draw});
})();

// fig2.js
/* Fig. 2: the model. A sequence of input bits and empty slots; attention of one slot before and after learning. */
(() => {
  const {set, mk, txt, rich, ease, mix, rgb, caps, stagger, note} = AF, P = PAL, K = KIT;
  const xs = i => 49 + i * 31;                                   // centres of the 12 input cells
  const s1 = [433, 464, 495, 526], s2 = [569, 600], s3 = [643];  // centres of the slots
  const vals = [...K.Y1, ...K.Y2, ...K.Y3], slots = [...s1, ...s2, ...s3];
  const arcD = (a, b, dip) => "M" + a + " 234Q" + (a + b) / 2 + " " + dip + " " + b + " 234";
  let el;

  function build(root) {
    el = {bits: [], slots: [], bars: [], arcs: []};
    caps(root, "INPUT x", 219.5, 24, P.INK);
    el.heads = [caps(root, "STEP 1", 479.5, 24, P.INK), caps(root, "STEP 2", 584.5, 24, P.INK), caps(root, "STEP 3", 643, 24, P.INK)];
    K.X.forEach((v, i) => el.bits.push(K.cell(root, xs(i), 206, 26, 26, v > 0 ? "+" : "−", rgb(P.KNOWN), P.INK)));
    slots.forEach((x, j) => {
      const g = mk(root, "g");
      const box = mk(g, "rect", {x: x - 13, y: 206, width: 26, height: 26, rx: 5, fill: "#fff", stroke: "#b9bfc8", "stroke-dasharray": "3 2.5"});
      const val = txt(g, vals[j] > 0 ? "+" : "−", {x, y: 223.5, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: rgb(P.BLUE)});
      el.slots.push({g, box, val});
    });
    el.writes = txt(root, "the model writes these, left to right", {x: 538, y: 44, "text-anchor": "middle", "font-size": 10.5, fill: P.MID});
    // attention of the first slot over the input
    el.barG = mk(root, "g");
    K.X.forEach((v, i) => el.bars.push(mk(el.barG, "rect", {x: xs(i) - 8, width: 16, rx: 3, fill: rgb(P.GREY)})));
    el.barLab = txt(root, "attention of the first slot", {x: 36, y: 96, "font-size": 10.5, fill: P.MID});
    el.focus = mk(root, "rect", {x: s1[0] - 16, y: 203, width: 32, height: 32, rx: 7, fill: "none", stroke: P.INK, "stroke-width": 1.6});
    el.even1 = txt(root, "even attention:", {x: 428, y: 92, "font-size": 12.5, "font-weight": 700, fill: P.MID});
    el.even2 = txt(root, "it sees the average of all 12 bits", {x: 428, y: 109, "font-size": 12.5, fill: P.MID});
    el.goal = mk(root, "g");
    txt(el.goal, "½ on each of its two children", {x: 428, y: 92, "font-size": 12.5, "font-weight": 700, fill: rgb(P.BLUE)});
    el.calc = rich(el.goal, [["average of (+1, −1) = 0  →  "], ["ψ", {"font-style": "italic"}], ["(0) = 0"]], {x: 428, y: 113, "font-size": 12.5, fill: P.INK});
    el.out = txt(el.goal, "chance of writing +1 is 0: it writes −1", {x: 428, y: 134, "font-size": 12.5, fill: P.INK});
    [[xs(0), s1[0], 272], [xs(2), s1[0], 262], [s1[0], s2[0], 262], [s1[1], s2[0], 254], [s2[0], s3[0], 254], [s2[1], s3[0], 250]].forEach(([a, b, dip]) =>
      el.arcs.push(mk(root, "path", {d: arcD(a, b, dip), fill: "none", stroke: rgb(P.BLUE), "stroke-width": 1.5, pathLength: 1})));
    el.sum = txt(root, "learning the function = finding the right two positions for every token", {x: 340, y: 290, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: rgb(P.BLUE)});
    note(el.writes, "Autoregressive generation", "The slots start at 0. The transformer is applied to its own output again and again: it writes one token, puts it back into the sequence, and writes the next. In RL a token is sampled from the output probability; in SFT it is the sign of a score.", "Sec. 2.2 and Fig. 4 of the paper");
    note(el.barLab, "Attention score", "For the token being written, the softmax of one column of the weight matrix W: how much weight each earlier position gets. The paper starts from W = 1, which gives equal weight to every position the mask allows.", "Sec. 2.2 of the paper");
    note(el.calc, "ψ", "The activation after the attention layer. It turns the average of the attended tokens into a number between 0 and 1. For parity ψ(z) = z², so two equal bits (average ±1) give 1 and two different bits (average 0) give 0. AND and OR use other choices.", "Table 1 of the paper");
    note(el.heads[0], "The mask", "Tokens of step t may attend only to the tokens of step t − 1 (for step 1, the input). The paper calls this a “pretrained” mask: a structural prior standing in for what pretraining provides. It is an assumption of the analysis.", "Sec. 2.2 and Fig. 2b of the paper");
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    // step 1 (0 - 2.6): the sequence
    el.bits.forEach((c, i) => set(c.g, {opacity: stagger(t, i, 0.3, 0.05, 0.3)}));
    el.slots.forEach((s, j) => {
      set(s.g, {opacity: stagger(t, j, 1.1, 0.08, 0.3)});
      const w = E([10.0, 10.2, 10.4, 10.6, 11.4, 11.6, 12.4][j], [10.0, 10.2, 10.4, 10.6, 11.4, 11.6, 12.4][j] + 0.35), first = j === 0 ? E(8.3, 8.7) : 0, u = Math.max(w, first);
      set(s.val, {opacity: u});
      set(s.box, {fill: rgb(mix(P.WHITE, P.BLUE_T, u)), "stroke-opacity": 1 - u});
    });
    el.heads.forEach((h, j) => set(h, {opacity: E(1.1 + 0.2 * j, 1.5 + 0.2 * j)}));
    set(el.writes, {opacity: E(1.8, 2.2)});
    // step 2 (2.6 - 5.6): even attention.  step 3 (5.6 - 9.2): two children
    const g = E(5.9, 6.9);                                    // from even to learned
    K.X.forEach((v, i) => {
      const child = i === 0 || i === 2, h = mix([70 / 6], [child ? 70 : 0], g)[0] * stagger(t, i, 3.0, 0.04, 0.35);
      set(el.bars[i], {y: 196 - h, height: Math.max(0, h), fill: rgb(child ? mix([200, 204, 211], P.BLUE, g) : [200, 204, 211])});
    });
    set(el.barG, {opacity: 1 - 0.55 * E(9.4, 9.9)});
    set(el.barLab, {opacity: Math.min(E(3.0, 3.4), 1 - 0.55 * E(9.4, 9.9))});
    set(el.focus, {opacity: Math.min(E(2.8, 3.2), 1 - E(9.4, 9.8))});
    const even = Math.min(E(3.8, 4.2), 1 - E(5.7, 6.0));
    set(el.even1, {opacity: even}); set(el.even2, {opacity: even});
    set(el.goal, {opacity: Math.min(E(6.8, 7.2), 1 - E(9.4, 9.8))});
    set(el.calc, {opacity: E(7.4, 7.8)});
    set(el.out, {opacity: E(8.0, 8.4)});
    // arcs: children of the first slot, then (step 4, 9.2 - 13.4) of one token of step 2 and of step 3
    [[6.6, 9.6], [6.75, 9.6], [10.8, 11.9], [10.9, 11.9], [11.9, 99], [12.0, 99]].forEach(([a, z], i) => {
      const u = E(a, a + 0.5);
      set(el.arcs[i], {"stroke-dasharray": u + " 1", opacity: u > 0.01 ? 1 - 0.65 * E(z, z + 0.4) : 0});
    });
    set(el.sum, {opacity: E(12.6, 13.0)});
  }

  AF.run({id: "fig-model", T: 14.2, starts: [0, 2.6, 5.6, 9.2], rest: 13.4, build, draw});
})();

// fig3.js
/* Fig. 3: four ways to supervise a three-step chain. One row per setting. */
(() => {
  const {set, mk, txt, ease, rgb, arrow, stagger, note} = AF, P = PAL;
  const SX = [226, 336, 446], W = 66, OWN = "#555", TRUE = rgb(P.GRN);
  const rows = [
    {name: "RL, process rewards", sub: "a reward for every step", hue: "AMB", read: [0, 0], fb: ["reward", "reward", "reward"], tag: ["each step is judged on", "what the model itself", "wrote before it"]},
    {name: "RL, final reward", sub: "one reward at the end", hue: "AMB", read: [0, 0], fb: [null, null, "reward"], tag: ["only the final", "answer is judged"]},
    {name: "SFT, teacher forcing", sub: "true steps fed in", hue: "GRN", read: [1, 1], fb: ["loss", "loss", "loss"], tag: ["every step reads the", "true step before it"]},
    {name: "SFT, no teacher forcing", sub: "its own steps fed in", hue: "GRN", read: [0, 0], fb: ["loss", "loss", "loss"], tag: ["labels are fixed from", "the input; the steps it", "reads are its own"]}
  ];
  let el;

  function build(root) {
    el = [];
    rows.forEach((r, k) => {
      const y = 30 + k * 66, g = mk(root, "g"), c = P[r.hue], o = {g, arr: [], box: [], fb: [], tag: []};
      o.name = txt(g, r.name, {x: 18, y: y + 11, "font-size": 12.5, "font-weight": 700, fill: rgb(c)});
      txt(g, r.sub, {x: 18, y: y + 27, "font-size": 10.5, fill: P.MID});
      const xb = mk(g, "g");
      mk(xb, "rect", {x: 172, y, width: 30, height: 26, rx: 5, fill: rgb(P.KNOWN)});
      txt(xb, "x", {x: 187, y: y + 17.5, "text-anchor": "middle", "font-size": 12.5, "font-style": "italic", fill: P.INK});
      o.x = xb;
      SX.forEach((x, j) => {
        const from = j ? SX[j - 1] + W + 3 : 205, teacher = j && r.read[j - 1];
        o.arr.push(arrow(g, j ? (teacher ? TRUE : OWN) : P.SOFT, [[from, y + 13], [x - 3, y + 13]]));
        const b = mk(g, "g");
        mk(b, "rect", {x, y, width: W, height: 26, rx: 5, fill: "#fff", stroke: "#b9bfc8"});
        txt(b, "step " + (j + 1), {x: x + W / 2, y: y + 17.5, "text-anchor": "middle", "font-size": 12.5, fill: P.INK});
        o.box.push(b);
        const f = mk(g, "g");
        if (r.fb[j]) {
          mk(f, "rect", {x, y: y + 31, width: W, height: 17, rx: 4, fill: rgb(P[r.hue + "_T"])});
          txt(f, r.fb[j], {x: x + W / 2, y: y + 43.3, "text-anchor": "middle", "font-size": 10.5, "font-weight": 700, fill: rgb(c)});
        } else {
          mk(f, "rect", {x: x + 0.5, y: y + 31.5, width: W - 1, height: 16, rx: 4, fill: "none", stroke: "#cfd3d9", "stroke-dasharray": "3 2.5"});
          txt(f, "none", {x: x + W / 2, y: y + 43.3, "text-anchor": "middle", "font-size": 10.5, fill: P.SOFT});
        }
        o.fb.push(f);
      });
      r.tag.forEach((s, i) => o.tag.push(txt(g, s, {x: 532, y: y + 9 + i * 14.5 + (3 - r.tag.length) * 7, "font-size": 10.5, fill: P.INK})));
      el.push(o);
    });
    el.key = mk(root, "g");
    mk(el.key, "path", {d: "M172 297h22", stroke: OWN, "stroke-width": 1.6});
    mk(el.key, "path", {d: "M199 297l-7 -3.6v7.2z", fill: OWN});
    el.k1 = txt(el.key, "reads the model’s own previous step", {x: 206, y: 301, "font-size": 10.5, fill: P.MID});
    mk(el.key, "path", {d: "M418 297h22", stroke: TRUE, "stroke-width": 1.6});
    mk(el.key, "path", {d: "M445 297l-7 -3.6v7.2z", fill: TRUE});
    el.k2 = txt(el.key, "reads the true previous step", {x: 452, y: 301, "font-size": 10.5, fill: P.MID});
    note(el[0].name, "Verifiable process reward", "The reward of step t compares the generated step with the label that is correct given the step the model generated before it. The total reward is the sum over steps, and it is maximised by policy gradient.", "Sec. 3.1 and Fig. 1 of the paper; the idea of process rewards follows Shao et al. [5]");
    note(el[1].name, "Final reward", "The reward is the generated final answer times the true answer: +1 if they agree, −1 if not. Nothing rewards the intermediate steps.", "Sec. 3.1 of the paper");
    note(el[2].name, "Teacher forcing", "During training each step is generated from the ground-truth previous steps, not from the model’s own. At inference no ground truth exists, so training and use do not match.", "Sec. 3.2 of the paper");
    note(el[3].name, "SFT without teacher forcing", "The model generates the whole chain from its own outputs and a hinge loss compares each generated step with its ground-truth label. No data augmentation, filtering or curriculum is used.", "Sec. 3.2 of the paper");
    note(el.k2, "True step", "The ground-truth value of a reasoning step, computed from the input by the decomposition of Fig. 1.");
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    el.forEach((o, k) => {
      const t0 = [0.3, 4.2, 7.8, 11.4][k];
      set(o.g, {opacity: E(t0, t0 + 0.4)});
      set(o.x, {opacity: E(t0 + 0.2, t0 + 0.5)});
      SX.forEach((x, j) => {
        o.arr[j](stagger(t, j, t0 + 0.5, 0.45, 0.4));
        set(o.box[j], {opacity: stagger(t, j, t0 + 0.75, 0.45, 0.3)});
        set(o.fb[j], {opacity: stagger(t, j, t0 + 2.0, 0.15, 0.35)});
      });
      o.tag.forEach(e => set(e, {opacity: E(t0 + 2.7, t0 + 3.1)}));
    });
    set(el.key, {opacity: E(1.6, 2.0)});
    set(el.k2, {opacity: 1}); set(el.k1, {opacity: 1});
  }

  AF.run({id: "fig-ways", T: 15.8, starts: [0, 3.9, 7.5, 11.1], rest: 15.0, build, draw});
})();

// fig4.js
/* Fig. 4: why the order differs. Two lanes; a label fits when it answers the question the model was actually asked. */
(() => {
  const {set, mk, txt, ease, mix, rgb, arrow, caps, stagger, note} = AF, P = PAL;
  const SX = [150, 300, 450], W = 96;
  const lanes = [{y: 52, hue: "AMB", title: "RL WITH PROCESS REWARDS"}, {y: 196, hue: "GRN", title: "SFT WITHOUT TEACHER FORCING"}];
  let el;

  function build(root) {
    el = [];
    lanes.forEach((L, k) => {
      const c = P[L.hue], o = {box: [], wrong: [], right: [], lab: [], dep: [], ok: [], no: []}, y = L.y;
      o.g = mk(root, "g");
      o.title = caps(o.g, L.title, 18, y - 20, rgb(c), "start");
      mk(o.g, "rect", {x: 60, y, width: 44, height: 28, rx: 5, fill: rgb(P.KNOWN)});
      txt(o.g, "x", {x: 82, y: y + 18.5, "text-anchor": "middle", "font-size": 12.5, "font-style": "italic", fill: P.INK});
      SX.forEach((x, j) => {
        arrow(o.g, P.SOFT, [[j ? SX[j - 1] + W + 3 : 107, y + 14], [x - 3, y + 14]])(1);
        o.box.push(mk(o.g, "rect", {x, y, width: W, height: 28, rx: 5}));
        o.wrong.push(txt(o.g, "step " + (j + 1) + ": wrong", {x: x + W / 2, y: y + 18.5, "text-anchor": "middle", "font-size": 12.5, fill: rgb(P.RED)}));
        o.right.push(txt(o.g, "step " + (j + 1) + ": right", {x: x + W / 2, y: y + 18.5, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: rgb(P.BLUE)}));
        // the label this step is compared with, and where that label comes from
        const lg = mk(o.g, "g");
        mk(lg, "rect", {x: x - 8, y: y + 46, width: W + 16, height: 22, rx: 4, fill: rgb(P[L.hue + "_T"])});
        txt(lg, k ? "label, fixed from x" : ["label, from x", "label, from its step 1", "label, from its step 2"][j], {x: x + W / 2, y: y + 60.7, "text-anchor": "middle", "font-size": 9.8, "font-weight": 700, fill: rgb(c)});
        o.lab.push(lg);
        // RL: the label depends on the step just before (or on x); SFT: every label hangs on one line from x
        // RL: the label is computed from the value the step itself reads (tapped off the arrow into the step).
        // SFT: every label hangs on one line that starts at x
        o.dep.push(k ? mk(o.g, "path", {d: "M82 " + (y + 30) + "V" + (y + 38) + "H" + (x + W / 2) + "V" + (y + 45), fill: "none", stroke: rgb(c), "stroke-width": 1.4, pathLength: 1})
                     : mk(o.g, "path", {d: "M" + (x - 23) + " " + (y + 16) + "V" + (y + 57) + "H" + (x - 11), fill: "none", stroke: rgb(c), "stroke-width": 1.4, pathLength: 1}));
        o.ok.push(txt(o.g, "fits what it read", {x: x + W / 2, y: y + 84, "text-anchor": "middle", "font-size": 10.5, "font-weight": 700, fill: rgb(P.BLUE)}));
        o.no.push(txt(o.g, "does not fit yet", {x: x + W / 2, y: y + 84, "text-anchor": "middle", "font-size": 10.5, fill: rgb(P.RED)}));
      });
      o.num = [1, 2, 3].map(n => txt(o.g, String(n), {x: 615, y: y + 30, "text-anchor": "middle", "font-size": 30, "font-weight": 700, fill: rgb(c)}));
      o.numLab = txt(o.g, "update", {x: 615, y: y + 48, "text-anchor": "middle", "font-size": 10.5, fill: P.MID});
      o.numLabs = txt(o.g, "updates", {x: 615, y: y + 48, "text-anchor": "middle", "font-size": 10.5, fill: P.MID});
      el.push(o);
    });
    el.rule = mk(root, "line", {x1: 18, y1: 154, x2: 662, y2: 154, stroke: "#e6e6e6"});
    note(el[0].title, "Why one update is enough", "The reward of step t is defined against the label that is correct given the generated step t − 1. So its signal does not depend on the earlier steps being right, and the rewards of all steps can be improved in the same update.", "Theorem 3.1 and the discussion in Sec. 3.3 of the paper");
    note(el[1].title, "Why it is step-wise", "The labels of all steps are fixed by the input. A later step can only match its label once the steps before it are generated correctly, so the steps are learned in order. No curriculum or filtering is needed for this to happen.", "Theorem 3.3 and Sec. 3.3 of the paper");
    note(el[0].ok[1], "A wrong step still gets a fair test", "Step 2 read a wrong step 1. Its reward asks: is step 2 the right function of that wrong step? The model can learn to answer this before step 1 is fixed.");
    note(el[1].numLabs, "T updates", "One sign-gradient update per reasoning step, so T updates for a chain of T steps. With teacher forcing, SFT learns all steps in one update, like RL here.", "Theorem 3.3 and Appendix B (Q4) of the paper");
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    // when each step turns right, and when each label is seen to fit
    const turn = [[6.4, 6.4, 6.4], [10.6, 13.2, 15.2]], fit = [[4.9, 5.2, 5.5], [9.0, 12.4, 14.4]], show = [[3.3, 3.6, 3.9], [7.9, 8.1, 8.3]];
    el.forEach((o, k) => {
      set(o.g, {opacity: E(0.3 + 0.5 * k, 0.8 + 0.5 * k)});
      [0, 1, 2].forEach(j => {
        const r = E(turn[k][j], turn[k][j] + 0.6), f = E(fit[k][j], fit[k][j] + 0.4), s = E(show[k][j], show[k][j] + 0.4);
        set(o.box[j], {fill: rgb(mix(P.RED_T, P.BLUE_T, r))});
        set(o.wrong[j], {opacity: (1 - r) * stagger(t, j, 1.3 + 0.3 * k, 0.25, 0.3)});
        set(o.right[j], {opacity: r});
        set(o.lab[j], {opacity: s});
        const u = E(show[k][j] + 0.2, show[k][j] + 0.9);
        set(o.dep[j], {"stroke-dasharray": u + " 1", opacity: u > 0.01 ? 1 : 0});
        set(o.ok[j], {opacity: f});
        set(o.no[j], {opacity: k ? Math.min(E(9.2, 9.6), 1 - f) : 0});
      });
      const n = k ? [E(10.9, 11.2), E(13.5, 13.8), E(15.5, 15.8)] : [E(6.7, 7.0), 0, 0];
      set(o.num[0], {opacity: n[0] * (1 - n[1])}); set(o.num[1], {opacity: n[1] * (1 - n[2])}); set(o.num[2], {opacity: n[2]});
      set(o.numLab, {opacity: n[0] * (1 - n[1])}); set(o.numLabs, {opacity: n[1]});
    });
    set(el.rule, {opacity: E(0.6, 1.0)});
  }

  AF.run({id: "fig-why", T: 17.2, starts: [0, 3.0, 7.5, 11.8], rest: 16.4, build, draw});
})();

// fig5.js
/* Fig. 5: the sign of the gradient as a grid (rows: tokens written, columns: positions attended to). RL: one grid with
   signal in all three blocks. SFT: one grid per update, stacked in depth, with signal in one block each. */
(() => {
  const {set, mk, txt, ease, rgb, caps, note} = AF, P = PAL, K = KIT;
  const CW = 11, CH = 13, X0 = -99, Y0 = 45.5;
  const blocks = [[0, 4, 0, 12], [4, 6, 12, 16], [6, 7, 16, 18]];             // rows r0..r1, columns c0..c1 of each step
  const kids = r => r < 4 ? [K.B[2 * r], K.B[2 * r + 1]] : r === 4 ? [12, 13] : r === 5 ? [14, 15] : [16, 17];
  const SR = K.space(172, 150), SS = K.space(486, 150);
  const quad = (S, c0, r0, c1, r1, z) => S.path([[X0 + c0 * CW, Y0 - r0 * CH, z], [X0 + c1 * CW, Y0 - r0 * CH, z], [X0 + c1 * CW, Y0 - r1 * CH, z], [X0 + c0 * CW, Y0 - r1 * CH, z]], true);
  let pl, el;

  function plane(root, S, z, lit, at, name) {
    const g = mk(root, "g"), p = {g, S, z, lit, at, cells: [], blk: [], marks: []};
    p.frame = mk(g, "path", {fill: "#fff", "fill-opacity": 0.3, stroke: "#c3c8d0", "stroke-linejoin": "round"});
    blocks.forEach(b => p.blk.push(mk(g, "path", {fill: "#eceef2", "fill-opacity": 0.55, stroke: "#d5d9df", "stroke-linejoin": "round"})));
    blocks.forEach((b, k) => { for (let r = b[0]; r < b[1]; r++) for (let c = b[2]; c < b[3]; c++) {
      const child = kids(r).includes(c);
      p.cells.push({e: mk(g, "path", {fill: rgb(child ? P.BLUE : P.RED_S), stroke: "#fff", "stroke-width": 0.6}), r, c, k, child});
    } });
    p.cells.filter(q => q.child).forEach(q => p.marks.push({e: mk(g, "path", {fill: "none", stroke: rgb(P.BLUE), "stroke-width": 1.1}), r: q.r, c: q.c}));
    p.name = txt(g, name, {"font-size": 10.5, "font-weight": 700, fill: P.MID});
    return p;
  }

  function build(root) {
    el = {};
    el.hRL = caps(root, "RL, PROCESS REWARDS", 18, 26, rgb(P.AMB), "start");
    el.hSFT = caps(root, "SFT, NO TEACHER FORCING", 372, 26, rgb(P.GRN), "start");
    // back to front
    pl = [plane(root, SS, -60, 1, 11.6, "update 2"), plane(root, SS, 60, 0, 8.3, "update 1"), plane(root, SR, 0, -1, 0.3, "update 1")];
    el.cols = txt(root, "columns: the positions a token may attend to", {x: 172, y: 92, "text-anchor": "middle", "font-size": 10.5, fill: P.MID});
    el.rows = txt(root, "rows: the tokens the model writes", {x: 73, y: 216, "font-size": 10.5, fill: P.MID});
    el.steps = ["step 1", "step 2", "step 3: nothing to learn"].map(s => txt(root, s, {"font-size": 10.5, fill: P.INK}));
    el.rRL = txt(root, "every block at once: 1 update", {x: 172, y: 252, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: rgb(P.AMB)});
    el.rSFT = txt(root, "one block per update, in order", {x: 492, y: 252, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: rgb(P.GRN)});
    el.key = mk(root, "g");
    mk(el.key, "rect", {x: 112, y: 276, width: 11, height: 11, rx: 2, fill: rgb(P.BLUE)});
    el.k1 = txt(el.key, "pushes attention up: a child", {x: 129, y: 285.5, "font-size": 10.5, fill: P.MID});
    mk(el.key, "rect", {x: 300, y: 276, width: 11, height: 11, rx: 2, fill: rgb(P.RED_S)});
    el.k2 = txt(el.key, "pushes it down: not a child", {x: 317, y: 285.5, "font-size": 10.5, fill: P.MID});
    mk(el.key, "rect", {x: 482.5, y: 276.5, width: 10, height: 10, rx: 2, fill: "#f1f2f5", stroke: "#d5d9df"});
    txt(el.key, "no signal", {x: 499, y: 285.5, "font-size": 10.5, fill: P.MID});
    note(el.k1, "Separation", "The proofs reduce to one condition on a quantity the paper calls the critical gradient component: it must be larger at a token’s two children than at any other position. Then the sign gradient raises the attention on the children and lowers it everywhere else.", "Eq. (7), Theorems 3.1 and 3.3 of the paper");
    note(el.rRL, "RL at initialisation", "What Theorem 3.1 needs: at W = 1 the policy gradient is positive at every child and negative at every other position, for all steps together. The paper’s numerical experiment shows this pattern; it is the next figure on this page.", "Theorem 3.1 of the paper");
    note(el.rSFT, "SFT, update by update", "What Theorem 3.3 describes: at each update the loss gradient is non-zero only for the step whose earlier steps are already right. The paper’s experiment shows this too; see the next figure.", "Theorem 3.3 of the paper");
    note(el.hSFT, "Depth = update number", "The three grids are the same weight matrix seen at three successive updates. They are stacked from front to back only so that all three can be read at once.");
  }

  function draw(t, life = 0) {
    const E = (a, b) => ease((t - a) / (b - a));
    const turn = E(7.2, 8.5), yaw = -0.56 * turn + 0.07 * Math.sin(0.8 * life) * E(8.5, 9.3), pitch = 0.3 * turn;
    SR.view(yaw, pitch); SS.view(yaw, pitch);
    pl.forEach(p => {
      const inn = E(p.at, p.at + 0.7), z = p.z + (p.S === SS ? -60 * (1 - inn) : 0);
      set(p.g, {opacity: inn});
      set(p.frame, {d: quad(p.S, 0, 0, 18, 7, z)});
      blocks.forEach((b, k) => set(p.blk[k], {d: quad(p.S, b[2], b[0], b[3], b[1], z)}));
      const on = p.lit < 0 ? E(4.0, 4.7) : E(p.at + 0.9, p.at + 1.5);
      p.cells.forEach(q => set(q.e, {d: quad(p.S, q.c, q.r, q.c + 1, q.r + 1, z), opacity: q.k < 2 && (p.lit < 0 || p.lit === q.k) ? on : 0}));   // step 3 has only its two children to look at: no gradient
      p.marks.forEach(m => set(m.e, {d: quad(p.S, m.c + 0.12, m.r + 0.12, m.c + 0.88, m.r + 0.88, z), opacity: E(1.6, 2.0)}));
      const c = p.S.pt([X0, Y0 + 7, z]);
      set(p.name, {x: c[0], y: c[1], opacity: p.S === SS ? 1 : E(8.3, 8.7)});
    });
    const flat = 1 - E(6.8, 7.2);
    set(el.cols, {opacity: Math.min(E(0.9, 1.3), flat)}); set(el.rows, {opacity: Math.min(E(1.1, 1.5), flat)});
    [[X0 + 4, Y0 - 4 * CH - 13, "start"], [X0 + 16 * CW, Y0 - 4 * CH + 6, "end"], [X0 + 18 * CW, Y0 - 7 * CH - 11, "end"]].forEach(([x, y, a], k) => {
      const q = SR.pt([x, y, 0]);
      set(el.steps[k], {x: q[0], y: q[1], "text-anchor": a, opacity: E(2.2 + 0.25 * k, 2.6 + 0.25 * k)});
    });
    set(el.hRL, {opacity: E(0.3, 0.7)});
    set(el.hSFT, {opacity: E(7.6, 8.0)});
    set(el.rRL, {opacity: E(5.0, 5.4)});
    set(el.rSFT, {opacity: E(13.2, 13.6)});
    set(el.key, {opacity: E(4.4, 4.8)});
  }

  AF.run({id: "fig-grad", T: 15.0, starts: [0, 3.6, 7.0, 11.2], rest: 14.2, idle: true, build, draw});
})();

// fig6.js
/* Fig. 6: the paper's own Figures 5 and 6 as the base picture, with a guide drawn on top: where to look, in which order.
   Stage units = picture pixels x 680 / 2673; the picture sits 30 units down, leaving a band for our labels. */
(() => {
  const {set, mk, txt, ease, rgb, stagger, note} = AF, P = PAL, K = KIT, OY = 30;
  const grid = (ox, oy, cw, ch) => (c0, c1, r0, r1) => [ox + c0 * cw - 1.2, OY + oy + r0 * ch - 1.2, (c1 - c0) * cw + 2.4, (r1 - r0) * ch + 2.4];
  const RL = grid(191.6, 7.6, 63.3 / 15, 149.6 / 35), S = [335.0, 451.0, 567.6].map(x => grid(x, 8.9, 81.3 / 15, 191.1 / 35));
  const blocks = g => [g(0, 8, 0, 20), g(8, 12, 20, 28), g(12, 14, 28, 32)];            // steps 1, 2, 3
  const mixR = (a, b, u) => a.map((v, i) => v + (b[i] - v) * u);
  const A = [10, OY, 92, 190], Bp = [172, OY, 92, 190], S0 = [316, OY, 110, 229], SA = [316, OY, 348, 229];
  let el;

  function build(root, svg) {
    el = {};
    el.spot = K.spot(root, 680, 268);
    el.heads = [["the pattern to reach", 58.6, P.BLUE], ["RL, first update", 223.2, P.AMB], ["SFT, update 1", 375.6, P.GRN], ["SFT, update 2", 491.7, P.GRN], ["SFT, update 3", 608.4, P.GRN]]
      .map(([s, x, c]) => txt(root, s, {x, y: 19, "text-anchor": "middle", "font-size": 10.5, "font-weight": 700, fill: rgb(c)}));
    el.rl = blocks(RL).map(b => mk(root, "rect", {x: b[0], y: b[1], width: b[2], height: b[3], rx: 1.5, fill: "none", stroke: rgb(P.AMB), "stroke-width": 2}));
    el.ghost = [0, 1].map(k => { const b = blocks(S[k])[k]; return mk(root, "rect", {x: b[0], y: b[1], width: b[2], height: b[3], rx: 1.5, fill: "none", stroke: rgb(P.GRN_S), "stroke-width": 1.6}); });
    el.box = mk(root, "rect", {rx: 1.5, fill: "none", stroke: rgb(P.GRN), "stroke-width": 2});
    el.tRL = txt(root, "RL: all three blocks in the same update", {x: 25, y: 240, "font-size": 12.5, "font-weight": 700, fill: rgb(P.AMB)});
    el.tSFT = txt(root, "SFT: one block per update", {x: 25, y: 258, "font-size": 12.5, "font-weight": 700, fill: rgb(P.GRN)});
    const b3 = blocks(S[2])[2];
    el.lens = K.lens(root, svg, b3, [575, OY + 22, b3[2] * 3.4, b3[3] * 3.4]);
    el.rows = K.hot(root, 176, OY + 7.6, 14, 150, "Rows", "The position a token may attend to: the 20 input bits x1 to x20, then the tokens of steps 1, 2 and 3.", "Fig. 5 of the paper");
    el.cols = K.hot(root, 191.6, OY + 158.5, 63.3, 14, "Columns", "The token being written: 8 tokens of step 1, 4 of step 2, 2 of step 3 and the final answer.", "Fig. 5 of the paper");
    note(el.heads[0], "Ground-truth attention", "The attention that solves the task: each column has two white cells, the two children of that token, with weight ½ each. Grey is 0.", "Fig. 5a of the paper");
    note(el.heads[1], "Sign of the policy gradient", "Computed at the initial weights W = 1. White is +1, black is −1, grey is 0 (masked positions, and the last token, which has nothing to learn).", "Fig. 5b of the paper");
    note(el.heads[2], "Sign of the SFT gradient", "The sign of the negative loss gradient at update s = 0, with the same colours. The next two grids are updates s = 1 and s = 2.", "Fig. 6 of the paper");
    note(el.tSFT, "The experiment", "Parity with d = 20 input bits and k = 16 relevant ones, so four reasoning steps. One-layer transformer as in Fig. 2, 50,000 training inputs, sign gradient updates.", "Appendix D of the paper");
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    el.heads.forEach((h, i) => set(h, {opacity: stagger(t, i, 0.4, 0.18, 0.35)}));
    // the light: on the target (step 1), on the RL grid (step 2), on the first SFT grid and then all three (step 3)
    const r = mixR(mixR(mixR(A, Bp, E(3.6, 4.6)), S0, E(7.0, 8.0)), SA, E(8.9, 9.7));
    el.spot(r, E(1.5, 2.1));
    el.rl.forEach(b => set(b, {opacity: E(4.9, 5.4)}));                       // together: that is the point
    set(el.tRL, {opacity: E(5.6, 6.0)});
    // one box, which moves from block to block and leaves a trace behind
    const g = [blocks(S[0])[0], blocks(S[1])[1], blocks(S[2])[2]], q = mixR(mixR(g[0], g[1], E(9.8, 10.6)), g[2], E(10.9, 11.7));
    set(el.box, {x: q[0], y: q[1], width: q[2], height: q[3], opacity: E(8.2, 8.6)});
    set(el.ghost[0], {opacity: E(9.9, 10.3)}); set(el.ghost[1], {opacity: E(11.0, 11.4)});
    set(el.tSFT, {opacity: E(11.8, 12.2)});
    // step 4: the smallest block, enlarged
    el.lens(E(13.0, 14.2), E(12.8, 13.1));
  }

  AF.run({id: "fig-exp", T: 16.2, starts: [0, 3.4, 6.8, 12.6], rest: 15.4, build, draw});
})();

// fig7.js
/* Fig. 6: the four results, first sorted by method, then by whether every step gets feedback that fits. */
(() => {
  const {set, mk, txt, ease, rgb, arc, caps, stagger, note} = AF, P = PAL;
  const CX = [110, 396], W = 256, H = 64, RY = [48, 130];
  const cards = [
    {hue: "AMB", name: "RL, process rewards", res: "the whole chain in one update", src: "Theorem 3.1", a: [0, 0], b: [0, 0]},
    {hue: "AMB", name: "RL, final reward only", res: "hard for parity: no usable signal", src: "Proposition 3.2", a: [1, 0], b: [1, 0]},
    {hue: "GRN", name: "SFT, no teacher forcing", res: "one step per update", src: "Theorem 3.3", a: [0, 1], b: [1, 1]},
    {hue: "GRN", name: "SFT, teacher forcing", res: "the whole chain in one update", src: "Appendix B; Kim and Suzuki [4]", a: [1, 1], b: [0, 1]}
  ];
  let el;

  function build(root) {
    el = {cards: []};
    el.rl = caps(root, "RL", 18, RY[0] + 36, rgb(P.AMB), "start");
    el.sft = caps(root, "SFT", 18, RY[1] + 36, rgb(P.GRN), "start");
    el.h1 = txt(root, "every step gets feedback that fits", {x: CX[0] + W / 2, y: 32, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: rgb(P.BLUE)});
    el.h2 = txt(root, "feedback comes late, or not at all", {x: CX[1] + W / 2, y: 32, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: P.MID});
    cards.forEach(c => {
      const g = mk(root, "g");
      mk(g, "rect", {x: 0, y: 0, width: W, height: H, rx: 7, fill: rgb(P[c.hue + "_T"])});
      const name = txt(g, c.name, {x: 14, y: 21, "font-size": 12.5, "font-weight": 700, fill: rgb(P[c.hue])});
      txt(g, c.res, {x: 14, y: 39, "font-size": 12.5, fill: P.INK});
      txt(g, c.src, {x: 14, y: 55, "font-size": 10.5, fill: P.MID});
      el.cards.push({g, name});
    });
    el.foot = mk(root, "g");
    mk(el.foot, "line", {x1: 18, y1: 214, x2: 662, y2: 214, stroke: "#e6e6e6"});
    txt(el.foot, "verified for", {x: 18, y: 240, "font-size": 12.5, fill: P.MID});
    el.fn = ["k-PARITY", "k-AND", "k-OR"].map((s, i) => {
      const g = mk(el.foot, "g");
      mk(g, "rect", {x: 104 + i * 92, y: 225, width: 82, height: 22, rx: 11, fill: rgb(P.BLUE_T)});
      txt(g, s, {x: 145 + i * 92, y: 240.4, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: rgb(P.BLUE)});
      return g;
    });
    el.scope = txt(el.foot, "one attention layer, structured masks", {x: 662, y: 240, "text-anchor": "end", "font-size": 12.5, fill: P.INK});
    el.scope2 = txt(el.foot, "sufficient conditions; deeper models and finite samples are left open", {x: 662, y: 266, "text-anchor": "end", "font-size": 10.5, fill: P.MID});
    note(el.cards[0].name, "Theorem 3.1", "If the critical gradient component separates a token’s children from all other positions, one update of sign policy gradient from W = 1, with a learning rate of order ln(d/ε), brings the attention within ε of the optimum for every step of the chain.", "Theorem 3.1 of the paper");
    note(el.cards[1].name, "Proposition 3.2", "For a class of mutually orthogonal targets, the variance of the final-reward policy gradient across targets is at most M divided by the size of the class. Sparse parities form such a class of size 2^d, so the part of the gradient that depends on the target is exponentially small.", "Proposition 3.2 of the paper, after Shalev-Shwartz et al. [2]");
    note(el.cards[2].name, "Theorem 3.3", "Under the same separation condition, evaluated on ground-truth steps, T updates of sign gradient descent on the SFT loss bring the attention within ε of the optimum. Each update learns one step.", "Theorem 3.3 of the paper");
    note(el.cards[3].name, "Teacher forcing", "With the true previous steps fed in, the separation condition holds for all steps at once, so all steps get a useful gradient in the same update. Kim and Suzuki proved one-update learning of parity in this setting.", "Appendix B (Q4) of the paper; Kim and Suzuki [4]");
    note(el.scope, "Assumptions", "A one-layer transformer with positional encoding, one attention head and a fixed activation; a mask that lets each step read only the step before it; Boolean functions that decompose into one fixed two-input function; population gradients.", "Sec. 2 and Appendix A of the paper");
  }

  function draw(t) {
    const E = (a, b) => ease((t - a) / (b - a));
    const m = E(4.2, 5.6);                                         // the regrouping
    cards.forEach((c, i) => {
      const A = [CX[c.a[0]], RY[c.a[1]]], Bq = [CX[c.b[0]], RY[c.b[1]]];
      const q = A[0] === Bq[0] ? A : arc(A, Bq, i === 3 ? 140 : 0, m);     // the two SFT cards pass each other
      set(el.cards[i].g, {transform: "translate(" + q[0].toFixed(1) + "," + q[1].toFixed(1) + ")", opacity: stagger(t, i, 0.4, 0.35, 0.4)});
    });
    set(el.rl, {opacity: E(0.3, 0.7)}); set(el.sft, {opacity: E(1.0, 1.4)});
    set(el.h1, {opacity: E(5.7, 6.1)}); set(el.h2, {opacity: E(6.0, 6.4)});
    set(el.foot, {opacity: E(7.6, 8.0)});
    el.fn.forEach((g, i) => set(g, {opacity: stagger(t, i, 8.0, 0.2, 0.35)}));
    set(el.scope, {opacity: E(8.9, 9.3)}); set(el.scope2, {opacity: E(9.5, 9.9)});
  }

  AF.run({id: "fig-map", T: 11.4, starts: [0, 3.8, 7.3], rest: 10.6, build, draw});
})();
