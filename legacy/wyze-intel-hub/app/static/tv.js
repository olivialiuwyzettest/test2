(function () {
  function qsa(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }

  function qs(selector) {
    return document.querySelector(selector);
  }

  function isFiniteNumber(n) {
    // Avoid Number.isFinite for older embedded/TV browsers.
    return typeof n === "number" && isFinite(n);
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
    if (!isFiniteNumber(n)) return fallback;
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
    var queuedArgs = null;
    var queuedThis = null;
    return function () {
      var now = Date.now();
      var args = arguments;
      var ctx = this;
      if (now - last >= ms) {
        last = now;
        fn.apply(ctx, args);
        return;
      }
      if (queued) return;
      queued = true;
      queuedArgs = args;
      queuedThis = ctx;
      window.setTimeout(function () {
        queued = false;
        last = Date.now();
        try {
          fn.apply(queuedThis, queuedArgs || []);
        } finally {
          queuedArgs = null;
          queuedThis = null;
        }
      }, ms);
    };
  }

  function raf(fn) {
    if (window.requestAnimationFrame) return window.requestAnimationFrame(fn);
    return window.setTimeout(fn, 16);
  }

  var body = document.body;
  if (!body || !body.classList.contains("mode-tv")) return;

  // Fit-to-screen scaling. Designed on a 1920x1080 baseline.
  var BASE_W = 1920;
  var BASE_H = 1080;
  // Leave a small safety margin so we never clip due to rounding/font metrics.
  var FIT_MARGIN_PX = 6; // per-edge
  var FIT_MAX_ITERS = 3;

  var fitEl = qs(".tv-fit");
  var rootEl = qs(".tv-root");

  function fitViewportBox() {
    if (!fitEl || !fitEl.getBoundingClientRect) return null;
    var rect = fitEl.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;

    try {
      if (window.getComputedStyle) {
        var st = window.getComputedStyle(fitEl);
        var pl = parseFloat(st.paddingLeft || "0") || 0;
        var pr = parseFloat(st.paddingRight || "0") || 0;
        var pt = parseFloat(st.paddingTop || "0") || 0;
        var pb = parseFloat(st.paddingBottom || "0") || 0;
        return { w: rect.width - pl - pr, h: rect.height - pt - pb };
      }
    } catch (e) {}

    return { w: rect.width, h: rect.height };
  }

  function updateScale() {
    if (!fitEl || !rootEl) return;
    fitRunId += 1;
    var runId = fitRunId;

    var override = Number(getQueryParam("scale") || "");
    var box = fitViewportBox();
    var vv = window.visualViewport;
    var w =
      (box && box.w) ||
      (vv && vv.width) ||
      document.documentElement.clientWidth ||
      window.innerWidth ||
      BASE_W;
    var h =
      (box && box.h) ||
      (vv && vv.height) ||
      document.documentElement.clientHeight ||
      window.innerHeight ||
      BASE_H;

    var availW = Math.max(1, w - FIT_MARGIN_PX * 2);
    var availH = Math.max(1, h - FIT_MARGIN_PX * 2);
    var scale = Math.min(availW / BASE_W, availH / BASE_H);

    if (isFiniteNumber(override) && override > 0.3 && override < 3) {
      scale = override;
    }
    if (!isFiniteNumber(scale) || scale <= 0) {
      scale = 1;
    }
    scale = Math.max(0.25, Math.min(scale, 3));

    // Apply + verify fit after paint. Some browsers may shift metrics after fonts load.
    function step(nextScale, iter) {
      if (runId !== fitRunId) return;
      if (!isFiniteNumber(nextScale) || nextScale <= 0) nextScale = 1;
      nextScale = Math.max(0.25, Math.min(nextScale, 3));

      rootEl.classList.add("is-fitting");
      document.documentElement.style.setProperty(
        "--tv-scale",
        Number(nextScale).toFixed(4)
      );

      raf(function () {
        if (runId !== fitRunId) return;

        var fitRect = fitEl.getBoundingClientRect();
        var rootRect = rootEl.getBoundingClientRect();
        if (!fitRect || !rootRect || !fitRect.width || !fitRect.height) {
          rootEl.classList.remove("is-fitting");
          return;
        }

        // Keep within fit rect with a small margin.
        var leftOk = rootRect.left >= fitRect.left + FIT_MARGIN_PX - 0.5;
        var topOk = rootRect.top >= fitRect.top + FIT_MARGIN_PX - 0.5;
        var rightOk = rootRect.right <= fitRect.right - FIT_MARGIN_PX + 0.5;
        var bottomOk = rootRect.bottom <= fitRect.bottom - FIT_MARGIN_PX + 0.5;

        if ((leftOk && topOk && rightOk && bottomOk) || iter >= FIT_MAX_ITERS) {
          rootEl.classList.remove("is-fitting");
          return;
        }

        var fitW = Math.max(1, fitRect.width - FIT_MARGIN_PX * 2);
        var fitH = Math.max(1, fitRect.height - FIT_MARGIN_PX * 2);
        var scaleByW = fitW / Math.max(1, rootRect.width);
        var scaleByH = fitH / Math.max(1, rootRect.height);
        var scaleBy = Math.min(scaleByW, scaleByH, 0.998);

        if (!isFiniteNumber(scaleBy) || scaleBy >= 1) {
          rootEl.classList.remove("is-fitting");
          return;
        }

        step(nextScale * scaleBy, iter + 1);
      });
    }

    step(scale, 0);
  }

  var fitRunId = 0;
  updateScale();
  var onResize = throttle(updateScale, 200);
  window.addEventListener("resize", onResize);
  if (window.visualViewport && window.visualViewport.addEventListener) {
    window.visualViewport.addEventListener("resize", onResize);
    window.visualViewport.addEventListener("scroll", onResize);
  }
  window.addEventListener("load", function () {
    window.setTimeout(updateScale, 50);
  });
  try {
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () {
        window.setTimeout(updateScale, 50);
      });
    }
  } catch (e) {}

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
  var pauseEnabled = true;

  // Allow disabling the pause-on-interaction behavior for kiosks/TV browsers that
  // emit frequent synthetic pointer events.
  var pauseParam = String(getQueryParam("pause") || "").trim().toLowerCase();
  if (pauseParam === "0" || pauseParam === "off" || pauseParam === "false" || pauseParam === "no") {
    pauseEnabled = false;
  }

  function isPaused() {
    if (!pauseEnabled) return false;
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
      if (isFiniteNumber(asNum)) {
        return clampInt(asNum, 1, pages.length, 1) - 1;
      }
      for (var i = 0; i < pages.length; i += 1) {
        var key = String(pages[i].dataset.pageKey || "").trim().toLowerCase();
        if (key && key === qp) return i;
      }
    }

    try {
      var stored = Number(window.localStorage.getItem("wyzeIntelTvPageIndex") || "");
      if (isFiniteNumber(stored)) return clampInt(stored, 0, pages.length - 1, 0);
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

  if (pauseEnabled) {
    var lastMoveX = null;
    var lastMoveY = null;
    function onMouseMove(e) {
      // Ignore tiny jitter so rotation doesn't get stuck on some devices.
      var x = e && typeof e.clientX === "number" ? e.clientX : null;
      var y = e && typeof e.clientY === "number" ? e.clientY : null;
      if (x !== null && y !== null && lastMoveX !== null && lastMoveY !== null) {
        var dist = Math.abs(x - lastMoveX) + Math.abs(y - lastMoveY);
        if (dist < 8) return;
      }
      lastMoveX = x;
      lastMoveY = y;
      onInteract();
    }

    var onMove = throttle(onMouseMove, 250);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("keydown", onInteract);
    window.addEventListener("touchstart", onInteract);
    window.addEventListener("pointerdown", onInteract);
  }

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
    window.addEventListener("resize", throttle(drawAllSparks, 250));
  }

  // Burn-in prevention: subtle layout shift every few minutes.
  function applyBurnInShift() {
    var mag = 2 + Math.floor(Math.random() * 3); // 2-4px
    var magY = 2 + Math.floor(Math.random() * 3);
    var dx = (Math.random() < 0.5 ? -1 : 1) * mag;
    var dy = (Math.random() < 0.5 ? -1 : 1) * magY;
    // Cycle the background subtly instead of shifting layout, to avoid any edge clipping.
    document.documentElement.style.setProperty("--burnin-bg-x", dx + "px");
    document.documentElement.style.setProperty("--burnin-bg-y", dy + "px");
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
