'use strict';

/* ---------- Шаблон: лист A4 или Letter, сетка 4×4 без полей, промежуток 5 мм ----------
   A4: ячейки 48.75×70.5 мм; Letter: 50.2×66.1 мм. Размеры пересчитывает zineGeometry() по бумаге. */
const GAP = 5;
let PW, PH, CW, CH, CUTS, FOLDS;
// ↓ — ячейка напечатана вверх ногами (как в шаблоне Inkscape)
const LAYOUT = [
  ['C↓', '30↓', '29↓', '5↑', '12↓', '27↑', '28↑', '6↑', '11↓', '26↓', '25↓', '17↑', 'B↑', '23↑', '24↑', '18↑'],
  ['4↓', '3↓', '2↓', '1↓', '7↑', '8↑', '9↑', '10↑', '16↓', '15↓', '14↓', '13↓', '19↑', '20↑', '21↑', '22↑'],
];
const SIDE_NAMES = ['Side 1 — cover', 'Side 2 — back'];

const CELLS = {};
LAYOUT.forEach((list, side) => list.forEach((tok, i) => {
  const key = tok.slice(0, -1);
  const r = Math.floor(i / 4), c = i % 4, id = `${side}-${r}-${c}`;
  const kind = key === 'C' ? 'cover' : key === 'B' ? 'back' : 'page';
  CELLS[id] = {
    id, side, r, c, kind, down: tok.endsWith('↓'),
    num: kind === 'page' ? +key : null,
    label: kind === 'cover' ? 'Cover' : kind === 'back' ? 'Back' : key,
  };
}));
// Линии реза на стороне 1 (мм): три надреза по серединам белых промежутков между рядами,
// поочерёдно от левого и правого края — лист превращается в «змейку» из 16 панелей.
// Каждый надрез не доходит до крайней ячейки: там ряды остаются соединены (5–6, 12–11, 17–18).
function zineGeometry() {
  PW = paper.w; PH = paper.h; CW = (PW - 3 * GAP) / 4; CH = (PH - 3 * GAP) / 4;
  CUTS = [
    { y: CH + GAP / 2, x0: 0, x1: 3 * (CW + GAP) - GAP / 2, from: 'left' },
    { y: 2 * (CH + GAP) - GAP / 2, x0: CW + GAP / 2, x1: PW, from: 'right' },
    { y: 3 * (CH + GAP) - GAP / 2, x0: 0, x1: 3 * (CW + GAP) - GAP / 2, from: 'left' },
  ];
  // Сгибы (вид со стороны 1) делаются на целом листе ДО резки — так ровнее и удобнее.
  // После резки полоса из 16 панелей складывается гармошкой так, что лицом друг к другу оказываются
  // подряд идущие страницы (1–2, 29–30, 3–4, 5–6 …). Поэтому: три вертикальные линии на всю высоту —
  // крайние «гора» (сторона 2 внутрь), средняя «долина» (сторона 1 внутрь); три горизонтальные на всю
  // ширину — «долина» (та часть, что потом разрезается, ничему не мешает).
  FOLDS = [
    ...[1, 2, 3].map(c => ({ x0: c * (CW + GAP) - GAP / 2, y0: 0, x1: c * (CW + GAP) - GAP / 2, y1: PH, type: c === 2 ? 'valley' : 'mountain' })),
    ...[1, 2, 3].map(r => ({ x0: 0, y0: r * (CH + GAP) - GAP / 2, x1: PW, y1: r * (CH + GAP) - GAP / 2, type: 'valley' })),
  ];
  const tab = document.querySelector('#modeTabs [data-mode=zine] span');
  if (tab) tab.textContent = `${paper.name} · 32 pages`;
}
zineGeometry();
// порядок чтения: обложка, 1…30, задняя
const cellOrder = id => { const c = CELLS[id]; return c.kind === 'cover' ? 0 : c.kind === 'back' ? 99 : c.num; };

/* ---------- Состояние ---------- */
// filter — фильтр фото этой зоны (FILTERS в shared.js)
const newZone = cells => ({ id: uid(), cells, photo: null, fx: 0.5, fy: 0.5, zoom: 1, flip: false, filter: 'none' });
const freshState = () => ({
  v: 1,
  zones: Object.keys(CELLS).map(id => newZone([id])),
  cover: { title: '', issue: '', date: '', color: '#ffffff', size: 11, titlePos: 'bottom', metaPos: 'bottom', titleAlign: 'left' },
  // margin — белая рамка по краю листа; offX/offY — сдвиг стороны 2 при экспорте (мм)
  print: { v: 2, margin: 2.5, offX: 0, offY: 0, cutLines: true },
  mode: 'zine',
  // freshBox() определяется в box.js, который грузится после app.js
  box: typeof freshBox === 'function' ? freshBox() : null,
});

let state = freshState();
let selection = new Set();
let multiSelect = false; // режим выбора нескольких (долгое нажатие, как в Google Photos): тапы добавляют/убирают ячейки
let currentSide = 0;      // какая сторона показана на узком экране
let printPanel = false; // правая колонка показывает настройки печати (кнопка «Print»)

// «2» → «#2»; если «#» уже есть или номер пустой — как есть
const issueText = v => { v = String(v || '').trim(); return v && !v.startsWith('#') ? '#' + v : v; };
// плейсхолдер даты — текущие месяц и год, «MM.YYYY»
const datePlaceholder = () => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };
const zoneById = id => state.zones.find(z => z.id === id);
const zoneSide = z => CELLS[z.cells[0]].side;
const zoneKind = z => CELLS[z.cells[0]].kind;

/* ---------- Геометрия зон ---------- */
function zoneRect(z) {
  const cs = z.cells.map(id => CELLS[id]);
  const r0 = Math.min(...cs.map(c => c.r)), r1 = Math.max(...cs.map(c => c.r));
  const c0 = Math.min(...cs.map(c => c.c)), c1 = Math.max(...cs.map(c => c.c));
  // внешняя белая рамка подрезает крайние зоны; линии сгиба (промежутки) не сдвигаются
  const m = +(state?.print?.margin) || 0;
  const x0 = Math.max(m, c0 * (CW + GAP)), y0 = Math.max(m, r0 * (CH + GAP));
  const x1 = Math.min(PW - m, c1 * (CW + GAP) + CW), y1 = Math.min(PH - m, r1 * (CH + GAP) + CH);
  return {
    x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0),
    rows: r1 - r0 + 1, cols: c1 - c0 + 1,
  };
}
// Смешанные зоны (поровну ↑ и ↓), которые по умолчанию печатаются вверх ногами
const MIXED_DOWN = new Set(['23-26']);
// Зона перевёрнута, если большинство её ячеек перевёрнуто (при равенстве — прямо,
// кроме зон из MIXED_DOWN), плюс ручной поворот
function zoneDown(z) {
  const downs = z.cells.filter(id => CELLS[id].down).length;
  const nums = z.cells.map(id => CELLS[id].num).sort((a, b) => a - b);
  const tieDown = MIXED_DOWN.has(`${nums[0]}-${nums[nums.length - 1]}`);
  const down = downs * 2 > z.cells.length || (downs * 2 === z.cells.length && tieDown);
  return down !== z.flip;
}
function zoneTitle(z) {
  if (zoneKind(z) !== 'page') return CELLS[z.cells[0]].label;
  const nums = z.cells.map(id => CELLS[id].num).sort((a, b) => a - b);
  return nums.length === 1 ? `Page ${nums[0]}` : `Pages ${nums[0]}–${nums[nums.length - 1]}`;
}
function zoneTag(z) {
  if (zoneKind(z) !== 'page') return CELLS[z.cells[0]].label;
  const nums = z.cells.map(id => CELLS[id].num).sort((a, b) => a - b);
  return nums.length === 1 ? `${nums[0]}` : `${nums[0]}–${nums[nums.length - 1]}`;
}

// Масштаб «cover» + зум; возвращает размеры изображения в долях зоны и зажимает фокус
// z.rot — поворот фото внутри зоны (0/90/180/270); fx/fy считаются в повёрнутом фото
// z.angle — свободный наклон фото (−45…45°) вокруг центра зоны. Чтобы углы зоны не оголялись,
// фото должно покрывать габарит зоны, повёрнутой в систему фото (BW×BH)
function imageFit(z) {
  const p = photos.get(z.photo), R = zoneRect(z), [pw, ph] = rotDims(p, z.rot);
  const a = (z.angle || 0) * Math.PI / 180, ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
  const BW = R.w * ca + R.h * sa, BH = R.w * sa + R.h * ca;
  const s = Math.max(BW / pw, BH / ph) * z.zoom;
  const wr = pw * s / R.w, hr = ph * s / R.h;
  const hx = BW / 2 / (pw * s), hy = BH / 2 / (ph * s);
  z.fx = clamp(z.fx, hx, 1 - hx);
  z.fy = clamp(z.fy, hy, 1 - hy);
  return { p, R, s, wr, hr };
}

/* ---------- Объединение ---------- */
function mergeCheck(zones) {
  if (zones.length < 2) return { ok: false, reason: 'Select several cells (Shift/Ctrl + click, or long-press on a phone).' };
  const cells = zones.flatMap(z => z.cells).map(id => CELLS[id]);
  if (new Set(cells.map(c => c.side)).size > 1) return { ok: false, reason: 'Cells must be on the same side of the sheet.' };
  if (cells.some(c => c.num === null)) return { ok: false, reason: 'The cover and back page can’t be merged.' };
  const nums = cells.map(c => c.num).sort((a, b) => a - b);
  if (nums.some((n, i) => i && n !== nums[i - 1] + 1)) return { ok: false, reason: 'Page numbers must be consecutive.' };
  const R = zoneRect({ cells: cells.map(c => c.id) });
  if (R.rows * R.cols !== cells.length) return { ok: false, reason: 'The merged zone must be a rectangle.' };
  return { ok: true };
}
function mergeSelected() {
  const zs = [...selection].map(zoneById).sort((a, b) => Math.min(...a.cells.map(cellOrder)) - Math.min(...b.cells.map(cellOrder)));
  if (!mergeCheck(zs).ok) return;
  setMultiSelect(false);
  const nz = newZone(zs.flatMap(z => z.cells).sort((a, b) => cellOrder(a) - cellOrder(b)));
  nz.photo = zs.find(z => z.photo)?.photo || null;
  state.zones = state.zones.filter(z => !zs.includes(z)).concat(nz);
  selection = new Set([nz.id]);
  changed();
}
// «Merge all»: самые крупные зоны, которые реально видны целиком в сложенном зине —
// панорамы по 4 на стороне 2, вертикальные пары на стороне 1 и два блока 2×2.
// (23–30 одним блоком формально объединяемы, но надрезы делят их — поэтому два блока.)
const MERGE_ALL_GROUPS = [[1, 2, 3, 4], [7, 8, 9, 10], [13, 14, 15, 16], [19, 20, 21, 22], [5, 6], [11, 12], [17, 18], [23, 24, 25, 26], [27, 28, 29, 30]];
function mergeAll() {
  const plans = [];
  for (const nums of MERGE_ALL_GROUPS) {
    const cellIds = Object.values(CELLS).filter(c => nums.includes(c.num)).map(c => c.id);
    const zs = state.zones.filter(z => z.cells.some(id => cellIds.includes(id)));
    // уже объединено целиком — пропускаем; зону, вылезающую за группу, не ломаем
    if (zs.length < 2 || zs.some(z => z.cells.some(id => !cellIds.includes(id))) || !mergeCheck(zs).ok) continue;
    zs.sort((a, b) => Math.min(...a.cells.map(cellOrder)) - Math.min(...b.cells.map(cellOrder)));
    plans.push(zs);
  }
  if (!plans.length) return;
  // фото, которым не останется места, возвращаются в материалы — предупредим
  const dropped = plans.reduce((n, zs) => n + Math.max(0, zs.filter(z => z.photo).length - 1), 0);
  if (dropped && !confirm(`Merge all? ${dropped} photo(s) will be taken out of the zine (they stay in Materials).`)) return;
  for (const zs of plans) {
    const keep = zs.find(z => z.photo);
    const nz = newZone(zs.flatMap(z => z.cells).sort((a, b) => cellOrder(a) - cellOrder(b)));
    if (keep) Object.assign(nz, { photo: keep.photo, ...focusFor(keep.photo, keep.rot, keep.mirror), rot: keep.rot || 0, angle: keep.angle || 0, mirror: !!keep.mirror, filter: keep.filter || 'none' });
    state.zones = state.zones.filter(z => !zs.includes(z)).concat(nz);
  }
  selection.clear(); setMultiSelect(false);
  changed();
}
// «Randomize layout»: случайная сетка из допустимых объединений, затем Autofill.
// Ряды стороны 2 режутся на случайные отрезки, пары 5–6 / 11–12 / 17–18 — объединены или нет,
// блоки 2×2 — целиком, двумя парами, одной парой или по ячейкам. Обложка и задняя не трогаются.
function randomizeLayout() {
  const rnd = Math.random, groups = [];
  const runs = nums => {
    const out = []; let cur = [nums[0]];
    for (const n of nums.slice(1)) { if (rnd() < 0.45) { out.push(cur); cur = [n]; } else cur.push(n); }
    return [...out, cur];
  };
  [[1, 2, 3, 4], [7, 8, 9, 10], [13, 14, 15, 16], [19, 20, 21, 22]].forEach(r => groups.push(...runs(r)));
  [[5, 6], [11, 12], [17, 18]].forEach(p => groups.push(...(rnd() < 0.5 ? [p] : p.map(n => [n]))));
  [[23, 24, 25, 26], [27, 28, 29, 30]].forEach(([a, b, c, d]) => {
    const x = rnd();
    groups.push(...(x < 0.35 ? [[a, b, c, d]] : x < 0.65 ? [[a, b], [c, d]]
      : x < 0.85 ? (rnd() < 0.5 ? [[a, b], [c], [d]] : [[a], [b], [c, d]]) : [[a], [b], [c], [d]]));
  });
  const cellOf = n => Object.values(CELLS).find(c => c.num === n).id;
  const keep = state.zones.filter(z => zoneKind(z) !== 'page'); // обложка и задняя — как есть
  state.zones = keep.concat(groups.map(g => newZone(g.map(cellOf).sort((a, b) => cellOrder(a) - cellOrder(b)))));
  selection.clear(); setMultiSelect(false);
  autofill(); // раскладывает свободные фото по новой сетке (если их нет — просто сетка)
  changed();
}
function splitZone(z) {
  const parts = [...z.cells].sort((a, b) => cellOrder(a) - cellOrder(b)).map(id => newZone([id]));
  parts[0].photo = z.photo; parts[0].filter = z.filter || 'none';
  state.zones = state.zones.filter(x => x !== z).concat(parts);
  selection = new Set([parts[0].id]);
  changed();
}

/* ---------- Отрисовка листов ---------- */
function coverTextLayout(w, h, cv) {
  const pad = 4.5, M = Math.max(2.6, cv.size * 0.36), capM = M * 0.72, gap = 2.2;
  // название уменьшается, если не помещается по ширине
  const tw = cv.title ? textWidth(cv.title, +cv.size, 700) : 0;
  const T = tw > w - 2 * pad ? +cv.size * (w - 2 * pad) / tw : +cv.size, capT = T * 0.72;
  const out = [];
  const titleY = cv.titlePos === 'top' ? pad + capT : h - pad;
  const align = { left: [pad, 'start'], center: [w / 2, 'middle'], right: [w - pad, 'end'] }[cv.titleAlign] || [pad, 'start'];
  if (cv.title) out.push({ text: cv.title, x: align[0], y: titleY, size: T, weight: 700, anchor: align[1] });
  let metaY;
  if (cv.metaPos === cv.titlePos && cv.title) metaY = cv.titlePos === 'top' ? titleY + gap + capM + 1 : titleY - capT - gap - 1;
  else metaY = cv.metaPos === 'top' ? pad + capM : h - pad;
  const issue = issueText(cv.issue);
  if (issue) out.push({ text: issue, x: pad, y: metaY, size: M, weight: 500, anchor: 'start' });
  if (cv.date) out.push({ text: cv.date, x: w - pad, y: metaY, size: M, weight: 500, anchor: 'end' });
  return out;
}
function coverSvg(z) {
  const R = zoneRect(z), cv = state.cover;
  const items = coverTextLayout(R.w, R.h, cv).map(t =>
    `<text x="${t.x}" y="${t.y}" font-size="${t.size}" font-weight="${t.weight}" text-anchor="${t.anchor}" fill="${esc(cv.color)}" font-family="'Ubuntu Sans', sans-serif">${esc(t.text)}</text>`);
  return items.length ? `<svg viewBox="0 0 ${R.w} ${R.h}" preserveAspectRatio="none">${items.join('')}</svg>` : '';
}

// img лежит в обёртке .ph размером с повёрнутое фото; само img повёрнуто вокруг центра обёртки
function applyImg(img, z) {
  const { R, wr, hr } = imageFit(z), rot = z.rot || 0;
  // точка фото (fx, fy) лежит в центре зоны — вокруг неё и наклоняем
  Object.assign(img.parentElement.style, {
    width: wr * 100 + '%', height: hr * 100 + '%',
    left: (0.5 - z.fx * wr) * 100 + '%', top: (0.5 - z.fy * hr) * 100 + '%',
    transformOrigin: `${z.fx * 100}% ${z.fy * 100}%`,
    transform: z.angle ? `rotate(${z.angle}deg)` : '',
  });
  // размеры обёртки в мм — нужны, чтобы при 90°/270° поменять стороны img
  const W = wr * R.w, H = hr * R.h, [iw, ih] = rot % 180 ? [H, W] : [W, H];
  Object.assign(img.style, {
    width: iw / W * 100 + '%', height: ih / H * 100 + '%',
    left: (W - iw) / 2 / W * 100 + '%', top: (H - ih) / 2 / H * 100 + '%',
    transform: imgTransform(z),
  });
}

function zoneHtml(z) {
  const R = zoneRect(z), down = zoneDown(z), p = z.photo && photos.get(z.photo);
  const cls = ['zone', p ? 'has-photo' : 'empty', selection.has(z.id) ? 'selected' : ''].join(' ');
  const style = `left:${R.x / PW * 100}%;top:${R.y / PH * 100}%;width:${R.w / PW * 100}%;height:${R.h / PH * 100}%`;
  const body = p
    ? `<div class="ph" style="${filterCss(z.filter)}"><img src="${p.url}" draggable="false" alt=""></div>`
    : `<div class="zone-empty"><b>${esc(zoneTag(z))}</b><span>drop a photo</span></div>`;
  return `<div class="${cls}" data-id="${z.id}" style="${style}">
    <div class="zone-inner${down ? ' rot' : ''}">${body}${zoneKind(z) === 'cover' ? coverSvg(z) : ''}
      ${p ? `<div class="zone-tag">↑ ${esc(zoneTag(z))}</div>` : ''}</div></div>`;
}

function renderSheets() {
  updateMode();
  if (state.mode === 'box') return renderBox();
  const host = $('#sheets');
  host.classList.toggle('hide-numbers', !$('#numbersToggle').checked);
  host.innerHTML = [0, 1].map(side => `<div class="sheet-col">
      <div class="sheet-cap">${SIDE_NAMES[side]}</div>
      <div class="sheet" data-side="${side}">${state.zones.filter(z => zoneSide(z) === side).map(zoneHtml).join('')}${side === 0 && state.print.cutLines ? cutOverlay() : ''}</div>
    </div>`).join('');
  host.querySelectorAll('.zone.has-photo').forEach(el => applyImg(el.querySelector('img'), zoneById(el.dataset.id)));
  // на узком экране стороны листаются горизонтально — после перерисовки остаёмся на той же
  host.scrollLeft = currentSide * host.clientWidth;
  // подсветить, если выбранные ячейки можно объединить
  const zs = [...selection].map(zoneById);
  if (zs.length > 1 && mergeCheck(zs).ok) zs.forEach(z => host.querySelector(`[data-id="${z.id}"]`)?.classList.add('mergeable'));
}

// Линии реза поверх стороны 1 — видны, пока открыта панель печати
function cutOverlay() {
  return `<svg class="cut-overlay" viewBox="0 0 ${PW} ${PH}" preserveAspectRatio="none">${CUTS.map(c =>
    `<line x1="${c.x0}" y1="${c.y}" x2="${c.x1}" y2="${c.y}"/>`).join('')}</svg>`;
}

/* ---------- Боковая панель ---------- */
function renderPanel() {
  if (selection.size) printPanel = false; // выбор ячейки закрывает настройки печати
  updateMultiBar();
  $('#exportBtn').classList.toggle('active', printPanel);
  document.body.classList.toggle('print-open', printPanel);
  if (printPanel) return renderPrintPanel();
  if (state.mode === 'box') return renderBoxPanel();
  const zs = [...selection].map(zoneById).filter(Boolean);
  let html = '';
  if (zs.length === 0) {
    html += `<div class="sec mobile-only"><p class="note">Tap a cell to edit it. Tap a photo in Materials to put it into the selected cell. To merge pages, long-press a cell, then tap its neighbours.</p></div>
      <div class="sec desktop-only"><h3>How it works</h3><ul class="legend">
      <li>Click to select a cell, Shift/Ctrl + click to select several</li>
      <li>Adjacent pages with consecutive numbers can be merged into one photo</li>
      <li>Drag photos from the strip below onto cells</li>
      <li>Drag a photo to reframe it; scroll wheel to zoom</li>
      <li>The ↑ arrow next to the number marks the top of the page</li>
      <li>Select the cover to edit its title, issue and date</li></ul></div>`;
  } else if (zs.length === 1) {
    const z = zs[0];
    html += `<div class="sec"><div class="zone-title">${esc(zoneTitle(z))}</div>
      <p class="note">${z.cells.length > 1 ? `Merged cells: ${z.cells.length}` : 'Single cell'} · ${zoneDown(z) ? 'printed upside down' : 'printed upright'}</p>
      ${z.photo ? '' : '<button class="btn block" data-act="upload">Upload photo</button>'}
      ${z.photo ? `<label class="f">Zoom<input type="range" min="1" max="5" step="0.01" value="${z.zoom}" data-act="zoom"></label>
      <div class="row"><button class="btn" data-act="center">Reset framing</button><button class="btn" data-act="remove">Remove photo</button></div>` : ''}
      ${z.photo ? rotateRow('data-act') : ''}
      ${z.photo ? `<label class="f"><span class="label-row">Adjust angle: <output id="angleOut">${fmtAngle(z.angle)}</output><button type="button" class="icon-btn" data-act="angle0" title="Reset angle" aria-label="Reset angle">↺</button></span><input type="range" min="-45" max="45" step="0.5" value="${z.angle || 0}" data-act="angle"></label>` : ''}
      ${z.photo ? `${filterSelect('data-zf="filter"', z.filter || 'none')}
      <button class="btn" data-act="filterAll" title="Use this filter for every photo in the zine">Apply filter to all photos</button>` : ''}
      ${z.cells.length > 1 ? '<button class="btn" data-act="split">Split cells</button>' : ''}
      <p class="note">To merge, Shift-click neighbouring pages (on a phone: long-press a cell, then tap the others).</p></div>`;
  } else {
    const chk = mergeCheck(zs);
    html += `<div class="sec"><div class="zone-title">Selected: ${zs.length}</div>
      <button class="btn primary block" data-act="merge" ${chk.ok ? '' : 'disabled'}>Merge into one zone</button>
      ${chk.ok ? '<p class="note">The photo will fill the whole zone with no white gaps.</p>' : `<p class="note warn">${esc(chk.reason)}</p>`}</div>`;
  }
  // настройки текста обложки — только когда выбрана сама обложка
  const cv = state.cover;
  if (zs.length === 1 && zoneKind(zs[0]) === 'cover') html += `<div class="sec"><h3>Cover text</h3>
    <label class="f">Title<input type="text" data-cv="title" value="${esc(cv.title)}" placeholder="Title"></label>
    <div class="row"><label class="f">Issue #<input type="text" data-cv="issue" value="${esc(cv.issue)}"></label>
    <label class="f">Date<input type="text" data-cv="date" value="${esc(cv.date)}" placeholder="${datePlaceholder()}"></label></div>
    <div class="row"><label class="f">Title position<select data-cv="titlePos">
      <option value="top" ${cv.titlePos === 'top' ? 'selected' : ''}>top</option>
      <option value="bottom" ${cv.titlePos === 'bottom' ? 'selected' : ''}>bottom</option></select></label>
    <label class="f">Issue & date<select data-cv="metaPos">
      <option value="top" ${cv.metaPos === 'top' ? 'selected' : ''}>top</option>
      <option value="bottom" ${cv.metaPos === 'bottom' ? 'selected' : ''}>bottom</option></select></label></div>
    <label class="f">Title alignment<select data-cv="titleAlign">
      <option value="left" ${cv.titleAlign === 'left' ? 'selected' : ''}>left</option>
      <option value="center" ${cv.titleAlign === 'center' ? 'selected' : ''}>center</option>
      <option value="right" ${cv.titleAlign === 'right' ? 'selected' : ''}>right</option></select></label>
    <div class="row"><label class="f">Size<input type="range" min="5" max="20" step="0.5" value="${cv.size}" data-cv="size"></label>
    <label class="f">Color<input type="color" value="${esc(cv.color)}" data-cv="color"></label></div></div>`;
  $('#panel').innerHTML = html;
}

// Схема резки: лист стороной 1 вверх, ячейки с номерами, надрезы с ножницами у начала
function cutDiagram() {
  const cells = Object.values(CELLS).filter(c => c.side === 0).map(c => {
    const x = c.c * (CW + GAP), y = c.r * (CH + GAP);
    const label = c.kind === 'page' ? c.num : c.kind === 'cover' ? 'C' : 'B';
    return `<rect x="${x}" y="${y}" width="${CW}" height="${CH}" rx="2"/><text class="num" x="${x + CW / 2}" y="${y + CH / 2 + 7}">${label}</text>`;
  }).join('');
  const cuts = CUTS.map(c => {
    const sx = c.from === 'left' ? c.x0 : c.x1, ex = c.from === 'left' ? c.x1 : c.x0;
    return `<line class="cut" x1="${c.x0}" y1="${c.y}" x2="${c.x1}" y2="${c.y}"/>
      <line class="stop" x1="${ex}" y1="${c.y - 7}" x2="${ex}" y2="${c.y + 7}"/>
      <text class="sc" x="${sx + (c.from === 'left' ? 2 : -2)}" y="${c.y - 3}" text-anchor="${c.from === 'left' ? 'start' : 'end'}">✂</text>`;
  }).join('');
  return `<svg class="cut-diagram" viewBox="-4 -4 ${PW + 8} ${PH + 8}"><rect class="sheet-bg" x="0" y="0" width="${PW}" height="${PH}"/>${cells}${cuts}</svg>`;
}

// Схема сгибов на целом листе: гора — штрихпунктир, долина — пунктир
function foldDiagram() {
  const cells = Object.values(CELLS).filter(c => c.side === 0).map(c => {
    const x = c.c * (CW + GAP), y = c.r * (CH + GAP);
    const label = c.kind === 'page' ? c.num : c.kind === 'cover' ? 'C' : 'B';
    return `<rect x="${x}" y="${y}" width="${CW}" height="${CH}" rx="2"/><text class="num" x="${x + CW / 2}" y="${y + CH / 2 + 7}">${label}</text>`;
  }).join('');
  const folds = FOLDS.map(f => `<line class="${f.type}" x1="${f.x0}" y1="${f.y0}" x2="${f.x1}" y2="${f.y1}"/>`).join('');
  return `<svg class="cut-diagram" viewBox="-4 -4 ${PW + 8} ${PH + 8}"><rect class="sheet-bg" x="0" y="0" width="${PW}" height="${PH}"/>${cells}${folds}</svg>`;
}

// Настройки печати и скачивание PDF (зин) / PDF и SVG (коробка)
function renderPrintPanel() {
  let html = `<div class="sec"><div class="zone-title label-row">Print<button type="button" class="icon-btn" data-act="closePrint" title="Close" aria-label="Close" style="margin-left:auto">×</button></div>`;
  if (state.mode === 'box') {
    const b = state.box;
    html += `${paperSelect()}<p class="note">The box net on one ${paper.name} sheet at 100% scale.</p>
      <label class="f check"><input type="checkbox" data-bx="pdfLines" ${b.pdfLines ? 'checked' : ''}> Cut and fold lines in PDF</label>
      <button class="btn primary block" data-act="downloadPdf">Download PDF</button>
      </div>
      <div class="sec"><h3>Cricut (Print Then Cut)</h3>
      <div class="row"><button class="btn" data-act="downloadPng">Print image (PNG)</button><button class="btn" data-act="downloadSvg">Cut &amp; score (SVG)</button></div>
      <ol class="steps">
        <li>Upload the <b>PNG</b> and choose <b>Print Then Cut</b>. Set its size to <b>${cricutSize()}</b> (lock proportions). Design Space traces the outline for cutting.</li>
        <li>Upload the <b>SVG</b>. It has the outline (for alignment only), the inner slit and the fold lines. Check that it is also <b>${cricutSize()}</b> — if not, set it (lock proportions).</li>
        <li>Select both and <b>Align → Center</b>: the grey outline should sit exactly on the edge of the picture. Then hide or delete the outline.</li>
        <li>Set the fold lines to <b>Score</b>, keep the slit as <b>Cut</b>. Select everything and <b>Attach</b>.</li>
      </ol></div>`;
  } else {
    const pr = state.print, empty = state.zones.filter(z => !z.photo).length;
    html += `${paperSelect()}<p class="note">Two ${paper.name} sides at 300 dpi. Print double-sided at 100% scale (turn off “Fit to page”).</p>
      ${empty ? `<p class="note warn">Empty zones: ${empty}. They will print white.</p>` : ''}
      <button class="btn primary block" data-act="downloadPdf">Download PDF</button>
      <button class="btn block" data-act="downloadImages">Download 2 images (JPG, ZIP)</button></div>
    <div class="sec"><h3>1. Fold the whole sheet</h3>
      ${foldDiagram()}
      <div class="fold-legend"><span><svg width="30" height="6"><line class="mountain" x1="0" y1="3" x2="30" y2="3"/></svg>Mountain — crease points towards you</span><span><svg width="30" height="6"><line class="valley" x1="0" y1="3" x2="30" y2="3"/></svg>Valley — crease points away from you</span></div>
      <ol class="steps">
        <li>Print double-sided and let the ink dry.</li>
        <li>Lay the sheet with <b>Side 1</b> (the cover side) up. Fold before cutting — the creases come out straighter.</li>
        <li>Fold the three <b>vertical</b> gaps through the whole sheet: left and right as mountains, the middle one as a valley.</li>
        <li>Fold the three <b>horizontal</b> gaps through the whole sheet as valleys.</li>
        <li>Press every crease hard (a bone folder or the back of a spoon helps), then open the sheet flat again.</li>
      </ol>
    </div>
    <div class="sec"><h3>2. Cut</h3>
      ${cutDiagram()}
      <ol class="steps">
        <li>Keep <b>Side 1</b> up and cut along the 3 lines in the middle of the horizontal gaps: the top and bottom cuts start at the <b>left</b> edge, the middle cut at the <b>right</b> edge.</li>
        <li>Stop each cut at the last vertical crease — the outermost cell must stay attached to the next row.</li>
      </ol>
      <label class="f check"><input type="checkbox" data-pr="cutLines" ${pr.cutLines ? 'checked' : ''}> Print cut lines on side 1</label>
    </div>
    <div class="sec"><h3>3. Assemble</h3>
      <ol class="steps">
        <li>You now have a zigzag strip of 16 panels with all creases ready.</li>
        <li>Collapse it along the creases into a stack: the cover ends up on top, the back page at the bottom. Every spread you open shows two consecutive pages (1–2, 3–4 …).</li>
      </ol>
    </div>
    <div class="sec"><h3>Settings</h3>
      <label class="f">White border at sheet edge, mm<input type="number" min="0" max="15" step="0.5" value="${pr.margin}" data-pr="margin"></label>
      <p class="note" style="color:var(--ink)">Side 2 offset:</p>
      <div class="row"><label class="f">X, mm<input type="number" min="-15" max="15" step="0.1" value="${pr.offX}" data-pr="offX"></label>
      <label class="f">Y, mm<input type="number" min="-15" max="15" step="0.1" value="${pr.offY}" data-pr="offY"></label></div>
      <p class="note">The border shows right away on the sheets. The offset only applies to side 2 in the PDF: plus moves right/down, minus moves left/up. If side 2 printed 1 mm too far right, set X = −1.</p></div>`;
  }
  $('#panel').innerHTML = html;
}

$('#panel').addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  const z = selection.size === 1 ? zoneById([...selection][0]) : null;
  if (act === 'closePrint') { printPanel = false; renderPanel(); }
  if (act === 'downloadPdf') state.mode === 'box' ? exportBox('pdf') : exportZinePdf();
  if (act === 'downloadImages') exportZineImages();
  if (act === 'downloadSvg') exportBox('svg');
  if (act === 'downloadPng') exportBox('png');
  if (act === 'merge') mergeSelected();
  if (!z) return;
  if (act === 'upload') pickForZone(z);
  if (act === 'remove') { z.photo = null; changed(); }
  if (act === 'center') { Object.assign(z, { ...focusFor(z.photo, z.rot, z.mirror), zoom: 1 }); changed(); }
  if (act === 'flip') { z.flip = !z.flip; changed(); }
  if (act === 'angle0') { e.preventDefault(); z.angle = 0; changed(); }
  if (act === 'rotl' || act === 'rotr') { rotatePhoto(z, act === 'rotr' ? 1 : -1); changed(); }
  if (act === 'mirror') { mirrorPhoto(z); changed(); }
  if (act === 'split') splitZone(z);
  if (act === 'filterAll') { state.zones.forEach(x => { x.filter = z.filter || 'none'; }); changed(); }
});
$('#panel').addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.act === 'zoom') {
    const z = zoneById([...selection][0]);
    z.zoom = +t.value; renderSheets(); save();
  }
  if (t.dataset.act === 'angle') {
    const z = zoneById([...selection][0]);
    z.angle = +t.value; $('#angleOut').textContent = fmtAngle(z.angle);
    renderSheets(); save();
  }
  if (t.dataset.cv) { state.cover[t.dataset.cv] = t.value; renderSheets(); save(); }
  if (t.dataset.zf) {
    const z = zoneById([...selection][0]);
    if (z) { z.filter = t.value in FILTERS ? t.value : 'none'; renderSheets(); save(); }
  }
  if (t.dataset.pr === 'cutLines') { state.print.cutLines = t.checked; renderSheets(); save(); return; }
  if (t.dataset.pr) {
    const v = parseFloat(String(t.value).replace(',', '.'));
    state.print[t.dataset.pr] = Number.isFinite(v) ? clamp(v, +t.min, +t.max) : 0;
    renderSheets(); save();
  }
});

/* ---------- Материалы: что этот продукт сообщает общему коду (shared.js) ---------- */
const APP = {
  paperChanged: zineGeometry, // бумагу сменили — пересчитать сетку
  key: 'zine',
  histIgnore: ['mode'],
  usedPhotos() {
    const used = new Set(state.zones.map(z => z.photo).filter(Boolean));
    if (state.box.photo) used.add(state.box.photo);
    return used;
  },
  pick(id) {
    if (state.mode === 'box') setBoxPhoto(id);
    else if (selection.size === 1) assign(zoneById([...selection][0]), id);
  },
  sanitize() {
    state.zones.forEach(z => { if (z.photo && !photos.has(z.photo)) z.photo = null; });
    if (state.box.photo && !photos.has(state.box.photo)) state.box.photo = null;
  },
  // после Undo/Redo: показать вкладку, где что-то изменилось; выделение — только существующие зоны
  afterRestore(prev) {
    if (JSON.stringify(prev.box) !== JSON.stringify(state.box)) state.mode = 'box';
    else if (JSON.stringify([prev.zones, prev.cover]) !== JSON.stringify([state.zones, state.cover])) state.mode = 'zine';
    selection = new Set([...selection].filter(zoneById));
    if (!selection.size) multiSelect = false;
    updateMultiBar();
  },
};

function assign(z, photoId) {
  Object.assign(z, { photo: photoId, ...focusFor(photoId), zoom: 1, rot: 0, angle: 0, mirror: false, filter: 'none' });
  changed();
}
/* ---------- Автозаполнение ----------
   Раскладывает свободные фото по пустым зонам так, чтобы фото обрезалось как можно меньше:
   альбомные — в широкие зоны, книжные — в высокие. Учитывается не форма файла, а форма
   «интересной области» (saliency.js): квадратное фото с башней по центру уйдёт в высокую зону.
   Стоимость пары «зона → фото»:
     потеря интересной области × вес зоны (число ячеек — панорамы важнее)
     + штраф за отход от исходного порядка фото (чтобы история не перемешивалась).
   Минимум суммарной стоимости ищется венгерским алгоритмом (точное решение, 32×N — мгновенно). */
const AUTOFILL_ORDER_WEIGHT = 0.35; // 0 — только форма, больше — строже держать порядок
function cropLoss(zoneAr, photoAr) { return 1 - Math.min(zoneAr / photoAr, photoAr / zoneAr); }
// Сколько «интересной области» фото не влезет в зону, если поставить кадр на неё;
// плюс немного общей обрезки — при прочих равных лучше фото, которое режется меньше
function fitCost(zoneAr, p) {
  const ap = p.w / p.h, wv = ap > zoneAr ? zoneAr / ap : 1, hv = ap > zoneAr ? 1 : ap / zoneAr;
  const s = p.sal || { x0: 0, y0: 0, x1: 1, y1: 1 }, cw = s.x1 - s.x0, ch = s.y1 - s.y0;
  const contentLoss = 1 - Math.min(cw, wv) * Math.min(ch, hv) / (cw * ch);
  return contentLoss + 0.25 * cropLoss(zoneAr, ap);
}

// Венгерский алгоритм: cost — n×m, n ≤ m; возвращает для каждой строки номер столбца
function hungarian(cost) {
  const n = cost.length, m = cost[0].length, INF = 1e18;
  const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(INF), used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const res = new Array(n);
  for (let j = 1; j <= m; j++) if (p[j]) res[p[j] - 1] = j - 1;
  return res;
}

function autofill() {
  const used = new Set(state.zones.map(z => z.photo).filter(Boolean));
  const free = library.filter(id => !used.has(id) && photos.has(id));
  const empty = state.zones.filter(z => !z.photo).sort((a, b) => Math.min(...a.cells.map(cellOrder)) - Math.min(...b.cells.map(cellOrder)));
  if (!free.length || !empty.length) return;
  const rank = (i, n) => n > 1 ? i / (n - 1) : 0.5;
  // столбцы: фото + «пустышки», если фото меньше, чем зон (такие зоны останутся пустыми;
  // обложку пустой оставлять дорого)
  const cols = Math.max(free.length, empty.length);
  const cost = empty.map((z, i) => {
    const R = zoneRect(z), zar = R.w / R.h, weight = z.cells.length;
    const row = free.map((id, j) => {
      const p = photos.get(id);
      return fitCost(zar, p) * weight + AUTOFILL_ORDER_WEIGHT * Math.abs(rank(i, empty.length) - rank(j, free.length));
    });
    while (row.length < cols) row.push(zoneKind(z) === 'cover' ? 100 : 0);
    return row;
  });
  hungarian(cost).forEach((j, i) => {
    if (j < free.length) Object.assign(empty[i], { photo: free[j], ...focusFor(free[j]), zoom: 1, rot: 0, angle: 0, mirror: false, filter: 'none' });
  });
  changed();
}

/* ---------- Импорт фото ---------- */
let zoneUploadTarget = null;
function pickForZone(z) { zoneUploadTarget = z.id; $('#zoneFileInput').click(); }
$('#zoneFileInput').addEventListener('change', async e => {
  const target = zoneUploadTarget;
  await importFiles(e.target.files, id => {
    if (target === 'box') return setBoxPhoto(id);
    const z = zoneById(target);
    if (z) assign(z, id);
  });
  e.target.value = '';
});

/* ---------- Взаимодействие с листами ---------- */
const sheets = $('#sheets');
let drag = null;
const touches = new Map(); // активные касания: pointerId → {x, y} (для щипка двумя пальцами)
const touchDist = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

sheets.addEventListener('pointerdown', e => {
  if (e.button !== 0 || state.mode === 'box') return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  // второй палец, пока первый держит фото, — масштаб щипком
  if (drag && touches.size === 2 && drag.z.photo && !drag.moving) {
    clearTimeout(drag.timer);
    capture(drag.el, e.pointerId);
    drag.pinch = { d0: touchDist(), zoom0: drag.z.zoom };
    drag.moved = true;
    return;
  }
  const el = e.target.closest('.zone');
  if (!el) { if (e.target.closest('.sheet') || e.target === sheets) { selection.clear(); setMultiSelect(false); renderSheets(); renderPanel(); } return; }
  const z = zoneById(el.dataset.id);
  drag = { el, z, x: e.clientX, y: e.clientY, fx0: z.fx, fy0: z.fy, moved: false, shift: e.shiftKey || e.ctrlKey || e.metaKey };
  capture(el, e.pointerId);
  // долгое нажатие без движения — выбрать ячейку и перейти в режим выбора нескольких
  const d = drag;
  d.timer = setTimeout(() => {
    if (drag !== d || d.moved) return;
    d.long = true;
    if (!multiSelect) selection.clear();
    selection.add(d.z.id);
    setMultiSelect(true);
    navigator.vibrate?.(15);
    renderSheets(); renderPanel();
  }, 450);
});
// долгое нажатие не должно открывать системное меню
sheets.addEventListener('contextmenu', e => { if (e.target.closest('.zone')) e.preventDefault(); });

sheets.addEventListener('pointermove', e => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!drag) return;
  if (drag.pinch) {
    if (touches.size < 2) return;
    drag.z.zoom = clamp(drag.pinch.zoom0 * touchDist() / drag.pinch.d0, 1, 5);
    applyImg(drag.el.querySelector('img'), drag.z);
    const sl = $('[data-act="zoom"]'); if (sl) sl.value = drag.z.zoom;
    return;
  }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (drag.long || (!drag.moved && Math.hypot(dx, dy) < 4)) return;
  clearTimeout(drag.timer);
  if (!drag.z.photo) return;
  drag.moved = true;
  // перенос в другую ячейку включается, только когда курсор дошёл до середины другой ячейки —
  // иначе это обычное панорамирование, даже если мышь вышла за край своей ячейки
  if (!drag.moving) {
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('.zone');
    if (t && t !== drag.el && nearCenter(t, e)) startPhotoMove();
  }
  if (drag.moving) return movePhotoGhost(e);
  const r = drag.el.getBoundingClientRect();
  drag.el.classList.add('panning');
  const { R, wr, hr } = imageFit(drag.z), box = r, sign = zoneDown(drag.z) ? -1 : 1;
  // сдвиг мыши в мм зоны → в систему наклонённого фото
  const mx = sign * dx / box.width * R.w, my = sign * dy / box.height * R.h;
  const a = (drag.z.angle || 0) * Math.PI / 180, ix = mx * Math.cos(a) + my * Math.sin(a), iy = -mx * Math.sin(a) + my * Math.cos(a);
  drag.z.fx -= ix / (wr * R.w);
  drag.z.fy -= iy / (hr * R.h);
  drag.x = e.clientX; drag.y = e.clientY;
  applyImg(drag.el.querySelector('img'), drag.z);
});

function endPointer(e, cancelled) {
  touches.delete(e.pointerId);
  if (!drag) return;
  if (drag.pinch) {
    if (touches.size < 2) { drag = null; save(); renderSheets(); }
    return;
  }
  const { z, moved, shift, long, timer, moving } = drag;
  clearTimeout(timer);
  if (moving) return finishPhotoMove(e, cancelled);
  drag = null;
  if (long || cancelled) return; // уже выбрано долгим нажатием / жест прерван
  if (moved) { save(); renderSheets(); return; }
  if (shift || multiSelect) selection.has(z.id) ? selection.delete(z.id) : selection.add(z.id);
  else selection = new Set([z.id]);
  if (multiSelect && !selection.size) setMultiSelect(false);
  renderSheets(); renderPanel();
}
sheets.addEventListener('pointerup', e => endPointer(e, false));
sheets.addEventListener('pointercancel', e => endPointer(e, true));

/* ---------- Перенос фото между ячейками ---------- */
let ghost = null;
function startPhotoMove() {
  drag.moving = true;
  Object.assign(drag.z, { fx: drag.fx0, fy: drag.fy0 }); // кадр в исходной ячейке не трогаем
  applyImg(drag.el.querySelector('img'), drag.z);
  drag.el.classList.remove('panning');
  drag.el.classList.add('moving-src');
  ghost = document.createElement('img');
  ghost.className = 'drag-ghost';
  ghost.src = photos.get(drag.z.photo).url;
  document.body.appendChild(ghost);
}
function movePhotoGhost(e) {
  ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.zone');
  sheets.querySelectorAll('.drop-hover').forEach(x => x !== target && x.classList.remove('drop-hover'));
  if (target && target !== drag.el) target.classList.add('drop-hover');
}
function finishPhotoMove(e, cancelled) {
  const src = drag.z;
  const el = cancelled ? null : document.elementFromPoint(e.clientX, e.clientY)?.closest('.zone');
  ghost?.remove(); ghost = null;
  drag = null;
  const dst = el && zoneById(el.dataset.id);
  if (dst && dst !== src) { swapPhotos(src, dst); selection = new Set([dst.id]); changed(); }
  else renderSheets();
}
// фото меняются местами (если ячейка пустая — просто переезжает); поворот и наклон едут с фото
function swapPhotos(a, b) {
  const pa = { photo: a.photo, rot: a.rot || 0, angle: a.angle || 0, mirror: !!a.mirror, filter: a.filter || 'none' };
  const pb = { photo: b.photo, rot: b.rot || 0, angle: b.angle || 0, mirror: !!b.mirror, filter: b.filter || 'none' };
  const put = (z, p) => Object.assign(z, p.photo ? { photo: p.photo, ...focusFor(p.photo, p.rot, p.mirror), zoom: 1, rot: p.rot, angle: p.angle, mirror: p.mirror, filter: p.filter } : { photo: null, filter: 'none' });
  put(a, pb); put(b, pa);
}
sheets.addEventListener('dblclick', e => {
  if (state.mode === 'box') return;
  const el = e.target.closest('.zone');
  if (el) pickForZone(zoneById(el.dataset.id));
});
sheets.addEventListener('wheel', e => {
  if (state.mode === 'box') return;
  const el = e.target.closest('.zone.selected.has-photo');
  if (!el) return;
  e.preventDefault();
  const z = zoneById(el.dataset.id);
  z.zoom = clamp(z.zoom * Math.exp(-e.deltaY * 0.0015), 1, 5);
  applyImg(el.querySelector('img'), z);
  const slider = $('[data-act="zoom"]'); if (slider) slider.value = z.zoom;
  save();
}, { passive: false });

sheets.addEventListener('dragover', e => {
  if (state.mode === 'box') return;
  const el = e.target.closest('.zone');
  const t = e.dataTransfer.types;
  if (!el || !(t.includes('Files') || t.includes(PHOTO_MIME))) return;
  e.preventDefault();
  sheets.querySelectorAll('.drop-hover').forEach(x => x !== el && x.classList.remove('drop-hover'));
  el.classList.add('drop-hover');
});
sheets.addEventListener('dragleave', e => { if (!sheets.contains(e.relatedTarget)) sheets.querySelectorAll('.drop-hover').forEach(x => x.classList.remove('drop-hover')); });
sheets.addEventListener('drop', async e => {
  if (state.mode === 'box') return;
  const el = e.target.closest('.zone');
  if (!el) return;
  e.preventDefault();
  const zId = el.dataset.id;
  const pid = e.dataTransfer.getData(PHOTO_MIME);
  if (pid) { assign(zoneById(zId), pid); return; }
  await importFiles(e.dataTransfer.files, id => { const z = zoneById(zId); if (z) assign(z, id); });
});

document.addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea') || state.mode === 'box') return;
  if (e.key === 'Escape') { selection.clear(); setMultiSelect(false); renderSheets(); renderPanel(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size) {
    selection.forEach(id => { const z = zoneById(id); if (z) z.photo = null; });
    changed();
  }
  if (e.key.toLowerCase() === 'm' && selection.size > 1) mergeSelected();
});

$('#numbersToggle').addEventListener('change', renderSheets);

/* ---------- Узкий экран: переключатель сторон и множественный выбор ---------- */
function showSide(side, smooth) {
  currentSide = side;
  const host = $('#sheets');
  host.scrollTo({ left: side * host.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  document.querySelectorAll('#sideSwitch [data-side]').forEach(b => b.classList.toggle('active', +b.dataset.side === side));
}
$('#sideSwitch').addEventListener('click', e => {
  const b = e.target.closest('[data-side]');
  if (b) showSide(+b.dataset.side, true);
});
// свайп между сторонами (по промежутку между листами) — обновляем переключатель
$('#sheets').addEventListener('scroll', () => {
  const host = $('#sheets');
  if (!host.clientWidth || state.mode === 'box') return;
  const side = Math.round(host.scrollLeft / host.clientWidth);
  if (side !== currentSide && side >= 0 && side <= 1) {
    currentSide = side;
    document.querySelectorAll('#sideSwitch [data-side]').forEach(b => b.classList.toggle('active', +b.dataset.side === side));
  }
}, { passive: true });
window.addEventListener('resize', () => { $('#sheets').scrollLeft = currentSide * $('#sheets').clientWidth; });
// плашка «✕ N selected» видна в режиме выбора нескольких; ✕ — выйти и снять выделение
function setMultiSelect(on) {
  multiSelect = on;
  updateMultiBar();
}
function updateMultiBar() {
  $('#multiBtn').hidden = !multiSelect;
  $('#multiCount').textContent = `${selection.size} selected`;
}
$('#multiBtn').addEventListener('click', () => { selection.clear(); setMultiSelect(false); renderSheets(); renderPanel(); });
$('#autofillBtn').addEventListener('click', autofill);
// Очистить: убрать фото из ячеек; сетка, обложка и материалы остаются
$('#resetBtn').addEventListener('click', () => {
  if (state.mode === 'box') {
    if (state.box.photo) { state.box.photo = null; changed(); }
    return;
  }
  if (!state.zones.some(z => z.photo)) return;
  state.zones.forEach(z => { z.photo = null; });
  changed();
});
// Сбросить сетку: разделить все объединённые зоны; фото остаётся на первой странице зоны
$('#mergeAllBtn').addEventListener('click', mergeAll);
$('#randomBtn').addEventListener('click', randomizeLayout);
$('#resetGridBtn').addEventListener('click', () => {
  const merged = state.zones.filter(z => z.cells.length > 1 || z.flip);
  if (!merged.length) return;
  state.zones = state.zones.flatMap(z => {
    if (z.cells.length === 1) return [{ ...z, flip: false }];
    const parts = [...z.cells].sort((a, b) => cellOrder(a) - cellOrder(b)).map(id => newZone([id]));
    parts[0].photo = z.photo; parts[0].filter = z.filter || 'none';
    return parts;
  });
  selection.clear();
  changed();
});

/* ---------- Экспорт PDF (300 dpi) ---------- */
async function renderSide(side, dpi) {
  const k = dpi / 25.4, W = Math.round(PW * k), H = Math.round(PH * k);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  // компенсация неточности двусторонней печати: вся сторона 2 сдвигается
  if (side === 1) ctx.translate(state.print.offX * k, state.print.offY * k);
  ctx.imageSmoothingQuality = 'high';
  for (const z of state.zones.filter(z => zoneSide(z) === side)) {
    const R = zoneRect(z);
    ctx.save();
    ctx.beginPath(); ctx.rect(R.x * k, R.y * k, R.w * k, R.h * k); ctx.clip();
    ctx.translate((R.x + R.w / 2) * k, (R.y + R.h / 2) * k);
    if (zoneDown(z)) ctx.rotate(Math.PI);
    if (z.photo && photos.has(z.photo)) {
      const { p, s } = imageFit(z), [pw, ph] = rotDims(p, z.rot);
      const bmp = await createImageBitmap(p.blob);
      // повёрнутое фото: ставим его центр, поворачиваем и рисуем в исходной ориентации
      const dw = pw * s * k, dh = ph * s * k;
      ctx.save();
      ctx.rotate((z.angle || 0) * Math.PI / 180); // наклон вокруг центра зоны
      ctx.translate(-z.fx * dw + dw / 2, -z.fy * dh + dh / 2);
      if (z.mirror) ctx.scale(-1, 1);
      ctx.rotate((z.rot || 0) * Math.PI / 180);
      ctx.drawImage(bmp, -p.w * s * k / 2, -p.h * s * k / 2, p.w * s * k, p.h * s * k);
      ctx.restore();
      bmp.close();
      // фильтр — только по прямоугольнику зоны (в пикселях листа; сторона 2 сдвинута на offX/offY)
      const dx = side === 1 ? state.print.offX : 0, dy = side === 1 ? state.print.offY : 0;
      applyFilterRect(ctx, (R.x + dx) * k, (R.y + dy) * k, R.w * k, R.h * k, FILTERS[z.filter]?.m);
    }
    if (zoneKind(z) === 'cover') {
      ctx.translate(-R.w / 2 * k, -R.h / 2 * k); ctx.scale(k, k);
      ctx.fillStyle = state.cover.color; ctx.textBaseline = 'alphabetic';
      for (const t of coverTextLayout(R.w, R.h, state.cover)) {
        ctx.font = `${t.weight} ${t.size}px "Ubuntu Sans", sans-serif`;
        ctx.textAlign = { start: 'left', middle: 'center', end: 'right' }[t.anchor];
        ctx.fillText(t.text, t.x, t.y);
      }
    }
    ctx.restore();
  }
  // линии реза: серый пунктир по середине белых промежутков, только на стороне 1
  if (side === 0 && state.print.cutLines) {
    ctx.save(); ctx.scale(k, k);
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.5)'; ctx.lineWidth = 0.2; ctx.setLineDash([1.4, 1]);
    CUTS.forEach(c => { ctx.beginPath(); ctx.moveTo(c.x0, c.y); ctx.lineTo(c.x1, c.y); ctx.stroke(); });
    ctx.restore();
  }
  return cv;
}

// «Print» открывает/закрывает настройки печати в правой колонке
$('#exportBtn').addEventListener('click', () => {
  printPanel = !printPanel;
  if (printPanel) selection.clear();
  renderSheets(); renderPanel();
});
const zineFileName = () => (state.cover.title || 'zine').replace(/[^\p{L}\p{N}_-]+/gu, '_');
// Две стороны листа отдельными картинками (JPG, 300 dpi) — одним ZIP
function exportZineImages() {
  return busy('Preparing images…', async () => {
    const files = [];
    for (const side of [0, 1]) {
      $('#busyText').textContent = `Preparing images… side ${side + 1} of 2`;
      const cv = await renderSide(side, 300);
      files.push({ blob: await withDpi(await canvasBlob(cv, 'image/jpeg', 0.95), 300), name: `${zineFileName()}_${paper.name}_side-${side + 1}.jpg` });
    }
    await downloadFiles(files, `${zineFileName()}_${paper.name}.zip`);
  });
}
async function exportZinePdf() {
  $('#busy').hidden = false;
  try {
    await Promise.all(['700 20px "Ubuntu Sans"', '500 20px "Ubuntu Sans"'].map(f => document.fonts.load(f)));
    const pages = [];
    for (const side of [0, 1]) {
      $('#busyText').textContent = `Preparing PDF… side ${side + 1} of 2`;
      const cv = await renderSide(side, 300);
      pages.push({ bytes: new Uint8Array(await (await canvasBlob(cv, 'image/jpeg', 0.93)).arrayBuffer()), W: cv.width, H: cv.height });
    }
    download(makePdf(pages), `${zineFileName()}.pdf`);
  } catch (err) {
    alert('Export failed: ' + err.message);
  } finally { $('#busy').hidden = true; }
}

/* ---------- Запуск (хранение, материалы и Undo — в shared.js) ---------- */
async function init() {
  const saved = await loadStudio();
  if (saved?.v === 1) {
    state = saved;
    state.cover = { ...freshState().cover, ...state.cover };
    // старые сохранения были с рамкой 0 по умолчанию — переводим на новое значение
    if (state.print?.v !== 2) state.print = { ...state.print, v: 2, margin: 2.5 };
    state.print = { ...freshState().print, ...state.print };
    state.mode = state.mode === 'box' ? 'box' : 'zine';
    state.box = { ...freshBox(), ...state.box };
    // раньше фильтр был один на весь зин — переносим его на каждую зону
    state.zones.forEach(z => { z.filter = (z.filter || state.filter) in FILTERS ? z.filter || state.filter : 'none'; });
    delete state.filter;
    APP.sanitize();
  }
  changed();
  histReset();
  analyzeMissing();
}
// init после загрузки всех скриптов (box.js)
window.addEventListener('DOMContentLoaded', init);
// после загрузки шрифта ширины названия меняются — перерисовать обложку
// (не раньше загрузки страницы: шрифт из кэша готов ещё до box.js)
window.addEventListener('DOMContentLoaded', () => document.fonts.load('700 20px "Ubuntu Sans"').then(() => renderSheets()));
