(function () {
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

  function initAutoRefresh() {
    var refreshSeconds = Number(document.body.dataset.refreshSeconds || 300);
    if (!refreshSeconds || refreshSeconds < 60) {
      return;
    }
    window.setInterval(function () {
      window.location.reload();
    }, refreshSeconds * 1000);
  }

  function drawSentimentChart(canvasId, series) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || !Array.isArray(series) || series.length === 0) {
      return;
    }

    var ctx = canvas.getContext("2d");
    var width = canvas.width;
    var height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    var pad = 30;
    var minY = -1;
    var maxY = 1;

    var grid = cssVar("--border", "rgba(15, 23, 42, 0.12)");
    var muted = cssVar("--muted", "#475569");
    var accent = cssVar("--accent", "#7951D6");

    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;

    for (var i = 0; i <= 4; i += 1) {
      var y = pad + ((height - pad * 2) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(width - pad, y);
      ctx.stroke();

      var label = (maxY - ((maxY - minY) * i) / 4).toFixed(1);
      ctx.fillStyle = muted;
      ctx.font = "12px sans-serif";
      ctx.fillText(label, 4, y + 4);
    }

    var stepX = (width - pad * 2) / Math.max(series.length - 1, 1);

    function yFor(v) {
      return pad + ((maxY - v) / (maxY - minY)) * (height - pad * 2);
    }

    // Emphasize the neutral baseline (0.0)
    ctx.strokeStyle = cssVar("--border-strong", "rgba(15, 23, 42, 0.24)");
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pad, yFor(0));
    ctx.lineTo(width - pad, yFor(0));
    ctx.stroke();

    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.beginPath();

    series.forEach(function (point, idx) {
      var x = pad + idx * stepX;
      var y = yFor(Number(point.avg_sentiment || 0));
      if (idx === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    var labelEvery = Math.max(1, Math.ceil(series.length / 10));
    ctx.fillStyle = accent;
    series.forEach(function (point, idx) {
      var x = pad + idx * stepX;
      var y = yFor(Number(point.avg_sentiment || 0));
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();

      if (idx % labelEvery === 0 || idx === series.length - 1) {
        ctx.fillStyle = muted;
        ctx.font = "11px sans-serif";
        ctx.fillText(String(point.day || ""), x - 16, height - 8);
        ctx.fillStyle = accent;
      }
    });
  }

  window.wyzeIntel = {
    drawSentimentChart: drawSentimentChart,
  };

  initAutoRefresh();
})();
