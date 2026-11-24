'use strict';


const BOX = {
  pageW: 173.5, pageH: 225.75,
  outline: 'M 124.248 145.426 L 124.248 52.176 L 97.988 32.914 A 19.001 19.001 0 0 0 75.516 32.914 L 49.251 52.176 L 49.251 145.426 L 41 145.426 L 25.001 148.248 L 25.001 197.605 L 41 200.424 L 49.251 200.424 L 68.566 200.424 A 6.001 6.001 0 0 0 72.806 198.667 L 74.052 197.425 L 74.052 197.425 A 17.96 17.96 0 0 1 99.452 197.425 L 99.452 197.425 L 100.693 198.667 A 6.001 6.001 0 0 0 104.934 200.424 L 124.248 200.424 L 132.5 200.424 L 148.498 197.605 L 148.498 148.248 L 132.5 145.426 L 124.248 145.426',
  cuts: [
    'M 114.021 172.925 L 97.723 172.925 A 4.544 4.544 0 0 1 94.509 171.595 L 94.463 171.549 A 10.908 10.908 0 0 0 79.036 171.549 L 78.99 171.595 A 4.544 4.544 0 0 1 75.777 172.925 L 59.478 172.925',
    'M 75.385 172.925 L 98.115 172.925',
  ],
  folds: [
    'M 114.021 44.676 L 59.478 44.676',
    'M 49.251 72.175 L 124.248 72.175',
    'M 124.248 81.174 L 49.251 81.174',
    'M 49.251 136.677 L 124.248 136.677',
    'M 124.248 145.175 L 49.251 145.175',
    'M 49.001 145.426 L 49.001 200.424',
    'M 41 200.424 L 41 145.426',
    'M 124.499 145.426 L 124.499 200.424',
    'M 132.5 200.424 L 132.5 145.426',
  ],
  bbox: { x: 25.001, y: 29.21, w: 123.497, h: 171.214 },
  lid: { x: 49.251, y: 81.174, w: 74.997, h: 55.503 },
  spines: {
    back: { x: 49.251, y: 136.677, w: 74.997, h: 8.498 },  // торец по линии петли
    front: { x: 49.251, y: 72.175, w: 74.997, h: 8.999 }, // передний торец крышки
  },
};
// BLEED (2 мм вылета фото за линию реза) — в shared.js

function freshBox() {
  return {
    photo: null, fx: 0.5, fy: 0.5, zoom: 1,
    color: '#ffffff', size: 14, titlePos: 'bottom', metaPos: 'bottom', titleAlign: 'left',
    lidRot: 180, // 180 — текст читается спереди, когда петля сзади
    spineEdge: 'back', spineText: '', spineSize: 4.5, spineFlip: false,
    pdfLines: true,
  };
}

state.box ??= freshBox();

/* ---------- Геометрия ---------- */
const boxArea = () => ({ x: BOX.bbox.x - BLEED, y: BOX.bbox.y - BLEED, w: BOX.bbox.w + 2 * BLEED, h: BOX.bbox.h + 2 * BLEED });
// фото «cover» на всю развёртку + вылет; возвращает прямоугольник фото в мм
// x/y/w/h — повёрнутое фото на странице; cx/cy — его центр; iw/ih — фото в исходной ориентации
// b.angle — наклон (−45…45°) вокруг центра развёртки; фото покрывает габарит развёртки,
// повёрнутой в систему фото, поэтому края с вылетом не оголяются
function boxFit() {
  const b = state.box, p = photos.get(b.photo), R = boxArea(), [pw, ph] = rotDims(p, b.rot);
  const a = (b.angle || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const BW = R.w * Math.abs(ca) + R.h * Math.abs(sa), BH = R.w * Math.abs(sa) + R.h * Math.abs(ca);
  const s = Math.max(BW / pw, BH / ph) * b.zoom;
  const dw = pw * s, dh = ph * s;
  const hx = BW / 2 / dw, hy = BH / 2 / dh;
  b.fx = clamp(b.fx, hx, 1 - hx);
  b.fy = clamp(b.fy, hy, 1 - hy);
  // точка фото (fx, fy) — в центре развёртки; центр фото смещён от неё с учётом наклона
  const ox = (0.5 - b.fx) * dw, oy = (0.5 - b.fy) * dh;
  const cx = R.x + R.w / 2 + ox * ca - oy * sa, cy = R.y + R.h / 2 + ox * sa + oy * ca;
  return { p, s, w: dw, h: dh, cx, cy, iw: p.w * s, ih: p.h * s, r0: b.rot || 0, tilt: b.angle || 0, mirror: !!b.mirror, angle: a };
}
// фото в исходной ориентации → страница: центр, наклон, отражение (по горизонтали), поворот на 90°
const boxPhotoMatrix = f => new DOMMatrix().translate(f.cx, f.cy).rotate(f.tilt).scale(f.mirror ? -1 : 1, 1).rotate(f.r0).translate(-f.iw / 2, -f.ih / 2);
// атрибуты <image>
function boxImgAttrs(f) {
  return { x: 0, y: 0, width: f.iw, height: f.ih, transform: `translate(${f.cx} ${f.cy}) rotate(${f.tilt})${f.mirror ? ' scale(-1 1)' : ''} rotate(${f.r0}) translate(${-f.iw / 2} ${-f.ih / 2})` };
}
function spineText() {
  const b = state.box, cv = state.cover;
  if (b.spineText.trim()) return b.spineText.trim();
  const year = (cv.date.match(/\d{4}/) || [])[0] || cv.date.trim();
  return [issueText(cv.issue), year].filter(Boolean).join(' · ');
}
// Блоки текста: крышка и торец. cx/cy — центр блока на странице, w/h и items — в системе блока (мм)
function boxTextBlocks() {
  const b = state.box, cv = state.cover, blocks = [];
  const lid = BOX.lid, rot = +b.lidRot, swap = rot % 180 !== 0;
  const lw = swap ? lid.h : lid.w, lh = swap ? lid.w : lid.h;
  blocks.push({
    cx: lid.x + lid.w / 2, cy: lid.y + lid.h / 2, rot, w: lw, h: lh,
    items: coverTextLayout(lw, lh, { ...cv, size: b.size, titlePos: b.titlePos, metaPos: b.metaPos, titleAlign: b.titleAlign }),
  });
  const text = spineText();
  if (text) {
    const sp = BOX.spines[b.spineEdge], sw = sp.w, sh = sp.h, pad = 3;
    const front = b.spineEdge === 'front';
    const x0 = 0, avail = sw - 2 * pad;
    let size = +b.spineSize;
    const tw = textWidth(text, size, 700);
    if (tw > avail) size *= avail / tw;
    // передний торец висит с крышки и при сборке переворачивается вместе с ней
    const srot = (front ? 180 : 0) + (b.spineFlip ? 180 : 0);
    blocks.push({
      cx: sp.x + sp.w / 2, cy: sp.y + sp.h / 2, rot: srot % 360, w: sw, h: sh,
      items: [{ text, x: x0 + (sw - x0) / 2, y: sh / 2 + size * 0.36, size, weight: 700, anchor: 'middle' }],
    });
  }
  return blocks;
}
function blocksSvg() {
  const color = esc(state.box.color);
  return boxTextBlocks().map(B =>
    `<g transform="translate(${B.cx} ${B.cy}) rotate(${B.rot}) translate(${-B.w / 2} ${-B.h / 2})">${
      B.items.map(t => `<text x="${t.x}" y="${t.y}" font-size="${t.size}" font-weight="${t.weight}" text-anchor="${t.anchor}" fill="${color}" font-family="'Ubuntu Sans', sans-serif">${esc(t.text)}</text>`).join('')
    }</g>`).join('');
}

/* ---------- Превью ---------- */
function renderBox() {
  const b = state.box, p = b.photo && photos.get(b.photo);
  const pad = 4, V = { x: BOX.bbox.x - pad, y: BOX.bbox.y - pad, w: BOX.bbox.w + 2 * pad, h: BOX.bbox.h + 2 * pad };
  let img = '';
  if (p) {
    const a = boxImgAttrs(boxFit());
    img = `<image href="${p.url}" ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ')} preserveAspectRatio="none"/>`;
  }
  const L = BOX.lid;
  const hint = p ? '' : `<g fill="#a39c91" font-family="'Ubuntu Sans', sans-serif" text-anchor="middle">
      <text x="${L.x + L.w / 2}" y="${L.y + L.h / 2 - 1}" font-size="6" font-weight="700">Lid</text>
      <text x="${L.x + L.w / 2}" y="${L.y + L.h / 2 + 5}" font-size="3.2">drop a photo onto the net</text></g>`;
  $('#sheets').innerHTML = `<div class="sheet-col">
    <div class="sheet-cap">Box net · solid = cut, dashed = fold</div>
    <div class="box-sheet" style="aspect-ratio:${V.w}/${V.h};--ar:${V.w / V.h}">
      <svg class="box-svg${p ? ' has-photo' : ''}" viewBox="${V.x} ${V.y} ${V.w} ${V.h}" xmlns="http://www.w3.org/2000/svg">
        <defs><clipPath id="boxClip"><path d="${BOX.outline}"/></clipPath></defs>
        <path class="box-shape" d="${BOX.outline}" fill="${p ? '#fff' : '#eeeae4'}" stroke="none"/>
        <g clip-path="url(#boxClip)">${img}${blocksSvg()}</g>${hint}
        <!-- превью: рез — тёмная сплошная, сгиб — оранжевый пунктир; светлая подложка, чтобы линии читались на тёмном фото -->
        <g fill="none" stroke="rgba(255,255,255,.7)" stroke-width="0.8">${[BOX.outline, ...BOX.cuts].map(d => `<path d="${d}"/>`).join('')}</g>
        <g fill="none" stroke="rgba(255,255,255,.55)" stroke-width="0.6" stroke-dasharray="1.4 1">${BOX.folds.map(d => `<path d="${d}"/>`).join('')}</g>
        <g fill="none" stroke="#e8661f" stroke-width="0.45" stroke-dasharray="1.4 1">${BOX.folds.map(d => `<path d="${d}"/>`).join('')}</g>
        <g fill="none" stroke="#2b2724" stroke-width="0.4">${[BOX.outline, ...BOX.cuts].map(d => `<path d="${d}"/>`).join('')}</g>
      </svg></div></div>`;
}

const sel = (name, val, opts) => `<select data-bx="${name}">${opts.map(([v, l]) => `<option value="${v}" ${String(val) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
function renderBoxPanel() {
  const b = state.box, cv = state.cover;
  $('#panel').innerHTML = `
  <div class="sec"><div class="zone-title">Box</div>
    <p class="note">The photo covers the whole net. Drag it to reframe; scroll wheel to zoom. Click a photo in Materials to put it on the box.</p>
    ${b.photo ? '' : '<button class="btn block" data-bact="upload">Upload photo</button>'}
    ${b.photo ? `<label class="f">Zoom<input type="range" min="1" max="5" step="0.01" value="${b.zoom}" data-bx="zoom"></label>
    ${rotateRow('data-bact')}
    <label class="f"><span class="label-row">Adjust angle: <output id="boxAngleOut">${fmtAngle(b.angle)}</output><button type="button" class="icon-btn" data-bact="angle0" title="Reset angle" aria-label="Reset angle">↺</button></span><input type="range" min="-45" max="45" step="0.5" value="${b.angle || 0}" data-bx="angle"></label>
    <div class="row"><button class="btn" data-bact="center">Reset framing</button><button class="btn" data-bact="remove">Remove photo</button></div>` : ''}
  </div>
  <div class="sec"><h3>Lid</h3>
    <label class="f">Title<input type="text" data-cv="title" value="${esc(cv.title)}" placeholder="Title"></label>
    <div class="row"><label class="f">Issue #<input type="text" data-cv="issue" value="${esc(cv.issue)}"></label>
    <label class="f">Date<input type="text" data-cv="date" value="${esc(cv.date)}" placeholder="${datePlaceholder()}"></label></div>
    <p class="note">Title, issue and date are shared with the zine cover.</p>
    <div class="row"><label class="f">Title position${sel('titlePos', b.titlePos, [['top', 'top'], ['bottom', 'bottom']])}</label>
    <label class="f">Issue & date${sel('metaPos', b.metaPos, [['top', 'top'], ['bottom', 'bottom']])}</label></div>
    <label class="f">Title alignment${sel('titleAlign', b.titleAlign, [['left', 'left'], ['center', 'center'], ['right', 'right']])}</label>
    <label class="f">Text orientation${sel('lidRot', b.lidRot, [[180, 'reads from the front (hinge at back)'], [0, 'reads from the hinge side'], [90, 'sideways, 90°'], [270, 'sideways, 270°']])}</label>
    <div class="row"><label class="f">Size<input type="range" min="5" max="24" step="0.5" value="${b.size}" data-bx="size"></label>
    <label class="f">Text color<input type="color" value="${esc(b.color)}" data-bx="color"></label></div>
  </div>
  <div class="sec"><h3>Spine</h3>
    <label class="f">Which edge${sel('spineEdge', b.spineEdge, [['back', 'back (along the hinge)'], ['front', 'front (lid edge)']])}</label>
    <label class="f">Text<input type="text" data-bx="spineText" value="${esc(b.spineText)}" placeholder="${esc(spineText() || 'Issue # · year')}"></label>
    <p class="note">Leave empty to use the issue number and the year from the date.</p>
    <div class="row"><label class="f">Size<input type="range" min="2" max="7" step="0.25" value="${b.spineSize}" data-bx="spineSize"></label>
    <label class="f check"><input type="checkbox" data-bx="spineFlip" ${b.spineFlip ? 'checked' : ''}> Flip</label></div>
  </div>
`;
}

$('#panel').addEventListener('input', e => {
  const t = e.target, key = t.dataset.bx;
  if (!key || state.mode !== 'box') return;
  const b = state.box;
  if (t.type === 'checkbox') b[key] = t.checked;
  else if (['zoom', 'size', 'spineSize', 'lidRot', 'angle'].includes(key)) b[key] = +t.value;
  else b[key] = t.value;
  renderBox(); save();
  if (key === 'spineEdge') renderPanel();
  if (key === 'angle') $('#boxAngleOut').textContent = fmtAngle(b.angle);
});
// плейсхолдер торца зависит от номера и даты
$('#panel').addEventListener('input', e => {
  if (state.mode === 'box' && e.target.dataset.cv) {
    const sp = $('[data-bx="spineText"]'); if (sp) sp.placeholder = spineText() || 'Issue # · year';
  }
});
$('#panel').addEventListener('click', e => {
  const act = e.target.closest('[data-bact]')?.dataset.bact;
  if (!act) return;
  if (act === 'upload') { zoneUploadTarget = 'box'; $('#zoneFileInput').click(); }
  if (act === 'center') { Object.assign(state.box, { fx: 0.5, fy: 0.5, zoom: 1 }); changed(); }
  if (act === 'mirror') { mirrorPhoto(state.box); changed(); }
  if (act === 'angle0') { e.preventDefault(); state.box.angle = 0; changed(); }
  if (act === 'rotl' || act === 'rotr') { rotatePhoto(state.box, act === 'rotr' ? 1 : -1); changed(); }
  if (act === 'remove') { state.box.photo = null; changed(); }
});
function setBoxPhoto(id) {
  Object.assign(state.box, { photo: id, fx: 0.5, fy: 0.5, zoom: 1, rot: 0, angle: 0, mirror: false });
  changed();
}

/* ---------- Взаимодействие ---------- */
let boxDrag = null;
const boxTouches = new Map(); // касания на развёртке — для щипка двумя пальцами
const boxTouchDist = () => { const [a, b] = [...boxTouches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
sheets.addEventListener('pointerdown', e => {
  if (state.mode !== 'box' || e.button !== 0) return;
  const svg = e.target.closest('.box-svg');
  if (!svg || !state.box.photo) return;
  boxTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  capture(svg, e.pointerId);
  if (boxDrag && boxTouches.size === 2) { boxDrag.pinch = { d0: boxTouchDist(), zoom0: state.box.zoom }; return; }
  boxDrag = { svg, x: e.clientX, y: e.clientY };
  svg.classList.add('panning');
});
sheets.addEventListener('pointermove', e => {
  if (boxTouches.has(e.pointerId)) boxTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!boxDrag) return;
  const { svg } = boxDrag, img = svg.querySelector('image');
  if (boxDrag.pinch) {
    if (boxTouches.size < 2) return;
    state.box.zoom = clamp(boxDrag.pinch.zoom0 * boxTouchDist() / boxDrag.pinch.d0, 1, 5);
    Object.entries(boxImgAttrs(boxFit())).forEach(([k, v]) => img.setAttribute(k, v));
    const sl = $('[data-bx="zoom"]'); if (sl) sl.value = state.box.zoom;
    return;
  }
  const f = boxFit();
  const ptPerPx = svg.viewBox.baseVal.width / svg.getBoundingClientRect().width;
  // сдвиг мыши → в систему наклонённого фото
  const mx = (e.clientX - boxDrag.x) * ptPerPx, my = (e.clientY - boxDrag.y) * ptPerPx;
  const ca = Math.cos(f.angle), sa = Math.sin(f.angle);
  state.box.fx -= (mx * ca + my * sa) / f.w;
  state.box.fy -= (-mx * sa + my * ca) / f.h;
  boxDrag.x = e.clientX; boxDrag.y = e.clientY;
  Object.entries(boxImgAttrs(boxFit())).forEach(([k, v]) => img.setAttribute(k, v));
});
const boxPointerEnd = e => {
  boxTouches.delete(e.pointerId);
  if (!boxDrag) return;
  if (boxDrag.pinch && boxTouches.size) return; // второй палец ещё на экране — ждём
  boxDrag = null; save(); renderBox();
};
sheets.addEventListener('pointerup', boxPointerEnd);
sheets.addEventListener('pointercancel', boxPointerEnd);
sheets.addEventListener('wheel', e => {
  if (state.mode !== 'box' || !state.box.photo || !e.target.closest('.box-svg')) return;
  e.preventDefault();
  state.box.zoom = clamp(state.box.zoom * Math.exp(-e.deltaY * 0.0015), 1, 5);
  renderBox();
  const sl = $('[data-bx="zoom"]'); if (sl) sl.value = state.box.zoom;
  save();
}, { passive: false });
sheets.addEventListener('dragover', e => {
  if (state.mode !== 'box') return;
  const svg = e.target.closest('.box-svg'), t = e.dataTransfer.types;
  if (!svg || !(t.includes('Files') || t.includes('application/x-zine-photo'))) return;
  e.preventDefault();
  svg.classList.add('drop-hover');
});
sheets.addEventListener('dragleave', e => {
  if (state.mode === 'box' && !sheets.contains(e.relatedTarget)) sheets.querySelector('.box-svg')?.classList.remove('drop-hover');
});
sheets.addEventListener('drop', async e => {
  if (state.mode !== 'box' || !e.target.closest('.box-svg')) return;
  e.preventDefault();
  const pid = e.dataTransfer.getData('application/x-zine-photo');
  if (pid) return setBoxPhoto(pid);
  await importFiles(e.dataTransfer.files, setBoxPhoto);
});
document.addEventListener('keydown', e => {
  if (state.mode !== 'box' || e.target.matches('input, select, textarea')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.box.photo) { state.box.photo = null; changed(); }
});

/* ---------- Режимы ---------- */
function updateMode() {
  document.body.classList.toggle('mode-box', state.mode === 'box');
  document.querySelectorAll('#modeTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.mode === state.mode));
}
$('#modeTabs').addEventListener('click', e => {
  const m = e.target.closest('[data-mode]')?.dataset.mode;
  if (!m || m === state.mode) return;
  state.mode = m; selection.clear();
  changed();
});

/* ---------- Экспорт ---------- */
// рисует развёртку в мм (трансформация уже выставлена вызывающим)
async function drawBoxArt(ctx, lines, bleed = true) {
  const outline = new Path2D(BOX.outline), b = state.box;
  ctx.imageSmoothingQuality = 'high';
  if (b.photo && photos.has(b.photo)) {
    const f = boxFit(), bmp = await createImageBitmap(f.p.blob);
    // матрица «фото в исходной ориентации → страница» с учётом поворота
    const m = boxPhotoMatrix(f);
    ctx.save(); ctx.clip(outline); ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f); ctx.drawImage(bmp, 0, 0, f.iw, f.ih); ctx.restore();
    // вылет: обводка контура тем же фото, чтобы при неточном резе не было белой каймы
    const pat = ctx.createPattern(bmp, 'no-repeat');
    pat.setTransform(m.scale(f.iw / bmp.width, f.ih / bmp.height));
    if (bleed) { ctx.save(); ctx.strokeStyle = pat; ctx.lineWidth = 2 * BLEED; ctx.lineJoin = 'round'; ctx.stroke(outline); ctx.restore(); }
    bmp.close();
  }
  ctx.save(); ctx.clip(outline);
  ctx.fillStyle = b.color; ctx.textBaseline = 'alphabetic';
  for (const B of boxTextBlocks()) {
    ctx.save();
    ctx.translate(B.cx, B.cy); ctx.rotate(B.rot * Math.PI / 180);
    ctx.translate(-B.w / 2, -B.h / 2);
    for (const t of B.items) {
      ctx.font = `${t.weight} ${t.size}px "Ubuntu Sans", sans-serif`;
      ctx.textAlign = { start: 'left', middle: 'center', end: 'right' }[t.anchor];
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
  }
  ctx.restore();
  if (lines) {
    // в PDF: сгибы — серый пунктир, едва заметный (10%); рез — серый пунктир, 50%
    ctx.save(); ctx.lineWidth = 0.2;
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.1)'; ctx.setLineDash([0.7, 0.7]);
    BOX.folds.forEach(d => ctx.stroke(new Path2D(d)));
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.5)'; ctx.setLineDash([1.4, 1]);
    [BOX.outline, ...BOX.cuts].forEach(d => ctx.stroke(new Path2D(d)));
    ctx.restore();
  }
}
// точный габарит контура (с дугами) — по нему режутся PNG и рамка SVG для Cricut
// Путь в мм → в pt относительно угла габарита B (команды M/L/A/Z; у дуг масштабируются радиусы и точка)
function toPt(d, B, k) {
  const t = d.match(/[MLAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi), out = [];
  const f = v => +(v).toFixed(3);
  for (let i = 0; i < t.length;) {
    const c = t[i];
    if (/^[MLZ]$/i.test(c)) { out.push(c); i++; if (c.toUpperCase() !== 'Z') { out.push(f((+t[i] - B.x) * k), f((+t[i + 1] - B.y) * k)); i += 2; } continue; }
    if (/^A$/i.test(c)) { const [rx, ry, rot, la, sw, x, y] = t.slice(i + 1, i + 8); out.push('A', f(rx * k), f(ry * k), rot, la, sw, f((x - B.x) * k), f((y - B.y) * k)); i += 8; continue; }
    // повтор координат после L/M без буквы
    out.push(f((+t[i] - B.x) * k), f((+t[i + 1] - B.y) * k)); i += 2;
  }
  return out.join(' ');
}
// размер PNG для Design Space (он не всегда читает DPI, поэтому задаём вручную)
function cricutSize() { const b = outlineBBox(); return `${b.w.toFixed(1)} × ${b.h.toFixed(1)} mm`; }
function outlineBBox() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden';
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', BOX.outline);
  svg.appendChild(path); document.body.appendChild(svg);
  const b = path.getBBox(); svg.remove();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}
async function exportBox(kind) {
  if (!state.box.photo && !confirm('The box has no photo. Export without a photo?')) return;
  $('#busy').hidden = false; $('#busyText').textContent = `Preparing ${kind.toUpperCase()}…`;
  try {
    await Promise.all(['700 20px "Ubuntu Sans"', '500 20px "Ubuntu Sans"'].map(f => document.fonts.load(f)));
    const dpi = 300, name = `${(state.cover.title || 'zine').replace(/[^\p{L}\p{N}_-]+/gu, '_')}_box`;
    if (kind === 'pdf') {
      // лист A4 или Letter, развёртка по центру в масштабе 100%
      const k = dpi / 25.4, W = Math.round(PW * k), H = Math.round(PH * k);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.translate((PW - BOX.pageW) / 2 * k, (PH - BOX.pageH) / 2 * k);
      ctx.scale(k, k);
      await drawBoxArt(ctx, state.box.pdfLines);
      const bytes = new Uint8Array(await (await canvasBlob(cv, 'image/jpeg', 0.93)).arrayBuffer());
      download(makePdf([{ bytes, W, H }]), name + '.pdf');
    } else if (kind === 'png') {
      // Cricut Print Then Cut: только картинка, ровно по контуру, без вылета, фон прозрачный —
      // Design Space сам обведёт контур для резки (и добавит свой bleed)
      const B = outlineBBox(), k = dpi / 25.4;
      const cv = document.createElement('canvas');
      cv.width = Math.round(B.w * k); cv.height = Math.round(B.h * k);
      const ctx = cv.getContext('2d');
      ctx.scale(cv.width / B.w, cv.height / B.h); ctx.translate(-B.x, -B.y);
      await drawBoxArt(ctx, false, false);
      download(await canvasBlob(cv, 'image/png'), name + '_print.png');
    } else {
      // Cricut: только линии, рамка SVG = габарит контура (совпадает с PNG — выравнивается по центру).
      // Design Space ждёт SVG «как из Illustrator»: координаты в pt (1/72″), без единиц и трансформаций —
      // размеры в мм он пересчитывает через 96 dpi, и линии выходят крупнее картинки.
      const B = outlineBBox(), PTMM = 72 / 25.4;
      const conv = d => toPt(d, B, PTMM), r = v => +v.toFixed(3);
      const W = r(B.w * PTMM), H = r(B.h * PTMM);
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" x="0px" y="0px" width="${W}px" height="${H}px" viewBox="0 0 ${W} ${H}">
  <g id="outline-align-only" fill="none" stroke="#9a9a9a" stroke-width="0.72">
    <path d="${conv(BOX.outline)}"/>
  </g>
  <g id="cut-slit" fill="none" stroke="#000000" stroke-width="0.72">
    ${BOX.cuts.map(d => `<path d="${conv(d)}"/>`).join('\n    ')}
  </g>
  <g id="score" fill="none" stroke="#00adee" stroke-width="0.72">
    ${BOX.folds.map(d => `<path d="${conv(d)}"/>`).join('\n    ')}
  </g>
</svg>
`;
      download(new Blob([svg], { type: 'image/svg+xml' }), name + '_cut-score.svg');
    }
  } catch (err) {
    alert('Export failed: ' + err.message);
  } finally { $('#busy').hidden = true; }
}
