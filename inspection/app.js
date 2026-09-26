/* Inspection Notes: site inspection recorder for valuation work.
   Plain JavaScript, no build step. Data is kept on the device in IndexedDB. */
'use strict';

const APP_VERSION = '1.1.0';
const PAL = { dark: '013C29', green: '015037', light: '5A8D7C', pale: 'E1E8CE' };
const SQFT = 10.7639;
const ACRE = 2.47105;

// ─── Small helpers ─────────────────────────────────────────
const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
const fmt = (v, dp = 2) => Number(v).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmt0 = v => Math.round(v).toLocaleString('en-GB');
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toTimeString().slice(0, 5);
const safe = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const lc = s => s ? s.charAt(0).toLowerCase() + s.slice(1) : '';

function ordinal(d) {
  const s = ['th', 'st', 'nd', 'rd'], v = d % 100;
  return d + (s[(v - 20) % 10] || s[v] || s[0]);
}
function ukDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${ordinal(d)} ${months[m - 1]} ${y}`;
}

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

function toast(msg, ms = 2400) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

// ─── IndexedDB ─────────────────────────────────────────────
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('inspection-notes', 2);
      r.onupgradeneeded = e => {
        const db = r.result;
        if (e.oldVersion < 1) {
          db.createObjectStore('jobs', { keyPath: 'id' });
          const it = db.createObjectStore('items', { keyPath: 'id' });
          it.createIndex('jobId', 'jobId');
          const ph = db.createObjectStore('photos', { keyPath: 'id' });
          ph.createIndex('jobId', 'jobId');
          ph.createIndex('itemId', 'itemId');
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (e.oldVersion < 2) {
          const vm = db.createObjectStore('memos', { keyPath: 'id' });
          vm.createIndex('jobId', 'jobId');
          vm.createIndex('itemId', 'itemId');
        }
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  req(store, mode, fn) {
    return new Promise((res, rej) => {
      const tx = this.db.transaction(store, mode);
      const out = fn(tx.objectStore(store));
      tx.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  },
  get: (s, id) => DB.req(s, 'readonly', st => st.get(id)),
  put: (s, v) => DB.req(s, 'readwrite', st => st.put(v)),
  del: (s, id) => DB.req(s, 'readwrite', st => st.delete(id)),
  all: s => DB.req(s, 'readonly', st => st.getAll()),
  by: (s, idx, v) => DB.req(s, 'readonly', st => st.index(idx).getAll(v)),
};

async function getSetting(key, def) {
  const r = await DB.get('settings', key);
  return r ? r.value : def;
}
const setSetting = (key, value) => DB.put('settings', { key, value });

// ─── Field definitions ─────────────────────────────────────
const CONDITION = ['', 'Good', 'Fair', 'Poor', 'Very poor', 'Dilapidated'];

const LISTS = {
  dwellingType: ['Farmhouse', 'Farm cottage', 'Detached house', 'Semi-detached house', 'Terraced cottage', 'Bungalow', 'Barn conversion', 'Annexe', 'Flat', 'Mobile home', 'Holiday let'],
  occupancy: ['Owner occupied', 'Vacant', 'Assured shorthold tenancy', 'Rent Act protected tenancy', 'Assured agricultural occupancy', 'Service occupancy', 'Holiday let', 'Family occupation'],
  walls: ['Solid stone', 'Rendered stone', 'Solid brick', 'Cavity brick', 'Brick and block cavity', 'Rendered block', 'Timber frame', 'Timber clad', 'Stone and brick', 'Non-traditional'],
  roof: ['Pitched, natural slate', 'Pitched, concrete tile', 'Pitched, clay tile', 'Pitched, fibre cement slate', 'Thatch', 'Flat, felt', 'Flat, single ply', 'Hipped, clay tile'],
  windows: ['uPVC double glazed', 'Timber double glazed', 'Timber single glazed', 'Timber sash, single glazed', 'Aluminium double glazed', 'Mixed'],
  heating: ['Oil fired central heating', 'LPG central heating', 'Mains gas central heating', 'Air source heat pump', 'Ground source heat pump', 'Biomass boiler', 'Solid fuel', 'Electric storage heaters', 'None'],
  water: ['Mains water', 'Private borehole', 'Private spring', 'Mains and private'],
  drainage: ['Mains drainage', 'Septic tank', 'Package treatment plant', 'Cesspit', 'Shared septic tank'],
  electricity: ['Mains single phase', 'Mains three phase', 'Off grid', 'Mains with solar PV'],
  roomName: ['Entrance hall', 'Hall', 'Porch', 'Sitting room', 'Living room', 'Dining room', 'Kitchen', 'Kitchen/breakfast room', 'Kitchen/dining room', 'Utility room', 'Boot room', 'Rear porch', 'Pantry', 'Study', 'Office', 'Snug', 'Conservatory', 'Garden room', 'Cloakroom', 'WC', 'Landing', 'Bedroom 1', 'Bedroom 2', 'Bedroom 3', 'Bedroom 4', 'Bedroom 5', 'En suite', 'Bathroom', 'Shower room', 'Dressing room', 'Airing cupboard', 'Cellar', 'Attic room', 'Garage', 'Store'],
  floor: ['Lower ground floor', 'Ground floor', 'First floor', 'Second floor', 'Attic', 'Cellar', 'Outside'],
  flooring: ['Carpet', 'Quarry tile', 'Ceramic tile', 'Stone flag', 'Wood', 'Laminate', 'Vinyl', 'Concrete'],
  buildingUse: ['General purpose store', 'Grain store', 'Livestock building', 'Cattle court', 'Cubicle house', 'Dairy parlour', 'Calf house', 'Sheep shed', 'Dutch barn', 'Implement shed', 'Workshop', 'Machinery store', 'Potato store', 'Fertiliser store', 'Silage clamp', 'Slurry store', 'Lean-to', 'Traditional stone barn', 'Traditional brick barn', 'Stables', 'Poultry house', 'Pig building', 'Garage', 'Store'],
  frame: ['Steel portal frame', 'Concrete portal frame', 'Timber pole', 'Timber frame', 'Loadbearing stone', 'Loadbearing brick', 'Loadbearing block', 'Steel stanchion and truss'],
  cladding: ['Fibre cement sheet', 'Box profile steel sheet', 'Yorkshire boarding', 'Space boarding', 'Concrete block', 'Concrete panel', 'Open sided', 'Stone', 'Brick', 'Timber weatherboard'],
  bRoof: ['Fibre cement sheet', 'Box profile steel sheet', 'Insulated steel panel', 'Corrugated iron', 'Natural slate', 'Clay tile', 'Concrete tile', 'Asbestos cement sheet (suspected)'],
  bFloor: ['Concrete', 'Earth', 'Hardcore', 'Slatted concrete', 'Brick', 'Cobbled'],
  landUse: ['Arable', 'Permanent pasture', 'Temporary grass', 'Rough grazing', 'Woodland', 'Orchard', 'Horticulture', 'Paddock', 'Meadow', 'Scrub', 'Yard', 'Water'],
  siteTopic: ['Access and approach', 'Farmyard and hardstanding', 'Services', 'Boundaries', 'Rights of way', 'Flood risk and watercourses', 'Environmental and ESG', 'Renewables', 'Development potential', 'Sporting and amenity', 'Neighbouring uses', 'Other observation'],
};

// kind -> label, prefix for references, field list
const KINDS = {
  dwelling: {
    label: 'Dwelling', plural: 'Residential', prefix: 'H',
    fields: [
      ['ref', 'Ref', 'short'], ['name', 'Name', 'text'],
      ['type', 'Type', 'list:dwellingType'], ['storeys', 'Storeys', 'short'],
      ['age', 'Approximate age or date', 'text'], ['listed', 'Listed or conservation area', 'text'],
      ['walls', 'Walls', 'list:walls'], ['roof', 'Roof', 'list:roof'],
      ['windows', 'Windows', 'list:windows'], ['heating', 'Heating', 'list:heating'],
      ['water', 'Water', 'list:water'], ['drainage', 'Drainage', 'list:drainage'],
      ['electricity', 'Electricity', 'list:electricity'], ['epc', 'EPC rating', 'short'],
      ['councilTax', 'Council tax band', 'short'], ['occupancy', 'Occupancy', 'list:occupancy'],
      ['gardens', 'Gardens, garaging and outbuildings', 'area'],
      ['condition', 'Condition', 'condition'], ['defects', 'Defects and repairs noted', 'area'],
      ['notes', 'Description and notes', 'area'],
    ],
    measures: true,
  },
  room: {
    label: 'Room', plural: 'Rooms', prefix: '',
    fields: [
      ['name', 'Room', 'list:roomName'], ['floor', 'Floor', 'list:floor'],
      ['ceiling', 'Ceiling height (m)', 'num'], ['flooring', 'Floor finish', 'list:flooring'],
      ['features', 'Features and fittings', 'area'],
      ['condition', 'Condition', 'condition'], ['notes', 'Notes', 'area'],
    ],
    measures: true,
  },
  building: {
    label: 'Farm building', plural: 'Farm buildings', prefix: 'B',
    fields: [
      ['ref', 'Ref', 'short'], ['name', 'Description or use', 'list:buildingUse'],
      ['age', 'Approximate age or date', 'text'], ['frame', 'Frame', 'list:frame'],
      ['walls', 'Walls', 'list:cladding'], ['cladding', 'Upper cladding', 'list:cladding'],
      ['roof', 'Roof', 'list:bRoof'], ['floor', 'Floor', 'list:bFloor'],
      ['doors', 'Doors and openings', 'text'], ['services', 'Services (electricity, water, lighting)', 'text'],
      ['eaves', 'Eaves height (m)', 'num'], ['ridge', 'Ridge height (m)', 'num'],
      ['capacity', 'Capacity (tonnes, head, cubicles)', 'text'], ['currentUse', 'Current use and occupation', 'text'],
      ['condition', 'Condition', 'condition'], ['defects', 'Defects and repairs noted', 'area'],
      ['notes', 'Description and notes', 'area'],
    ],
    measures: true,
  },
  land: {
    label: 'Land parcel', plural: 'Land', prefix: 'F',
    fields: [
      ['ref', 'Field or parcel no.', 'short'], ['name', 'Name', 'text'],
      ['hectares', 'Area (ha)', 'num'], ['use', 'Current use', 'list:landUse'],
      ['grade', 'ALC grade or soil', 'text'], ['topography', 'Topography and aspect', 'text'],
      ['boundaries', 'Boundaries', 'text'], ['water', 'Water supply', 'text'],
      ['access', 'Access', 'text'], ['designations', 'Designations, schemes, rights of way', 'area'],
      ['condition', 'Condition', 'condition'], ['notes', 'Notes', 'area'],
    ],
    measures: false,
  },
  site: {
    label: 'Site observation', plural: 'Site, services and general', prefix: 'S',
    fields: [
      ['name', 'Topic', 'list:siteTopic'], ['notes', 'Observations', 'area'],
    ],
    measures: false,
  },
};
const KIND_ORDER = ['dwelling', 'building', 'land', 'site'];

const JOB_FIELDS = [
  ['ref', 'Our reference', 'short'], ['name', 'Property name', 'text'],
  ['address', 'Address', 'area'], ['postcode', 'Postcode', 'short'],
  ['client', 'Client', 'text'], ['purpose', 'Purpose of valuation', 'text'],
  ['basis', 'Basis of value', 'text'], ['valDate', 'Valuation date', 'date'],
  ['inspDate', 'Inspection date', 'date'], ['inspector', 'Inspected by', 'text'],
  ['inspStart', 'Time started', 'time'], ['inspEnd', 'Time finished', 'time'],
  ['attendees', 'Present at inspection', 'text'], ['weather', 'Weather and ground conditions', 'text'],
  ['extent', 'Extent of inspection', 'area'], ['limitations', 'Limitations and areas not inspected', 'area'],
  ['tenure', 'Tenure and occupation as seen or stated', 'area'], ['totalArea', 'Total area stated (ha)', 'num'],
  ['esg', 'ESG, environmental and sustainability observations', 'area'],
  ['notes', 'General notes', 'area'],
];

// ─── App state ─────────────────────────────────────────────
const S = { job: null, items: [], thumbs: new Map(), timer: null, pending: new Map(), settings: {} };

function thumbURL(p) {
  if (!S.thumbs.has(p.id)) S.thumbs.set(p.id, URL.createObjectURL(p.thumb || p.blob));
  return S.thumbs.get(p.id);
}

function scheduleSave(obj, store) {
  obj.updated = Date.now();
  S.pending.set(store + ':' + obj.id, [store, obj]);
  $('#saving').textContent = 'Saving…';
  clearTimeout(S.timer);
  S.timer = setTimeout(flushSaves, 500);
}
async function flushSaves() {
  clearTimeout(S.timer);
  if (!S.pending.size) return;
  const list = [...S.pending.values()];
  S.pending.clear();
  let touchJob = null;
  for (const [store, obj] of list) {
    await DB.put(store, obj);
    if (store !== 'jobs' && S.job && obj.jobId === S.job.id) touchJob = S.job;
  }
  if (touchJob) { touchJob.updated = Date.now(); await DB.put('jobs', touchJob); }
  $('#saving').textContent = 'Saved';
  setTimeout(() => { if ($('#saving').textContent === 'Saved') $('#saving').textContent = ''; }, 1200);
  requestPersist();
}
window.addEventListener('pagehide', flushSaves);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSaves(); });

let persistAsked = false;
async function requestPersist() {
  if (persistAsked || !navigator.storage?.persist) return;
  persistAsked = true;
  try { await navigator.storage.persist(); } catch (e) { /* not supported */ }
}

// ─── Form building ─────────────────────────────────────────
function field(obj, def, store, onChange) {
  const [key, label, type] = def;
  const save = v => { obj[key] = v; scheduleSave(obj, store); onChange && onChange(key, v); };
  let input;
  if (type === 'area') {
    input = h('textarea', { value: obj[key] || '', oninput: e => save(e.target.value), placeholder: Dict.mode() === 'app' ? 'Type, or tap the microphone and speak' : 'Type, or use the microphone key on the keyboard' });
  } else if (type === 'condition') {
    input = h('select', { onchange: e => save(e.target.value) },
      CONDITION.map(c => h('option', { value: c, selected: (obj[key] || '') === c }, c || '–')));
  } else if (type.startsWith('list:')) {
    const listId = 'dl-' + type.slice(5);
    if (!document.getElementById(listId)) {
      document.body.append(h('datalist', { id: listId }, LISTS[type.slice(5)].map(o => h('option', { value: o }))));
    }
    input = h('input', { type: 'text', list: listId, value: obj[key] || '', oninput: e => save(e.target.value), autocomplete: 'off' });
  } else {
    const t = { num: 'text', short: 'text', text: 'text', date: 'date', time: 'time' }[type] || 'text';
    input = h('input', { type: t, value: obj[key] || '', inputmode: type === 'num' ? 'decimal' : null, oninput: e => save(e.target.value) });
  }
  input.dataset.key = key;
  const speakable = !['condition', 'date', 'time'].includes(type) && Dict.mode() === 'app';
  return h('label', { class: 'f' }, h('span', null, label), speakable ? h('div', { class: 'fld' }, input, micButton(input, type === 'num')) : input);
}

function fieldGrid(obj, defs, store, onChange) {
  const out = [];
  let pair = [];
  for (const d of defs) {
    const small = ['short', 'num', 'date', 'time', 'condition'].includes(d[2]) || d[2].startsWith('list:');
    if (small && d[2] !== 'area') {
      pair.push(field(obj, d, store, onChange));
      if (pair.length === 2) { out.push(h('div', { class: 'row' }, pair)); pair = []; }
    } else {
      if (pair.length) { out.push(h('div', { class: 'row' }, pair)); pair = []; }
      out.push(field(obj, d, store, onChange));
    }
  }
  if (pair.length) out.push(h('div', { class: 'row' }, pair, h('div')));
  return out;
}

// ─── Measurements ──────────────────────────────────────────
const rowArea = r => r.direct ? num(r.area) : num(r.l) * num(r.w);
function measureArea(rows) {
  return (rows || []).reduce((t, r) => t + rowArea(r), 0);
}
function measureBlock(item) {
  item.measures = item.measures || [];
  const body = h('tbody');
  const total = h('div', { class: 'total' });
  const recalc = () => {
    const a = measureArea(item.measures);
    total.replaceChildren(h('span', null, 'Total'), h('span', null, a ? `${fmt(a)} m²  (${fmt0(a * SQFT)} sq ft)` : '–'));
  };
  const draw = () => {
    body.replaceChildren(...item.measures.map((r, i) => {
      const areaCell = h('td', { class: 'area' });
      const show = () => { const a = rowArea(r); areaCell.textContent = a ? fmt(a) : ''; };
      const upd = () => { show(); recalc(); scheduleSave(item, 'items'); };
      show();
      const inp = (k, ph, mode) => h('input', { value: r[k] || '', placeholder: ph, inputmode: mode, oninput: e => { r[k] = e.target.value; upd(); } });
      return h('tr', null,
        h('td', null, inp('label', r.direct ? 'Stated area' : item.kind === 'room' ? 'Main' : 'Section', null)),
        r.direct ? h('td', { colspan: 2 }, inp('area', 'Area m²', 'decimal'))
          : [h('td', null, inp('l', 'L m', 'decimal')), h('td', null, inp('w', 'W m', 'decimal'))],
        areaCell,
        h('td', { class: 'x' }, h('button', { class: 'btn ghost sm', onclick: () => { item.measures.splice(i, 1); scheduleSave(item, 'items'); draw(); } }, '✕')));
    }));
    recalc();
  };
  if (!item.measures.length) item.measures.push({ label: '', l: '', w: '' });
  draw();
  return h('div', null,
    h('table', { class: 'meas' },
      h('thead', null, h('tr', null, h('th', null, 'Part'), h('th', null, 'Length'), h('th', null, 'Width'), h('th', { style: { textAlign: 'right' } }, 'm²'), h('th'))),
      body),
    total,
    h('div', { class: 'btns' },
      h('button', { class: 'btn sec sm', onclick: () => { item.measures.push({ label: '', l: '', w: '' }); draw(); } }, '+ Add section'),
      h('button', { class: 'btn sec sm', onclick: () => { item.measures.push({ label: '', direct: true, area: '' }); draw(); } }, '+ Enter an area directly')),
    h('p', { class: 'muted' }, 'Use one line per rectangle for L-shaped or irregular plans, and enter a negative length to deduct a section. Measurements are in metres, and the area in square feet is shown alongside.'));
}

// ─── Photos ────────────────────────────────────────────────
let photoTarget = null; // {jobId, itemId}
let lastFix = null;

function getPosition() {
  if (!S.settings.gps || !navigator.geolocation) return Promise.resolve(null);
  return new Promise(res => {
    navigator.geolocation.getCurrentPosition(
      p => { lastFix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }; res(lastFix); },
      () => res(lastFix), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  });
}

function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { res(img); URL.revokeObjectURL(url); };
    img.onerror = () => { rej(new Error('Could not read image')); URL.revokeObjectURL(url); };
    img.src = url;
  });
}
function scaleTo(img, max, q) {
  let w = img.naturalWidth, hgt = img.naturalHeight;
  const s = Math.min(1, max / Math.max(w, hgt));
  w = Math.round(w * s); hgt = Math.round(hgt * s);
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  c.getContext('2d').drawImage(img, 0, 0, w, hgt);
  return new Promise(res => c.toBlob(b => res({ blob: b, w, h: hgt }), 'image/jpeg', q));
}

async function addPhotos(files, fromCamera) {
  if (!files.length || !photoTarget) return;
  const pos = fromCamera ? await getPosition() : null;
  const max = S.settings.photoMax || 2400;
  let n = 0;
  for (const f of files) {
    try {
      const img = await loadImage(f);
      const main = max >= 9999 && f.type === 'image/jpeg' ? { blob: f, w: img.naturalWidth, h: img.naturalHeight } : await scaleTo(img, max, 0.85);
      const th = await scaleTo(img, 320, 0.7);
      const p = {
        id: uid(), jobId: photoTarget.jobId, itemId: photoTarget.itemId || null,
        blob: main.blob, thumb: th.blob, w: main.w, h: main.h,
        caption: '', taken: Date.now(), fileName: f.name || '', pos: pos || null,
        order: Date.now() + n, inReport: true,
      };
      await DB.put('photos', p);
      n++;
    } catch (e) { console.error(e); toast('One photo could not be read'); }
  }
  if (n) {
    toast(`${n} photo${n > 1 ? 's' : ''} saved`);
    S.job.updated = Date.now(); await DB.put('jobs', S.job);
    requestPersist();
    render();
  }
}
$('#camInput').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; addPhotos(f, true); });
$('#libInput').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; addPhotos(f, false); });

function photoButtons(jobId, itemId) {
  return h('div', { class: 'btns' },
    h('button', { class: 'btn', onclick: () => { photoTarget = { jobId, itemId }; $('#camInput').click(); } }, '📷 Take photo'),
    h('button', { class: 'btn sec', onclick: () => { photoTarget = { jobId, itemId }; $('#libInput').click(); } }, 'From library'));
}

function photoGrid(photos) {
  if (!photos.length) return h('p', { class: 'muted' }, 'No photographs yet.');
  return h('div', { class: 'photos' }, photos.map(p =>
    h('div', { class: 'ph', style: { backgroundImage: `url(${thumbURL(p)})` }, onclick: () => go(`#/photo/${p.id}`) },
      p.caption ? h('span', null, p.caption) : null)));
}

// ─── Description builder (draft prose from the structured notes) ───
function joinList(a) {
  a = a.filter(Boolean);
  if (a.length < 2) return a[0] || '';
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}
function sentence(s) { s = (s || '').trim(); if (!s) return ''; return cap(s) + (/[.!?]$/.test(s) ? '' : '.'); }
function areaText(item) {
  const a = measureArea(item.measures);
  if (!a) return '';
  const used = (item.measures || []).filter(r => rowArea(r));
  const main = used.filter(r => !r.direct && num(r.l) && num(r.w));
  const dims = used.length === 1 && main.length === 1 ? `${fmt(num(main[0].l), 1)}m x ${fmt(num(main[0].w), 1)}m, ` : '';
  return `${dims}${fmt(a)} m² (${fmt0(a * SQFT)} sq ft)`;
}

function describe(item, rooms = []) {
  const k = item.kind, out = [];
  if (k === 'dwelling') {
    const type = item.type ? lc(item.type) : 'dwelling';
    let s = `${item.storeys ? `A ${item.storeys} storey ` : 'A '}${type}`;
    if (item.age) s += ` dating from ${item.age}`;
    const cons = joinList([item.walls && `${lc(item.walls)} walls`, item.roof && `a ${lc(item.roof)} roof`]);
    if (cons) s += `, of ${cons}`;
    out.push(sentence(s));
    if (item.windows) out.push(sentence(`Windows are ${lc(item.windows)}`));
    if (item.listed) out.push(sentence(`Listing or designation: ${item.listed}`));
    const drain = item.drainage && (/drainage/i.test(item.drainage) ? lc(item.drainage) : `drainage to a ${lc(item.drainage)}`);
    const svc = joinList([item.electricity && `${lc(item.electricity)} electricity`, item.water && lc(item.water), drain, item.heating && lc(item.heating)]);
    if (svc) out.push(sentence(`Services noted were ${svc}`));
    if (item.epc || item.councilTax) out.push(sentence(joinList([item.epc && `EPC rating ${item.epc}`, item.councilTax && `council tax band ${item.councilTax}`])));
    const a = areaText(item);
    if (a) out.push(sentence(`Gross internal area ${a}`));
    if (rooms.length) {
      const byFloor = {};
      rooms.forEach(r => { const f = r.floor || 'Accommodation'; (byFloor[f] = byFloor[f] || []).push(r); });
      Object.entries(byFloor).forEach(([f, rs]) => out.push(sentence(`${f === 'Accommodation' ? 'The accommodation' : cap(f) + ' accommodation'} comprises ${joinList(rs.map(r => lc(r.name || 'room')))}`)));
    }
    if (item.gardens) out.push(sentence(item.gardens));
    if (item.occupancy) out.push(sentence(`Occupation: ${lc(item.occupancy)}`));
    if (item.condition) out.push(sentence(`The property appeared to be in ${lc(item.condition)} condition at the date of inspection`));
    if (item.defects) out.push(sentence(`Defects noted: ${item.defects}`));
    if (item.notes) out.push(sentence(item.notes));
  } else if (k === 'room') {
    const a = areaText(item);
    if (a) out.push(sentence(`${a}${item.ceiling ? `, ceiling height ${item.ceiling}m` : ''}`));
    if (item.flooring) out.push(sentence(`${cap(item.flooring)} floor`));
    if (item.features) out.push(sentence(item.features));
    if (item.condition) out.push(sentence(`${cap(item.condition)} condition`));
    if (item.notes) out.push(sentence(item.notes));
  } else if (k === 'building') {
    let s = item.frame ? `A ${lc(item.frame)} building` : 'A building';
    if (item.age) s += ` of about ${item.age}`;
    const cons = joinList([item.walls && `${lc(item.walls)} walls`, item.cladding && `${lc(item.cladding)} cladding above`, item.roof && `a ${lc(item.roof)} roof`, item.floor && `a ${lc(item.floor)} floor`]);
    if (cons) s += `, with ${cons}`;
    out.push(sentence(s));
    const a = areaText(item);
    const hts = joinList([item.eaves && `${item.eaves}m to eaves`, item.ridge && `${item.ridge}m to ridge`]);
    if (a || hts) out.push(sentence(`It measures ${[a, hts].filter(Boolean).join(', ')}`));
    if (item.doors) out.push(sentence(item.doors));
    if (item.services) out.push(sentence(`Services: ${item.services}`));
    if (item.capacity) out.push(sentence(`Capacity: ${item.capacity}`));
    if (item.currentUse) out.push(sentence(`At the date of inspection the building was in use for ${lc(item.currentUse)}`));
    if (item.condition) out.push(sentence(`It appeared to be in ${lc(item.condition)} condition`));
    if (item.defects) out.push(sentence(`Defects noted: ${item.defects}`));
    if (item.notes) out.push(sentence(item.notes));
  } else if (k === 'land') {
    const ha = num(item.hectares);
    let s = ha ? `${fmt(ha)} ha (${fmt(ha * ACRE)} acres)` : 'Land';
    if (item.use) s += ` of ${lc(item.use)}`;
    out.push(sentence(s));
    if (item.grade) out.push(sentence(`Grade or soil: ${item.grade}`));
    if (item.topography) out.push(sentence(item.topography));
    if (item.boundaries) out.push(sentence(`Boundaries: ${lc(item.boundaries)}`));
    if (item.water) out.push(sentence(`Water: ${lc(item.water)}`));
    if (item.access) out.push(sentence(`Access: ${lc(item.access)}`));
    if (item.designations) out.push(sentence(item.designations));
    if (item.condition) out.push(sentence(`${cap(item.condition)} condition`));
    if (item.notes) out.push(sentence(item.notes));
  } else {
    if (item.notes) out.push(sentence(item.notes));
  }
  return out.join(' ');
}

function itemTitle(it) {
  const k = KINDS[it.kind];
  return [it.ref, it.name || k.label].filter(Boolean).join(' ');
}
function itemSub(it, rooms) {
  const bits = [];
  const a = measureArea(it.measures);
  if (a) bits.push(`${fmt(a, 1)} m²`);
  if (it.kind === 'land' && num(it.hectares)) bits.push(`${fmt(num(it.hectares))} ha`);
  if (it.kind === 'dwelling') bits.push(`${rooms} room${rooms === 1 ? '' : 's'}`);
  if (it.condition) bits.push(it.condition);
  if (it.kind === 'site' && it.notes) bits.push(it.notes.slice(0, 60));
  return bits.join(' · ');
}
function nextRef(kind) {
  const p = KINDS[kind].prefix;
  if (!p) return '';
  const n = S.items.filter(i => i.kind === kind).length + 1;
  return p + n;
}
function sortItems(a, b) { return (a.order || 0) - (b.order || 0); }

// ─── Routing ───────────────────────────────────────────────
function go(hash) { location.hash = hash; }
window.addEventListener('hashchange', render);

async function loadJob(id) {
  if (S.job && S.job.id === id) return;
  S.job = await DB.get('jobs', id);
  S.items = S.job ? await DB.by('items', 'jobId', id) : [];
}
async function reloadItems() { S.items = await DB.by('items', 'jobId', S.job.id); }

function setHeader(title, back) {
  $('#title').textContent = title;
  $('#backBtn').classList.toggle('hidden', !back);
  $('#backBtn').onclick = back ? () => go(back) : null;
}
function setFab(...btns) { $('#fab').replaceChildren(...btns); }

async function render() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const app = $('#app');
  window.scrollTo(0, 0);
  try {
    await flushSaves(); // never redraw from the database while edits are still waiting to be written
    if (parts[0] === 'job') { await loadJob(parts[1]); if (!S.job) return go(''); await viewJob(app); }
    else if (parts[0] === 'item') {
      let it = await DB.get('items', parts[1]);
      if (!it) return go('');
      await loadJob(it.jobId);
      it = S.items.find(i => i.id === it.id) || it;
      await viewItem(app, it);
    } else if (parts[0] === 'photo') {
      const p = await DB.get('photos', parts[1]);
      if (!p) return history.back();
      await loadJob(p.jobId);
      await viewPhoto(app, p);
    } else if (parts[0] === 'settings') await viewSettings(app);
    else await viewHome(app);
  } catch (e) {
    console.error(e);
    app.replaceChildren(h('div', { class: 'banner' }, 'Something went wrong: ' + e.message));
  }
}

// ─── Views ─────────────────────────────────────────────────
async function viewHome(app) {
  S.job = null;
  setHeader('Inspection Notes', null);
  const jobs = (await DB.all('jobs')).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const kids = [];
  if (!isStandalone() && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    kids.push(h('div', { class: 'banner' }, 'On an iPhone or iPad, tap Share then "Add to Home Screen" and open the app from there. Safari can clear data held by websites that have not been used for seven days, and a home screen app is protected from that.'));
  }
  const est = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  kids.push(h('div', { class: 'card' },
    h('h2', null, h('span', { class: 'grow' }, 'Inspections'), h('span', { class: 'pill' }, jobs.length)),
    jobs.length ? jobs.map(j => {
      const needsBackup = !j.lastExport || (j.updated || 0) > j.lastExport + 5000;
      return h('div', { class: 'list-item', onclick: () => go(`#/job/${j.id}`) },
        h('div', { class: 'thumb' }, (j.ref || 'INS').slice(0, 6)),
        h('div', { class: 'txt' },
          h('div', { class: 't1' }, j.name || 'Untitled inspection'),
          h('div', { class: 't2' }, [ukDate(j.inspDate), j.client].filter(Boolean).join(' · ') || 'No details yet')),
        needsBackup ? h('span', { class: 'pill warn' }, 'Not backed up') : h('span', { class: 'pill' }, 'Backed up'),
        h('span', { class: 'chev' }, '›'));
    }) : h('p', { class: 'muted' }, 'No inspections yet. Start one with the button below.')));
  kids.push(h('div', { class: 'card' },
    h('h2', null, 'Backup and transfer'),
    h('p', { class: 'muted' }, 'Everything is held on this device only. Export each inspection as a ZIP (notes, photographs and Word schedule) as soon as you are back in signal, and save it to OneDrive, Dropbox or email it to the office.'),
    h('button', { class: 'btn sec block', onclick: () => $('#importInput').click() }, 'Import an inspection ZIP'),
    est ? h('p', { class: 'muted' }, `Storage used: ${fmt(est.usage / 1048576, 1)} MB of about ${fmt0(est.quota / 1048576)} MB available. ${persisted ? 'Storage is marked as persistent.' : 'Storage is not yet marked as persistent.'}`) : null));
  app.replaceChildren(...kids);
  setFab(h('button', { class: 'btn', onclick: newJob }, '+ New inspection'));
}

async function newJob() {
  const inspector = await getSetting('inspector', '');
  const job = { id: uid(), created: Date.now(), updated: Date.now(), inspDate: todayISO(), inspStart: nowTime(), inspector, name: '' };
  await DB.put('jobs', job);
  S.job = job; S.items = [];
  go(`#/job/${job.id}`);
}

async function viewJob(app) {
  const job = S.job;
  setHeader(job.name || 'New inspection', '#/');
  const photos = await DB.by('photos', 'jobId', job.id);
  const unsorted = photos.filter(p => !p.itemId).sort((a, b) => a.order - b.order);
  const count = {}, firstPhoto = {};
  photos.forEach(p => { if (p.itemId) { count[p.itemId] = (count[p.itemId] || 0) + 1; if (!firstPhoto[p.itemId] || p.order < firstPhoto[p.itemId].order) firstPhoto[p.itemId] = p; } });
  const roomCount = {};
  S.items.filter(i => i.kind === 'room').forEach(r => roomCount[r.parentId] = (roomCount[r.parentId] || 0) + 1);

  const detailsOpen = !job.name;
  const titleEl = $('#title');
  const det = h('details', { open: detailsOpen || null },
    h('summary', null, 'Inspection details (property, client, date, weather, limitations)'),
    h('div', { style: { marginTop: '10px' } }, fieldGrid(job, JOB_FIELDS, 'jobs', (k, v) => {
      if (k === 'name') titleEl.textContent = v || 'New inspection';
      if (k === 'inspector') { S.settings.inspector = v; setSetting('inspector', v); }
    })),
    h('button', { class: 'btn sec sm', onclick: e => { job.inspEnd = nowTime(); scheduleSave(job, 'jobs'); render(); } }, 'Set finish time to now'));

  const needsBackup = !job.lastExport || (job.updated || 0) > job.lastExport + 5000;
  const kids = [
    needsBackup && (S.items.length || photos.length) ? h('div', { class: 'banner' }, 'This inspection has changes that have not been exported. Export a ZIP backup before leaving site or once you have signal.') : null,
    h('div', { class: 'card' }, h('h2', null, 'Record of inspection'), det),
  ];

  for (const kind of KIND_ORDER) {
    const k = KINDS[kind];
    const list = S.items.filter(i => i.kind === kind).sort(sortItems);
    kids.push(h('div', { class: 'card' },
      h('h2', null, h('span', { class: 'grow' }, k.plural), h('span', { class: 'pill' }, list.length)),
      list.map(it => h('div', { class: 'list-item', onclick: () => go(`#/item/${it.id}`) },
        h('div', { class: 'thumb', style: firstPhoto[it.id] ? { backgroundImage: `url(${thumbURL(firstPhoto[it.id])})` } : null }, firstPhoto[it.id] ? '' : (it.ref || '–')),
        h('div', { class: 'txt' }, h('div', { class: 't1' }, itemTitle(it)), h('div', { class: 't2' }, itemSub(it, roomCount[it.id] || 0) || 'No details yet')),
        count[it.id] ? h('span', { class: 'pill' }, `📷 ${count[it.id]}`) : null,
        h('span', { class: 'chev' }, '›'))),
      h('button', { class: 'btn sec sm', style: { marginTop: '8px' }, onclick: () => addItem(kind) }, `+ Add ${k.label.toLowerCase()}`)));
  }

  const jobMemos = (await DB.by('memos', 'jobId', job.id)).filter(m => !m.itemId).sort((a, b) => a.created - b.created);
  kids.push(voiceCard(job.id, null, jobMemos, 'General voice notes'));
  kids.push(h('div', { class: 'card' },
    h('h2', null, h('span', { class: 'grow' }, 'Unsorted photographs'), h('span', { class: 'pill' }, unsorted.length)),
    h('p', { class: 'muted' }, 'Use Quick photo to capture now and file it against a building or room later.'),
    photoGrid(unsorted)));

  kids.push(h('div', { class: 'card' },
    h('h2', null, 'Export'),
    h('button', { class: 'btn block', onclick: () => exportZip(job) }, 'Export ZIP backup (notes, photos, Word schedule)'),
    h('button', { class: 'btn sec block', onclick: () => exportDocx(job, true) }, 'Word inspection schedule only'),
    h('button', { class: 'btn sec block', onclick: () => exportCSV(job) }, 'Schedule of areas (CSV for Excel)'),
    job.lastExport ? h('p', { class: 'muted' }, `Last exported ${new Date(job.lastExport).toLocaleString('en-GB')}`) : null,
    h('details', null, h('summary', null, 'Delete this inspection'),
      h('p', { class: 'muted' }, 'This removes the inspection and all its photographs from this device. It cannot be undone.'),
      h('button', { class: 'btn danger', onclick: () => deleteJob(job) }, 'Delete inspection'))));

  app.replaceChildren(...kids);
  setFab(h('button', { class: 'btn', onclick: () => { photoTarget = { jobId: job.id, itemId: null }; $('#camInput').click(); } }, '📷 Quick photo'));
}

async function addItem(kind, parentId) {
  const siblings = S.items.filter(i => i.kind === kind && (kind !== 'room' || i.parentId === parentId));
  const it = { id: uid(), jobId: S.job.id, kind, parentId: parentId || null, ref: nextRef(kind), name: '', order: Date.now(), created: Date.now(), updated: Date.now() };
  if (kind === 'room' && siblings.length) it.floor = siblings.sort(sortItems)[siblings.length - 1].floor || '';
  await DB.put('items', it);
  S.items.push(it);
  go(`#/item/${it.id}`);
}

async function viewItem(app, it) {
  const k = KINDS[it.kind];
  const parent = it.parentId ? S.items.find(i => i.id === it.parentId) : null;
  const back = parent ? `#/item/${parent.id}` : `#/job/${it.jobId}`;
  setHeader(itemTitle(it), back);
  const photos = (await DB.by('photos', 'itemId', it.id)).sort((a, b) => a.order - b.order);
  const memos = (await DB.by('memos', 'itemId', it.id)).sort((a, b) => a.created - b.created);
  const rooms = it.kind === 'dwelling' ? S.items.filter(i => i.parentId === it.id).sort(sortItems) : [];
  const preview = h('div', { class: 'preview' });
  const refresh = () => { preview.textContent = describe(it, rooms) || 'Nothing recorded yet.'; $('#title').textContent = itemTitle(it); };
  refresh();

  // keep the in-memory list in step with edits
  const idx = S.items.findIndex(i => i.id === it.id);
  if (idx >= 0) S.items[idx] = it;

  const form = fieldGrid(it, k.fields, 'items', refresh);
  const pickHost = h('div');
  const dictBtn = h('button', { class: 'btn block' }, '🎙 Dictate notes');
  dictBtn.addEventListener('click', () => {
    const ta = app.querySelector('textarea[data-key="notes"]');
    if (!ta) return;
    ta.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const mic = ta.parentElement.querySelector('.mic');
    if (mic) mic.click(); else { ta.focus(); toast('Tap the microphone on the keyboard to dictate', 3500); }
  });
  const kids = [
    h('div', { class: 'card' },
      h('h2', null, h('span', { class: 'grow' }, 'Photographs'), h('span', { class: 'pill' }, photos.length)),
      photoGrid(photos), photoButtons(it.jobId, it.id)),
    h('div', { class: 'card' },
      h('h2', null, 'Dictate'),
      h('p', { class: 'muted' }, k.measures
        ? 'Tap and describe what you see, for example "steel portal frame, fibre cement roof, 24.4 by 18.3, eaves 6.1, full stop". Tap again to stop. Measurements you say are offered for the measurements table. Every field also has its own microphone.'
        : 'Tap and describe what you see. Say "full stop", "comma" or "new paragraph" for punctuation. Tap again to stop. Every field also has its own microphone.'),
      dictBtn, pickHost),
    h('div', { class: 'card' }, h('h2', null, k.label + (parent ? ` in ${itemTitle(parent)}` : '')), form),
  ];
  if (k.measures) {
    kids.push(h('div', { class: 'card' }, h('h2', null, it.kind === 'dwelling' ? 'Overall measurements (GIA)' : 'Measurements'),
      (() => { const b = measureBlock(it); b.addEventListener('input', () => setTimeout(refresh, 0)); return b; })(),
      h('button', { class: 'btn sec sm', style: { marginTop: '8px' }, onclick: () => { if (!offerPickUp(it, pickHost)) toast('No new measurements found in the notes'); else pickHost.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, 'Pick up measurements from notes')));
  }
  kids.push(voiceCard(it.jobId, it.id, memos, itemTitle(it)));
  if (it.kind === 'dwelling') {
    const roomTotal = rooms.reduce((t, r) => t + measureArea(r.measures), 0);
    kids.push(h('div', { class: 'card' },
      h('h2', null, h('span', { class: 'grow' }, 'Rooms'), h('span', { class: 'pill' }, rooms.length)),
      rooms.map(r => h('div', { class: 'list-item', onclick: () => go(`#/item/${r.id}`) },
        h('div', { class: 'txt' }, h('div', { class: 't1' }, r.name || 'Room'), h('div', { class: 't2' }, [r.floor, itemSub(r)].filter(Boolean).join(' · '))),
        h('span', { class: 'chev' }, '›'))),
      roomTotal ? h('p', { class: 'muted' }, `Sum of room areas ${fmt(roomTotal)} m² (${fmt0(roomTotal * SQFT)} sq ft). Room areas exclude walls, stairs and circulation, so they will be less than the GIA.`) : null,
      h('button', { class: 'btn sec sm', style: { marginTop: '8px' }, onclick: () => addItem('room', it.id) }, '+ Add room')));
  }
  kids.push(h('div', { class: 'card' },
    h('h2', null, 'Draft description'),
    h('p', { class: 'muted' }, 'Built from the notes above for use as a starting point in the report. It updates as you type.'),
    preview));
  kids.push(h('div', { class: 'card' },
    h('details', null, h('summary', null, 'Move or delete'),
      h('div', { class: 'btns' },
        h('button', { class: 'btn sec sm', onclick: () => moveItem(it, -1) }, 'Move up'),
        h('button', { class: 'btn sec sm', onclick: () => moveItem(it, 1) }, 'Move down'),
        h('button', { class: 'btn danger sm', onclick: () => deleteItem(it) }, `Delete ${k.label.toLowerCase()}`)))));
  app.replaceChildren(...kids);
  app.addEventListener('dictated', function onD(e) {
    if (!document.body.contains(pickHost)) return app.removeEventListener('dictated', onD);
    if (k.measures && ['notes', 'defects', 'features'].includes(e.detail.key)) offerPickUp(it, pickHost);
  });
  setFab(h('button', { class: 'btn', onclick: () => { photoTarget = { jobId: it.jobId, itemId: it.id }; $('#camInput').click(); } }, '📷 Photo'));
}

async function moveItem(it, dir) {
  const sibs = S.items.filter(i => i.kind === it.kind && i.parentId === it.parentId).sort(sortItems);
  const i = sibs.findIndex(s => s.id === it.id), j = i + dir;
  if (j < 0 || j >= sibs.length) return;
  [sibs[i].order, sibs[j].order] = [sibs[j].order, sibs[i].order];
  if (sibs[i].order === sibs[j].order) sibs[i].order += dir;
  await DB.put('items', sibs[i]); await DB.put('items', sibs[j]);
  toast(dir < 0 ? 'Moved up' : 'Moved down');
}

async function deleteItem(it) {
  const children = S.items.filter(i => i.parentId === it.id);
  if (!confirm(`Delete ${itemTitle(it)}${children.length ? ` and its ${children.length} room(s)` : ''} with all photographs?`)) return;
  for (const x of [it, ...children]) {
    for (const p of await DB.by('photos', 'itemId', x.id)) await DB.del('photos', p.id);
    for (const m of await DB.by('memos', 'itemId', x.id)) await DB.del('memos', m.id);
    await DB.del('items', x.id);
  }
  await reloadItems();
  go(it.parentId ? `#/item/${it.parentId}` : `#/job/${it.jobId}`);
}

async function deleteJob(job) {
  if (!confirm(`Delete "${job.name || 'this inspection'}" and all its photographs from this device?`)) return;
  for (const p of await DB.by('photos', 'jobId', job.id)) await DB.del('photos', p.id);
  for (const m of await DB.by('memos', 'jobId', job.id)) await DB.del('memos', m.id);
  for (const i of await DB.by('items', 'jobId', job.id)) await DB.del('items', i.id);
  await DB.del('jobs', job.id);
  S.job = null;
  go('#/');
}

async function viewPhoto(app, p) {
  const it = p.itemId ? S.items.find(i => i.id === p.itemId) : null;
  setHeader(it ? itemTitle(it) : 'Unsorted photograph', null);
  $('#backBtn').classList.remove('hidden');
  $('#backBtn').onclick = () => history.back();
  const full = URL.createObjectURL(p.blob);
  const img = h('img', { src: full, alt: p.caption || 'Photograph' });
  img.onload = () => setTimeout(() => URL.revokeObjectURL(full), 1000);
  const opts = [h('option', { value: '' }, 'Unsorted')];
  const addOpt = (i, prefix = '') => opts.push(h('option', { value: i.id, selected: i.id === p.itemId }, prefix + itemTitle(i)));
  for (const kind of KIND_ORDER) {
    S.items.filter(i => i.kind === kind).sort(sortItems).forEach(i => {
      addOpt(i);
      if (kind === 'dwelling') S.items.filter(r => r.parentId === i.id).sort(sortItems).forEach(r => addOpt(r, '    ↳ '));
    });
  }
  const pos = p.pos ? `${p.pos.lat.toFixed(5)}, ${p.pos.lng.toFixed(5)} (±${p.pos.acc}m)` : '';
  app.replaceChildren(
    h('div', { class: 'viewer' }, img),
    h('div', { class: 'card' },
      h('label', { class: 'f' }, h('span', null, 'Caption'),
        h('input', { value: p.caption || '', placeholder: 'e.g. North elevation, Grain store B3', oninput: e => { p.caption = e.target.value; scheduleSave(p, 'photos'); } })),
      h('label', { class: 'f' }, h('span', null, 'Filed against'),
        h('select', { onchange: async e => { p.itemId = e.target.value || null; await DB.put('photos', p); toast('Photograph moved'); } }, opts)),
      h('label', { class: 'f', style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        h('input', { type: 'checkbox', style: { width: 'auto' }, checked: p.inReport !== false, onchange: e => { p.inReport = e.target.checked; scheduleSave(p, 'photos'); } }),
        h('span', { style: { margin: 0 } }, 'Include in Word schedule')),
      h('p', { class: 'muted' }, `Taken ${new Date(p.taken).toLocaleString('en-GB')} · ${p.w} x ${p.h} px${pos ? ' · ' + pos : ''}`),
      pos ? h('a', { class: 'btn sec sm', href: `https://www.google.com/maps?q=${p.pos.lat},${p.pos.lng}`, target: '_blank', rel: 'noopener' }, 'Show on map') : null,
      h('div', { class: 'btns' },
        h('button', { class: 'btn sec sm', onclick: () => downloadBlob(p.blob, safe((p.caption || 'photo') + '.jpg')) }, 'Save copy to device'),
        h('button', { class: 'btn danger sm', onclick: async () => { if (confirm('Delete this photograph?')) { await DB.del('photos', p.id); history.back(); } } }, 'Delete'))));
  setFab();
}

async function viewSettings(app) {
  setHeader('Settings', S.job ? `#/job/${S.job.id}` : '#/');
  const s = S.settings;
  const saveS = async (k, v) => { s[k] = v; await setSetting(k, v); };
  app.replaceChildren(
    h('div', { class: 'card' }, h('h2', null, 'Defaults'),
      h('label', { class: 'f' }, h('span', null, 'Inspector name'), h('input', { value: s.inspector || '', oninput: e => saveS('inspector', e.target.value) })),
      h('label', { class: 'f' }, h('span', null, 'Firm name (Word footer and title)'), h('input', { value: s.firm || '', oninput: e => saveS('firm', e.target.value) })),
      h('label', { class: 'f' }, h('span', null, 'Photograph size kept'),
        h('select', { onchange: e => saveS('photoMax', +e.target.value) },
          [[1600, 'Standard (1600 px, about 0.3 MB)'], [2400, 'High (2400 px, about 0.7 MB)'], [3200, 'Very high (3200 px, about 1.3 MB)'], [9999, 'Original file (large)']]
            .map(([v, t]) => h('option', { value: v, selected: (s.photoMax || 2400) === v }, t)))),
      h('label', { class: 'f', style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        h('input', { type: 'checkbox', style: { width: 'auto' }, checked: !!s.gps, onchange: e => saveS('gps', e.target.checked) }),
        h('span', { style: { margin: 0 } }, 'Record GPS position with each photograph taken'))),
    dictationSettings(saveS),
    h('div', { class: 'card' }, h('h2', null, 'About'),
      h('p', { class: 'muted' }, `Inspection Notes version ${APP_VERSION}. Data is held in this browser on this device and is not sent anywhere. Photographs taken with the in-app camera are not saved to the phone's camera roll, so export regularly.`)));
  setFab();
}

function dictationSettings(saveS) {
  const s = S.settings;
  const status = h('p', { class: 'muted' });
  const extra = h('div');
  const paint = () => {
    extra.replaceChildren();
    if (!SpeechRec) {
      status.textContent = 'This browser has no built-in speech recognition, so dictation uses the microphone key on the phone keyboard. On an iPhone with UK English downloaded, keyboard dictation works with no signal.';
      return;
    }
    const local = Dict.localState;
    if (local === 'available') status.textContent = 'The in-app microphone is available and the UK English speech pack is on this phone, so dictation works with no signal.';
    else if (local === 'downloadable' || local === 'downloading') {
      status.textContent = local === 'downloading' ? 'The offline UK English speech pack is downloading.' : 'The in-app microphone is available but needs a signal. Download the offline UK English speech pack while you have wifi so it works on farms with no coverage.';
      if (local === 'downloadable') extra.append(h('button', { class: 'btn sec block', onclick: async () => { toast('Downloading speech pack…', 4000); const ok = await Dict.installLocal(); await Dict.checkLocal(); await setSetting('speechLocal', Dict.localState); toast(ok ? 'Offline speech pack installed' : 'The speech pack could not be installed'); paint(); } }, 'Download offline speech pack'));
    } else {
      status.textContent = IS_IOS
      ? 'The in-app microphone may work but needs a signal, and it is unreliable in home screen apps on iPhone. If it fails, choose keyboard dictation below, which runs on the phone and works offline.'
      : 'The in-app microphone is available but needs a signal on this phone. With no signal, use the keyboard microphone or record a voice note.';
      if (typeof SpeechRec.available === 'function') extra.append(h('button', { class: 'btn sec block', onclick: async () => { toast('Checking…'); await Dict.checkLocal(); await setSetting('speechLocal', Dict.localState); paint(); if (Dict.localState === 'unavailable') toast('Offline speech is not offered on this phone'); } }, 'Check for offline speech pack'));
    }
  };
  paint();
  return h('div', { class: 'card' }, h('h2', null, 'Dictation'),
    h('label', { class: 'f' }, h('span', null, 'Dictation method'),
      h('select', { onchange: e => saveS('dictation', e.target.value) },
        [['auto', 'Microphone button beside each field'], ['keyboard', 'Keyboard microphone only']]
          .map(([v, t]) => h('option', { value: v, selected: (s.dictation || 'auto') === v }, t)))),
    status, extra,
    h('p', { class: 'muted' }, 'Spoken commands: "full stop", "comma", "question mark", "colon", "new line" and "new paragraph". Numbers such as "six point one" become 6.1, and "24 by 18" becomes 24 x 18.'));
}

function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone; }

// ─── Export: files ─────────────────────────────────────────
async function downloadBlob(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  return true;
}

async function collect(job) {
  await flushSaves();
  const items = await DB.by('items', 'jobId', job.id);
  const photos = (await DB.by('photos', 'jobId', job.id)).sort((a, b) => a.order - b.order);
  const memos = (await DB.by('memos', 'jobId', job.id)).sort((a, b) => a.created - b.created);
  return { items, photos, memos };
}

function orderedItems(items) {
  const out = [];
  for (const kind of KIND_ORDER) {
    items.filter(i => i.kind === kind).sort(sortItems).forEach(i => {
      out.push(i);
      if (kind === 'dwelling') items.filter(r => r.parentId === i.id).sort(sortItems).forEach(r => out.push(r));
    });
  }
  return out;
}

function photoFileNames(items, photos) {
  const names = new Map(), used = new Set(), byItem = {};
  const title = id => { const i = items.find(x => x.id === id); if (!i) return 'Unsorted'; const par = i.parentId ? items.find(x => x.id === i.parentId) : null; return (par ? itemTitle(par) + ' - ' : '') + itemTitle(i); };
  photos.forEach(p => {
    const key = p.itemId || '_';
    byItem[key] = (byItem[key] || 0) + 1;
    let n = safe(`${title(p.itemId)} ${String(byItem[key]).padStart(2, '0')}${p.caption ? ' ' + p.caption : ''}`).slice(0, 120);
    while (used.has(n.toLowerCase())) n += '_';
    used.add(n.toLowerCase());
    names.set(p.id, `photos/${n}.jpg`);
  });
  return names;
}

function csvFor(job, items) {
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [['Group', 'Ref', 'Name', 'Floor or use', 'Part', 'Length (m)', 'Width (m)', 'Area (m²)', 'Area (sq ft)', 'Eaves (m)', 'Ridge (m)', 'Hectares', 'Acres', 'Condition']];
  for (const it of orderedItems(items)) {
    const par = it.parentId ? items.find(x => x.id === it.parentId) : null;
    const group = it.kind === 'room' ? `Room in ${par ? itemTitle(par) : ''}` : KINDS[it.kind].label;
    const base = [group, it.ref || '', it.name || '', it.floor || it.use || it.currentUse || ''];
    const ms = (it.measures || []).filter(r => rowArea(r));
    if (ms.length) ms.forEach(r => { const a = rowArea(r); rows.push([...base, r.label || '', r.direct ? '' : r.l, r.direct ? '' : r.w, a.toFixed(2), (a * SQFT).toFixed(0), it.eaves || '', it.ridge || '', '', '', it.condition || '']); });
    else rows.push([...base, '', '', '', '', '', it.eaves || '', it.ridge || '', it.hectares || '', num(it.hectares) ? (num(it.hectares) * ACRE).toFixed(2) : '', it.condition || '']);
  }
  return '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n');
}

async function exportCSV(job) {
  const { items } = await collect(job);
  await downloadBlob(new Blob([csvFor(job, items)], { type: 'text/csv' }), safe(`${job.ref || ''} ${job.name || 'Inspection'} areas.csv`));
}

async function exportZip(job) {
  toast('Preparing ZIP…', 4000);
  const { items, photos, memos } = await collect(job);
  const zip = new JSZip();
  const names = photoFileNames(items, photos);
  const meta = photos.map(p => { const { blob, thumb, ...m } = p; return { ...m, file: names.get(p.id) }; });
  const memoCount = {};
  const memoMeta = memos.map(m => {
    const it = items.find(i => i.id === m.itemId);
    const t = it ? itemTitle(it) : 'General';
    memoCount[t] = (memoCount[t] || 0) + 1;
    const { blob, ...rest } = m;
    return { ...rest, file: `audio/${safe(t)} voice note ${String(memoCount[t]).padStart(2, '0')}.${audioExt(m.type)}` };
  });
  zip.file('inspection.json', JSON.stringify({ app: 'inspection-notes', version: APP_VERSION, exported: new Date().toISOString(), job, items, photos: meta, memos: memoMeta }, null, 1));
  photos.forEach(p => zip.file(names.get(p.id), p.blob));
  memos.forEach((m, i) => zip.file(memoMeta[i].file, m.blob));
  zip.file(safe(`${job.ref || ''} ${job.name || 'Inspection'} areas.csv`), csvFor(job, items));
  try { zip.file(safe(`${job.ref || ''} ${job.name || 'Inspection'} inspection schedule.docx`), await buildDocx(job, items, photos, memos)); }
  catch (e) { console.error(e); toast('Word schedule could not be built, ZIP made without it'); }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const ok = await downloadBlob(blob, safe(`${job.ref || ''} ${job.name || 'Inspection'} ${job.inspDate || todayISO()}.zip`));
  if (ok) { job.lastExport = Date.now(); await DB.put('jobs', job); render(); }
}

async function exportDocx(job) {
  toast('Building Word schedule…', 4000);
  const { items, photos, memos } = await collect(job);
  const blob = await buildDocx(job, items, photos, memos);
  await downloadBlob(blob, safe(`${job.ref || ''} ${job.name || 'Inspection'} inspection schedule.docx`));
}

// ─── Import ────────────────────────────────────────────────
$('#importInput').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    let data, zip = null;
    if (/\.json$/i.test(f.name)) data = JSON.parse(await f.text());
    else { zip = await JSZip.loadAsync(f); data = JSON.parse(await zip.file('inspection.json').async('string')); }
    if (data.app !== 'inspection-notes') throw new Error('This is not an Inspection Notes export');
    const existing = await DB.get('jobs', data.job.id);
    if (existing && !confirm(`"${existing.name}" is already on this device. Replace it with the imported copy?`)) return;
    if (existing) {
      for (const p of await DB.by('photos', 'jobId', existing.id)) await DB.del('photos', p.id);
      for (const m of await DB.by('memos', 'jobId', existing.id)) await DB.del('memos', m.id);
      for (const i of await DB.by('items', 'jobId', existing.id)) await DB.del('items', i.id);
    }
    for (const m of data.memos || []) {
      const zf = zip && zip.file(m.file);
      if (!zf) continue;
      const { file, ...rest } = m;
      await DB.put('memos', { ...rest, blob: new Blob([await zf.async('arraybuffer')], { type: m.type }) });
    }
    await DB.put('jobs', data.job);
    for (const i of data.items) await DB.put('items', i);
    let missing = 0;
    for (const m of data.photos) {
      const zf = zip && zip.file(m.file);
      if (!zf) { missing++; continue; }
      const blob = new Blob([await zf.async('arraybuffer')], { type: 'image/jpeg' });
      const img = await loadImage(blob);
      const th = await scaleTo(img, 320, 0.7);
      const { file, ...rest } = m;
      await DB.put('photos', { ...rest, blob, thumb: th.blob });
    }
    toast(missing ? `Imported, but ${missing} photographs were missing` : 'Inspection imported');
    S.job = null;
    go(`#/job/${data.job.id}`);
  } catch (err) { console.error(err); alert('Import failed: ' + err.message); }
});

// ─── Word schedule ─────────────────────────────────────────
async function buildDocx(job, items, photos, memos = []) {
  const D = window.docx;
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, ImageRun, Footer, PageNumber, LevelFormat, AlignmentType, BorderStyle, VerticalAlign } = D;
  const J = AlignmentType.JUSTIFIED;
  const CONTENT = 11906 - 2 * 1440; // A4 width less 1 inch margins, in twips
  const TABLE_W = CONTENT - 720;
  const firm = S.settings.firm || '';
  const children = [];
  const border = { style: BorderStyle.SINGLE, size: 4, color: PAL.light };
  const borders = { top: border, bottom: border, left: border, right: border };

  const P = (text, opts = {}) => new Paragraph({ alignment: J, ...opts, children: Array.isArray(text) ? text : [new TextRun(String(text ?? ''))] });
  const heading = t => new Paragraph({ numbering: { reference: 'schedule', level: 0 }, keepNext: true, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: t, bold: true, color: PAL.green })] });
  const clause = (runs, extra = {}) => new Paragraph({ numbering: { reference: 'schedule', level: 1 }, alignment: J, ...extra, children: runs });
  const body = t => P(t, { indent: { left: 720 } });
  const cell = (t, o = {}) => new TableCell({
    borders, width: { size: o.w, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
    shading: o.head ? { type: ShadingType.CLEAR, color: 'auto', fill: PAL.green } : o.shade ? { type: ShadingType.CLEAR, color: 'auto', fill: PAL.pale } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ alignment: o.right ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { after: 0 }, children: [new TextRun({ text: String(t ?? ''), bold: !!o.head || !!o.bold, color: o.head ? 'FFFFFF' : PAL.dark, size: 20 })] })],
  });
  const table = (headRow, rows, widths, rightCols = []) => new Table({
    width: { size: TABLE_W, type: WidthType.DXA }, columnWidths: widths, indent: { size: 720, type: WidthType.DXA },
    rows: [
      new TableRow({ tableHeader: true, children: headRow.map((t, i) => cell(t, { head: true, w: widths[i], right: rightCols.includes(i) })) }),
      ...rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, { w: widths[i], shade: ri % 2 === 1, right: rightCols.includes(i), bold: r.bold })) })),
    ],
  });
  const kv = rows => new Table({
    width: { size: TABLE_W, type: WidthType.DXA }, columnWidths: [2800, TABLE_W - 2800], indent: { size: 720, type: WidthType.DXA },
    rows: rows.map(([k, v]) => new TableRow({ cantSplit: true, children: [cell(k, { w: 2800, shade: true, bold: true }), cell(v, { w: TABLE_W - 2800 })] })),
  });
  const gap = () => new Paragraph({ spacing: { after: 60 }, children: [] });

  // Photographs: two per row, sized to the column
  const photoTable = async list => {
    list = list.filter(p => p.inReport !== false);
    if (!list.length) return [];
    const colW = TABLE_W / 2;
    const maxPx = Math.floor((colW - 200) / 15); // twips to pixels at 96 dpi
    const rows = [];
    for (let i = 0; i < list.length; i += 2) {
      const pair = list.slice(i, i + 2);
      const cells = [];
      for (const p of pair) {
        const buf = await p.blob.arrayBuffer();
        const ratio = p.h / p.w;
        let w = maxPx, hh = Math.round(maxPx * ratio);
        if (hh > maxPx * 1.1) { hh = Math.round(maxPx * 1.1); w = Math.round(hh / ratio); }
        cells.push(new TableCell({
          width: { size: colW, type: WidthType.DXA }, borders: { top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } },
          margins: { top: 60, bottom: 60, left: 60, right: 60 },
          children: [
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new ImageRun({ type: 'jpg', data: buf, transformation: { width: w, height: hh } })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: p.caption || '', size: 18, color: PAL.light, italics: true })] }),
          ],
        }));
      }
      if (cells.length === 1) cells.push(new TableCell({ width: { size: colW, type: WidthType.DXA }, borders: { top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } }, children: [new Paragraph('')] }));
      rows.push(new TableRow({ cantSplit: true, children: cells }));
    }
    return [new Table({ width: { size: TABLE_W, type: WidthType.DXA }, columnWidths: [colW, colW], indent: { size: 720, type: WidthType.DXA }, rows }), gap()];
  };

  const photosFor = id => photos.filter(p => p.itemId === id);
  const memoParas = id => memos.filter(m => (m.itemId || null) === id && (m.transcript || '').trim())
    .map(m => body([new TextRun({ text: 'Voice note. ', bold: true }), new TextRun(sentence(m.transcript))]));
  const measTable = it => {
    const ms = (it.measures || []).filter(r => rowArea(r));
    if (!ms.length) return [];
    const rows = ms.map(r => { const a = rowArea(r); return [r.label || (r.direct ? 'Stated area' : ''), r.direct ? '' : fmt(num(r.l)), r.direct ? '' : fmt(num(r.w)), fmt(a), fmt0(a * SQFT)]; });
    if (ms.length > 1) { const a = measureArea(it.measures); const t = ['Total', '', '', fmt(a), fmt0(a * SQFT)]; t.bold = true; rows.push(t); }
    return [table(['Part', 'Length (m)', 'Width (m)', 'Area (m²)', 'Area (sq ft)'], rows, [TABLE_W - 4 * 1500, 1500, 1500, 1500, 1500], [1, 2, 3, 4]), gap()];
  };

  // Title block
  children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Record of Inspection', bold: true, size: 32, color: PAL.dark })] }));
  children.push(new Paragraph({ spacing: { after: 240 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: PAL.green, space: 4 } }, children: [new TextRun({ text: [job.name, job.postcode].filter(Boolean).join(', ') || 'Property', size: 26, color: PAL.green, bold: true })] }));

  // 1. Inspection record
  children.push(heading('Inspection record'));
  const recRows = [
    ['Our reference', job.ref], ['Property', job.name], ['Address', [job.address, job.postcode].filter(Boolean).join(', ')],
    ['Client', job.client], ['Purpose', job.purpose], ['Basis of value', job.basis],
    ['Valuation date', ukDate(job.valDate)], ['Inspection date', ukDate(job.inspDate)],
    ['Time on site', [job.inspStart, job.inspEnd].filter(Boolean).join(' to ')],
    ['Inspected by', job.inspector], ['Present', job.attendees], ['Weather and ground', job.weather],
    ['Total area stated', num(job.totalArea) ? `${fmt(num(job.totalArea))} ha (${fmt(num(job.totalArea) * ACRE)} acres)` : ''],
  ].filter(r => r[1]);
  if (recRows.length) children.push(kv(recRows), gap());
  for (const [k, label] of [['extent', 'Extent of inspection'], ['limitations', 'Limitations and areas not inspected'], ['tenure', 'Tenure and occupation as seen or stated'], ['esg', 'ESG, environmental and sustainability observations'], ['notes', 'General notes']]) {
    if (job[k]) children.push(clause([new TextRun({ text: label + '. ', bold: true }), new TextRun(sentence(job[k]))]));
  }
  children.push(...memoParas(null));

  // Sections per kind
  for (const kind of KIND_ORDER) {
    const list = items.filter(i => i.kind === kind).sort(sortItems);
    if (!list.length) continue;
    children.push(heading(KINDS[kind].plural));
    if (kind === 'land') {
      const rows = list.map(l => [l.ref || '', l.name || '', l.use || '', num(l.hectares) ? fmt(num(l.hectares)) : '', num(l.hectares) ? fmt(num(l.hectares) * ACRE) : '']);
      const tha = list.reduce((t, l) => t + num(l.hectares), 0);
      if (tha) { const t = ['', 'Total', '', fmt(tha), fmt(tha * ACRE)]; t.bold = true; rows.push(t); }
      children.push(table(['Field', 'Name', 'Use', 'Hectares', 'Acres'], rows, [1200, TABLE_W - 1200 - 2000 - 2 * 1400, 2000, 1400, 1400], [3, 4]), gap());
    }
    if (kind === 'building') {
      const rows = list.map(b => { const a = measureArea(b.measures); return [b.ref || '', b.name || '', b.frame || '', a ? fmt(a) : '', a ? fmt0(a * SQFT) : '', b.condition || '']; });
      const ta = list.reduce((t, b) => t + measureArea(b.measures), 0);
      if (ta) { const t = ['', 'Total', '', fmt(ta), fmt0(ta * SQFT), '']; t.bold = true; rows.push(t); }
      children.push(table(['Ref', 'Building', 'Frame', 'm²', 'sq ft', 'Condition'], rows, [800, TABLE_W - 800 - 2000 - 1200 - 1100 - 1300, 2000, 1200, 1100, 1300], [3, 4]), gap());
    }
    for (const it of list) {
      const rooms = kind === 'dwelling' ? items.filter(r => r.parentId === it.id).sort(sortItems) : [];
      children.push(clause([new TextRun({ text: itemTitle(it) + '. ', bold: true }), new TextRun(describe(it, rooms))], { keepNext: false }));
      children.push(...measTable(it));
      children.push(...memoParas(it.id));
      children.push(...await photoTable(photosFor(it.id)));
      if (rooms.length) {
        const rrows = rooms.map(r => { const a = measureArea(r.measures); const ms = (r.measures || []).filter(m => !m.direct && num(m.l) && num(m.w)); return [r.floor || '', r.name || '', ms.length === 1 ? `${fmt(num(ms[0].l), 2)} x ${fmt(num(ms[0].w), 2)}` : '', a ? fmt(a) : '', a ? fmt0(a * SQFT) : '']; });
        children.push(body([new TextRun({ text: 'Schedule of accommodation', bold: true, color: PAL.green })]));
        children.push(table(['Floor', 'Room', 'Dimensions (m)', 'm²', 'sq ft'], rrows, [1800, TABLE_W - 1800 - 2000 - 1100 - 1100, 2000, 1100, 1100], [3, 4]), gap());
        for (const r of rooms) {
          const d = describe(r);
          if (d) children.push(body([new TextRun({ text: `${r.name || 'Room'}${r.floor ? ` (${lc(r.floor)})` : ''}. `, bold: true }), new TextRun(d)]));
          children.push(...memoParas(r.id));
          children.push(...await photoTable(photosFor(r.id)));
        }
      }
    }
  }

  const unsorted = photos.filter(p => !p.itemId);
  if (unsorted.some(p => p.inReport !== false)) {
    children.push(heading('Other photographs'));
    children.push(...await photoTable(unsorted));
  }

  const footDesc = [firm, 'Record of inspection', job.name].filter(Boolean).join(', ');
  const doc = new Document({
    creator: job.inspector || firm || 'Inspection Notes',
    title: `Record of inspection, ${job.name || ''}`,
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: 22, color: PAL.dark },
          paragraph: { spacing: { line: 276, after: 120 }, alignment: J },
        },
      },
    },
    numbering: {
      config: [{
        reference: 'schedule',
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 720 } }, run: { bold: true, color: PAL.green } } },
          { level: 1, format: LevelFormat.DECIMAL, text: '%1.%2', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 720 } } } },
        ],
      }],
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: `${footDesc}   |   Page `, color: '808080', size: 16 }),
              new TextRun({ children: [PageNumber.CURRENT], color: '808080', size: 16 }),
              new TextRun({ text: ' of ', color: '808080', size: 16 }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], color: '808080', size: 16 }),
            ],
          })],
        }),
      },
      children,
    }],
  });
  return Packer.toBlob(doc);
}

// ─── Start up ──────────────────────────────────────────────
$('#menuBtn').addEventListener('click', () => go('#/settings'));

(async function start() {
  try { await DB.open(); }
  catch (e) { $('#app').replaceChildren(h('div', { class: 'banner' }, 'This browser will not allow local storage, so the app cannot run. Try Safari or Chrome outside private browsing.')); return; }
  S.settings = {
    inspector: await getSetting('inspector', ''), firm: await getSetting('firm', ''),
    photoMax: await getSetting('photoMax', 2400), gps: await getSetting('gps', true),
    dictation: await getSetting('dictation', 'auto'),
  };
  Dict.localState = await getSetting('speechLocal', null); // checked only on request in Settings
  render();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Offline cache not available', e));
  }
})();
