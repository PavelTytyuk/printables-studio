'use strict';

/* ---------- Printables Studio: общее для всех продуктов ----------
   Материалы (фото) — одни на все продукты, лежат в общей базе; у каждого продукта своё состояние.
   Продукт (zine/app.js, strip/strip.js) объявляет:
     state, freshState(), renderSheets(), renderPanel()
     APP = { key,            // ключ состояния в базе: 'zine' | 'strip'
             histIgnore,     // поля state, которые не участвуют в Undo (вкладка, настройки экспорта…)
             usedPhotos(),   // Set id фото, занятых в этом продукте
             pick(id),       // тап по фото в Materials
             sanitize(),     // убрать из state ссылки на фото, которых больше нет
             afterRestore(prev) }  // необязательно: после Undo/Redo (prev — состояние до него)
   Продукт без фото (Habit Tracker) просто не выводит блок Materials (#library) — он тогда не подключается. */

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Math.random().toString(36).slice(2, 10);

const photos = new Map(); // id -> {id, name, w, h, blob, preview, sal, url}
let library = [];         // порядок фото в Materials
const PHOTO_MIME = 'application/x-studio-photo';
// где ещё занято фото: id -> подпись для бейджа («zine», «strips»)
const PRODUCTS = { zine: 'zine', strip: 'strips' };
const otherUse = new Map();

/* ---------- Фильтры ----------
   Фильтр — цветовая матрица 3×4 (строки R, G, B; значения 0…1, последний столбец — сдвиг).
   Одна и та же матрица работает в превью (SVG feColorMatrix) и в экспорте (по пикселям). */
const LUMA = [0.2126, 0.7152, 0.0722];
const GRAY = [[...LUMA, 0], [...LUMA, 0], [...LUMA, 0]];
const matMul = (A, B) => A.map(r => [0, 1, 2, 3].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j] + (j === 3 ? r[3] : 0))); // сначала B, потом A
const contrast = c => [[c, 0, 0, (1 - c) / 2], [0, c, 0, (1 - c) / 2], [0, 0, c, (1 - c) / 2]];
const saturate = v => [0, 1, 2].map(i => [...LUMA.map((l, j) => l * (1 - v) + (i === j ? v : 0)), 0]);
const FILTERS = {
  none: { name: 'Original' },
  bw: { name: 'Black & white', m: matMul(contrast(1.08), GRAY) },
  booth: { name: 'Photo booth (high-contrast B&W)', m: matMul(contrast(1.4), GRAY) },
  sepia: { name: 'Sepia', m: [[0.393, 0.769, 0.189, 0], [0.349, 0.686, 0.168, 0], [0.272, 0.534, 0.131, 0]] },
  // выцветшая плёнка: меньше цвета и контраста, приподнятые тени, тёплый оттенок
  faded: { name: 'Faded film', m: matMul([[1.03, 0, 0, 0.03], [0, 1, 0, 0.02], [0, 0, 0.93, 0.04]], matMul(contrast(0.86), saturate(0.72))) },
};
document.body.insertAdjacentHTML('beforeend', `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${
  Object.entries(FILTERS).filter(([, f]) => f.m).map(([id, f]) => `<filter id="flt-${id}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">
    <feColorMatrix type="matrix" values="${f.m.map(r => `${r[0]} ${r[1]} ${r[2]} 0 ${r[3]}`).join(' ')} 0 0 0 1 0"/></filter>`).join('')}</defs></svg>`);
// Матрица фильтра по пикселям прямоугольника холста (в пикселях устройства, обрезается по холсту).
// Округление внутрь: полупрозрачный пиксель на краю не трогаем — иначе у белого промежутка появится цветная кромка
function applyFilterRect(ctx, x, y, w, h, m) {
  const x1 = Math.min(ctx.canvas.width, Math.floor(x + w)), y1 = Math.min(ctx.canvas.height, Math.floor(y + h));
  x = Math.max(0, Math.ceil(x)); y = Math.max(0, Math.ceil(y)); w = x1 - x; h = y1 - y;
  if (!m || w <= 0 || h <= 0) return;
  const img = ctx.getImageData(x, y, w, h), d = img.data;
  const [[a0, a1, a2, a3], [b0, b1, b2, b3], [c0, c1, c2, c3]] = m;
  for (let j = 0; j < d.length; j += 4) {
    const r = d[j], g = d[j + 1], b = d[j + 2];
    d[j] = a0 * r + a1 * g + a2 * b + a3 * 255;
    d[j + 1] = b0 * r + b1 * g + b2 * b + b3 * 255;
    d[j + 2] = c0 * r + c1 * g + c2 * b + c3 * 255;
  }
  ctx.putImageData(img, x, y);
}
const filterCss = id => FILTERS[id]?.m ? `filter:url(#flt-${id})` : '';
const filterSelect = (attr, cur) => `<label class="f">Filter<select ${attr}>${Object.entries(FILTERS).map(([id, f]) => `<option value="${id}"${id === cur ? ' selected' : ''}>${f.name}</option>`).join('')}</select></label>`;

/* ---------- Фото в кадре ---------- */
const rotDims = (p, rot) => (rot || 0) % 180 ? [p.h, p.w] : [p.w, p.h];
const fmtAngle = a => `${+(a || 0) > 0 ? '+' : ''}${+(a || 0)}°`;
// Фото в кадре = отражение (z.mirror, по горизонтали) ∘ поворот на z.rot; fx/fy — точка в этой картинке.
// Поворот на 90° по экрану, кадр остаётся на той же точке снимка. С отражением поворот снимка обратный
function rotatePhoto(z, dir) {
  const { fx, fy } = z;
  if (dir > 0) Object.assign(z, { fx: 1 - fy, fy: fx }); else Object.assign(z, { fx: fy, fy: 1 - fx });
  z.rot = (((z.rot || 0) + (z.mirror ? -dir : dir) * 90) % 360 + 360) % 360;
}
// отражение по горизонтали; кадр остаётся на той же (теперь зеркальной) точке
function mirrorPhoto(z) {
  z.mirror = !z.mirror;
  z.fx = 1 - z.fx;
}
// CSS-трансформация img внутри обёртки .ph
const imgTransform = z => [z.mirror ? 'scaleX(-1)' : '', z.rot ? `rotate(${z.rot}deg)` : ''].join(' ').trim();
// Начальный кадр — центр «интересной области» фото (saliency.js) с учётом поворота на 90° и отражения
function focusFor(photoId, rot = 0, mirror = false) {
  const sal = photos.get(photoId)?.sal, t = { fx: sal ? sal.cx : 0.5, fy: sal ? sal.cy : 0.5, rot: 0 };
  for (let i = 0; i < ((rot || 0) / 90) % 4; i++) rotatePhoto(t, 1);
  return { fx: mirror ? 1 - t.fx : t.fx, fy: t.fy };
}
// кнопки поворота и отражения; attr — data-атрибут действий панели (data-act / data-bact)
const rotateRow = attr => `<div class="row rot-row"><button class="btn" ${attr}="rotl" title="Rotate photo counterclockwise">↺ Rotate</button><button class="btn" ${attr}="mirror" title="Flip photo horizontally">⇆ Flip</button><button class="btn" ${attr}="rotr" title="Rotate photo clockwise">Rotate ↻</button></div>`;
// ширина текста в мм при заданном кегле (мм), тем же шрифтом, что в превью и экспорте
const measureCtx = document.createElement('canvas').getContext('2d');
function textWidth(text, size, weight) {
  measureCtx.font = `${weight} 100px "Ubuntu Sans", sans-serif`;
  return measureCtx.measureText(text).width * size / 100;
}
// захват указателя может не сработать (указатель уже отпущен) — это не повод ломать жест
const capture = (el, id) => { try { el.setPointerCapture(id); } catch (err) { /* ignore */ } };
// курсор в центральной половине элемента (по ширине и высоте)
function nearCenter(el, e) {
  const r = el.getBoundingClientRect();
  return Math.abs(e.clientX - (r.left + r.width / 2)) < r.width / 4 && Math.abs(e.clientY - (r.top + r.height / 2)) < r.height / 4;
}

/* ---------- Материалы ---------- */
const hasLibrary = !!$('#library');
function renderLibrary() {
  if (!hasLibrary) return;
  const used = APP.usedPhotos();
  $('#libCount').textContent = library.length ? `${library.length} photos` : '';
  $('#libStrip').innerHTML = library.length
    ? library.map(id => {
      const p = photos.get(id);
      if (!p) return '';
      const badge = used.has(id) ? '<span class="badge">in use</span>' : otherUse.has(id) ? `<span class="badge other">in ${otherUse.get(id)}</span>` : '';
      return `<div class="thumb${used.has(id) ? ' used' : ''}" draggable="true" data-photo="${id}" title="${esc(p.name)}">
        <img src="${p.url}" alt="">${badge}<button class="del" data-del="${id}" title="Delete">×</button></div>`;
    }).join('')
    : '<div class="lib-empty">Drop photos here or click “Upload photos”</div>';
}
if (hasLibrary) {
$('#libStrip').addEventListener('dragstart', e => {
  const id = e.target.closest('.thumb')?.dataset.photo;
  if (id) { e.dataTransfer.setData(PHOTO_MIME, id); e.dataTransfer.effectAllowed = 'copy'; }
});
$('#libStrip').addEventListener('click', e => {
  const del = e.target.closest('[data-del]')?.dataset.del;
  if (del) { removePhoto(del); return; }
  const id = e.target.closest('.thumb')?.dataset.photo;
  if (id) APP.pick(id);
});
const lib = $('#library');
lib.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); lib.classList.add('drop-hover'); } });
lib.addEventListener('dragleave', () => lib.classList.remove('drop-hover'));
lib.addEventListener('drop', async e => { e.preventDefault(); lib.classList.remove('drop-hover'); await importFiles(e.dataTransfer.files); });
}
// файлы, брошенные мимо, не должны открываться в браузере
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());

// Удаление фото из материалов — насовсем и из всех продуктов (Undo его не возвращает)
function removePhoto(id) {
  if (otherUse.has(id) && !confirm(`This photo is also used in your ${otherUse.get(id)}. Delete it anyway?`)) return;
  URL.revokeObjectURL(photos.get(id)?.url);
  photos.delete(id);
  library = library.filter(x => x !== id);
  DB.del('photos', id);
  saveLibrary();
  APP.sanitize();
  changed();
}
$('#libClearBtn')?.addEventListener('click', async () => {
  if (!library.length) return;
  if (!confirm('Delete all materials? The photos will be removed from everything in Printables Studio — zine, box and strips.')) return;
  photos.forEach(p => URL.revokeObjectURL(p.url));
  photos.clear();
  library = [];
  await DB.clear('photos');
  saveLibrary();
  APP.sanitize();
  changed();
});

/* ---------- Импорт фото ---------- */
// Один файл → запись в библиотеке: превью до 1600 px, оригинал хранится как есть
/* ---------- Дата съёмки из EXIF ----------
   JPEG: DateTimeOriginal (или DateTimeDigitized, или DateTime из IFD0) → 'YYYY-MM-DD'; нет даты — null. */
async function photoDate(blob) {
  try {
    const v = new DataView(await blob.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return null;
    for (let o = 2; o + 10 < v.byteLength;) {
      const m = v.getUint16(o);
      if (m === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return exifDate(v, o + 10); // «Exif»
      if ((m & 0xFF00) !== 0xFF00 || m === 0xFFDA) break; // начались данные изображения
      o += 2 + v.getUint16(o + 2);
    }
  } catch { /* битый файл — без даты */ }
  return null;
}
function exifDate(v, t) { // t — начало TIFF-заголовка; все смещения внутри EXIF считаются от него
  const le = v.getUint16(t) === 0x4949, u16 = o => v.getUint16(t + o, le), u32 = o => v.getUint32(t + o, le);
  const tags = ifd => { const r = {}; for (let i = 0, n = u16(ifd); i < n; i++) r[u16(ifd + 2 + i * 12)] = ifd + 2 + i * 12; return r; };
  const str = e => { const n = u32(e + 4), at = n > 4 ? u32(e + 8) : e + 8; let s = ''; for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint8(t + at + i)); return s; };
  const ifd0 = tags(u32(4));
  let raw = null;
  if (ifd0[0x8769]) { const ex = tags(u32(ifd0[0x8769] + 8)), e = ex[0x9003] || ex[0x9004]; if (e) raw = str(e); }
  if (!raw && ifd0[0x0132]) raw = str(ifd0[0x0132]);
  const m = raw?.match(/^(\d{4}):(\d{2}):(\d{2})/);
  return m && +m[1] > 1900 ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
// Фото, загруженные до появления даты (taken === undefined), — читаем EXIF один раз и сохраняем
const datesPending = new Set();
function ensureDates(ids, onDone) {
  const todo = ids.filter(id => photos.get(id)?.taken === undefined && !datesPending.has(id));
  if (!todo.length) return;
  todo.forEach(id => datesPending.add(id));
  Promise.all(todo.map(async id => {
    const p = photos.get(id);
    p.taken = await photoDate(p.blob);
    datesPending.delete(id);
    const { url, ...rec } = p;
    await DB.put('photos', rec).catch(() => {});
  })).then(onDone);
}

async function importOne(f) {
  const bmp = await createImageBitmap(f);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const rec = { id: uid(), name: f.name, w: bmp.width, h: bmp.height, blob: f, sal: analyzeSaliency(cv), taken: await photoDate(f) };
  bmp.close();
  rec.preview = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
  await DB.put('photos', rec);
  photos.set(rec.id, { ...rec, url: URL.createObjectURL(rec.preview) });
  return rec.id;
}

// Прогресс загрузки: общий для нескольких одновременных импортов
const progress = { total: 0, done: 0 };
function renderProgress() {
  const box = $('#libProgress'), active = progress.done < progress.total;
  box.hidden = !active;
  if (!active) { progress.total = progress.done = 0; return; }
  box.querySelector('.bar > i').style.width = (progress.done / progress.total * 100) + '%';
  box.querySelector('span').textContent = `Uploading ${progress.done} / ${progress.total}`;
}

// Импорт параллельно (3 файла за раз); onFirst вызывается, как только готов первый файл —
// так фото, брошенное на кадр, появляется сразу, не дожидаясь остальных
async function importFiles(fileList, onFirst) {
  const files = [...fileList].filter(f => f.type.startsWith('image/'));
  if (!files.length) return [];
  const ids = new Array(files.length), failed = [];
  progress.total += files.length; renderProgress();
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      try {
        ids[i] = await importOne(files[i]);
        library.push(ids[i]);
        if (i === 0 && onFirst) onFirst(ids[0]);
      } catch (err) { failed.push(files[i].name); }
      progress.done++; renderProgress(); renderLibrary();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  // вернуть порядок файлов как при выборе (параллельная загрузка могла его перемешать)
  const done = ids.filter(Boolean), set = new Set(done);
  library = library.filter(id => !set.has(id)).concat(done);
  saveLibrary();
  if (failed.length) alert(`Couldn’t open: ${failed.join(', ')}\n(Browsers can’t read HEIC — save as JPEG)`);
  changed();
  return done;
}
$('#fileInput')?.addEventListener('change', async e => { await importFiles(e.target.files); e.target.value = ''; });

// фото, загруженные до появления анализа, досчитываем в фоне по превью
async function analyzeMissing() {
  for (const p of photos.values()) {
    if (p.sal) continue;
    try {
      const bmp = await createImageBitmap(p.preview);
      p.sal = analyzeSaliency(bmp);
      bmp.close();
      const { url, ...rec } = p;
      await DB.put('photos', rec);
    } catch (err) { /* без анализа фото просто центрируется */ }
  }
}

/* ---------- Файлы ---------- */
const canvasBlob = (cv, type, q) => new Promise(r => cv.toBlob(r, type, q));
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
// Записывает разрешение (dpi) в файл, чтобы программы открывали картинку в настоящем размере:
// PNG — чанк pHYs после IHDR, JPEG — плотность в заголовке JFIF
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) { let c = ~0; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8); return ~c >>> 0; }
async function withDpi(blob, dpi) {
  const b = new Uint8Array(await blob.arrayBuffer());
  if (blob.type === 'image/png') {
    const ch = new Uint8Array(21), dv = new DataView(ch.buffer), ppm = Math.round(dpi / 0.0254);
    dv.setUint32(0, 9); ch.set([112, 72, 89, 115], 4); // длина, 'pHYs'
    dv.setUint32(8, ppm); dv.setUint32(12, ppm); ch[16] = 1;
    dv.setUint32(17, crc32(ch.subarray(4, 17)));
    return new Blob([b.subarray(0, 33), ch, b.subarray(33)], { type: 'image/png' });
  }
  if (b[2] === 0xFF && b[3] === 0xE0 && b[6] === 0x4A && b[7] === 0x46) { b[13] = 1; b[14] = b[16] = dpi >> 8; b[15] = b[17] = dpi & 255; }
  return new Blob([b], { type: blob.type });
}
// ZIP без сжатия (PNG/JPG и так сжаты): files — [{ name, blob }]
async function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer()), name = enc.encode(f.name), crc = crc32(data);
    const head = (sig, extra) => {
      const b = new Uint8Array(extra + 26 + 4), dv = new DataView(b.buffer);
      let o = 0;
      dv.setUint32(o, sig, true); o += 4;
      if (extra) { dv.setUint16(o, 20, true); o += 2; }          // version made by
      dv.setUint16(o, 20, true); dv.setUint16(o + 2, 0x0800, true); // version needed, имена в UTF-8
      dv.setUint16(o + 4, 0, true);                               // без сжатия
      dv.setUint16(o + 6, 0, true); dv.setUint16(o + 8, 0x21, true); // время, дата (1980-01-01)
      dv.setUint32(o + 10, crc, true); dv.setUint32(o + 14, data.length, true); dv.setUint32(o + 18, data.length, true);
      dv.setUint16(o + 22, name.length, true);
      return { b, dv };
    };
    const local = head(0x04034b50, 0), cen = head(0x02014b50, 16);
    cen.dv.setUint32(42, offset, true);                           // где лежит локальный заголовок
    parts.push(local.b, name, data);
    central.push(cen.b, name);
    offset += local.b.length + name.length + data.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0), end = new Uint8Array(22), dv = new DataView(end.buffer);
  dv.setUint32(0, 0x06054b50, true); dv.setUint16(8, files.length, true); dv.setUint16(10, files.length, true);
  dv.setUint32(12, size, true); dv.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
// один файл скачивается как есть, несколько — одним архивом
async function downloadFiles(files, zipName) {
  if (files.length === 1) download(files[0].blob, files[0].name);
  else if (files.length) download(await makeZip(files), zipName);
}
async function busy(label, fn) {
  $('#busyText').textContent = label; $('#busy').hidden = false;
  try {
    await Promise.all(['700 20px "Ubuntu Sans"', '500 20px "Ubuntu Sans"'].map(f => document.fonts.load(f)));
    await fn();
  } catch (err) { alert('Export failed: ' + err.message); }
  finally { $('#busy').hidden = true; }
}

/* ---------- Вылет (bleed) и метки реза ----------
   Вылет — фон и фото продолжаются за линию реза, чтобы при неточной резке не осталось белой каймы.
   Края готовой картинки продлеваются наружу: крайние ряды пикселей растягиваются на px. */
const BLEED = 2; // мм
function addBleed(src, px) {
  if (!px) return src;
  const W = src.width, H = src.height, cv = document.createElement('canvas');
  cv.width = W + 2 * px; cv.height = H + 2 * px;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.drawImage(src, px, px);
  c.drawImage(src, 0, 0, W, 1, px, 0, W, px);              // верх
  c.drawImage(src, 0, H - 1, W, 1, px, H + px, W, px);     // низ
  c.drawImage(src, 0, 0, 1, H, 0, px, px, H);              // лево
  c.drawImage(src, W - 1, 0, 1, H, W + px, px, px, H);     // право
  c.drawImage(src, 0, 0, 1, 1, 0, 0, px, px);              // углы
  c.drawImage(src, W - 1, 0, 1, 1, W + px, 0, px, px);
  c.drawImage(src, 0, H - 1, 1, 1, 0, H + px, px, px);
  c.drawImage(src, W - 1, H - 1, 1, 1, W + px, H + px, px, px);
  return cv;
}
// Галочки вылета в панели экспорта: для листа PDF (по умолчанию включён) и для отдельных картинок (выключен —
// Cricut Print Then Cut режет по краю картинки и добавляет свой вылет)
const bleedSheetOption = x => `<label class="f check"><input type="checkbox" data-ex="bleed" ${x.bleed ? 'checked' : ''}> ${BLEED} mm bleed past the cut line</label>`;
const bleedImgOption = x => `<label class="f check"><input type="checkbox" data-ex="imgBleed" ${x.imgBleed ? 'checked' : ''}> Add ${BLEED} mm bleed</label>
  <p class="note">For print shops and photo labs: the background runs ${BLEED} mm past every edge. Leave it off for Cricut.</p>`;
// Метки реза у углов; it — линия реза {x, y, w, h} в мм. С вылетом метки начинаются за его краем
function cropMarks(ctx, it, k, bleed = 0) {
  const off = bleed ? bleed + 0.5 : 1, len = bleed ? 1.5 : 2.5;
  ctx.save(); ctx.scale(k, k);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 0.15;
  for (const [cx, sx] of [[it.x, -1], [it.x + it.w, 1]]) for (const [cy, sy] of [[it.y, -1], [it.y + it.h, 1]]) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * off, cy); ctx.lineTo(cx + sx * (off + len), cy);
    ctx.moveTo(cx, cy + sy * off); ctx.lineTo(cx, cy + sy * (off + len));
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------- Бумага: A4 или US Letter — одна настройка на всю Printables Studio ---------- */
const PAPERS = { a4: { id: 'a4', name: 'A4', w: 210, h: 297 }, letter: { id: 'letter', name: 'Letter', w: 215.9, h: 279.4 } };
let paper = PAPERS.a4;
function applyPaper(id) {
  paper = PAPERS[id] || PAPERS.a4;
  document.documentElement.style.setProperty('--paper-ar', `${paper.w} / ${paper.h}`);
  APP.paperChanged?.();
}
const paperSelect = () => `<label class="f">Paper<select data-paper>${Object.values(PAPERS).map(p =>
  `<option value="${p.id}"${p === paper ? ' selected' : ''}>${p.id === 'letter' ? 'US Letter · 8.5×11 in' : 'A4 · 210×297 mm'}</option>`).join('')}</select></label>`;
document.addEventListener('change', e => {
  if (!e.target.matches?.('[data-paper]') || e.target.value === paper.id) return;
  applyPaper(e.target.value);
  DB.put('kv', paper.id, 'paper').catch(() => {});
  renderSheets(); renderPanel();
});

// Минимальный PDF: по странице на картинку JPEG; pages — [{ bytes, W, H }], size — лист в мм
function makePdf(pages, size = paper) {
  const enc = new TextEncoder(), chunks = [], offsets = [];
  let len = 0;
  const push = d => { const b = typeof d === 'string' ? enc.encode(d) : d; chunks.push(b); len += b.length; };
  const obj = (n, parts) => { offsets[n] = len; push(`${n} 0 obj\n`); parts.forEach(push); push('\nendobj\n'); };
  const pw = +(size.w / 25.4 * 72).toFixed(2), ph = +(size.h / 25.4 * 72).toFixed(2), total = 3 + 3 * pages.length;
  push('%PDF-1.4\n');
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  obj(2, [`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`]);
  pages.forEach((pg, i) => {
    const n = 3 + 3 * i, cs = `q ${pw} 0 0 ${ph} 0 0 cm /Im${i} Do Q`;
    obj(n, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im${i} ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`]);
    obj(n + 1, [`<< /Length ${cs.length} >>\nstream\n`, cs, '\nendstream']);
    obj(n + 2, [`<< /Type /XObject /Subtype /Image /Width ${pg.W} /Height ${pg.H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.bytes.length} >>\nstream\n`, pg.bytes, '\nendstream']);
  });
  const xref = len;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

/* ---------- Хранение (IndexedDB) ----------
   База printables-studio: photos — общие материалы; kv — состояние каждого продукта по его ключу
   и порядок фото ('library'). */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open('printables-studio', 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore('photos', { keyPath: 'id' }); rq.result.createObjectStore('kv'); };
      rq.onsuccess = () => { this.db = rq.result; res(); };
      rq.onerror = () => rej(rq.error);
    });
  },
  tx(store, mode, fn) {
    if (!this.db) return Promise.resolve();
    return new Promise((res, rej) => {
      const rq = fn(this.db.transaction(store, mode).objectStore(store));
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
  },
  put(store, val, key) { return this.tx(store, 'readwrite', s => s.put(val, key)); },
  get(store, key) { return this.tx(store, 'readonly', s => s.get(key)); },
  getAll(store) { return this.tx(store, 'readonly', s => s.getAll()); },
  getAllKeys(store) { return this.tx(store, 'readonly', s => s.getAllKeys()); },
  del(store, key) { return this.tx(store, 'readwrite', s => s.delete(key)); },
  clear(store) { return this.tx(store, 'readwrite', s => s.clear()); },
};

// Раньше у каждого продукта была своя база. Переносим фото и состояние в общую; в старой базе
// фото стираются только после проверки, что все они на месте в новой (состояние там остаётся).
const LEGACY = { zine: 'zine-studio', strip: 'strip-studio' };
function openLegacy(name) {
  return new Promise(res => {
    const rq = indexedDB.open(name);
    rq.onupgradeneeded = () => rq.transaction.abort(); // базы не было — не создаём
    rq.onsuccess = () => res(rq.result);
    rq.onerror = e => { e.preventDefault(); res(null); };
  });
}
async function migrateLegacy() {
  if (await DB.get('kv', 'migrated')) return;
  let order = (await DB.get('kv', 'library')) || [];
  for (const [key, name] of Object.entries(LEGACY)) {
    const old = await openLegacy(name);
    if (!old) continue;
    try {
      if (!old.objectStoreNames.contains('photos')) continue;
      const rq = (store, fn, mode = 'readonly') => new Promise((res, rej) => {
        const r = fn(old.transaction(store, mode).objectStore(store));
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      const st = await rq('kv', s => s.get('state')), keys = await rq('photos', s => s.getAllKeys());
      for (const id of keys) await DB.put('photos', await rq('photos', s => s.get(id)));
      if (st) {
        order = order.concat((st.library || []).filter(id => !order.includes(id)));
        delete st.library;
        if (!(await DB.get('kv', key))) await DB.put('kv', st, key);
      }
      await DB.put('kv', order, 'library');
      const have = new Set(await DB.getAllKeys('photos'));
      if (keys.every(id => have.has(id))) await rq('photos', s => s.clear(), 'readwrite');
    } finally { old.close(); }
  }
  await DB.put('kv', true, 'migrated');
}

// все id фото, упомянутые в сохранённом состоянии другого продукта (поля photo на любой глубине)
function photoRefs(o, out = new Set()) {
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) {
    if (k === 'photo') { if (typeof v === 'string') out.add(v); } else photoRefs(v, out);
  }
  return out;
}
// порядок фото и «занято в другом продукте» — из базы
async function loadShared() {
  const pid = (await DB.get('kv', 'paper')) || 'a4', paperMoved = pid !== paper.id;
  if (paperMoved) applyPaper(pid);
  const order = (await DB.get('kv', 'library')) || [], seen = new Set(order);
  library = order.filter(id => photos.has(id)).concat([...photos.keys()].filter(id => !seen.has(id)));
  otherUse.clear();
  for (const [key, label] of Object.entries(PRODUCTS)) {
    if (key === APP.key) continue;
    photoRefs(await DB.get('kv', key)).forEach(id => otherUse.set(id, label));
  }
  return paperMoved;
}
// Открывает базу, загружает материалы; возвращает сохранённое состояние продукта (или undefined)
async function loadStudio() {
  try {
    await DB.open();
    try { await migrateLegacy(); } catch (err) { console.warn('Could not move data from the old storage', err); }
    if (hasLibrary) for (const rec of await DB.getAll('photos')) photos.set(rec.id, { ...rec, url: URL.createObjectURL(rec.preview) });
    await loadShared();
    const saved = await DB.get('kv', APP.key);
    if (saved) delete saved.library;
    return saved;
  } catch (err) { console.warn('IndexedDB unavailable, working without saving', err); }
}
// Материалы могли измениться в другой вкладке (другом продукте) — подтягиваем при возврате на вкладку
async function syncMaterials() {
  if (!DB.db || progress.total) return;
  try {
    if (!hasLibrary) { if (await loadShared()) changed(); return; }
    const keys = await DB.getAllKeys('photos'), have = new Set(keys);
    let dirty = false;
    for (const [id, p] of [...photos]) if (!have.has(id)) { URL.revokeObjectURL(p.url); photos.delete(id); dirty = true; }
    for (const id of keys) {
      if (photos.has(id)) continue;
      const rec = await DB.get('photos', id);
      if (rec && !photos.has(id)) { photos.set(id, { ...rec, url: URL.createObjectURL(rec.preview) }); dirty = true; }
    }
    if (await loadShared()) dirty = true; // бумагу сменили в другой вкладке
    if (dirty) { APP.sanitize(); changed(); } else renderLibrary();
  } catch (err) { /* база недоступна — остаёмся с тем, что есть */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncMaterials(); });

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => DB.put('kv', state, APP.key).catch(() => {}), 300);
  // непрерывная правка (ползунок, ввод текста, перетаскивание) — один шаг Undo, когда она затихнет
  clearTimeout(hist.timer);
  hist.timer = setTimeout(histCommit, 600);
}
function saveLibrary() { DB.put('kv', library, 'library').catch(() => {}); }
function changed() { renderSheets(); renderPanel(); renderLibrary(); save(); histCommit(); }

/* ---------- Undo / Redo ----------
   История — снимки state (JSON) в памяти вкладки. Материалы в неё не входят: удалённое фото
   Undo не вернёт, ссылки на него просто убираются (APP.sanitize). */
const hist = { undo: [], redo: [], cur: null, timer: 0 };
function histSnap() {
  const o = { ...state };
  APP.histIgnore.forEach(k => delete o[k]);
  return JSON.stringify(o);
}
function histCommit() {
  clearTimeout(hist.timer);
  const j = histSnap();
  if (j === hist.cur) return;
  if (hist.cur !== null) {
    hist.undo.push(hist.cur);
    if (hist.undo.length > 100) hist.undo.shift();
    hist.redo.length = 0;
  }
  hist.cur = j;
  histButtons();
}
// точка отсчёта: состояние после загрузки
function histReset() { clearTimeout(hist.timer); hist.undo.length = hist.redo.length = 0; hist.cur = histSnap(); histButtons(); }
function histButtons() {
  $('#undoBtn').disabled = !hist.undo.length;
  $('#redoBtn').disabled = !hist.redo.length;
}
function histGo(from, to) {
  histCommit();
  if (!from.length) return;
  to.push(hist.cur);
  const prev = state, keep = {};
  APP.histIgnore.forEach(k => { keep[k] = state[k]; });
  state = { ...JSON.parse(from.pop()), ...keep };
  APP.sanitize();
  APP.afterRestore?.(prev);
  hist.cur = histSnap();
  renderSheets(); renderPanel(); renderLibrary();
  clearTimeout(saveTimer);
  DB.put('kv', state, APP.key).catch(() => {});
  histButtons();
}
const undo = () => histGo(hist.undo, hist.redo);
const redo = () => histGo(hist.redo, hist.undo);
// конец правки в поле (выбор в списке, галочка, отпущенный ползунок) — отдельный шаг
document.addEventListener('change', () => histCommit());
$('#undoBtn').addEventListener('click', undo);
$('#redoBtn').addEventListener('click', redo);
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  // в текстовых полях Ctrl+Z — обычная отмена ввода
  if (e.target.matches?.('input[type=text], input[type=number], textarea')) return;
  const k = e.key.toLowerCase();
  if (k === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)(); }
  else if (k === 'y') { e.preventDefault(); redo(); }
});
