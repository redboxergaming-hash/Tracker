function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function seriesBounds(points, key) {
  const values = points.map((p) => safeNumber(p[key])).filter((v) => v !== null);
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max: max === min ? min + 1 : max };
}

function yForValue(value, bounds, chartTop, chartHeight) {
  if (value === null || !bounds) return null;
  const ratio = (value - bounds.min) / (bounds.max - bounds.min);
  return chartTop + chartHeight - ratio * chartHeight;
}

function drawSeries(ctx, points, key, color, bounds, chartLeft, chartTop, chartWidth, chartHeight) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();

  let started = false;
  const step = points.length > 1 ? chartWidth / (points.length - 1) : 0;

  points.forEach((point, i) => {
    const value = safeNumber(point[key]);
    const y = yForValue(value, bounds, chartTop, chartHeight);
    if (y === null) {
      started = false;
      return;
    }
    const x = chartLeft + i * step;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();
}

export function drawWeeklyAnalyticsChart(canvas, points) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.floor(rect.width || 320));
  const height = 220;
  canvas.width = width;
  canvas.height = height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const chartLeft = 36;
  const chartRight = width - 12;
  const chartTop = 12;
  const chartBottom = height - 30;
  const chartWidth = chartRight - chartLeft;
  const chartHeight = chartBottom - chartTop;

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(chartLeft, chartBottom);
  ctx.lineTo(chartRight, chartBottom);
  ctx.stroke();

  const calorieBounds = seriesBounds(points, 'calories');
  const scaleBounds = seriesBounds(points, 'scaleWeight');
  const trendBounds = seriesBounds(points, 'trendWeight');

  drawSeries(ctx, points, 'calories', '#0ea5e9', calorieBounds, chartLeft, chartTop, chartWidth, chartHeight);
  drawSeries(ctx, points, 'scaleWeight', '#16a34a', scaleBounds, chartLeft, chartTop, chartWidth, chartHeight);
  drawSeries(ctx, points, 'trendWeight', '#f59e0b', trendBounds, chartLeft, chartTop, chartWidth, chartHeight);

  ctx.fillStyle = '#334155';
  ctx.font = '11px sans-serif';
  points.forEach((point, i) => {
    if (i % 2 !== 0) return;
    const step = points.length > 1 ? chartWidth / (points.length - 1) : 0;
    const x = chartLeft + i * step;
    ctx.fillText(point.date.slice(5), x - 16, height - 10);
  });

  ctx.fillStyle = '#0f172a';
  ctx.font = '12px sans-serif';
  ctx.fillText('Calories', 12, 14);
  ctx.fillStyle = '#16a34a';
  ctx.fillText('Scale', 74, 14);
  ctx.fillStyle = '#f59e0b';
  ctx.fillText('Trend', 118, 14);
}
