/* taichi-live.js - the rooting lab for learn-taichi-with-phoebe
   A real balance model, viewed from above. Nothing here is scripted: the base
   of support is a convex hull computed from the actual foot polygons, the
   centre of mass is tested against that hull with real geometry, and the
   tipping angle is atan(margin / com_height) - ordinary physics.

   What it teaches: rooting is not mystical. It is keeping your centre of mass
   over your base of support, keeping that centre low, and knowing which foot
   is empty so you can move it. The classical error 双重 (double-weighting)
   shows up here as a measurable trade-off, not a scolding.

   Drop <div class="tcbox"></div> on a page and this builds the whole tool. */

(function () {
  "use strict";

  /* All model units are centimetres, viewed from above.
     x = left(-) / right(+), y = forward(-) / back(+). */
  var FOOT_W = 9, FOOT_L = 25;

  var STANCES = {
    wuji: {
      label: "无极 wújí · parallel",
      note: "Feet shoulder-width, weight even. The starting posture - and the clearest way to feel what double-weighting costs you.",
      feet: [
        { key: "L", name: "left",  x: -14, y: 0, rot: 0,  full: true },
        { key: "R", name: "right", x:  14, y: 0, rot: 0,  full: true }
      ]
    },
    bow: {
      label: "弓步 gōngbù · bow stance",
      note: "Front foot forward and flat, back foot angled out. The workhorse stance of the form, and the most stable one front-to-back.",
      feet: [
        { key: "L", name: "front", x: -11, y: -30, rot: 0,  full: true },
        { key: "R", name: "back",  x:  15, y:  24, rot: 45, full: true }
      ]
    },
    empty: {
      label: "虚步 xūbù · empty stance",
      note: "The back foot carries you; the front foot only touches. Small base, but the front foot is completely free to move.",
      feet: [
        { key: "R", name: "back",  x:  11, y: 12, rot: 30, full: true },
        { key: "L", name: "front", x: -10, y: -26, rot: 0, full: false }
      ]
    },
    single: {
      label: "独立 dúlì · single leg",
      note: "One foot down, as in the golden-rooster postures. The smallest possible base - which is exactly why it is trained.",
      feet: [
        { key: "R", name: "standing", x: 0, y: 0, rot: 0, full: true }
      ]
    }
  };

  var COM_H_NORMAL = 100;  /* cm above the floor, roughly, standing tall */
  var COM_H_SUNK   = 88;   /* 沉 sinking: knees soften, hips drop */

  /* ---------- geometry helpers ---------- */

  function footCorners(f) {
    var r = f.rot * Math.PI / 180;
    var hw = FOOT_W / 2, hl = FOOT_L / 2;
    /* an "empty" foot contributes only a small toe patch to the base */
    if (!f.full) { hw = 3.5; hl = 3.5; }
    var pts = [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]];
    if (!f.full) { pts = pts.map(function (p) { return [p[0], p[1] - (FOOT_L / 2 - 3.5)]; }); }
    return pts.map(function (p) {
      return {
        x: f.x + p[0] * Math.cos(r) - p[1] * Math.sin(r),
        y: f.y + p[0] * Math.sin(r) + p[1] * Math.cos(r)
      };
    });
  }

  function convexHull(pts) {
    if (pts.length < 3) return pts.slice();
    var p = pts.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    var cross = function (o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); };
    var lower = [];
    p.forEach(function (pt) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
      lower.push(pt);
    });
    var upper = [];
    for (var i = p.length - 1; i >= 0; i--) {
      var pt = p[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
      upper.push(pt);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  function pointInPoly(pt, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      var hit = ((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  }

  function distToPoly(pt, poly) {
    var min = Infinity;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[j], b = poly[i];
      var dx = b.x - a.x, dy = b.y - a.y;
      var len2 = dx * dx + dy * dy;
      var t = len2 ? Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2)) : 0;
      var px = a.x + t * dx, py = a.y + t * dy;
      var d = Math.hypot(pt.x - px, pt.y - py);
      if (d < min) min = d;
    }
    return min;
  }

  document.querySelectorAll(".tcbox").forEach(function (box) {
    var stanceKey = "bow";
    var shift = 50;   /* 0 = fully onto foot A, 100 = fully onto foot B */
    var sunk = false;

    box.innerHTML =
      '<div class="tc-head">' +
        '<span class="tc-title">The rooting lab</span>' +
        '<span class="tc-honest">real geometry - the numbers are computed, not scripted</span>' +
      '</div>' +
      '<div class="tc-controls"><div class="tc-group tc-stances" role="group" aria-label="Stance"></div>' +
        '<button type="button" class="tc-pill tc-sink">沉 sink</button></div>' +
      '<p class="tc-note"></p>' +
      '<div class="tc-body">' +
        '<div class="tc-stage"></div>' +
        '<div class="tc-panel">' +
          '<label class="tc-slider-label">Weight shift' +
            '<input type="range" class="tc-slider" min="0" max="100" value="50" aria-label="Shift weight between feet">' +
          '</label>' +
          '<div class="tc-weights"></div>' +
          '<div class="tc-meters"></div>' +
          '<p class="tc-verdict"></p>' +
        '</div>' +
      '</div>';

    var stanceWrap = box.querySelector(".tc-stances");
    var sinkBtn = box.querySelector(".tc-sink");
    var noteEl = box.querySelector(".tc-note");
    var stage = box.querySelector(".tc-stage");
    var slider = box.querySelector(".tc-slider");
    var weightsEl = box.querySelector(".tc-weights");
    var metersEl = box.querySelector(".tc-meters");
    var verdictEl = box.querySelector(".tc-verdict");

    Object.keys(STANCES).forEach(function (k) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tc-pill" + (k === stanceKey ? " on" : "");
      b.textContent = STANCES[k].label;
      b.addEventListener("click", function () {
        stanceKey = k;
        stanceWrap.querySelectorAll(".tc-pill").forEach(function (p) { p.classList.remove("on"); });
        b.classList.add("on");
        if (k === "single") { shift = 0; slider.value = 0; slider.disabled = true; }
        else { slider.disabled = false; }
        render();
      });
      stanceWrap.appendChild(b);
    });

    slider.addEventListener("input", function () { shift = +slider.value; render(); });
    sinkBtn.addEventListener("click", function () { sunk = !sunk; sinkBtn.classList.toggle("on", sunk); render(); });

    /* ---------- SVG scaffold ---------- */
    var svgNS = "http://www.w3.org/2000/svg";
    var VW = 400, VH = 320, SCALE = 3.1, CX = VW / 2, CY = VH / 2 + 6;
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + VW + " " + VH);
    svg.setAttribute("class", "tc-svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Top-down view of stance, base of support, and centre of mass");
    stage.appendChild(svg);

    function sx(mx) { return CX + mx * SCALE; }
    function sy(my) { return CY + my * SCALE; }

    function render() {
      var st = STANCES[stanceKey];
      noteEl.textContent = st.note;

      /* Centre of mass rides the line between the two foot centres - and is
         allowed to OVERSHOOT past either foot, because losing your root is the
         thing the lab most needs to be able to show. */
      var a = st.feet[0], b = st.feet[1];
      var t = -0.35 + (shift / 100) * 1.7;
      var com = b ? { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } : { x: a.x, y: a.y };

      /* Weight split: past a foot, that foot simply carries everything the
         body still has on the floor - so clamp for the readout. */
      var tc = Math.max(0, Math.min(1, t));
      var wA = b ? Math.round((1 - tc) * 100) : 100;
      var wB = b ? 100 - wA : 0;

      /* base of support = convex hull of all contact polygons */
      var pts = [];
      st.feet.forEach(function (f) { pts = pts.concat(footCorners(f)); });
      var hull = convexHull(pts);

      var inside = pointInPoly(com, hull);
      var margin = distToPoly(com, hull);        /* cm to the nearest edge */
      var comH = sunk ? COM_H_SUNK : COM_H_NORMAL;
      var tipAngle = Math.atan((inside ? margin : 0) / comH) * 180 / Math.PI;

      /* ---- draw ---- */
      svg.innerHTML = "";

      var poly = document.createElementNS(svgNS, "polygon");
      poly.setAttribute("points", hull.map(function (p) { return sx(p.x) + "," + sy(p.y); }).join(" "));
      poly.setAttribute("class", "tc-base" + (inside ? "" : " out"));
      svg.appendChild(poly);

      st.feet.forEach(function (f) {
        var g = document.createElementNS(svgNS, "g");
        var r = document.createElementNS(svgNS, "rect");
        r.setAttribute("x", sx(f.x) - (FOOT_W / 2) * SCALE);
        r.setAttribute("y", sy(f.y) - (FOOT_L / 2) * SCALE);
        r.setAttribute("width", FOOT_W * SCALE);
        r.setAttribute("height", FOOT_L * SCALE);
        r.setAttribute("rx", 7);
        r.setAttribute("transform", "rotate(" + f.rot + " " + sx(f.x) + " " + sy(f.y) + ")");
        var share = (f === a) ? wA : (b ? wB : 0);
        r.setAttribute("class", "tc-foot" + (f.full ? "" : " ghost") + (share >= 60 ? " loaded" : share <= 10 ? " free" : ""));
        g.appendChild(r);
        var lab = document.createElementNS(svgNS, "text");
        lab.setAttribute("x", sx(f.x));
        lab.setAttribute("y", sy(f.y) + 5);
        lab.setAttribute("text-anchor", "middle");
        lab.setAttribute("class", "tc-footlab");
        lab.textContent = share + "%";
        g.appendChild(lab);
        svg.appendChild(g);
      });

      var dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("cx", sx(com.x));
      dot.setAttribute("cy", sy(com.y));
      dot.setAttribute("r", 9);
      dot.setAttribute("class", "tc-com" + (inside ? "" : " out"));
      svg.appendChild(dot);

      /* The legend carries the labelling, so nothing floats over the feet. */
      var legendDot = document.createElementNS(svgNS, "circle");
      legendDot.setAttribute("cx", 17);
      legendDot.setAttribute("cy", VH - 14);
      legendDot.setAttribute("r", 5);
      legendDot.setAttribute("class", "tc-com" + (inside ? "" : " out"));
      svg.appendChild(legendDot);

      var legend = document.createElementNS(svgNS, "text");
      legend.setAttribute("x", 29);
      legend.setAttribute("y", VH - 10);
      legend.setAttribute("class", "tc-legend");
      legend.textContent = "centre of mass · dashed outline = base of support · seen from above";
      svg.appendChild(legend);

      /* ---- readouts ---- */
      weightsEl.innerHTML = st.feet.map(function (f) {
        var share = (f === a) ? wA : (b ? wB : 0);
        return '<div class="tc-w"><span class="tc-wname">' + f.name + '</span>' +
               '<span class="tc-wbar"><i style="width:' + share + '%"></i></span>' +
               '<span class="tc-wval">' + share + '%</span></div>';
      }).join("");

      var marginPct = Math.max(0, Math.min(100, (margin / 20) * 100));
      var anglePct = Math.max(0, Math.min(100, (tipAngle / 20) * 100));
      metersEl.innerHTML =
        '<div class="tc-m"><span class="tc-mk">Margin to the edge</span>' +
          '<span class="tc-mbar' + (inside ? "" : " bad") + '"><i style="width:' + (inside ? marginPct : 100) + '%"></i></span>' +
          '<span class="tc-mv">' + (inside ? margin.toFixed(1) + " cm" : "outside") + '</span></div>' +
        '<div class="tc-m"><span class="tc-mk">Lean you can recover</span>' +
          '<span class="tc-mbar' + (inside ? "" : " bad") + '"><i style="width:' + anglePct + '%"></i></span>' +
          '<span class="tc-mv">' + tipAngle.toFixed(1) + "°" + '</span></div>';

      /* verdict: the honest trade-off, including 双重 */
      var freeFoot = null;
      if (b) { if (wA <= 10) freeFoot = a.name; else if (wB <= 10) freeFoot = b.name; }
      var v;
      var overloadedGhost = b && st.feet.some(function (f) {
        return !f.full && ((f === a ? wA : wB) >= 35);
      });
      if (!inside) {
        v = '<b class="bad">Off your root.</b> The centre of mass has left the base of support - at this point you are falling, or taking a step you did not choose. Notice it took surprisingly little travel to get here.';
      } else if (!b) {
        v = '<b class="good">One foot, whole weight.</b> The base is a single footprint, so the margin is small and every correction has to come from the standing leg. This is the stance the golden-rooster postures train, and it is trained precisely because it is hard.';
      } else if (overloadedGhost) {
        v = '<b class="warn">You are loading the empty foot.</b> In 虚步 that front foot is meant to touch, not carry - it is a feeler, not a pillar. Watch the margin collapse as weight arrives on a contact patch the size of a toe.';
      } else if (wA >= 40 && wA <= 60) {
        v = '<b class="warn">双重 shuāngzhòng · double-weighted.</b> Stable, but stuck: both feet are loaded, so neither is free to move. The classics treat this as the fault to train out, and here you can see why - the margin is fine, the mobility is gone.';
      } else if (freeFoot) {
        v = '<b class="good">Rooted, and the ' + freeFoot + ' foot is free.</b> One foot full, one empty - 分虚实 fēn xūshí, distinguishing empty and full. You can step without first shifting.';
      } else {
        v = '<b class="good">Rooted.</b> Weight is clearly divided and the centre of mass sits inside the base. Keep shifting to see how far you can go before the lighter foot frees up.';
      }
      if (sunk) v += ' <span class="tc-sunknote">沉 sinking is on: a lower centre of mass buys you more recoverable lean from the same footprint.</span>';
      verdictEl.innerHTML = v;
    }

    render();
  });
})();
