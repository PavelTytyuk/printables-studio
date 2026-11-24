'use strict';

/* ---------- Strip Studio: фотострипы (ряд или колонка фото) ----------
   Все размеры в мм. Стрип = фон + рамка + N кадров с промежутками + подпись у края. */
const DPI = 300;
const PRESETS = [
  { id: 'booth4', name: 'Photo booth · 2×6 in · 4 photos', w: 50.8, h: 152.4, count: 4, dir: 'col' },
  { id: 'booth3', name: 'Photo booth · 2×6 in · 3 photos', w: 50.8, h: 152.4, count: 3, dir: 'col' },
  { id: 'mini3', name: 'Mini · 35×105 mm · 3 photos', w: 35, h: 105, count: 3, dir: 'col' },
  { id: 'row3', name: 'Row · 150×50 mm · 3 photos', w: 150, h: 50, count: 3, dir: 'row' },
  { id: 'row4', name: 'Row · 180×45 mm · 4 photos', w: 180, h: 45, count: 4, dir: 'row' },
  // Polaroid 600: карточка 88×107, кадр 79×79, внизу широкое поле для подписи
  { id: 'polaroid', name: 'Polaroid · 88×107 mm · 1 photo', w: 88, h: 107, count: 1, dir: 'col', border: 4.5, cap: { pos: 'bottom', h: 23.5 } },
];
// листы для раскладки: бумага (A4 или Letter, см. shared.js) и область Print Then Cut у Cricut (6.75×9.25 in)
const printSheet = () => ({ w: paper.w, h: paper.h, margin: 8, gap: 6 });
const CRICUT = { w: 171.4, h: 234.9, margin: 0, gap: 5 };
const LIMITS = { w: [15, 290], h: [15, 290], count: [1, 12], border: [0, 20], gap: [0, 20] };
const CAP_LIMITS = { size: [2, 12], h: [4, 40] };

// фильтры фото (FILTERS) — в shared.js
/* ---------- Состояние ---------- */
const newSlot = () => ({ id: uid(), photo: null, fx: 0.5, fy: 0.5, zoom: 1, rot: 0, angle: 0 });
const newStrip = (p = PRESETS[0]) => ({
  id: uid(), w: p.w, h: p.h, count: p.count, dir: p.dir, border: 3, gap: 3, color: '#ffffff',
  filter: 'none',
  cap: { text: '', date: '', pos: 'bottom', align: 'center', size: 4, color: '#1f1d1a', h: 12, blank: false },
  slots: Array.from({ length: p.count }, newSlot),
});
const freshState = () => {
  const s = newStrip();
  return { v: 1, strips: [s], active: s.id, exp: { mode: 'images', format: 'png', copies: 1, marks: true, bleed: true, imgBleed: false } };
};
let state = freshState();
let selected = null;      // id выбранного кадра
let exportPanel = false;  // правая колонка показывает настройки экспорта

const fmt = v => +(+v).toFixed(1);
const isNarrow = () => matchMedia('(max-width: 1100px)').matches;
const activeStrip = () => state.strips.find(s => s.id === state.active) || state.strips[0];
const stripSlots = s => s.slots.slice(0, s.count); // лишние кадры хранятся — вернутся, если снова увеличить число фото
const hasCaption = s => !!(s.cap.blank || s.cap.text.trim() || s.cap.date.trim()); // blank — пустое место, чтобы подписать от руки
function findSlot(id) {
  for (const s of state.strips) {
    const i = stripSlots(s).findIndex(x => x.id === id);
    if (i >= 0) return { s, i, slot: s.slots[i], R: stripLayout(s).rects[i] };
  }
  return null;
}

/* ---------- Геометрия ---------- */
// Подпись занимает полосу у верхнего или нижнего края (вместо рамки с этой стороны)
function stripLayout(s) {
  const b = s.border, cap = hasCaption(s), capH = Math.max(b, s.cap.h);
  const top = cap && s.cap.pos === 'top' ? capH : b, bottom = cap && s.cap.pos !== 'top' ? capH : b;
  const ax = b, ay = top, aw = Math.max(1, s.w - 2 * b), ah = Math.max(1, s.h - top - bottom), n = s.count;
  const rects = [];
  if (s.dir === 'row') {
    const cw = Math.max(0.5, (aw - s.gap * (n - 1)) / n);
    for (let i = 0; i < n; i++) rects.push({ x: ax + i * (cw + s.gap), y: ay, w: cw, h: ah });
  } else {
    const ch = Math.max(0.5, (ah - s.gap * (n - 1)) / n);
    for (let i = 0; i < n; i++) rects.push({ x: ax, y: ay + i * (ch + s.gap), w: aw, h: ch });
  }
  return { rects, cap: cap ? { x: 0, y: s.cap.pos === 'top' ? 0 : s.h - capH, w: s.w, h: capH } : null };
}

// Масштаб «cover» + зум, с учётом поворота на 90° и свободного наклона; зажимает фокус
function imageFit(z, R) {
  const p = photos.get(z.photo), [pw, ph] = rotDims(p, z.rot);
  const a = (z.angle || 0) * Math.PI / 180, ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
  const BW = R.w * ca + R.h * sa, BH = R.w * sa + R.h * ca;
  const s = Math.max(BW / pw, BH / ph) * z.zoom;
  const wr = pw * s / R.w, hr = ph * s / R.h;
  const hx = BW / 2 / (pw * s), hy = BH / 2 / (ph * s);
  z.fx = clamp(z.fx, hx, 1 - hx);
  z.fy = clamp(z.fy, hy, 1 - hy);
  return { p, s, wr, hr };
}
function applyImg(img, z, R) {
  const { wr, hr } = imageFit(z, R), rot = z.rot || 0;
  Object.assign(img.parentElement.style, {
    width: wr * 100 + '%', height: hr * 100 + '%',
    left: (0.5 - z.fx * wr) * 100 + '%', top: (0.5 - z.fy * hr) * 100 + '%',
    transformOrigin: `${z.fx * 100}% ${z.fy * 100}%`,
    transform: z.angle ? `rotate(${z.angle}deg)` : '',
  });
  const W = wr * R.w, H = hr * R.h, [iw, ih] = rot % 180 ? [H, W] : [W, H];
  Object.assign(img.style, {
    width: iw / W * 100 + '%', height: ih / H * 100 + '%',
    left: (W - iw) / 2 / W * 100 + '%', top: (H - ih) / 2 / H * 100 + '%',
    transform: imgTransform(z),
  });
}

/* ---------- Подпись ---------- */
// Строки подписи (текст + дата помельче), по центру полосы; длинная строка ужимается по ширине
function captionLayout(s) {
  const L = stripLayout(s);
  if (!L.cap) return [];
  const c = s.cap, pad = Math.max(s.border, 2), maxW = Math.max(1, s.w - 2 * pad), lines = [];
  if (c.text.trim()) lines.push({ text: c.text.trim(), weight: 700, size: c.size });
  if (c.date.trim()) lines.push({ text: c.date.trim(), weight: 500, size: c.size * 0.7 });
  lines.forEach(l => { const w = textWidth(l.text, l.size, l.weight); if (w > maxW) l.size *= maxW / w; });
  const LH = 1.25, total = lines.reduce((a, l) => a + l.size * LH, 0);
  let y = L.cap.y + (L.cap.h - total) / 2;
  const x = c.align === 'left' ? pad : c.align === 'right' ? s.w - pad : s.w / 2;
  const anchor = c.align === 'left' ? 'start' : c.align === 'right' ? 'end' : 'middle';
  return lines.map(l => { const t = { ...l, x, anchor, y: y + l.size * LH * 0.78 }; y += l.size * LH; return t; });
}

/* ---------- Отрисовка ---------- */
// px на мм. Широкий экран: общий масштаб для всех стрипов (видно их настоящее соотношение);
// узкий: каждый стрип вписан в экран, между ними листаем
function viewScale(s) {
  const host = $('#sheets');
  if (isNarrow()) return Math.max(0.5, Math.min((host.clientWidth - 28) / s.w, (host.clientHeight - 28) / s.h));
  // самый большой стрип вписан в окно; от числа стрипов масштаб не зависит — лишние уходят в прокрутку
  const maxH = Math.max(...state.strips.map(x => x.h)), maxW = Math.max(...state.strips.map(x => x.w));
  return clamp(Math.min((host.clientHeight - 36 - 44) / maxH, (host.clientWidth - 36) / maxW), 1.4, 6);
}
function stripHtml(s) {
  const k = viewScale(s), L = stripLayout(s);
  const slots = stripSlots(s).map((z, i) => {
    const R = L.rects[i], p = z.photo && photos.get(z.photo);
    return `<div class="zone${p ? ' has-photo' : ''}${selected === z.id ? ' selected' : ''}" data-id="${z.id}"
      style="left:${R.x / s.w * 100}%;top:${R.y / s.h * 100}%;width:${R.w / s.w * 100}%;height:${R.h / s.h * 100}%">
      <div class="zone-inner"${p && FILTERS[s.filter].m ? ` style="filter:url(#flt-${s.filter})"` : ''}>${p ? `<div class="ph"><img src="${p.url}" alt="" draggable="false"></div>` : `<div class="zone-empty"><b>+</b><span>${i + 1}</span></div>`}</div></div>`;
  }).join('');
  const cap = captionLayout(s).map(t => `<text x="${t.x}" y="${t.y}" font-size="${t.size}" font-weight="${t.weight}" text-anchor="${t.anchor}">${esc(t.text)}</text>`).join('');
  return `<div class="strip${state.strips.length > 1 && s.id === state.active ? ' active' : ''}" data-strip="${s.id}"
    style="--ar:${s.w / s.h};width:${s.w * k}px;height:${s.h * k}px;background:${esc(s.color)}">${slots}
    ${cap ? `<svg class="cap-svg" viewBox="0 0 ${s.w} ${s.h}" fill="${esc(s.cap.color)}" font-family="'Ubuntu Sans', sans-serif">${cap}</svg>` : ''}</div>`;
}
function renderSheets() {
  const host = $('#sheets'), idx = Math.max(0, state.strips.indexOf(activeStrip()));
  host.innerHTML = state.strips.map((s, i) => `<div class="sheet-col" data-strip="${s.id}">
    <div class="sheet-cap">Strip ${i + 1} · ${fmt(s.w)} × ${fmt(s.h)} mm</div>${stripHtml(s)}</div>`).join('')
    + '<div class="sheet-col add-col"><button class="add-strip" data-add>+ Add strip</button></div>';
  host.querySelectorAll('.zone.has-photo').forEach(el => { const t = findSlot(el.dataset.id); applyImg(el.querySelector('img'), t.slot, t.R); });
  $('#stripSeg').innerHTML = state.strips.map((s, i) => `<button data-strip="${s.id}" class="${i === idx ? 'active' : ''}">${i + 1}</button>`).join('')
    + '<button data-add title="Add strip">+</button>';
  if (isNarrow()) host.scrollLeft = idx * host.clientWidth;
}

/* ---------- Боковая панель ---------- */
const opt = (v, cur, label = v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
function renderPanel() {
  $('#exportBtn').classList.toggle('active', exportPanel);
  if (exportPanel) return renderExportPanel();
  const s = activeStrip(), t = selected && findSlot(selected), c = s.cap;
  let html = '';
  if (t) {
    const z = t.slot;
    html += `<div class="sec"><div class="zone-title">Photo ${t.i + 1}</div>
      ${z.photo ? '' : '<button class="btn block" data-act="upload">Upload photo</button>'}
      ${z.photo ? `<label class="f">Zoom<input type="range" min="1" max="5" step="0.01" value="${z.zoom}" data-act="zoom"></label>
      <div class="row"><button class="btn" data-act="center">Reset framing</button><button class="btn" data-act="remove">Remove photo</button></div>
      ${rotateRow('data-act')}
      <label class="f"><span class="label-row">Adjust angle: <output id="angleOut">${fmtAngle(z.angle)}</output><button type="button" class="icon-btn" data-act="angle0" title="Reset angle" aria-label="Reset angle">↺</button></span><input type="range" min="-45" max="45" step="0.5" value="${z.angle || 0}" data-act="angle"></label>` : ''}</div>`;
  } else {
    html += `<div class="sec mobile-only"><p class="note">Tap a frame to select it, then tap a photo in Materials to put it there. Drag a photo to reframe it, pinch to zoom.</p></div>
      <div class="sec desktop-only"><h3>How it works</h3><ul class="legend">
      <li>Set the strip size and the number of photos below</li>
      <li>Drag photos from Materials onto frames</li>
      <li>Drag a photo to reframe it; scroll wheel to zoom</li>
      <li>Drag a photo onto another frame to swap them</li>
      <li>Export gives you images or a ready-to-print sheet</li></ul></div>`;
  }
  const preset = presetOf(s);
  html += `<div class="sec"><h3>Strip ${state.strips.indexOf(s) + 1}</h3>
    <label class="f">Preset<select data-st="preset">${PRESETS.map(p => opt(p.id, preset?.id, p.name)).join('')}${preset ? '' : '<option selected>Custom</option>'}</select></label>
    <div class="row"><label class="f">Width, mm<input type="number" min="15" max="290" step="0.1" value="${fmt(s.w)}" data-st="w"></label>
    <label class="f">Height, mm<input type="number" min="15" max="290" step="0.1" value="${fmt(s.h)}" data-st="h"></label></div>
    <div class="row"><label class="f">Photos<input type="number" min="1" max="12" step="1" value="${s.count}" data-st="count"></label>
    <label class="f">Direction<select data-st="dir">${opt('col', s.dir, 'column')}${opt('row', s.dir, 'row')}</select></label></div>
    <p class="note" id="frameNote"></p></div>
    <div class="sec"><h3>Photo look</h3>
    <label class="f">Filter<select data-st="filter">${Object.entries(FILTERS).map(([id, f]) => opt(id, s.filter, f.name)).join('')}</select></label></div>
    <div class="sec"><h3>Border &amp; gaps</h3>
    <div class="row"><label class="f">Border, mm<input type="number" min="0" max="20" step="0.5" value="${s.border}" data-st="border"></label>
    <label class="f">Gap, mm<input type="number" min="0" max="20" step="0.5" value="${s.gap}" data-st="gap"></label></div>
    <label class="f">Background<input type="color" value="${esc(s.color)}" data-st="color"></label></div>
    <div class="sec"><h3>Caption</h3>
    <label class="f">Text<input type="text" data-cap="text" value="${esc(c.text)}" placeholder="Caption"></label>
    <label class="f">Date<input type="text" data-cap="date" value="${esc(c.date)}" placeholder="${datePlaceholder()}"></label>
    ${dateSuggest(s)}
    <div class="row"><label class="f">Position<select data-cap="pos">${opt('bottom', c.pos)}${opt('top', c.pos)}</select></label>
    <label class="f">Alignment<select data-cap="align">${opt('left', c.align)}${opt('center', c.align)}${opt('right', c.align)}</select></label></div>
    <div class="row"><label class="f">Text size<input type="range" min="2" max="12" step="0.25" value="${c.size}" data-cap="size"></label>
    <label class="f">Color<input type="color" value="${esc(c.color)}" data-cap="color"></label></div>
    <label class="f">Caption area height, mm<input type="number" min="4" max="40" step="0.5" value="${c.h}" data-cap="h"></label>
    <label class="f check"><input type="checkbox" data-cap="blank" ${c.blank ? 'checked' : ''}> Keep the area empty for handwriting</label>
    <p class="note">The caption area appears once you type a text or a date, or tick the box to leave blank space to write on by hand.</p></div>
    <div class="sec"><div class="row"><button class="btn" data-act="duplicate">Duplicate strip</button>
    <button class="btn" data-act="deleteStrip" ${state.strips.length > 1 ? '' : 'disabled'}>Delete strip</button></div></div>`;
  $('#panel').innerHTML = html;
  updateFrameNote();
}
// Даты съёмки фото этого стрипа (из EXIF) — кнопки «Set 14.08.2026» под полем даты
const fmtDate = d => d.split('-').reverse().join('.');
function dateSuggest(s) {
  const ids = stripSlots(s).map(z => z.photo).filter(id => photos.has(id));
  ensureDates(ids, () => { if (!exportPanel && activeStrip() === s) renderPanel(); });
  const dates = [...new Set(ids.map(id => photos.get(id).taken).filter(Boolean))].map(fmtDate).filter(d => d !== s.cap.date.trim());
  return dates.length ? `<div class="date-suggest">${dates.slice(0, 3).map(d => `<button type="button" class="chip" data-act="setDate" data-date="${d}" title="Date the photo was taken">Set ${d}</button>`).join('')}</div>` : '';
}
const datePlaceholder = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };
function updateFrameNote() {
  const el = $('#frameNote'), R = stripLayout(activeStrip()).rects[0];
  if (el) el.textContent = `Each photo: ${fmt(R.w)} × ${fmt(R.h)} mm`;
}

function deleteStrip(s) {
  if (state.strips.length < 2) return;
  const i = state.strips.indexOf(s);
  state.strips.splice(i, 1);
  state.active = state.strips[Math.min(i, state.strips.length - 1)].id; selected = null; changed();
}

const panel = $('#panel');
panel.addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act || e.target.matches('input[type=range]')) return;
  const s = activeStrip(), t = selected && findSlot(selected), z = t?.slot;
  if (act === 'closeExport') { exportPanel = false; renderPanel(); }
  else if (act === 'dlActive') exportImages([s]);
  else if (act === 'dlAll') exportImages(state.strips);
  else if (act === 'dlA4') exportA4();
  else if (act === 'dlCricut') exportCricut();
  else if (act === 'duplicate') {
    const copy = JSON.parse(JSON.stringify(s));
    copy.id = uid(); copy.slots.forEach(x => { x.id = uid(); });
    state.strips.splice(state.strips.indexOf(s) + 1, 0, copy);
    state.active = copy.id; selected = null; changed();
  } else if (act === 'deleteStrip') deleteStrip(s);
  else if (act === 'setDate') { s.cap.date = e.target.closest('[data-act]').dataset.date; changed(); }
  else if (!z) return;
  else if (act === 'upload') pickForSlot(z);
  else if (act === 'remove') { z.photo = null; changed(); }
  else if (act === 'center') { Object.assign(z, focusFor(z.photo, z.rot, z.mirror), { zoom: 1 }); changed(); }
  else if (act === 'angle0') { z.angle = 0; changed(); }
  else if (act === 'rotl' || act === 'rotr') { rotatePhoto(z, act === 'rotr' ? 1 : -1); changed(); }
  else if (act === 'mirror') { mirrorPhoto(z); changed(); }
});
// ввод в полях: модель и превью обновляются сразу, панель перерисовывается только по change (чтобы не терять фокус)
panel.addEventListener('input', e => {
  const el = e.target, s = activeStrip(), t = selected && findSlot(selected);
  if (el.dataset.act === 'zoom' && t) { t.slot.zoom = +el.value; }
  else if (el.dataset.act === 'angle' && t) { t.slot.angle = +el.value; $('#angleOut').textContent = fmtAngle(t.slot.angle); }
  else if (el.dataset.st) {
    const key = el.dataset.st;
    if (key === 'preset') {
      const p = PRESETS.find(x => x.id === el.value), was = presetOf(s);
      if (p) {
        setShape(s, p);
        if (p.cap) Object.assign(s.cap, p.cap, { blank: true }); // поле для подписи видно и пустым — подписать от руки
        else if (was?.cap) { const d = newStrip().cap; Object.assign(s.cap, { pos: d.pos, h: d.h, blank: false }); s.border = 3; } // уходим с Polaroid — обычные поля
        if (p.border != null) s.border = p.border;
      }
    }
    else if (key === 'dir') { s.dir = el.value; if ((s.dir === 'row') !== (s.w > s.h)) [s.w, s.h] = [s.h, s.w]; }
    else if (key === 'color' || key === 'filter') s[key] = el.value;
    else {
      const v = parseFloat(el.value);
      if (!Number.isFinite(v)) return;
      if (key === 'count') setShape(s, { count: Math.round(clamp(v, ...LIMITS.count)) });
      else s[key] = clamp(v, ...LIMITS[key]);
    }
  } else if (el.dataset.cap) {
    const key = el.dataset.cap;
    if (key in CAP_LIMITS) { const v = parseFloat(el.value); if (!Number.isFinite(v)) return; s.cap[key] = clamp(v, ...CAP_LIMITS[key]); }
    else s.cap[key] = key === 'blank' ? el.checked : el.value;
  } else if (el.dataset.ex) {
    const key = el.dataset.ex;
    state.exp[key] = el.type === 'checkbox' ? el.checked : key === 'copies' ? Math.round(clamp(parseFloat(el.value) || 1, 1, 20)) : el.value;
    if (key === 'mode' || key === 'format' || key === 'imgBleed') renderPanel(); else updatePackDiagram();
    save();
    return;
  } else return;
  renderSheets(); updateFrameNote(); save();
});
panel.addEventListener('change', e => {
  if (e.target.matches('select, input[type=number]') && !e.target.dataset.ex) { renderPanel(); renderLibrary(); }
  if (e.target.dataset.ex === 'copies') renderPanel();
});
// пресет, которому соответствует стрип; у пресетов с подписью (Polaroid) учитываются и поля
const presetOf = s => PRESETS.find(p => p.w === s.w && p.h === s.h && p.count === s.count && p.dir === s.dir
  && (p.border == null || p.border === s.border)
  && (!p.cap || (hasCaption(s) && p.cap.h === s.cap.h && p.cap.pos === s.cap.pos)));
function setShape(s, { w = s.w, h = s.h, count = s.count, dir = s.dir }) {
  Object.assign(s, { w, h, count, dir });
  while (s.slots.length < s.count) s.slots.push(newSlot());
  if (selected && !findSlot(selected)) selected = null;
}

/* ---------- Материалы: что этот продукт сообщает общему коду (shared.js) ---------- */
const APP = {
  key: 'strip',
  histIgnore: ['active', 'exp'],
  usedPhotos() {
    const used = new Set();
    state.strips.forEach(s => stripSlots(s).forEach(z => { if (z.photo) used.add(z.photo); }));
    return used;
  },
  // тап по фото кладёт его в выбранный кадр; выбор переходит на следующий пустой — можно заполнять стрип подряд
  pick(id) {
    const t = selected && findSlot(selected);
    if (!t) {
      // выбран сам стрип, без кадра: фото — в первый пустой кадр, а если пустых нет — в первый.
      // Кадр не выделяем, чтобы следующие клики заполняли стрип дальше
      const slots = stripSlots(activeStrip());
      return assign(slots.find(z => !z.photo) || slots[0], id);
    }
    const next = stripSlots(t.s).find((x, i) => i > t.i && !x.photo);
    assign(t.slot, id, next?.id);
  },
  sanitize() {
    state.strips.forEach(s => s.slots.forEach(z => { if (z.photo && !photos.has(z.photo)) z.photo = null; }));
  },
  // после Undo/Redo активным становится стрип, который изменился (или вернулся)
  afterRestore(prev) {
    const was = new Map(prev.strips.map(s => [s.id, JSON.stringify(s)]));
    const diff = state.strips.find(s => was.get(s.id) !== JSON.stringify(s));
    if (diff) state.active = diff.id;
    if (!state.strips.some(s => s.id === state.active)) state.active = state.strips[0].id;
    if (selected && !findSlot(selected)) selected = null;
    if (diff && !isNarrow()) requestAnimationFrame(() => sheets.querySelector(`.strip[data-strip="${state.active}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
  },
};

function assign(z, photoId, selectNext) {
  Object.assign(z, { photo: photoId, ...focusFor(photoId), zoom: 1, rot: 0, angle: 0, mirror: false });
  if (selectNext) selected = selectNext;
  changed();
}
// Автозаполнение: свободные фото по порядку в пустые кадры (в стрипе порядок — это история)
function autofill() {
  const used = new Set();
  state.strips.forEach(s => stripSlots(s).forEach(z => { if (z.photo) used.add(z.photo); }));
  const free = library.filter(id => !used.has(id));
  if (!free.length) { alert(library.length ? 'All photos are already in use.' : 'Upload photos to Materials first.'); return; }
  state.strips.forEach(s => stripSlots(s).forEach(z => {
    if (!z.photo && free.length) { const id = free.shift(); Object.assign(z, { photo: id, ...focusFor(id), zoom: 1, rot: 0, angle: 0, mirror: false }); }
  }));
  changed();
}

let uploadTarget = null;
function pickForSlot(z) { uploadTarget = z.id; $('#slotFileInput').click(); }
$('#slotFileInput').addEventListener('change', async e => {
  const target = uploadTarget;
  await importFiles(e.target.files, id => { const t = findSlot(target); if (t) assign(t.slot, id); });
  e.target.value = '';
});

/* ---------- Взаимодействие со стрипами ---------- */
const sheets = $('#sheets');
let drag = null;
const touches = new Map(); // активные касания выбранного кадра (для щипка)
const touchDist = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
function addStrip() {
  const a = activeStrip(), s = newStrip(a);
  Object.assign(s, { border: a.border, gap: a.gap, color: a.color, filter: a.filter, cap: { ...a.cap } });
  state.strips.push(s); state.active = s.id; selected = null; exportPanel = false;
  changed();
  if (!isNarrow()) sheets.querySelector(`.strip[data-strip="${s.id}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

sheets.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  // второй палец, пока первый держит фото, — масштаб щипком
  if (drag && touches.size === 1 && drag.t.slot.photo && !drag.moving) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    capture(drag.el, e.pointerId);
    drag.pinch = { d0: touchDist(), zoom0: drag.t.slot.zoom };
    drag.moved = true;
    return;
  }
  if (e.target.closest('[data-add]')) return;
  const el = e.target.closest('.zone'), stripEl = e.target.closest('.strip');
  if (!el) {
    if (stripEl) state.active = stripEl.dataset.strip;
    if (selected || stripEl) { selected = null; if (stripEl) exportPanel = false; renderSheets(); renderPanel(); }
    return;
  }
  const t = findSlot(el.dataset.id);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  drag = { el, t, x: e.clientX, y: e.clientY, fx0: t.slot.fx, fy0: t.slot.fy, moved: false };
  capture(el, e.pointerId);
});
sheets.addEventListener('click', e => { if (e.target.closest('[data-add]')) addStrip(); });
sheets.addEventListener('contextmenu', e => { if (e.target.closest('.zone')) e.preventDefault(); });

sheets.addEventListener('pointermove', e => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!drag) return;
  const z = drag.t.slot, R = drag.t.R;
  if (drag.pinch) {
    if (touches.size < 2) return;
    z.zoom = clamp(drag.pinch.zoom0 * touchDist() / drag.pinch.d0, 1, 5);
    applyImg(drag.el.querySelector('img'), z, R);
    const sl = $('[data-act="zoom"]'); if (sl) sl.value = z.zoom;
    return;
  }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  if (!z.photo) return;
  drag.moved = true;
  // перенос в другой кадр включается, только когда курсор дошёл до середины другого кадра
  if (!drag.moving) {
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.zone');
    if (over && over !== drag.el && nearCenter(over, e)) startPhotoMove();
  }
  if (drag.moving) return movePhotoGhost(e);
  const box = drag.el.getBoundingClientRect();
  drag.el.classList.add('panning');
  const { wr, hr } = imageFit(z, R);
  const mx = dx / box.width * R.w, my = dy / box.height * R.h;
  const a = (z.angle || 0) * Math.PI / 180, ix = mx * Math.cos(a) + my * Math.sin(a), iy = -mx * Math.sin(a) + my * Math.cos(a);
  z.fx -= ix / (wr * R.w);
  z.fy -= iy / (hr * R.h);
  drag.x = e.clientX; drag.y = e.clientY;
  applyImg(drag.el.querySelector('img'), z, R);
});

function endPointer(e, cancelled) {
  touches.delete(e.pointerId);
  if (!drag) return;
  if (drag.pinch) {
    if (touches.size < 2) { drag = null; touches.clear(); save(); renderSheets(); }
    return;
  }
  const { t, moved, moving } = drag;
  if (moving) return finishPhotoMove(e, cancelled);
  drag = null;
  if (cancelled) return;
  if (moved) { save(); renderSheets(); return; }
  selected = t.slot.id; state.active = t.s.id; exportPanel = false;
  renderSheets(); renderPanel();
}
sheets.addEventListener('pointerup', e => endPointer(e, false));
sheets.addEventListener('pointercancel', e => endPointer(e, true));

/* ---------- Перенос фото между кадрами ---------- */
let ghost = null;
function startPhotoMove() {
  drag.moving = true;
  Object.assign(drag.t.slot, { fx: drag.fx0, fy: drag.fy0 });
  applyImg(drag.el.querySelector('img'), drag.t.slot, drag.t.R);
  drag.el.classList.remove('panning');
  drag.el.classList.add('moving-src');
  ghost = document.createElement('img');
  ghost.className = 'drag-ghost';
  ghost.src = photos.get(drag.t.slot.photo).url;
  document.body.appendChild(ghost);
}
function movePhotoGhost(e) {
  ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.zone');
  sheets.querySelectorAll('.drop-hover').forEach(x => x !== target && x.classList.remove('drop-hover'));
  if (target && target !== drag.el) target.classList.add('drop-hover');
}
function finishPhotoMove(e, cancelled) {
  const src = drag.t.slot;
  const el = cancelled ? null : document.elementFromPoint(e.clientX, e.clientY)?.closest('.zone');
  ghost?.remove(); ghost = null;
  drag = null;
  const dst = el && findSlot(el.dataset.id);
  if (dst && dst.slot !== src) { swapPhotos(src, dst.slot); selected = dst.slot.id; state.active = dst.s.id; changed(); }
  else renderSheets();
}
function swapPhotos(a, b) {
  const pa = { photo: a.photo, rot: a.rot || 0, angle: a.angle || 0, mirror: !!a.mirror }, pb = { photo: b.photo, rot: b.rot || 0, angle: b.angle || 0, mirror: !!b.mirror };
  const put = (z, p) => Object.assign(z, p.photo ? { photo: p.photo, ...focusFor(p.photo, p.rot, p.mirror), zoom: 1, rot: p.rot, angle: p.angle, mirror: p.mirror } : { photo: null });
  put(a, pb); put(b, pa);
}
sheets.addEventListener('dblclick', e => {
  const el = e.target.closest('.zone');
  if (el) pickForSlot(findSlot(el.dataset.id).slot);
});
sheets.addEventListener('wheel', e => {
  const el = e.target.closest('.zone.selected.has-photo');
  if (!el) return;
  e.preventDefault();
  const t = findSlot(el.dataset.id);
  t.slot.zoom = clamp(t.slot.zoom * Math.exp(-e.deltaY * 0.0015), 1, 5);
  applyImg(el.querySelector('img'), t.slot, t.R);
  const slider = $('[data-act="zoom"]'); if (slider) slider.value = t.slot.zoom;
  save();
}, { passive: false });

sheets.addEventListener('dragover', e => {
  const el = e.target.closest('.zone'), types = e.dataTransfer.types;
  if (!el || !(types.includes('Files') || types.includes(PHOTO_MIME))) return;
  e.preventDefault();
  sheets.querySelectorAll('.drop-hover').forEach(x => x !== el && x.classList.remove('drop-hover'));
  el.classList.add('drop-hover');
});
sheets.addEventListener('dragleave', e => { if (!sheets.contains(e.relatedTarget)) sheets.querySelectorAll('.drop-hover').forEach(x => x.classList.remove('drop-hover')); });
sheets.addEventListener('drop', async e => {
  const el = e.target.closest('.zone');
  if (!el) return;
  e.preventDefault();
  const id = el.dataset.id, pid = e.dataTransfer.getData(PHOTO_MIME);
  if (pid) { const t = findSlot(id); state.active = t.s.id; assign(t.slot, pid); return; }
  await importFiles(e.dataTransfer.files, pid2 => { const t = findSlot(id); if (t) assign(t.slot, pid2); });
});

document.addEventListener('keydown', e => {
  if (e.target.matches?.('input, select, textarea')) return;
  if (e.key === 'Escape' && selected) { selected = null; renderSheets(); renderPanel(); }
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  // выбран кадр — убрать из него фото; выбран сам стрип (без кадра) — удалить стрип (Undo вернёт)
  if (selected) { const t = findSlot(selected); if (t?.slot.photo) { t.slot.photo = null; changed(); } }
  else if (!exportPanel && !isNarrow()) { e.preventDefault(); deleteStrip(activeStrip()); }
});

/* ---------- Узкий экран: переключатель стрипов ---------- */
$('#stripSeg').addEventListener('click', e => {
  if (e.target.closest('[data-add]')) return addStrip();
  const id = e.target.closest('[data-strip]')?.dataset.strip;
  if (!id) return;
  state.active = id; selected = null;
  sheets.scrollTo({ left: state.strips.findIndex(s => s.id === id) * sheets.clientWidth, behavior: 'smooth' });
  markSeg(); renderPanel(); save();
});
function markSeg() {
  const idx = state.strips.indexOf(activeStrip());
  document.querySelectorAll('#stripSeg [data-strip]').forEach((b, i) => b.classList.toggle('active', i === idx));
}
// свайп между стрипами — активным становится тот, что на экране
sheets.addEventListener('scroll', () => {
  if (!isNarrow() || !sheets.clientWidth || drag) return;
  const s = state.strips[Math.round(sheets.scrollLeft / sheets.clientWidth)];
  if (s && s.id !== state.active) { state.active = s.id; selected = null; markSeg(); renderPanel(); }
}, { passive: true });
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderSheets, 80); });

$('#autofillBtn').addEventListener('click', autofill);
$('#addBtn').addEventListener('click', addStrip);
// Очистить: удалить все стрипы и начать с одного нового (Undo вернёт); материалы остаются
$('#resetBtn').addEventListener('click', () => {
  if (state.strips.length === 1 && !state.strips[0].slots.some(z => z.photo)) return;
  const s = newStrip();
  state.strips = [s]; state.active = s.id; selected = null; exportPanel = false;
  changed();
});

/* ---------- Экспорт ---------- */
// Раскладка стрипов по листам «полками»; длинная сторона стрипа — вертикально (если влезает)
function packSheets(P) {
  const UW = P.w - 2 * P.margin, UH = P.h - 2 * P.margin, pages = [], skipped = [];
  let page = null, x = 0, y = 0, rowH = 0;
  // место в текущем ряду или в новом ряду ниже; null — на этом листе не помещается
  const spot = (w, h) => {
    let nx = x, ny = y, nr = rowH;
    if (nx + w > UW + 0.01) { nx = 0; ny += nr + P.gap; nr = 0; }
    return ny + h > UH + 0.01 ? null : { nx, ny, nr };
  };
  state.strips.forEach((s, i) => {
    const sizes = [[Math.min(s.w, s.h), Math.max(s.w, s.h)], [Math.max(s.w, s.h), Math.min(s.w, s.h)]].filter(([w, h]) => w <= UW && h <= UH);
    if (!sizes.length) { skipped.push(i + 1); return; }
    for (let c = 0; c < state.exp.copies; c++) {
      let w, h, at = null;
      if (page) for ([w, h] of sizes) if ((at = spot(w, h))) break;
      if (!at) { page = []; pages.push(page); x = y = rowH = 0; [w, h] = sizes[0]; at = { nx: 0, ny: 0, nr: 0 }; }
      page.push({ s, x: P.margin + at.nx, y: P.margin + at.ny, w, h, rot: w !== s.w });
      x = at.nx + w + P.gap; y = at.ny; rowH = Math.max(at.nr, h);
    }
  });
  return { pages, skipped };
}
const pageBBox = page => ({ w: Math.max(...page.map(it => it.x + it.w)), h: Math.max(...page.map(it => it.y + it.h)) });
function packDiagram() {
  const cricut = state.exp.mode === 'cricut', P = cricut ? CRICUT : printSheet(), { pages, skipped } = packSheets(P);
  return `<div class="pack-diagram${cricut ? ' cricut' : ''}">${pages.map(pg => `<svg viewBox="0 0 ${P.w} ${P.h}">${pg.map(it => `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}"/>`).join('')}</svg>`).join('')}</div>
    <p class="note">${pages.length} sheet${pages.length === 1 ? '' : 's'}, ${pages.reduce((a, p) => a + p.length, 0)} strips.${
    cricut ? ' ' + pages.map((pg, i) => { const b = pageBBox(pg); return `Sheet ${i + 1}: ${fmt(b.w)} × ${fmt(b.h)} mm.`; }).join(' ') : ''}</p>
    ${skipped.length ? `<p class="note warn">Strip ${skipped.join(', ')} is too large for this sheet and is left out.</p>` : ''}`;
}
function updatePackDiagram() { const el = $('#packBox'); if (el) el.innerHTML = packDiagram(); }

function renderExportPanel() {
  const x = state.exp, s = activeStrip(), n = state.strips.length;
  const empty = state.strips.reduce((a, st) => a + stripSlots(st).filter(z => !z.photo).length, 0);
  const inch = v => (v / 25.4).toFixed(2);
  let html = `<div class="sec"><div class="zone-title">Export</div>
    ${empty ? `<p class="note warn">${empty} empty frame${empty === 1 ? '' : 's'} — they will stay blank.</p>` : ''}
    <label class="f">Export as<select data-ex="mode">${opt('images', x.mode, 'Separate images')}${opt('a4', x.mode, 'Sheet for printing (PDF)')}${opt('cricut', x.mode, 'Cricut Print Then Cut sheet (PNG)')}</select></label></div>`;
  if (x.mode === 'images') html += `<div class="sec">
    <label class="f">Format<select data-ex="format">${opt('png', x.format, 'PNG')}${opt('jpg', x.format, 'JPG')}</select></label>
    <p class="note">One image per strip at ${DPI} dpi, exactly the strip size — print it, send it to a photo lab or import it into Cricut Design Space.</p>
    ${bleedImgOption(x)}
    <button class="btn primary block" data-act="dlActive">Download strip ${state.strips.indexOf(s) + 1}</button>
    ${n > 1 ? `<button class="btn block" data-act="dlAll">Download all ${n} strips (ZIP)</button>` : ''}</div>
    <div class="sec"><h3>Cricut (Print Then Cut)</h3><ol class="steps">
    <li>In Design Space: Upload → the image → “Complex” → save as <b>Print Then Cut</b>.</li>
    ${x.imgBleed ? '<li class="warn">Turn the bleed off for Cricut — Design Space adds its own.</li>' : ''}
    <li>Add it to the canvas and set the size to <b>${fmt(s.w)} × ${fmt(s.h)} mm</b> (${inch(s.w)} × ${inch(s.h)} in) — the size is also in the file name.</li>
    <li>Make it: print, then let the Cricut cut around the strip.</li></ol></div>`;
  else if (x.mode === 'a4') html += `<div class="sec">
    ${paperSelect()}
    <label class="f">Copies of each strip<input type="number" min="1" max="20" step="1" value="${x.copies}" data-ex="copies"></label>
    <label class="f check"><input type="checkbox" data-ex="marks" ${x.marks ? 'checked' : ''}> Crop marks at the corners</label>
    ${bleedSheetOption(x)}
    <div id="packBox">${packDiagram()}</div>
    <p class="note">Print at 100% (“actual size”), without “fit to page”.</p>
    <button class="btn primary block" data-act="dlA4">Download PDF</button></div>`;
  else html += `<div class="sec">
    <label class="f">Copies of each strip<input type="number" min="1" max="20" step="1" value="${x.copies}" data-ex="copies"></label>
    <div id="packBox">${packDiagram()}</div>
    <button class="btn primary block" data-act="dlCricut">Download PNG</button></div>
    <div class="sec"><h3>How to use</h3><ol class="steps">
    <li>The strips are packed into the Print Then Cut area (6.75 × 9.25 in) on a transparent background.</li>
    <li>In Design Space: Upload → the PNG → “Complex” → save as <b>Print Then Cut</b>.</li>
    <li>Set the image size to the sheet size shown above (also in the file name).</li>
    <li>Make it: the Cricut cuts around every strip separately.</li></ol></div>`;
  html += '<div class="sec"><button class="btn block" data-act="closeExport">Back to editing</button></div>';
  $('#panel').innerHTML = html;
}
$('#exportBtn').addEventListener('click', () => {
  exportPanel = !exportPanel;
  if (exportPanel) selected = null;
  renderSheets(); renderPanel();
});

// Рисует стрип в (0,0) контекста, k — px на мм
async function drawStrip(ctx, s, k) {
  const L = stripLayout(s);
  ctx.fillStyle = s.color; ctx.fillRect(0, 0, s.w * k, s.h * k);
  ctx.imageSmoothingQuality = 'high';
  const slots = stripSlots(s);
  for (let i = 0; i < slots.length; i++) {
    const z = slots[i], R = L.rects[i];
    if (!z.photo || !photos.has(z.photo)) continue;
    const { p, s: sc } = imageFit(z, R), [pw, ph] = rotDims(p, z.rot);
    const bmp = await createImageBitmap(p.blob), dw = pw * sc * k, dh = ph * sc * k;
    // фото в кадре; (ox, oy) — левый верхний угол кадра в координатах контекста c
    const paint = (c, ox, oy) => {
      c.save();
      c.beginPath(); c.rect(ox, oy, R.w * k, R.h * k); c.clip();
      c.translate(ox + R.w / 2 * k, oy + R.h / 2 * k);
      c.rotate((z.angle || 0) * Math.PI / 180);
      c.translate(-z.fx * dw + dw / 2, -z.fy * dh + dh / 2);
      if (z.mirror) c.scale(-1, 1);
      c.rotate((z.rot || 0) * Math.PI / 180);
      c.drawImage(bmp, -p.w * sc * k / 2, -p.h * sc * k / 2, p.w * sc * k, p.h * sc * k);
      c.restore();
    };
    const m = FILTERS[s.filter].m;
    if (!m) paint(ctx, R.x * k, R.y * k);
    else {
      // с фильтром кадр собирается на отдельном холсте и пересчитывается по пикселям
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(R.w * k)); cv.height = Math.max(1, Math.round(R.h * k));
      const c = cv.getContext('2d', { willReadFrequently: true });
      c.imageSmoothingQuality = 'high';
      paint(c, 0, 0);
      applyFilterRect(c, 0, 0, cv.width, cv.height, m);
      ctx.drawImage(cv, R.x * k, R.y * k, R.w * k, R.h * k);
    }
    bmp.close();
  }
  ctx.save(); ctx.scale(k, k);
  ctx.fillStyle = s.cap.color; ctx.textBaseline = 'alphabetic';
  for (const t of captionLayout(s)) {
    ctx.font = `${t.weight} ${t.size}px "Ubuntu Sans", sans-serif`;
    ctx.textAlign = { start: 'left', middle: 'center', end: 'right' }[t.anchor];
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.restore();
}
// Лист раскладки → canvas (W×H мм); повёрнутые стрипы рисуются на 90° по часовой.
// opts: bg — фон листа, marks — метки реза, bleed — вылет в мм (каждый стрип рисуется отдельно и продлевается по краям)
async function drawPage(page, W, H, opts) {
  const k = DPI / 25.4, cv = document.createElement('canvas'), bp = Math.round((opts.bleed || 0) * k);
  cv.width = Math.round(W * k); cv.height = Math.round(H * k);
  const ctx = cv.getContext('2d');
  if (opts.bg) { ctx.fillStyle = opts.bg; ctx.fillRect(0, 0, cv.width, cv.height); }
  for (const it of page) {
    const one = document.createElement('canvas');
    one.width = Math.round(it.s.w * k); one.height = Math.round(it.s.h * k);
    await drawStrip(one.getContext('2d'), it.s, k);
    ctx.save();
    ctx.translate(it.x * k, it.y * k);
    if (it.rot) { ctx.translate(it.w * k, 0); ctx.rotate(Math.PI / 2); }
    ctx.drawImage(addBleed(one, bp), -bp, -bp);
    ctx.restore();
  }
  // метки — после всех стрипов, чтобы вылет соседа их не закрыл
  if (opts.marks) page.forEach(it => cropMarks(ctx, it, k, opts.bleed || 0));
  return cv;
}

const safeName = s => (s.cap.text.trim() || 'strip').replace(/[^\p{L}\p{N}_-]+/gu, '_');
const sizeName = (w, h) => `${fmt(w)}x${fmt(h)}mm`;

function exportImages(list) {
  const jpg = state.exp.format === 'jpg';
  return busy('Preparing images…', async () => {
    const files = [];
    for (const s of list) {
      // вылет округлён до целых пикселей — иначе картинка выходит на пиксель меньше
      const b = state.exp.imgBleed ? BLEED : 0, k = DPI / 25.4, bm = Math.round(b * k) / k;
      const cv = await drawPage([{ s, x: bm, y: bm, w: s.w, h: s.h, rot: false }], (Math.round(s.w * k) + 2 * Math.round(b * k)) / k, (Math.round(s.h * k) + 2 * Math.round(b * k)) / k, { bleed: b });
      const blob = await withDpi(await canvasBlob(cv, jpg ? 'image/jpeg' : 'image/png', 0.95), DPI);
      files.push({ blob, name: `${safeName(s)}-${state.strips.indexOf(s) + 1}_${sizeName(s.w, s.h)}${b ? `_bleed${b}mm` : ''}.${jpg ? 'jpg' : 'png'}` });
    }
    await downloadFiles(files, 'photo-strips.zip');
  });
}
function exportA4() {
  const P = printSheet(), { pages } = packSheets(P);
  if (!pages.length) return;
  return busy('Preparing PDF…', async () => {
    const out = [];
    for (const pg of pages) {
      const cv = await drawPage(pg, P.w, P.h, { bg: '#fff', marks: state.exp.marks, bleed: state.exp.bleed ? BLEED : 0 });
      out.push({ bytes: new Uint8Array(await (await canvasBlob(cv, 'image/jpeg', 0.93)).arrayBuffer()), W: cv.width, H: cv.height });
    }
    download(makePdf(out), `photo-strips_${paper.name}.pdf`);
  });
}
// Лист для Cricut: прозрачный фон, обрезан по занятой области — Design Space режет вокруг каждого стрипа
function exportCricut() {
  const { pages } = packSheets(CRICUT);
  if (!pages.length) return;
  return busy('Preparing PNG…', async () => {
    const files = [];
    for (let i = 0; i < pages.length; i++) {
      const b = pageBBox(pages[i]), cv = await drawPage(pages[i], b.w, b.h, {});
      files.push({ blob: await withDpi(await canvasBlob(cv, 'image/png'), DPI), name: `photo-strips_cricut-${i + 1}_${sizeName(b.w, b.h)}.png` });
    }
    await downloadFiles(files, 'photo-strips_cricut.zip');
  });
}

/* ---------- Запуск (хранение, материалы и Undo — в shared.js) ---------- */
async function init() {
  const saved = await loadStudio();
  if (saved?.v === 1 && saved.strips?.length) {
    state = saved;
    state.exp = { ...freshState().exp, ...state.exp };
    state.strips.forEach(s => {
      s.cap = { ...newStrip().cap, ...s.cap };
      s.filter = s.filter in FILTERS ? s.filter : 'none';
      delete s.grain;
    });
    APP.sanitize();
    if (!state.strips.some(s => s.id === state.active)) state.active = state.strips[0].id;
  }
  changed();
  histReset();
  analyzeMissing();
}
window.addEventListener('DOMContentLoaded', init);
// после загрузки шрифта ширина подписи меняется — перерисовать
document.fonts.load('700 20px "Ubuntu Sans"').then(() => renderSheets());
