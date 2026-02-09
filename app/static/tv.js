(function () {
  function qsa(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }

  function qs(selector) {
    return document.querySelector(selector);
  }

  function cssVar(name, fallback) {
    try {
      var value = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue(name);
      value = (value || "").trim();
      return value || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function clampInt(value, min, max, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    n = Math.floor(n);
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function getQueryParam(name) {
    try {
      var url = new URL(window.location.href);
      return url.searchParams.get(name);
    } catch (e) {
      return null;
    }
  }

  function throttle(fn, ms) {
    var last = 0;
    var queued = false;
    return function () {
      var now = Date.now();
      if (now - last >= ms) {
        last = now;
        fn();
        return;
      }
      if (queued) return;
      queued = true;
      window.setTimeout(function () {
        queued = false;
        last = Date.now();
        fn();
      }, ms);
    };
  }

  var body = document.body;
  if (!body || !body.classList.contains("mode-tv")) return;

  // Fit-to-screen scaling. Designed on a 1920x1080 baseline.
  var BASE_W = 1920;
  var BASE_H = 1080;
  var SCALE_PAD = 0.99;

  function updateScale() {
    var override = Number(getQueryParam("scale") || "");
    var w = window.innerWidth || BASE_W;
    var h = window.innerHeight || BASE_H;
    var scale = Math.min(w / BASE_W, h / BASE_H) * SCALE_PAD;

    if (Number.isFinite(override) && override > 0.3 && override < 3) {
      scale = override;
    }
    if (!Number.isFinite(scale) || scale <= 0) {
      scale = 1;
    }
    scale = Math.max(0.5, Math.min(scale, 3));
    document.documentElement.style.setProperty("--tv-scale", scale.toFixed(4));
  }

  updateScale();
  window.addEventListener("resize", throttle(updateScale, 200), { passive: true });

  // Kiosk-safe: never navigate away in the same tab.
  document.addEventListener(
    "click",
    function (e) {
      var target = e.target;
      if (!target || !target.closest) return;
      var a = target.closest("a");
      if (!a || !a.href) return;
      e.preventDefault();
      window.open(a.href, "_blank", "noopener,noreferrer");
    },
    true
  );

  var pages = qsa(".tv-page");
  if (pages.length === 0) return;

  var rotationSeconds = clampInt(
    getQueryParam("rotate") || body.dataset.tvRotationSeconds,
    0,
    120,
    20
  );
  var burninShiftSeconds = clampInt(
    body.dataset.tvBurninShiftSeconds,
    30,
    900,
    240
  );

  var indicatorEl = qs("[data-tv-indicator]");
  var pageNameEl = qs("[data-tv-page-name]");
  var feedIndicatorEl = qs("[data-tv-feed-indicator]");
  var pausedUntil = 0;
  var pauseMs = 60 * 1000;

  function isPaused() {
    return Date.now() < pausedUntil;
  }

  function pageTitle(pageEl) {
    return (pageEl && pageEl.dataset && pageEl.dataset.pageTitle) || "Page";
  }

  function showPage(nextIndex) {
    var idx = ((nextIndex % pages.length) + pages.length) % pages.length;
    pages.forEach(function (p, i) {
      p.classList.toggle("is-active", i === idx);
    });
    try {
      window.localStorage.setItem("wyzeIntelTvPageIndex", String(idx));
    } catch (e) {}

    if (indicatorEl) {
      indicatorEl.textContent = "Page " + (idx + 1) + "/" + pages.length;
    }
    if (pageNameEl) {
      pageNameEl.textContent = pageTitle(pages[idx]);
    }
    body.dataset.tvPageIndex = String(idx);
  }

  function findStartIndex() {
    var qp = (getQueryParam("page") || "").trim().toLowerCase();
    if (qp) {
      var asNum = Number(qp);
      if (Number.isFinite(asNum)) {
        return clampInt(asNum, 1, pages.length, 1) - 1;
      }
      for (var i = 0; i < pages.length; i += 1) {
        var key = String(pages[i].dataset.pageKey || "").trim().toLowerCase();
        if (key && key === qp) return i;
      }
    }

    try {
      var stored = Number(window.localStorage.getItem("wyzeIntelTvPageIndex") || "");
      if (Number.isFinite(stored)) return clampInt(stored, 0, pages.length - 1, 0);
    } catch (e) {}
    return 0;
  }

  var index = findStartIndex();
  showPage(index);

  function tick() {
    if (isPaused()) return;
    index = (index + 1) % pages.length;
    showPage(index);
  }

  var rotationTimer = null;
  if (rotationSeconds > 0) {
    rotationTimer = window.setInterval(tick, rotationSeconds * 1000);
  }

  function onInteract() {
    pausedUntil = Date.now() + pauseMs;
  }

  var onMove = throttle(onInteract, 250);
  window.addEventListener("mousemove", onMove, { passive: true });
  window.addEventListener("keydown", onInteract);
  window.addEventListener("touchstart", onInteract, { passive: true });
  window.addEventListener("pointerdown", onInteract, { passive: true });

  // Rolling feed ticker (latest news + discussions).
  var feedItems = qsa("[data-tv-feed-item]");
  var tickerSeconds = clampInt(
    getQueryParam("ticker") || body.dataset.tvTickerSeconds,
    0,
    60,
    7
  );
  var feedIndex = 0;

  function showFeed(nextIndex) {
    if (!feedItems || feedItems.length === 0) return;
    var idx = ((nextIndex % feedItems.length) + feedItems.length) % feedItems.length;
    feedItems.forEach(function (el, i) {
      el.classList.toggle("is-active", i === idx);
    });
    feedIndex = idx;
    if (feedIndicatorEl) {
      feedIndicatorEl.textContent = String(idx + 1) + "/" + String(feedItems.length);
    }
  }

  if (feedItems.length > 0) {
    // Sync to whichever element is currently active in the DOM.
    for (var i = 0; i < feedItems.length; i += 1) {
      if (feedItems[i].classList.contains("is-active")) {
        feedIndex = i;
        break;
      }
    }
    showFeed(feedIndex);
    if (tickerSeconds > 0 && feedItems.length > 1) {
      window.setInterval(function () {
        if (isPaused()) return;
        showFeed(feedIndex + 1);
      }, tickerSeconds * 1000);
    }
  }

  // 30-day sparklines for each KPI tile.
  var sparkData = (window.wyzeIntelTv && window.wyzeIntelTv.sparks) || {};
  var sparkCanvases = qsa("canvas[data-tv-spark]");

  function drawSparkline(canvas, values) {
    if (!canvas || !Array.isArray(values) || values.length === 0) return;

    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.floor(rect.width));
    var h = Math.max(1, Math.floor(rect.height));
    var dpr = window.devicePixelRatio || 1;

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var pad = 8;
    var minV = 0;
    var maxV = 0;
    values.forEach(function (v) {
      maxV = Math.max(maxV, Number(v) || 0);
    });
    if (maxV <= 0) maxV = 1;

    var stepX = (w - pad * 2) / Math.max(values.length - 1, 1);
    function yFor(v) {
      var n = Number(v) || 0;
      var t = (n - minV) / (maxV - minV);
      return pad + (1 - t) * (h - pad * 2);
    }

    var accent = cssVar("--accent", "#7951D6");
    var border = cssVar("--border", "rgba(201, 195, 230, 0.22)");

    // Baseline.
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.moveTo(pad, h - pad);
    ctx.lineTo(w - pad, h - pad);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Line path (for fill).
    ctx.beginPath();
    values.forEach(function (v, idx) {
      var x = pad + idx * stepX;
      var y = yFor(v);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    // Area fill.
    var grad = ctx.createLinearGradient(0, pad, 0, h - pad);
    grad.addColorStop(0, "rgba(121, 81, 214, 0.22)");
    grad.addColorStop(1, "rgba(121, 81, 214, 0.00)");
    ctx.lineTo(w - pad, h - pad);
    ctx.lineTo(pad, h - pad);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Stroke line.
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    values.forEach(function (v, idx) {
      var x = pad + idx * stepX;
      var y = yFor(v);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Last dot.
    var last = values[values.length - 1];
    var lastX = pad + (values.length - 1) * stepX;
    var lastY = yFor(last);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawAllSparks() {
    sparkCanvases.forEach(function (c) {
      var key = String(c.dataset.tvSpark || "").trim();
      var series = sparkData[key];
      if (Array.isArray(series)) {
        drawSparkline(c, series);
      }
    });
  }

  if (sparkCanvases.length > 0) {
    drawAllSparks();
    window.addEventListener("resize", throttle(drawAllSparks, 250), {
      passive: true
    });
  }

  // Burn-in prevention: subtle layout shift every few minutes.
  function applyBurnInShift() {
    var mag = 2 + Math.floor(Math.random() * 3); // 2-4px
    var magY = 2 + Math.floor(Math.random() * 3);
    var dx = (Math.random() < 0.5 ? -1 : 1) * mag;
    var dy = (Math.random() < 0.5 ? -1 : 1) * magY;
    document.documentElement.style.setProperty("--burnin-x", dx + "px");
    document.documentElement.style.setProperty("--burnin-y", dy + "px");
  }
  applyBurnInShift();
  window.setInterval(applyBurnInShift, burninShiftSeconds * 1000);

  // Current time (PT) in header.
  var clockEl = qs("[data-tv-clock]");
  if (clockEl && window.Intl && Intl.DateTimeFormat) {
    var formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/Los_Angeles"
    });

    function updateClock() {
      clockEl.textContent = formatter.format(new Date()) + " PT";
    }

    updateClock();
    window.setInterval(updateClock, 10 * 1000);
  }
})();
