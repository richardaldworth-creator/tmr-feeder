/* Voice input for Inspection Notes: live dictation into fields, voice note recording
   and picking measurements out of dictated text. Loaded before app.js and uses its
   helpers (h, toast, DB, scheduleSave, S) only when called. */
'use strict';

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ─── Tidying dictated text ─────────────────────────────────
const SPOKEN = [
  [/\s*\bnew paragraph\b\s*/gi, '\n\n'],
  [/\s*\bnew line\b\s*/gi, '\n'],
  [/\s*\b(full stop|period)\b/gi, '.'],
  [/\s*\bcomma\b/gi, ','],
  [/\s*\bquestion mark\b/gi, '?'],
  [/\s*\bcolon\b/gi, ':'],
  [/\s*\bopen bracket\b\s*/gi, ' ('],
  [/\s*\bclose bracket\b/gi, ')'],
  [/\b(\d+)\s+point\s+(\d+)\b/gi, '$1.$2'],
  [/\b(\d+(?:\.\d+)?)\s*(?:metres|meters|metre|meter)\b/gi, '$1m'],
  [/\b(\d+(?:\.\d+)?)m?\s+(?:by|times)\s+(\d+(?:\.\d+)?)/gi, '$1 x $2'],
  [/\bsquare metres\b/gi, 'm²'],
];
function tidySpeech(t) {
  let s = ' ' + t + ' ';
  for (const [re, rep] of SPOKEN) s = s.replace(re, rep);
  s = s.replace(/[ \t]+/g, ' ').replace(/ ([.,?:)])/g, '$1').replace(/\n /g, '\n');
  // capital letter after a full stop, question mark or new line
  s = s.replace(/([.?]\s+|\n)([a-z])/g, (m, a, b) => a + b.toUpperCase());
  return s.trim();
}
function appendText(base, add, multiline) {
  if (!add) return base;
  if (!multiline || !base.trim()) return capFirst(add);
  const b = base.replace(/\s+$/, '');
  if (/\n$/.test(base)) return base + capFirst(add);
  if (/[.?!:]$/.test(b)) return b + ' ' + capFirst(add);
  return b + '. ' + capFirst(add);
}
const capFirst = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// ─── Live dictation ────────────────────────────────────────
const Dict = {
  active: null,
  localState: null, // 'available' | 'downloadable' | 'downloading' | 'unavailable' | null

  mode() {
    const m = (window.S && S.settings.dictation) || 'auto';
    if (m === 'keyboard' || !SpeechRec) return 'keyboard';
    return 'app';
  },

  async checkLocal() {
    if (!SpeechRec || typeof SpeechRec.available !== 'function') return (this.localState = null);
    try { this.localState = await Promise.race([SpeechRec.available({ langs: ['en-GB'], processLocally: true }), new Promise(r => setTimeout(() => r('unavailable'), 3000))]); }
    catch (e) { this.localState = 'unavailable'; }
    return this.localState;
  },

  async installLocal() {
    if (!SpeechRec || typeof SpeechRec.install !== 'function') return false;
    try { return await SpeechRec.install({ langs: ['en-GB'], processLocally: true }); }
    catch (e) { return false; }
  },

  toggle(el, btn, numeric) {
    if (this.active && this.active.el === el) return this.stop();
    if (this.active) this.stop();
    this.start(el, btn, numeric);
  },

  start(el, btn, numeric) {
    if (this.mode() === 'keyboard') {
      el.focus();
      toast(IS_IOS ? 'Tap the microphone key at the bottom of the keyboard to dictate' : 'Tap the microphone on the keyboard to dictate', 3500);
      return;
    }
    const multiline = el.tagName === 'TEXTAREA';
    const a = { el, btn, numeric, multiline, base: el.value, finals: '', heard: false, stopping: false, err: null };
    this.active = a;
    btn.classList.add('on');
    el.classList.add('dictating');
    const useLocal = this.localState === 'available';
    const run = () => {
      const rec = new SpeechRec();
      a.rec = rec;
      rec.lang = 'en-GB';
      rec.interimResults = true;
      rec.continuous = false; // restarted on end, which behaves better on Android than continuous mode
      rec.maxAlternatives = 1;
      if (useLocal) { try { rec.processLocally = true; } catch (e) { /* older browser */ } }
      rec.onresult = e => {
        let fin = '', interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) fin += t; else interim += t;
        }
        if (fin) a.finals = (a.finals + ' ' + fin).trim();
        this.show(a, interim);
      };
      rec.onerror = e => { a.err = e.error; };
      rec.onend = () => {
        if (a.stopping || this.active !== a) return this.finish(a);
        if (a.err && a.err !== 'no-speech' && a.err !== 'aborted') { this.explain(a.err); return this.finish(a); }
        a.err = null;
        try { run(); } catch (e) { this.finish(a); }
      };
      rec.start();
    };
    try { run(); } catch (e) { this.explain(e.name || 'start'); this.finish(a); }
  },

  show(a, interim) {
    const spoken = tidySpeech((a.finals + ' ' + (interim || '')).trim());
    if (!spoken) return;
    a.heard = true;
    let v;
    if (a.numeric) {
      const m = spoken.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
      if (!m) return;
      v = m[0];
    } else v = appendText(a.base, spoken, a.multiline);
    a.el.value = v;
    a.el.dispatchEvent(new Event('input', { bubbles: true }));
    if (a.multiline) a.el.scrollTop = a.el.scrollHeight;
  },

  stop() {
    const a = this.active;
    if (!a) return;
    a.stopping = true;
    try { a.rec && a.rec.stop(); } catch (e) { this.finish(a); }
    setTimeout(() => this.finish(a), 1500); // in case the engine never fires onend
  },

  finish(a) {
    if (a.done) return;
    a.done = true;
    a.btn.classList.remove('on');
    a.el.classList.remove('dictating');
    if (this.active === a) this.active = null;
    if (a.heard) {
      this.show(a, '');
      a.el.dispatchEvent(new CustomEvent('dictated', { bubbles: true, detail: { key: a.el.dataset.key } }));
    }
  },

  explain(err) {
    const msg = {
      'not-allowed': 'Microphone permission was refused. Allow it in the phone settings for this app, or use the keyboard microphone.',
      'service-not-allowed': IS_IOS
        ? 'The in-app microphone is not available here. Use the microphone key on the keyboard instead, which works offline on recent iPhones. You can switch to keyboard dictation in Settings.'
        : 'Speech recognition is blocked in this browser. Use the keyboard microphone instead.',
      'network': 'No signal for speech recognition. Use the keyboard microphone, record a voice note, or download the offline speech pack in Settings when you are next in signal.',
      'audio-capture': 'No microphone could be found.',
      'language-not-supported': 'UK English speech recognition is not available on this phone. Use the keyboard microphone instead.',
    }[err] || 'Dictation stopped. Use the keyboard microphone if it keeps happening.';
    toast(msg, 6000);
  },
};

function micButton(el, numeric) {
  const b = h('button', { type: 'button', class: 'mic', 'aria-label': 'Dictate', title: 'Dictate' }, '🎙');
  b.addEventListener('click', e => { e.preventDefault(); Dict.toggle(el, b, numeric); });
  return b;
}

// ─── Voice notes (audio recordings) ────────────────────────
const Recorder = {
  mr: null, target: null, started: 0, timer: null,

  supported() { return !!(navigator.mediaDevices && window.MediaRecorder); },

  async toggle(jobId, itemId, btn) {
    if (this.mr) return this.stop();
    if (!this.supported()) { toast('This browser cannot record audio'); return; }
    if (Dict.active) Dict.stop();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { toast('Microphone permission is needed to record a voice note', 4000); return; }
    const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks = [];
    this.mr = mr; this.target = { jobId, itemId }; this.started = Date.now();
    mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(this.timer);
      const mime = mr.mimeType || type || 'audio/webm';
      const blob = new Blob(chunks, { type: mime });
      const memo = { id: uid(), jobId, itemId: itemId || null, blob, type: mime, duration: Math.round((Date.now() - this.started) / 1000), created: Date.now(), transcript: '' };
      this.mr = null;
      if (blob.size) {
        await DB.put('memos', memo);
        if (S.job) { S.job.updated = Date.now(); await DB.put('jobs', S.job); }
        toast(`Voice note saved (${fmtDur(memo.duration)})`);
      }
      render();
    };
    mr.start(1000);
    const paint = () => { btn.textContent = `■ Stop recording ${fmtDur((Date.now() - this.started) / 1000)}`; };
    btn.classList.add('danger'); paint();
    this.timer = setInterval(paint, 500);
  },

  stop() { if (this.mr && this.mr.state !== 'inactive') this.mr.stop(); },
};
const fmtDur = s => { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const audioExt = t => /mp4|m4a|aac/.test(t) ? 'm4a' : /ogg/.test(t) ? 'ogg' : 'webm';
window.addEventListener('hashchange', () => Recorder.stop());

function voiceCard(jobId, itemId, memos, title) {
  const btn = h('button', { class: 'btn block' }, '● Record voice note');
  btn.addEventListener('click', () => Recorder.toggle(jobId, itemId, btn));
  return h('div', { class: 'card' },
    h('h2', null, h('span', { class: 'grow' }, title || 'Voice notes'), h('span', { class: 'pill' }, memos.length)),
    h('p', { class: 'muted' }, 'Recordings work with no signal. They are kept with the inspection and exported in the ZIP. Type or dictate a transcript later if you want the words in the Word schedule.'),
    btn,
    memos.map((m, i) => {
      const url = URL.createObjectURL(m.blob);
      const ta = h('textarea', { value: m.transcript || '', placeholder: 'Transcript or summary (optional)', style: { minHeight: '60px' }, oninput: e => { m.transcript = e.target.value; scheduleSave(m, 'memos'); } });
      ta.dataset.key = 'transcript';
      return h('div', { style: { borderTop: '1px solid #eef1e6', paddingTop: '8px', marginTop: '8px' } },
        h('div', { class: 'muted' }, `Voice note ${i + 1} · ${new Date(m.created).toLocaleString('en-GB')} · ${fmtDur(m.duration || 0)}`),
        h('audio', { controls: true, src: url, preload: 'metadata', style: { width: '100%', margin: '6px 0' } }),
        Dict.mode() === 'app' ? h('div', { class: 'fld' }, ta, micButton(ta)) : ta,
        h('div', { class: 'btns' },
          h('button', { class: 'btn sec sm', onclick: () => downloadBlob(m.blob, safe(`${title || 'Voice note'} ${i + 1}.${audioExt(m.type)}`)) }, 'Save copy'),
          h('button', { class: 'btn danger sm', onclick: async () => { if (confirm('Delete this voice note?')) { await DB.del('memos', m.id); render(); } } }, 'Delete')));
    }));
}

// ─── Picking measurements out of dictated notes ────────────
function pickUpMeasures(it) {
  const text = tidySpeech([it.notes, it.defects, it.features].filter(Boolean).join('. '));
  const found = { dims: [], eaves: '', ridge: '', ceiling: '' };
  const have = new Set((it.measures || []).map(r => `${num(r.l)}x${num(r.w)}`));
  const re = /(\d+(?:\.\d+)?)\s*m?\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s*m?\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const l = num(m[1]), w = num(m[2]);
    if (!l || !w || l > 500 || w > 500) continue;
    const key = `${l}x${w}`;
    if (have.has(key)) continue;
    have.add(key);
    // use the few words before the figures as the label, e.g. "lean-to 12 x 6"
    const before = text.slice(Math.max(0, m.index - 30), m.index).split(/[.,;\n]/).pop().trim().split(/\s+/).slice(-3).join(' ');
    found.dims.push({ label: /\d/.test(before) ? '' : capFirst(before.replace(/\b(measures|measuring|is|of|at|about|approximately|overall)\b/gi, '').trim()), l: String(l), w: String(w) });
  }
  const grab = word => { const r = new RegExp(word + '[^\\d.]{0,24}(\\d+(?:\\.\\d+)?)', 'i').exec(text); return r ? r[1] : ''; };
  if (it.kind === 'building' && !it.eaves) found.eaves = grab('eaves');
  if (it.kind === 'building' && !it.ridge) found.ridge = grab('ridge');
  if (it.kind === 'room' && !it.ceiling) found.ceiling = grab('ceiling');
  const any = found.dims.length || found.eaves || found.ridge || found.ceiling;
  return any ? found : null;
}

function describeFound(f) {
  const bits = f.dims.map(d => `${d.label ? d.label + ' ' : ''}${d.l} x ${d.w}m`);
  if (f.eaves) bits.push(`eaves ${f.eaves}m`);
  if (f.ridge) bits.push(`ridge ${f.ridge}m`);
  if (f.ceiling) bits.push(`ceiling ${f.ceiling}m`);
  return bits.join(', ');
}

function applyFound(it, f) {
  it.measures = (it.measures || []).filter(r => r.direct ? num(r.area) : (num(r.l) || num(r.w) || r.label));
  f.dims.forEach(d => it.measures.push(d));
  if (f.eaves) it.eaves = f.eaves;
  if (f.ridge) it.ridge = f.ridge;
  if (f.ceiling) it.ceiling = f.ceiling;
  scheduleSave(it, 'items');
}

function offerPickUp(it, host) {
  const f = pickUpMeasures(it);
  host.replaceChildren();
  if (!f) return false;
  host.append(h('div', { class: 'banner ok' },
    h('div', null, `Measurements heard in your notes: ${describeFound(f)}.`),
    h('div', { class: 'btns' },
      h('button', { class: 'btn sm', onclick: () => { applyFound(it, f); toast('Added to measurements'); render(); } }, 'Add to measurements'),
      h('button', { class: 'btn sec sm', onclick: () => host.replaceChildren() }, 'Ignore'))));
  return true;
}
