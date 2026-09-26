/* Saving photographs to the phone's gallery, and writing the date, GPS position and
   caption back into each JPEG as EXIF (resizing on a canvas strips the original data).
   Loaded before app.js and uses its helpers only when called. */
'use strict';

// ─── EXIF writer ───────────────────────────────────────────
const EX = {
  u16: v => [(v >> 8) & 255, v & 255],
  u32: v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255],
  ascii: s => { const b = [...String(s || '').replace(/[^\x20-\x7e]/g, '')].map(c => c.charCodeAt(0)); b.push(0); return b; },
  rational: list => list.flatMap(([n, d]) => [...EX.u32(n), ...EX.u32(d)]),
};

// entries: [tag, type, count, bytes]. Types: 1 byte, 2 ascii, 4 long, 5 rational.
function ifdBytes(entries, start) {
  entries = entries.slice().sort((a, b) => a[0] - b[0]);
  const out = [...EX.u16(entries.length)], extra = [];
  const dataStart = start + 2 + entries.length * 12 + 4;
  for (const [tag, type, count, bytes] of entries) {
    out.push(...EX.u16(tag), ...EX.u16(type), ...EX.u32(count));
    if (bytes.length <= 4) { const b = bytes.slice(); while (b.length < 4) b.push(0); out.push(...b); }
    else { out.push(...EX.u32(dataStart + extra.length)); extra.push(...bytes); if (extra.length % 2) extra.push(0); }
  }
  out.push(0, 0, 0, 0);
  return out.concat(extra);
}

function exifDate(ms) {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function dms(v) {
  v = Math.abs(v);
  const d = Math.floor(v), mf = (v - d) * 60, m = Math.floor(mf), s = Math.round((mf - m) * 60 * 1000);
  return [[d, 1], [m, 1], [s, 1000]];
}

function buildExif({ taken, pos, caption, artist }) {
  const date = EX.ascii(exifDate(taken || Date.now()));
  const ifd0 = [
    [0x0131, 2, 0, EX.ascii('Inspection Notes')],
    [0x0132, 2, 20, date],
  ];
  if (caption) { const c = EX.ascii(caption); ifd0.push([0x010E, 2, c.length, c]); }
  if (artist) { const a = EX.ascii(artist); ifd0.push([0x013B, 2, a.length, a]); }
  ifd0[0][2] = ifd0[0][3].length;
  const exif = [[0x9003, 2, 20, date], [0x9004, 2, 20, date]];
  const gps = pos && isFinite(pos.lat) && isFinite(pos.lng) ? [
    [0x0000, 1, 4, [2, 3, 0, 0]],
    [0x0001, 2, 2, EX.ascii(pos.lat >= 0 ? 'N' : 'S')],
    [0x0002, 5, 3, EX.rational(dms(pos.lat))],
    [0x0003, 2, 2, EX.ascii(pos.lng >= 0 ? 'E' : 'W')],
    [0x0004, 5, 3, EX.rational(dms(pos.lng))],
  ] : null;
  // Lay out IFD0, then the Exif IFD, then the GPS IFD. Sizes do not depend on the pointer values.
  const ptrs = [[0x8769, 4, 1, EX.u32(0)]];
  if (gps) ptrs.push([0x8825, 4, 1, EX.u32(0)]);
  const len0 = ifdBytes([...ifd0, ...ptrs], 8).length;
  const exifStart = 8 + len0;
  const exifBytes = ifdBytes(exif, exifStart);
  const gpsStart = exifStart + exifBytes.length;
  ptrs[0][3] = EX.u32(exifStart);
  if (gps) ptrs[1][3] = EX.u32(gpsStart);
  const tiff = [0x4D, 0x4D, 0x00, 0x2A, ...EX.u32(8), ...ifdBytes([...ifd0, ...ptrs], 8), ...exifBytes, ...(gps ? ifdBytes(gps, gpsStart) : [])];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]; // "Exif\0\0"
  return new Uint8Array([0xFF, 0xE1, ...EX.u16(body.length + 2), ...body]);
}

// Returns the photo as a JPEG blob carrying EXIF. Files that already have EXIF are left alone.
async function photoWithExif(p) {
  try {
    const buf = new Uint8Array(await p.blob.arrayBuffer());
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return p.blob;
    let pos = 2;
    while (pos + 4 < buf.length && buf[pos] === 0xFF && buf[pos + 1] >= 0xE0 && buf[pos + 1] <= 0xEF) {
      const marker = buf[pos + 1], len = (buf[pos + 2] << 8) | buf[pos + 3];
      if (marker === 0xE1 && String.fromCharCode(...buf.slice(pos + 4, pos + 8)) === 'Exif') return p.blob;
      if (marker !== 0xE0) break; // keep other segments, drop only the JFIF header
      pos += 2 + len;
    }
    const app1 = buildExif({ taken: p.taken, pos: p.pos, caption: p.caption, artist: S.job && S.job.inspector });
    return new Blob([buf.slice(0, 2), app1, buf.slice(pos)], { type: 'image/jpeg' });
  } catch (e) {
    console.warn('EXIF not added', e);
    return p.blob;
  }
}

// ─── Saving to the gallery ─────────────────────────────────
const GALLERY_BATCH = 20;
const IS_ANDROID = /Android/.test(navigator.userAgent);

function galleryMethod() {
  if (IS_IOS && navigator.canShare) return 'share';
  return 'download';
}

// Photographs that still need a copy in the gallery. Ones brought in from the library are already there.
const needsGallery = list => list.filter(p => !p.gallery && !p.fromLibrary);

async function saveToGallery(list, names) {
  const todo = list.slice(0, GALLERY_BATCH);
  if (!todo.length) { toast('These photographs are already in the gallery'); return 0; }
  names = names || photoFileNames(S.items || [], todo);
  const files = [];
  for (const p of todo) {
    const blob = await photoWithExif(p);
    const name = (names && names.get(p.id) || `${safe(p.caption || 'Photo')} ${p.id}.jpg`).replace(/^photos\//, '');
    files.push(new File([blob], name, { type: 'image/jpeg', lastModified: p.taken }));
  }
  let saved = false;
  if (galleryMethod() === 'share' && navigator.canShare({ files })) {
    try { await navigator.share({ files }); saved = true; }
    catch (e) {
      if (e.name === 'AbortError') return 0;
      toast('The share sheet could not be opened. Tap the button again.', 4000);
      return 0;
    }
  } else {
    for (const f of files) {
      const a = h('a', { href: URL.createObjectURL(f), download: f.name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      await new Promise(r => setTimeout(r, 350));
    }
    saved = true;
  }
  if (saved) {
    const now = Date.now();
    for (const p of todo) { p.gallery = now; await DB.put('photos', p); }
    const left = list.length - todo.length;
    toast(left ? `${todo.length} saved. Tap again for the next ${Math.min(left, GALLERY_BATCH)}.` : `${todo.length} photograph${todo.length > 1 ? 's' : ''} sent to the gallery`, 4000);
  }
  return saved ? todo.length : 0;
}

function galleryButton(photos, label) {
  const todo = needsGallery(photos);
  if (!photos.length) return null;
  const text = todo.length
    ? `${label || 'Save to phone gallery'} (${todo.length} not yet saved)`
    : 'All photographs are in the gallery';
  return h('button', {
    class: 'btn sec block', disabled: !todo.length || null,
    onclick: async () => {
      const items = S.items || [];
      const n = await saveToGallery(todo, photoFileNames(items, photos));
      if (n) render();
    },
  }, text);
}
