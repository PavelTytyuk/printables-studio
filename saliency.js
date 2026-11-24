'use strict';

/* ---------- Оценка «интересной области» фото ----------
   Без нейросетей: по уменьшенной копии (до 96 px) строим карту заметности —
   детали (перепады яркости по Собелю) + отличие цвета от среднего по кадру
   (frequency-tuned saliency, Achanta 2009) + мягкий приоритет центра.
   Ровное небо, стены и пол дают мало, предметы, люди и текстуры — много.
   Результат — прямоугольник, где сосредоточено ~80% «интересности», в долях кадра:
   { x0, y0, x1, y1 } (0…1), и его центр { cx, cy }. */
const SAL_SIZE = 96;

function analyzeSaliency(source) {
  const sw = source.width, sh = source.height, k = SAL_SIZE / Math.max(sw, sh);
  const W = Math.max(8, Math.round(sw * k)), H = Math.max(8, Math.round(sh * k));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data, N = W * H;

  // sRGB → Lab
  const L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N);
  const lin = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  for (let i = 0; i < N; i++) {
    const r = lin(px[i * 4]), g = lin(px[i * 4 + 1]), b = lin(px[i * 4 + 2]);
    const X = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
    const Y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
    const Z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
    L[i] = 116 * Y - 16; A[i] = 500 * (X - Y); B[i] = 200 * (Y - Z);
  }
  // лёгкое размытие 3×3, чтобы шум и JPEG-артефакты не считались деталями
  const blur = src => {
    const out = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += src[yy * W + xx]; n++; }
      }
      out[y * W + x] = s / n;
    }
    return out;
  };
  const Lb = blur(L), Ab = blur(A), Bb = blur(B);
  let mL = 0, mA = 0, mB = 0;
  for (let i = 0; i < N; i++) { mL += Lb[i]; mA += Ab[i]; mB += Bb[i]; }
  mL /= N; mA /= N; mB /= N;

  const color = new Float32Array(N), edge = new Float32Array(N);
  let maxC = 1e-6, maxE = 1e-6;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    color[i] = Math.hypot(Lb[i] - mL, Ab[i] - mA, Bb[i] - mB);
    if (x > 0 && y > 0 && x < W - 1 && y < H - 1) {
      const g = (dx, dy) => Lb[(y + dy) * W + x + dx];
      const gx = g(1, -1) + 2 * g(1, 0) + g(1, 1) - g(-1, -1) - 2 * g(-1, 0) - g(-1, 1);
      const gy = g(-1, 1) + 2 * g(0, 1) + g(1, 1) - g(-1, -1) - 2 * g(0, -1) - g(1, -1);
      edge[i] = Math.hypot(gx, gy);
    }
    if (color[i] > maxC) maxC = color[i];
    if (edge[i] > maxE) maxE = edge[i];
  }

  // смесь (детали важнее: большой однотонный фон тоже «отличается от среднего»),
  // приоритет центра, и оставляем только то, что заметнее среднего
  const s = new Float32Array(N);
  let mean = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, dx = (x + 0.5) / W - 0.5, dy = (y + 0.5) / H - 0.5;
    const center = 0.6 + 0.4 * Math.exp(-(dx * dx + dy * dy) / (2 * 0.3 * 0.3));
    s[i] = (0.35 * color[i] / maxC + 0.65 * edge[i] / maxE) * center;
    mean += s[i];
  }
  mean /= N;
  const colSum = new Float64Array(W), rowSum = new Float64Array(H);
  let total = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = Math.max(0, s[y * W + x] - mean);
    colSum[x] += v; rowSum[y] += v; total += v;
  }
  if (total <= 0) return { x0: 0, y0: 0, x1: 1, y1: 1, cx: 0.5, cy: 0.5 };

  // границы по накопленной массе: 10% и 90% по каждой оси
  const span = (sums, n) => {
    let acc = 0, lo = 0, hi = n - 1;
    for (let i = 0; i < n; i++) { acc += sums[i]; if (acc >= total * 0.1) { lo = i; break; } }
    acc = 0;
    for (let i = n - 1; i >= 0; i--) { acc += sums[i]; if (acc >= total * 0.1) { hi = i; break; } }
    let a = lo / n, b = (hi + 1) / n;
    // не меньше 20% кадра по каждой оси — иначе одна яркая точка станет «всем кадром»
    if (b - a < 0.2) { const c = (a + b) / 2; a = Math.max(0, Math.min(0.8, c - 0.1)); b = a + 0.2; }
    return [a, b];
  };
  const [x0, x1] = span(colSum, W), [y0, y1] = span(rowSum, H);
  const r = v => +v.toFixed(3);
  return { x0: r(x0), y0: r(y0), x1: r(x1), y1: r(y1), cx: r((x0 + x1) / 2), cy: r((y0 + y1) / 2) };
}
