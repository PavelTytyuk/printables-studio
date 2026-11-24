'use strict';

/* ---------- Habit Tracker Studio: сетка-трекер привычек для бумаги или наклейки в журнал ----------
   Все размеры в мм. Сверху всегда 2 см под названия привычек (их можно вписать от руки),
   слева — подписи строк (дни, дни недели, недели или месяцы), дальше — сетка: колонка на привычку. */
const DPI = 300;
const HEADER = 20;
const LIMITS = { w: [30, 290], h: [40, 290], count: [1, 31] };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// строки трекера: { text, bold } — выходные (суббота, воскресенье) жирные
const plain = list => list.map(text => ({ text, bold: false }));
const range = n => Array.from({ length: n }, (_, i) => String(i + 1));
const daysIn = (year, month) => new Date(year, month, 0).getDate(); // month — 1…12
const isWeekend = (year, month, day) => [0, 6].includes(new Date(year, month - 1, day).getDay());
const TYPES = {
  week: { name: 'Week', rows: t => (t.weekStart === 'sun' ? ['Sun', ...DAYS.slice(0, 6)] : DAYS).map(text => ({ text, bold: text === 'Sat' || text === 'Sun' })) },
  // wd — день недели перед числом («Mo 2»), если включено
  month: { name: 'Month', rows: t => range(daysIn(t.year, t.month)).map((text, i) => ({
    text, bold: isWeekend(t.year, t.month, i + 1), wd: t.weekdays ? WD[new Date(t.year, t.month - 1, i + 1).getDay()] : '' })) },
  yearWeeks: { name: 'Year · by weeks', rows: () => plain(range(52)) },
  yearMonths: { name: 'Year · by months', rows: () => plain(MONTHS) },
};
const typeTitle = t => t.type === 'month' ? `${MONTH_NAMES[t.month - 1]} ${t.year}` : TYPES[t.type].name;
// оттенки бумаги от белого к жёлтому — подогнать под тон страниц журнала
const PAPER_TONES = ['#ffffff', '#fffdf8', '#fefbf1', '#fdf8e8', '#fcf5de', '#fbf1d3', '#f9edc7', '#f7e8ba', '#f4e2ab', '#f1db9b'];
// толщина линий, мм: внутренние и внешняя рамка
const LINE_WEIGHTS = { thin: { name: 'Thin', inner: 0.12, outer: 0.22 }, medium: { name: 'Medium', inner: 0.2, outer: 0.35 }, thick: { name: 'Thick', inner: 0.3, outer: 0.5 } };
const strokeW = (t, outer) => (LINE_WEIGHTS[t.weight] || LINE_WEIGHTS.medium)[outer ? 'outer' : 'inner'];
const LINE_COLORS = [['#bdb7ae', 'Light grey'], ['#8d877e', 'Grey'], ['#56514b', 'Dark grey'], ['#1f1d1a', 'Black'], ['#8a6a4f', 'Warm brown']];
const INK = '#2b2724';
const CRICUT_MAX = { w: 171.4, h: 234.9 }; // область Print Then Cut (6.75×9.25 in)

/* ---------- Состояние ---------- */
const freshState = () => ({
  v: 1,
  t: { type: 'month', month: new Date().getMonth() + 1, year: new Date().getFullYear(), weekStart: 'mon', weekdays: true, w: 90, h: 150, count: 8, square: true, habits: [], paper: PAPER_TONES[0], line: LINE_COLORS[1][0], weight: 'medium' },
  exp: { mode: 'images', format: 'png', copies: 1, marks: true, bleed: true, imgBleed: false },
});
let state = freshState();
let exportPanel = false;
const fmt = v => +(+v).toFixed(1);
const isNarrow = () => matchMedia('(max-width: 1100px)').matches;
const habitName = (t, i) => (t.habits[i] || '').trim();

/* ---------- Геометрия: одна раскладка для превью (SVG) и экспорта (canvas) ----------
   Квадратные клетки (t.square): ширина и высота — наибольшие допустимые, клетка берётся самой крупной,
   при которой сетка влезает в оба размера, и итоговый трекер обычно меньше по одной из сторон.
   Без квадрата клетки растягиваются ровно на заданные ширину и высоту (например, широкая строка на день под текст). */
function layout(t) {
  const rows = TYPES[t.type].rows(t), n = rows.length, gy = HEADER;
  // ширина колонки подписей зависит от кегля, а кегль — от клетки: пара итераций сходится
  let cell = (t.h - HEADER) / n, fs, lw, numW, wdW;
  for (let k = 0; k < 3; k++) {
    fs = clamp((t.square ? cell : (t.h - HEADER) / n) * 0.55, 1.3, 3.2); // кегль подписей строк — по высоте строки
    // подписи строк: число по правому краю; день недели — отдельной колонкой слева от чисел
    numW = Math.max(...rows.map(r => textWidth(r.text, fs, r.bold ? 700 : 500)));
    wdW = Math.max(0, ...rows.map(r => r.wd ? textWidth(r.wd, fs, r.bold ? 700 : 500) : 0));
    lw = numW + (wdW ? wdW + fs * 0.6 : 0) + 2.4;
    cell = Math.max(0.5, Math.min((t.w - lw) / t.count, (t.h - HEADER) / n));
  }
  const cw = t.square ? cell : Math.max(0.5, (t.w - lw) / t.count), rh = t.square ? cell : Math.max(0.5, (t.h - HEADER) / n);
  const gx = lw, gw = cw * t.count, gh = rh * n, w = gx + gw, h = gy + gh;
  const byHeight = (t.h - HEADER) / n < (t.w - lw) / t.count; // упёрлись в высоту — ширина вышла меньше заданной
  const lines = [];
  // вертикали идут и через шапку — по ним удобно вписать название в свою колонку
  for (let i = 0; i <= t.count; i++) lines.push({ x1: gx + i * cw, y1: 0, x2: gx + i * cw, y2: h, outer: i === 0 || i === t.count });
  for (let j = 0; j <= n; j++) lines.push({ x1: gx, y1: gy + j * rh, x2: w, y2: gy + j * rh, outer: j === 0 || j === n });
  const texts = [];
  rows.forEach((r, j) => {
    const y = gy + (j + 0.5) * rh + fs * 0.36, weight = r.bold ? 700 : 500;
    texts.push({ text: r.text, weight, x: gx - 1.2, y, size: fs, anchor: 'end' });
    if (r.wd) texts.push({ text: r.wd, weight, x: gx - 1.2 - numW - fs * 0.6 - wdW, y, size: fs, anchor: 'start' });
  });
  // месяц и год — в пустом углу над подписями строк: «Nov» и «2026» в две строки по центру
  if (t.type === 'month') {
    // обе строки одной ширины: у каждой свой кегль; ширина — по колонке подписей, но кегль не больше 6 мм
    const mon = MONTHS[t.month - 1], yr = String(t.year), wm = textWidth(mon, 1, 700), wy = textWidth(yr, 1, 500);
    const T = Math.min(gx - 1.6, 6 * Math.min(wm, wy)), sm = T / wm, sy = T / wy;
    const cap = 0.7, gap = 0.35 * (sm + sy) / 2, block = cap * sm + gap + cap * sy; // высота прописных ≈ 0.7 кегля
    const y1 = (HEADER - block) / 2 + cap * sm, y2 = y1 + gap + cap * sy;
    texts.push({ text: mon, weight: 700, x: gx / 2, y: y1, size: sm, anchor: 'middle' }, { text: yr, weight: 500, x: gx / 2, y: y2, size: sy, anchor: 'middle' });
  }
  const labels = [];
  for (let i = 0; i < t.count; i++) {
    const name = habitName(t, i);
    if (!name) continue;
    const { lines: ls, size } = fitLabel(name, clamp(cw * 0.6, 1.6, 3.6), cw);
    // текст снизу вверх: базовая линия смещена вправо, чтобы буквы встали по центру колонки
    ls.forEach((text, j) => labels.push({ text, x: gx + (i + 0.5) * cw + size * (0.36 + (j - (ls.length - 1) / 2) * 1.15), y: HEADER - 1.5, size }));
  }
  return { rows, n, gx, gy, gw, gh, cw, rh, w, h, byHeight, lines, texts, labels };
}

// Название в шапке (высота 2 см минус поля): одна строка; длинное — две строки, если колонка широкая;
// иначе кегль уменьшается, но не мельче 1.8 мм, а остаток обрезается многоточием
const LABEL_ROOM = HEADER - 3, LABEL_MIN = 1.8;
function fitLabel(name, size, cw) {
  const w = textWidth(name, size, 500);
  if (w <= LABEL_ROOM) return { lines: [name], size };
  // чуть длиннее места — просто немного мельче, без переноса
  if (w * 0.78 <= LABEL_ROOM) return { lines: [name], size: size * LABEL_ROOM / w };
  const words = name.split(/\s+/);
  if (words.length > 1 && cw >= size * 2.5) {
    let best = null;
    for (let k = 1; k < words.length; k++) {
      const pair = [words.slice(0, k).join(' '), words.slice(k).join(' ')], m = Math.max(...pair.map(x => textWidth(x, size, 500)));
      if (!best || m < best.m) best = { pair, m };
    }
    const s2 = best.m <= LABEL_ROOM ? size : Math.max(LABEL_MIN, size * LABEL_ROOM / best.m);
    return { lines: best.pair.map(x => clip(x, s2)), size: s2 };
  }
  const s1 = Math.max(LABEL_MIN, size * LABEL_ROOM / w);
  return { lines: [clip(name, s1)], size: s1 };
}
function clip(text, size) {
  if (textWidth(text, size, 500) <= LABEL_ROOM) return text;
  while (text.length > 1 && textWidth(text + '…', size, 500) > LABEL_ROOM) text = text.slice(0, -1);
  return text.trimEnd() + '…';
}

/* ---------- Превью ---------- */
function viewScale(L) {
  const host = $('#sheets'), pad = isNarrow() ? 24 : 56;
  return Math.max(0.5, Math.min((host.clientWidth - pad) / L.w, (host.clientHeight - pad) / L.h));
}
function trackerSvg(t, L) {
  const ln = L.lines.map(l => `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke-width="${strokeW(t, l.outer)}"/>`).join('');
  const tx = L.texts.map(x => `<text x="${x.x}" y="${x.y}" font-size="${x.size}" font-weight="${x.weight}" text-anchor="${x.anchor}">${esc(x.text)}</text>`).join('');
  const lb = L.labels.map(x => `<text font-size="${x.size}" transform="translate(${x.x} ${x.y}) rotate(-90)">${esc(x.text)}</text>`).join('');
  // прозрачные зоны шапки — клик по колонке открывает её название в панели
  const hot = Array.from({ length: t.count }, (_, i) => `<rect class="col-hot" data-col="${i}" x="${L.gx + i * L.cw}" y="0" width="${L.cw}" height="${HEADER}"/>`).join('');
  return `<svg viewBox="0 0 ${L.w} ${L.h}" font-family="'Ubuntu Sans', sans-serif" font-weight="500">
    <rect width="${L.w}" height="${L.h}" fill="${esc(t.paper)}"/>
    <g stroke="${esc(t.line)}" stroke-linecap="square">${ln}</g>
    <g fill="${INK}">${tx}${lb}</g>${hot}</svg>`;
}
function renderSheets() {
  const t = state.t, L = layout(t), k = viewScale(L);
  $('#sheets').innerHTML = `<div class="sheet-col"><div class="sheet-cap">${typeTitle(t)} · ${fmt(L.w)} × ${fmt(L.h)} mm</div>
    <div class="tracker" style="width:${L.w * k}px;height:${L.h * k}px">${trackerSvg(t, L)}</div></div>`;
}

/* ---------- Боковая панель ---------- */
const opt = (v, cur, label = v) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${label}</option>`;
function renderPanel() {
  $('#exportBtn').classList.toggle('active', exportPanel);
  if (exportPanel) return renderExportPanel();
  const t = state.t, L = layout(t);
  const names = Array.from({ length: t.count }, (_, i) =>
    `<label class="habit-row"><span>${i + 1}</span><input type="text" data-habit="${i}" value="${esc(t.habits[i] || '')}" placeholder="Leave empty to write by hand"></label>`).join('');
  $('#panel').innerHTML = `<div class="sec"><h3>Tracker</h3>
    <label class="f">Type<select data-t="type">${Object.entries(TYPES).map(([id, x]) => opt(id, t.type, x.name)).join('')}</select></label>
    ${t.type === 'month' ? `<div class="row"><label class="f">Month<select data-t="month">${MONTH_NAMES.map((m, i) => opt(i + 1, t.month, m)).join('')}</select></label>
    <label class="f">Year<input type="number" min="2000" max="2100" step="1" value="${t.year}" data-t="year"></label></div>
    <label class="f check"><input type="checkbox" data-t="weekdays" ${t.weekdays ? 'checked' : ''}> Days of the week</label>
    <p class="note">${daysIn(t.year, t.month)} days · weekend dates are bold.</p>` : ''}
    ${t.type === 'week' ? `<label class="f">Week starts on<select data-t="weekStart">${opt('mon', t.weekStart, 'Monday')}${opt('sun', t.weekStart, 'Sunday')}</select></label>` : ''}
    <label class="f check"><input type="checkbox" data-t="square" ${t.square ? 'checked' : ''}> Square cells</label>
    <div class="row"><label class="f">${t.square ? 'Max width' : 'Width'}, mm<input type="number" min="30" max="290" step="0.5" value="${fmt(t.w)}" data-t="w"></label>
    <label class="f">${t.square ? 'Max height' : 'Height'}, mm<input type="number" min="40" max="290" step="0.5" value="${fmt(t.h)}" data-t="h"></label></div>
    <label class="f">Habits (columns)<input type="number" min="1" max="31" step="1" value="${t.count}" data-t="count"></label>
    <p class="note" id="cellNote">${cellNote(L)}</p></div>
    <div class="sec"><h3>Habits</h3>${names}
    <p class="note">The top 2 cm are kept for the names — empty columns stay blank to label by hand.</p></div>
    <div class="sec"><h3>Paper tone</h3>
    <div class="swatches">${PAPER_TONES.map(c => `<button type="button" class="swatch${c === t.paper ? ' active' : ''}" data-paper-tone="${c}" style="background:${c}" title="${c}" aria-label="Paper tone ${c}"></button>`).join('')}</div>
    <label class="f">Custom tone<input type="color" value="${esc(t.paper)}" data-t="paper"></label></div>
    <div class="sec"><h3>Lines</h3>
    <div class="row"><label class="f">Line colour<select data-t="line">${LINE_COLORS.map(([c, n]) => opt(c, t.line, n)).join('')}</select></label>
    <label class="f">Line weight<select data-t="weight">${Object.entries(LINE_WEIGHTS).map(([id, x]) => opt(id, t.weight, x.name)).join('')}</select></label></div></div>`;
}
const cellNote = L => !state.t.square ? `Cells ${fmt(L.cw)} × ${fmt(L.rh)} mm · ${L.n} rows. They stretch to fill the width and height.`
  : `Square cells ${fmt(L.cw)} mm · ${L.n} rows. Actual size ${fmt(L.w)} × ${fmt(L.h)} mm — ` + (L.byHeight ? 'the height sets the cell size, so the tracker is narrower than the max width.' : 'the width sets the cell size, so the tracker is shorter than the max height.');

const panel = $('#panel');
panel.addEventListener('input', e => {
  const el = e.target, t = state.t;
  if (el.dataset.habit != null) { t.habits[+el.dataset.habit] = el.value; }
  else if (el.dataset.t) {
    const key = el.dataset.t;
    if (key === 'weekdays' || key === 'square') t[key] = el.checked;
    else if (key === 'type' || key === 'weekStart' || key === 'paper' || key === 'line' || key === 'weight') t[key] = el.value;
    else {
      const v = parseFloat(el.value);
      if (!Number.isFinite(v)) return;
      t[key] = key === 'month' ? clamp(Math.round(v), 1, 12) : key === 'year' ? clamp(Math.round(v), 2000, 2100) : key === 'count' ? Math.round(clamp(v, ...LIMITS.count)) : clamp(v, ...LIMITS[key]);
    }
  } else if (el.dataset.ex) {
    const key = el.dataset.ex;
    state.exp[key] = el.type === 'checkbox' ? el.checked : key === 'copies' ? Math.round(clamp(parseFloat(el.value) || 1, 1, 50)) : el.value;
    if (key === 'mode' || key === 'format' || key === 'imgBleed') renderPanel(); else updatePack();
    save();
    return;
  } else return;
  renderSheets();
  const note = $('#cellNote');
  if (note) note.textContent = cellNote(layout(t));
  save();
});
// список и число колонок меняют сам состав панели — перерисовываем по change (чтобы не терять фокус при вводе)
panel.addEventListener('change', e => {
  if (e.target.matches('select[data-t], input[data-t=count], input[data-t=year], input[data-t=paper], input[data-t=square]')) renderPanel();
});
panel.addEventListener('click', e => {
  const tone = e.target.closest('[data-paper-tone]')?.dataset.paperTone;
  if (tone) { state.t.paper = tone; changed(); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'closeExport') { exportPanel = false; renderPanel(); }
  else if (act === 'dlImage') exportImage();
  else if (act === 'dlSheet') exportSheet();
});
// клик по шапке колонки — к полю её названия
$('#sheets').addEventListener('click', e => {
  const col = e.target.closest('[data-col]')?.dataset.col;
  if (col == null) return;
  if (exportPanel) { exportPanel = false; renderPanel(); }
  const input = panel.querySelector(`[data-habit="${col}"]`);
  input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  input?.focus();
});

$('#exportBtn').addEventListener('click', () => { exportPanel = !exportPanel; renderPanel(); });
// Очистить: убрать все названия привычек (размеры и вид остаются; Undo вернёт)
$('#resetBtn').addEventListener('click', () => {
  if (!state.t.habits.some(h => h?.trim())) return;
  state.t.habits = [];
  changed();
});
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderSheets, 80); });

/* ---------- Для shared.js: фото в трекере нет ---------- */
const APP = {
  key: 'habits',
  histIgnore: ['exp'],
  usedPhotos: () => new Set(),
  pick() {},
  sanitize() {},
};

/* ---------- Экспорт ---------- */
function drawTracker(ctx, t, k) {
  const L = layout(t);
  ctx.save(); ctx.scale(k, k);
  ctx.fillStyle = t.paper; ctx.fillRect(0, 0, L.w, L.h);
  ctx.strokeStyle = t.line; ctx.lineCap = 'square';
  for (const l of L.lines) { ctx.lineWidth = strokeW(t, l.outer); ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke(); }
  ctx.fillStyle = INK; ctx.textBaseline = 'alphabetic';
  for (const x of L.texts) { ctx.font = `${x.weight} ${x.size}px "Ubuntu Sans", sans-serif`; ctx.textAlign = { start: 'left', middle: 'center', end: 'right' }[x.anchor]; ctx.fillText(x.text, x.x, x.y); }
  ctx.textAlign = 'left';
  for (const x of L.labels) {
    ctx.save(); ctx.translate(x.x, x.y); ctx.rotate(-Math.PI / 2);
    ctx.font = `500 ${x.size}px "Ubuntu Sans", sans-serif`; ctx.fillText(x.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}
// Сколько трекеров помещается на лист (как есть или повёрнутыми на 90°) и раскладка по страницам
function packSheet() {
  const L = layout(state.t), P = { w: paper.w, h: paper.h, m: 8, g: 6 };
  const fit = (w, h) => ({ cols: Math.floor((P.w - 2 * P.m + P.g) / (w + P.g)), rows: Math.floor((P.h - 2 * P.m + P.g) / (h + P.g)), w, h });
  const a = fit(L.w, L.h), b = fit(L.h, L.w);
  const best = b.cols * b.rows > a.cols * a.rows ? { ...b, rot: true } : { ...a, rot: false };
  const per = best.cols * best.rows;
  if (!per) return { P, per: 0, pages: [] };
  const bw = best.cols * best.w + (best.cols - 1) * P.g, bh = best.rows * best.h + (best.rows - 1) * P.g;
  const ox = (P.w - bw) / 2, oy = (P.h - bh) / 2, pages = [];
  for (let i = 0; i < state.exp.copies; i++) {
    const j = i % per;
    if (!j) pages.push([]);
    pages[pages.length - 1].push({ x: ox + (j % best.cols) * (best.w + P.g), y: oy + Math.floor(j / best.cols) * (best.h + P.g), w: best.w, h: best.h, rot: best.rot });
  }
  return { P, per, pages };
}
function packHtml() {
  const { P, per, pages } = packSheet();
  if (!per) return `<p class="note warn">The tracker is larger than ${paper.name} paper (with 8 mm margins).</p>`;
  return `<div class="pack-diagram">${pages.map(pg => `<svg viewBox="0 0 ${P.w} ${P.h}">${pg.map(it => `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}"/>`).join('')}</svg>`).join('')}</div>
    <p class="note">${per} per sheet · ${pages.length} sheet${pages.length === 1 ? '' : 's'}.</p>`;
}
function updatePack() { const el = $('#packBox'); if (el) el.innerHTML = packHtml(); }
function renderExportPanel() {
  const x = state.exp, t = layout(state.t), inch = v => (v / 25.4).toFixed(2); // t — итоговый размер
  const big = t.w > CRICUT_MAX.w || t.h > CRICUT_MAX.h;
  let html = `<div class="sec"><div class="zone-title label-row">Export<button type="button" class="icon-btn" data-act="closeExport" title="Close" aria-label="Close" style="margin-left:auto">×</button></div>
    <label class="f">Export as<select data-ex="mode">${opt('images', x.mode, 'Image (sticker / Cricut)')}${opt('sheet', x.mode, 'Sheet for printing (PDF)')}</select></label></div>`;
  if (x.mode === 'images') html += `<div class="sec">
    <label class="f">Format<select data-ex="format">${opt('png', x.format, 'PNG')}${opt('jpg', x.format, 'JPG')}</select></label>
    <p class="note">One image at ${DPI} dpi, exactly ${fmt(t.w)} × ${fmt(t.h)} mm, filled with the paper tone.</p>
    ${bleedImgOption(x)}
    <button class="btn primary block" data-act="dlImage">Download image</button></div>
    <div class="sec"><h3>Cricut (Print Then Cut)</h3>
    ${big ? `<p class="note warn">Print Then Cut fits up to 171 × 234 mm (6.75 × 9.25 in) — make the tracker smaller or print the PDF sheet.</p>` : ''}
    <ol class="steps">
    <li>In Design Space: Upload → the image → “Complex” → save as <b>Print Then Cut</b>.</li>
    ${x.imgBleed ? '<li class="warn">Turn the bleed off for Cricut — Design Space adds its own.</li>' : ''}
    <li>Set the size to <b>${fmt(t.w)} × ${fmt(t.h)} mm</b> (${inch(t.w)} × ${inch(t.h)} in) — it is also in the file name.</li>
    <li>Print on sticker paper and let the Cricut cut it out.</li></ol></div>`;
  else html += `<div class="sec">
    ${paperSelect()}
    <label class="f">Copies<input type="number" min="1" max="50" step="1" value="${x.copies}" data-ex="copies"></label>
    <label class="f check"><input type="checkbox" data-ex="marks" ${x.marks ? 'checked' : ''}> Crop marks at the corners</label>
    ${bleedSheetOption(x)}
    <div id="packBox">${packHtml()}</div>
    <p class="note">Print at 100% (“actual size”), without “fit to page”, then cut along the marks.</p>
    <button class="btn primary block" data-act="dlSheet">Download PDF</button></div>`;
  $('#panel').innerHTML = html;
}
const fileBase = () => { const L = layout(state.t); const t = state.t, name = t.type === 'month' ? `${t.year}-${String(t.month).padStart(2, '0')}` : t.type;
  return `habit-tracker_${name}_${fmt(L.w)}x${fmt(L.h)}mm`; };
// Трекер в итоговом размере → canvas, с вылетом bleed мм по краям. Вылет — только тон бумаги:
// рамка лежит на линии реза, растягивать края (addBleed) нельзя — вышла бы полоса цвета линий
function trackerCanvas(bleed) {
  const t = state.t, L = layout(t), k = DPI / 25.4, bp = Math.round(bleed * k), cv = document.createElement('canvas');
  cv.width = Math.round(L.w * k) + 2 * bp; cv.height = Math.round(L.h * k) + 2 * bp;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = t.paper; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.translate(bp, bp);
  drawTracker(ctx, t, k);
  return cv;
}
function exportImage() {
  const jpg = state.exp.format === 'jpg', b = state.exp.imgBleed ? BLEED : 0;
  return busy('Preparing image…', async () => {
    const blob = await withDpi(await canvasBlob(trackerCanvas(b), jpg ? 'image/jpeg' : 'image/png', 0.95), DPI);
    download(blob, `${fileBase()}${b ? `_bleed${b}mm` : ''}.${jpg ? 'jpg' : 'png'}`);
  });
}
function exportSheet() {
  const { P, pages } = packSheet(), k = DPI / 25.4, b = state.exp.bleed ? BLEED : 0, bp = Math.round(b * k);
  if (!pages.length) return;
  return busy('Preparing PDF…', async () => {
    const one = trackerCanvas(b), out = []; // все копии одинаковые — рисуем один раз
    for (const pg of pages) {
      const cv = document.createElement('canvas');
      cv.width = Math.round(P.w * k); cv.height = Math.round(P.h * k);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      for (const it of pg) {
        ctx.save(); ctx.translate(it.x * k, it.y * k);
        if (it.rot) { ctx.translate(it.w * k, 0); ctx.rotate(Math.PI / 2); }
        ctx.drawImage(one, -bp, -bp);
        ctx.restore();
      }
      if (state.exp.marks) pg.forEach(it => cropMarks(ctx, it, k, b));
      out.push({ bytes: new Uint8Array(await (await canvasBlob(cv, 'image/jpeg', 0.93)).arrayBuffer()), W: cv.width, H: cv.height });
    }
    download(makePdf(out), `${fileBase()}_${paper.name}.pdf`);
  });
}

/* ---------- Запуск (хранение и Undo — в shared.js) ---------- */
async function init() {
  const saved = await loadStudio();
  if (saved?.v === 1 && saved.t) {
    const f = freshState();
    state = { ...f, ...saved, t: { ...f.t, ...saved.t }, exp: { ...f.exp, ...saved.exp } };
    if (!(state.t.type in TYPES)) state.t.type = 'month';
    delete state.t.days; // раньше месяц задавался числом дней — теперь месяцем и годом
  }
  changed();
  histReset();
  // подписи меряются шрифтом Ubuntu Sans — когда он догрузится, раскладку пересчитываем
  Promise.all(['500 20px "Ubuntu Sans"', '700 20px "Ubuntu Sans"'].map(f => document.fonts.load(f))).then(() => { renderSheets(); renderPanel(); });
}
init();
