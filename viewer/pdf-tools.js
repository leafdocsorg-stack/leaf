/* Leaf Viewer — PDF toolkit, phases 1–2.
   View, annotate, fill forms on the page, create fields, sign, organize, merge, split,
   stamps (watermark, page numbers, Bates), true redaction, passwords, OCR.
   Built on PDF.js (Apache 2.0), pdf-lib (MIT), qpdf (Apache 2.0) and Tesseract.js (Apache 2.0). */
{
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
if (window.pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
const say = t => window.LeafApp.say(t);

let srcs = [], pages = [], annots = {}, fields = [], values = {}, tool = 'none', sigPng = null, sigSize = null;
let undo = [], uidN = 0, aidN = 0, fileName = 'document.pdf', widgets = {};
const vps = {};
const stamps = { wm: '', wmOpacity: 0.15, pn: false, pnFmt: 'Page {n} of {total}', pnPos: 'bc', bates: false, batesPrefix: 'ABC', batesStart: 1, batesDigits: 6 };
const snap = () => { undo.push(JSON.stringify({ pages, annots })); if (undo.length > 60) undo.shift(); };
const busy = t => { $('#busy').hidden = !t; $('#busy').textContent = t || ''; };

/* ---------- qpdf (passwords) ---------- */
async function qpdf(args, input) {
  if (typeof window.Module !== 'function') throw new Error('The password engine did not load in this view.');
  const m = await window.Module({ noInitialRun: true, locateFile: () => 'qpdf.wasm', print: () => {}, printErr: () => {} });
  m.FS.writeFile('/in.pdf', input);
  let code; try { code = m.callMain(args); } catch (e) { code = e && e.status != null ? e.status : 2; }
  let out = null; try { out = m.FS.readFile('/out.pdf'); } catch (e) {}
  return { code, out };
}

/* ---------- open ---------- */
async function open(bytes, name) {
  if (!window.pdfjsLib || !window.PDFLib) { say('The PDF engine did not load in this view.'); return false; }
  bytes = await unlockIfNeeded(bytes, name); if (!bytes) return false;
  srcs = []; pages = []; annots = {}; undo = []; values = {}; fields = []; widgets = {}; fileName = name || 'document.pdf';
  Object.assign(stamps, { wm: '', wmOpacity: 0.15, pn: false, pnFmt: 'Page {n} of {total}', pnPos: 'bc', bates: false, batesPrefix: 'ABC', batesStart: 1, batesDigits: 6 }); $('#pwSet').value = ''; ['#infoTitle', '#infoAuthor', '#infoSubject'].forEach(i => $(i).value = ''); $('#ocrResult').textContent = '';
  await addSource(bytes, name);
  await readFields();
  window.LeafApp.setMode('pdf', fileName);
  document.querySelector('#pdfMain [data-tab="pedit"]').click(); renderAll(); renderFields(); syncStampUI();
  return true;
}
async function unlockIfNeeded(bytes, name) {
  try { const d = await pdfjsLib.getDocument({ data: bytes.slice() }).promise; await d.destroy(); return bytes; }
  catch (err) {
    if (!err || err.name !== 'PasswordException') throw err;
    for (let tries = 0; tries < 3; tries++) {
      const pw = await askPassword(name, tries > 0);
      if (pw == null) return null;
      busy('Unlocking…'); const r = await qpdf(['--password=' + pw, '--decrypt', '/in.pdf', '/out.pdf'], bytes).catch(e => ({ code: 2, err: e })); busy('');
      if (r.err) { say(r.err.message); return null; }
      if (r.code === 0 && r.out) { say('Unlocked. The password is removed in this copy; you can add one again when saving.'); return r.out; }
    }
    say('That password did not work.'); return null;
  }
}
function askPassword(name, retry) {
  return new Promise(res => {
    const d = $('#pwDlg'); $('#pwTitle').textContent = (retry ? 'Wrong password. ' : '') + name + ' is password-protected';
    $('#pwIn').value = ''; d.showModal(); $('#pwIn').focus();
    const done = v => { d.close(); $('#pwOk').onclick = $('#pwCancel').onclick = null; res(v); };
    $('#pwOk').onclick = e => { e.preventDefault(); done($('#pwIn').value); };
    $('#pwCancel').onclick = () => done(null);
  });
}
async function addSource(bytes, name) {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const si = srcs.push({ name, bytes, doc }) - 1;
  for (let i = 0; i < doc.numPages; i++) pages.push({ uid: 'p' + (++uidN), src: si, idx: i, rot: 0, sel: false });
  if (si === 0) for (let i = 0; i < doc.numPages; i++) {
    const anns = await (await doc.getPage(i + 1)).getAnnotations();
    widgets[i] = anns.filter(a => a.subtype === 'Widget' && a.fieldName && !a.hidden).map(a => ({ name: a.fieldName, rect: a.rect, ft: a.fieldType, check: !!a.checkBox, radio: !!a.radioButton, exp: a.buttonValue, options: (a.options || []).map(o => o.displayValue || o.exportValue) }));
  }
  return doc.numPages;
}
async function readFields() {
  try {
    const d = await PDFLib.PDFDocument.load(srcs[0].bytes, { ignoreEncryption: true }), L = PDFLib;
    fields = d.getForm().getFields().map(f => {
      const type = f instanceof L.PDFTextField ? 'text' : f instanceof L.PDFCheckBox ? 'check' : f instanceof L.PDFDropdown ? 'drop' : f instanceof L.PDFOptionList ? 'list' : f instanceof L.PDFRadioGroup ? 'radio' : 'other', name = f.getName();
      let options = [], value = '';
      try {
        if (type === 'text') value = f.getText() || '';
        else if (type === 'check') value = f.isChecked();
        else if (type === 'drop' || type === 'list') { options = f.getOptions(); value = (f.getSelected() || [])[0] || ''; }
        else if (type === 'radio') { options = f.getOptions(); value = f.getSelected() || ''; }
      } catch (e) {}
      values[name] = value;
      return { name, type, options };
    }).filter(f => f.type !== 'other');
  } catch (e) { fields = []; }
}

/* ---------- rendering ---------- */
function renderAll() {
  $('#pdfPages').innerHTML = pages.map((p, i) => '<div class="ppage" data-uid="' + p.uid + '"><canvas></canvas><svg class="ov" data-uid="' + p.uid + '"></svg><div class="fl" data-uid="' + p.uid + '"></div><span class="pnum">' + (i + 1) + ' / ' + pages.length + '</span></div>').join('') || '<p class="note">No pages. Add a PDF to start.</p>';
  $('#pdfThumbs').innerHTML = pages.map((p, i) => '<div class="thumb' + (p.sel ? ' sel' : '') + '" data-uid="' + p.uid + '"><label class="tsel"><input type="checkbox" data-act="sel"' + (p.sel ? ' checked' : '') + ' aria-label="Select page ' + (i + 1) + '"> ' + (i + 1) + (srcs.length > 1 ? ' <small>' + esc(srcs[p.src].name.slice(0, 14)) + '</small>' : '') + '</label><canvas></canvas><div class="tact"><button data-act="up" aria-label="Move page ' + (i + 1) + ' up"' + (i ? '' : ' disabled') + '>↑</button><button data-act="down" aria-label="Move page ' + (i + 1) + ' down"' + (i < pages.length - 1 ? '' : ' disabled') + '>↓</button><button data-act="rot" aria-label="Rotate page ' + (i + 1) + '">⟳</button><button data-act="del" aria-label="Delete page ' + (i + 1) + '">✕</button></div></div>').join('');
  $('#pgCount').textContent = pages.length + (pages.length === 1 ? ' page' : ' pages') + (srcs.length > 1 ? ' from ' + srcs.length + ' files' : '');
  pages.forEach(p => { renderPage(p); renderThumb(p); });
}
async function pdfPage(p) { return srcs[p.src].doc.getPage(p.idx + 1); }
async function renderPage(p) {
  const el = document.querySelector('.ppage[data-uid="' + p.uid + '"]'); if (!el) return;
  const page = await pdfPage(p), rotation = (page.rotate + p.rot) % 360;
  const base = page.getViewport({ scale: 1, rotation }), W = Math.min(el.parentElement.clientWidth || 800, 860);
  const vp = page.getViewport({ scale: W / base.width, rotation }); vps[p.uid] = vp;
  const c = el.querySelector('canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
  el.style.width = vp.width + 'px'; el.style.height = vp.height + 'px';
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
  drawOverlay(p.uid); drawFieldInputs(p);
}
async function renderThumb(p) {
  const el = document.querySelector('.thumb[data-uid="' + p.uid + '"] canvas'); if (!el) return;
  const page = await pdfPage(p), rotation = (page.rotate + p.rot) % 360;
  const base = page.getViewport({ scale: 1, rotation }), vp = page.getViewport({ scale: 120 / base.width, rotation });
  el.width = vp.width; el.height = vp.height;
  await page.render({ canvasContext: el.getContext('2d'), viewport: vp }).promise;
}
/* live form inputs over the PDF's own fields */
function drawFieldInputs(p) {
  const box = document.querySelector('.fl[data-uid="' + p.uid + '"]'), vp = vps[p.uid]; if (!box || !vp) return;
  const ws = p.src === 0 ? (widgets[p.idx] || []) : [];
  box.innerHTML = ws.map(w => {
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle(w.rect), l = Math.min(x1, x2), t = Math.min(y1, y2), wd = Math.abs(x2 - x1), ht = Math.abs(y2 - y1);
    const pos = 'left:' + l + 'px;top:' + t + 'px;width:' + wd + 'px;height:' + ht + 'px;font-size:' + Math.max(9, Math.min(ht * 0.62, 16)) + 'px';
    const v = values[w.name], nm = esc(w.name);
    if (w.ft === 'Btn' && w.check) return '<input type="checkbox" class="pf" data-f="' + nm + '" aria-label="' + nm + '" style="' + pos + '"' + (v ? ' checked' : '') + '>';
    if (w.ft === 'Btn' && w.radio) return '<input type="radio" class="pf" name="r-' + nm + '" data-f="' + nm + '" data-v="' + esc(w.exp || '') + '" aria-label="' + nm + '" style="' + pos + '"' + (v && v === w.exp ? ' checked' : '') + '>';
    if (w.ft === 'Ch') return '<select class="pf" data-f="' + nm + '" aria-label="' + nm + '" style="' + pos + '"><option value=""></option>' + w.options.map(o => '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
    if (w.ft === 'Tx') return '<input class="pf" data-f="' + nm + '" aria-label="' + nm + '" style="' + pos + '" value="' + esc(v || '') + '">';
    return '';
  }).join('');
}
function setValue(name, v, from) {
  values[name] = v;
  document.querySelectorAll('[data-f="' + CSS.escape(name) + '"]').forEach(el => {
    if (el === from) return;
    if (el.type === 'checkbox') el.checked = !!v; else if (el.type === 'radio') el.checked = el.dataset.v === v; else el.value = v || '';
  });
}
const onField = e => {
  const el = e.target.closest('#pdfMain [data-f]'); if (!el) return;
  setValue(el.dataset.f, el.type === 'checkbox' ? el.checked : el.type === 'radio' ? el.dataset.v : el.value, el);
};
document.addEventListener('input', onField); document.addEventListener('change', onField);

function arrowHead(x1, y1, x2, y2, L) { const ang = Math.atan2(y2 - y1, x2 - x1), sp = 0.45; return [[x2, y2], [x2 - L * Math.cos(ang - sp), y2 - L * Math.sin(ang - sp)], [x2 - L * Math.cos(ang + sp), y2 - L * Math.sin(ang + sp)]].map(q => q.join(',')).join(' '); }
function drawOverlay(uid) {
  const svg = document.querySelector('svg.ov[data-uid="' + uid + '"]'), vp = vps[uid]; if (!svg || !vp) return;
  svg.setAttribute('viewBox', '0 0 ' + vp.width + ' ' + vp.height);
  const V = (x, y) => vp.convertToViewportPoint(x, y);
  const R = a => { const [x1, y1] = V(a.x, a.y), [x2, y2] = V(a.x + a.w, a.y + a.h); return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }; };
  let out = (annots[uid] || []).map(a => {
    if (a.t === 'hl') { const r = R(a); return '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="' + (a.c || '#ffd633') + '" fill-opacity=".4"/>'; }
    if (a.t === 'img') { const r = R(a); return '<image href="' + a.png + '" x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" preserveAspectRatio="none"/>'; }
    if (a.t === 'redact') { const r = R(a); return '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="#000" fill-opacity=".55" stroke="#d11" stroke-width="1.5"/>'; }
    if (a.t === 'newfield') { const r = R(a); return '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="#0b5d63" fill-opacity=".08" stroke="#0b5d63" stroke-dasharray="4 3"/><text x="' + (r.x + 4) + '" y="' + (r.y - 4) + '" font-size="11" fill="#0b5d63" font-family="Inter,sans-serif">' + esc(a.ft + ': ' + a.name) + '</text>'; }
    if (a.t === 'edit') { const r = R(editBox(a)), [bx, by] = V(a.x, a.by); return '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="' + a.bg + '"/><text x="' + bx + '" y="' + by + '" font-size="' + (a.size * vp.scale) + '" font-family=\'' + cssFam(a) + '\' font-weight="' + (a.bold ? 700 : 400) + '" font-style="' + (a.italic ? 'italic' : 'normal') + '" fill="' + a.fg + '"' + (a.wt ? ' stroke="' + a.fg + '" stroke-width="' + (a.wt * vp.scale) + '" stroke-linejoin="round"' : '') + ' xml:space="preserve">' + esc(a.txt) + '</text>'; }
    if (a.t === 'ul' || a.t === 'st') { const r = R(a), yy = a.t === 'ul' ? r.y + r.h : r.y + r.h / 2; return '<line x1="' + r.x + '" x2="' + (r.x + r.w) + '" y1="' + yy + '" y2="' + yy + '" stroke="' + (a.c || '#d11') + '" stroke-width="1.5"/>'; }
    if (a.t === 'rect') { const r = R(a); return '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="none" stroke="' + (a.c || '#0b5d63') + '" stroke-width="' + ((a.wd || 1.6) * vp.scale) + '"/>'; }
    if (a.t === 'ell') { const r = R(a); return '<ellipse cx="' + (r.x + r.w / 2) + '" cy="' + (r.y + r.h / 2) + '" rx="' + (r.w / 2) + '" ry="' + (r.h / 2) + '" fill="none" stroke="' + (a.c || '#0b5d63') + '" stroke-width="' + ((a.wd || 1.6) * vp.scale) + '"/>'; }
    if (a.t === 'line') { const [x1, y1] = V(a.x0, a.y0), [x2, y2] = V(a.x1, a.y1); let o = '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + (a.c || '#0b5d63') + '" stroke-width="' + ((a.wd || 1.6) * vp.scale) + '" stroke-linecap="round"/>'; if (a.arrow) { const h = arrowHead(x1, y1, x2, y2, 9 + (a.wd || 1.6) * 2 * vp.scale); o += '<polygon points="' + h + '" fill="' + (a.c || '#0b5d63') + '"/>'; } return o; }
    if (a.t === 'link') { const r = R(a); return '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="#2a6fdb" fill-opacity=".12" stroke="#2a6fdb" stroke-dasharray="3 2"/>'; }
    if (a.t === 'note') { const [x, y] = V(a.x, a.y); return '<g><rect x="' + x + '" y="' + (y - 18) + '" width="18" height="18" rx="2" fill="#ffd633" stroke="#a88400"/><text x="' + (x + 9) + '" y="' + (y - 5) + '" font-size="12" text-anchor="middle" fill="#6b5300" font-family="Helvetica,Arial,sans-serif">i</text><title>' + esc(a.txt) + '</title></g>'; }
    if (a.t === 'stamp') { const r = R(a); return '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" fill="none" stroke="' + a.c + '" stroke-width="' + (2.5 * vp.scale) + '" rx="' + (4 * vp.scale) + '"/><text x="' + (r.x + r.w / 2) + '" y="' + (r.y + r.h / 2) + '" dy=".35em" text-anchor="middle" font-size="' + (a.fs * vp.scale) + '" font-weight="700" font-family="Helvetica,Arial,sans-serif" fill="' + a.c + '">' + esc(a.label) + '</text>'; }
    if (a.t === 'ink') return '<polyline fill="none" stroke="' + (a.c || '#0b5d63') + '" stroke-width="' + ((a.wd || 1.6) * vp.scale) + '" stroke-linecap="round" stroke-linejoin="round" points="' + a.pts.map(pt => V(pt[0], pt[1]).join(',')).join(' ') + '"/>';
    if (a.t === 'text') { const [x, y] = V(a.x, a.y); return '<text x="' + x + '" y="' + y + '" font-size="' + (a.s * vp.scale) + '" font-family="Helvetica,Arial,sans-serif" fill="' + (a.c || '#111') + '">' + esc(a.txt) + '</text>'; }
    return '';
  }).join('');
  { const pg = pages.find(q => q.uid === uid); if (pg && pg.crop) { const c = pg.crop, pgo = srcs[pg.src].doc, W = vp.width, H = vp.height, k = vp.scale; const sh = (x, y, w, h) => w > 0 && h > 0 ? '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="#000" fill-opacity=".38"/>' : ''; out += sh(0, 0, c.l * k, H) + sh(W - c.r * k, 0, c.r * k, H) + sh(c.l * k, 0, W - (c.l + c.r) * k, c.t * k) + sh(c.l * k, H - c.b * k, W - (c.l + c.r) * k, c.b * k); } }
  out += stampPreview(uid, vp);
  if (draft && draft.uid === uid) {
    if (draft.t === 'ink') out += '<polyline fill="none" stroke="#0b5d63" stroke-width="2" points="' + draft.pts.map(pt => V(pt[0], pt[1]).join(',')).join(' ') + '"/>';
    else if (draft.t === 'line' || draft.t === 'arrow') { const [x1, y1] = V(draft.x0, draft.y0), [x2, y2] = V(draft.x1, draft.y1); out += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#0b5d63" stroke-width="2" stroke-dasharray="4 3"/>'; }
    else { const fl = ['hl', 'ul', 'st'].includes(draft.t) && Math.abs(draft.y1 - draft.y0) < 6, my = (draft.y0 + draft.y1) / 2; const [x1, y1] = V(draft.x0, fl ? my + 6 : draft.y0), [x2, y2] = V(draft.x1, fl ? my - 6 : draft.y1); const col = draft.t === 'redact' ? '#d11' : draft.t === 'field' ? '#0b5d63' : '#c9a400'; out += '<rect x="' + Math.min(x1, x2) + '" y="' + Math.min(y1, y2) + '" width="' + Math.abs(x2 - x1) + '" height="' + Math.abs(y2 - y1) + '" fill="' + col + '" fill-opacity=".15" stroke="' + col + '" stroke-dasharray="4 3"/>'; }
  }
  svg.innerHTML = out;
}
function stampTexts(i, total) {
  const t = [];
  if (stamps.pn) t.push({ k: 'pn', s: stamps.pnFmt.replace('{n}', i + 1).replace('{total}', total) });
  if (stamps.bates) t.push({ k: 'bates', s: stamps.batesPrefix + String(stamps.batesStart + i).padStart(stamps.batesDigits, '0') });
  return t;
}
function stampPreview(uid, vp) {
  const i = pages.findIndex(p => p.uid === uid); if (i < 0) return '';
  let o = '';
  if (stamps.wm) o += '<text x="' + vp.width / 2 + '" y="' + vp.height / 2 + '" text-anchor="middle" dominant-baseline="middle" font-size="' + (60 * vp.scale) + '" font-weight="700" font-family="Helvetica,Arial,sans-serif" fill="#777" fill-opacity="' + stamps.wmOpacity + '" transform="rotate(-45 ' + vp.width / 2 + ' ' + vp.height / 2 + ')">' + esc(stamps.wm) + '</text>';
  for (const s of stampTexts(i, pages.length)) {
    const fs = 9 * vp.scale, y = vp.height - 22 * vp.scale;
    if (s.k === 'bates') o += '<text x="' + (vp.width - 36 * vp.scale) + '" y="' + y + '" text-anchor="end" font-size="' + fs + '" font-family="Helvetica,Arial,sans-serif" fill="#222">' + esc(s.s) + '</text>';
    else { const pos = stamps.pnPos, x = pos === 'bl' ? 36 * vp.scale : pos === 'br' ? vp.width - 36 * vp.scale : vp.width / 2; o += '<text x="' + x + '" y="' + (stamps.bates && pos === 'br' ? y - 12 * vp.scale : y) + '" text-anchor="' + (pos === 'bl' ? 'start' : pos === 'br' ? 'end' : 'middle') + '" font-size="' + fs + '" font-family="Helvetica,Arial,sans-serif" fill="#222">' + esc(s.s) + '</text>'; }
  }
  return o;
}
const redrawOverlays = () => pages.forEach(p => drawOverlay(p.uid));

/* ---------- tools ---------- */
function setTool(t) {
  tool = t;
  document.querySelectorAll('button[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t));
  $('#pdfPages').dataset.tool = t;
  const hints = { none: 'Pick a tool, then work on the page. Form fields can be typed into directly.', edit: 'Click any line of text on the page, then type to change it. Enter to apply, Esc to cancel.', ul: 'Drag across text to underline it.', st: 'Drag across text to strike it through.', rect: 'Drag to draw a box.', image: insPng ? 'Click where the image goes.' : 'Choose an image first.', hl: 'Drag across text to highlight it.', ell: 'Drag to draw an oval.', line: 'Drag to draw a line.', arrow: 'Drag from the tail to the point of the arrow.', link: 'Drag a box over the text or image that should open the link.', note: 'Type the note, then click where its pin goes.', stamp: 'Click where the stamp goes.',  ink: 'Draw freely on the page.', text: 'Type your text below, then click where it goes.', sign: sigPng ? 'Click where your signature goes.' : 'Create your signature in the Sign tab first.', redact: 'Drag over anything to remove. It is permanently removed when you save.', field: 'Drag a box where the new field goes.' };
  $('#toolHint').textContent = hints[t] || ''; if ($('#editHint')) $('#editHint').textContent = t === 'edit' ? hints.edit : ''; $('#redactHint').textContent = t === 'redact' ? hints.redact : ''; $('#fieldHint').textContent = t === 'field' ? hints.field : '';
}

/* ---------- edit existing text ---------- */
const runCache = {};
{ const st = document.createElement('style');
  st.textContent = '.pedit{position:absolute;z-index:5;box-sizing:border-box;border:1px solid #14808a;outline:2px solid rgba(20,128,138,.25);padding:0 1px;margin:0;line-height:1;border-radius:1px}#pdfPages[data-tool=edit] .ov{cursor:text}';
  document.head.appendChild(st); }
async function runsFor(uid) {
  if (runCache[uid]) return runCache[uid];
  const p = pages.find(q => q.uid === uid), page = await pdfPage(p), tc = await page.getTextContent();
  const runs = []; let cur = null;
  const fontInfo = fn => {
    let name = ''; try { name = page.commonObjs.get(fn).name || ''; } catch (e) {}
    const fam = (tc.styles[fn] || {}).fontFamily || '';
    const n = name + ' ' + fam;
    return { bold: /bold|black|heavy|semibold|demi/i.test(n), italic: /italic|oblique/i.test(n),
      fam: /courier|mono|consolas|menlo/i.test(n) ? 'mono' : /times|georgia|serif|garamond|palatino|minion|cambria|book/i.test(n) && !/sans/i.test(n) ? 'serif' : 'sans' };
  };
  for (const it of tc.items) {
    if (!it.str && !it.width) continue;
    const [a, b, , d, e, f] = it.transform, size = Math.hypot(a, b) || Math.abs(d) || 10;
    if (Math.abs(b) > 0.05 * size) continue;
    const fi = fontInfo(it.fontName);
    if (cur && Math.abs(f - cur.y) < 0.3 * size) {
      const gap = e - (cur.x + cur.w);
      if (gap > -size * 0.5 && gap < size * 0.6) {
        if (gap > size * 0.25 && !/\s$/.test(cur.str) && !/^\s/.test(it.str)) cur.str += ' ';
        cur.str += it.str; cur.w = Math.max(cur.w, e + it.width - cur.x); continue;
      }
    }
    cur = { x: e, y: f, w: it.width, size, str: it.str, ...fi }; runs.push(cur);
  }
  return (runCache[uid] = runs.filter(r => r.str.trim() && r.w > 1));
}
const bbox = r => ({ x: r.x - 1, y: r.y - 0.24 * r.size, w: r.w + 2, h: 1.22 * r.size });
const inBox = (b, pt) => pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h;
const editBox = a => bbox({ x: a.x, y: a.by, w: a.w, size: a.size });
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const covered = (uid, r) => (annots[uid] || []).some(a => a.t === 'edit' && overlaps(bbox(r), editBox(a)));
function sampleColors(uid, r) {
  const vp = vps[uid], el = document.querySelector('.ppage[data-uid="' + uid + '"] canvas'); if (!el || !vp) return { bg: '#ffffff', fg: '#111111' };
  const k = el.width / vp.width, ctx = el.getContext('2d'), bb = bbox(r);
  const [x1, y1, x2, y2] = vp.convertToViewportRectangle([bb.x, bb.y, bb.x + bb.w, bb.y + bb.h]);
  const L = Math.max(0, Math.floor(Math.min(x1, x2) * k)), T = Math.max(0, Math.floor(Math.min(y1, y2) * k));
  const W = Math.max(1, Math.min(el.width - L, Math.ceil(Math.abs(x2 - x1) * k))), H = Math.max(1, Math.min(el.height - T, Math.ceil(Math.abs(y2 - y1) * k)));
  let data; try { data = ctx.getImageData(L, T, W, H).data; } catch (e) { return { bg: '#ffffff', fg: '#111111' }; }
  const cnt = {}; let best = '', bn = 0;
  for (let i = 0; i < data.length; i += 4) { const q = (data[i] >> 4) + ',' + (data[i + 1] >> 4) + ',' + (data[i + 2] >> 4); const n = cnt[q] = (cnt[q] || 0) + 1; if (n > bn) { bn = n; best = q; } }
  const bgc = best.split(',').map(v => v * 16 + 8); let far = 0, fgc = [17, 17, 17];
  for (let i = 0; i < data.length; i += 4) { const dd = Math.abs(data[i] - bgc[0]) + Math.abs(data[i + 1] - bgc[1]) + Math.abs(data[i + 2] - bgc[2]); if (dd > far) { far = dd; fgc = [data[i], data[i + 1], data[i + 2]]; } }
  const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  let ink = 0; if (far > 90) for (let i = 0; i < data.length; i += 4) ink += Math.min(1, (Math.abs(data[i] - bgc[0]) + Math.abs(data[i + 1] - bgc[1]) + Math.abs(data[i + 2] - bgc[2])) / far);
  return { bg: hex(bgc.map(v => v > 232 ? 255 : v)), fg: far > 90 ? hex(fgc) : '#111111', ink: ink / W, k };
}
/* Match stroke weight: the replacement uses a standard font, which is often thinner than the original, so measure how much ink each has per unit of width and thicken the new text to match. */
function fitWeight(a, cols) {
  if (cols) { a.ink0 = cols.ink; a.k0 = cols.k; } a.wt = 0; if (!a.ink0 || !a.txt) return;
  try {
    const k = a.k0, px = a.size * k, c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
    const font = (a.italic ? 'italic ' : '') + (a.bold ? '700 ' : '400 ') + px + 'px ' + cssFam(a); x.font = font;
    const w = Math.max(1, Math.ceil(x.measureText(a.txt).width)); c.width = w + 8; c.height = Math.ceil(px * 1.5);
    x.font = font; x.fillStyle = a.bg; x.fillRect(0, 0, c.width, c.height); x.fillStyle = a.fg; x.textBaseline = 'alphabetic'; x.fillText(a.txt, 4, px * 1.1);
    const d = x.getImageData(0, 0, c.width, c.height).data, hx = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), B = hx(a.bg), F = hx(a.fg);
    const far = Math.abs(F[0] - B[0]) + Math.abs(F[1] - B[1]) + Math.abs(F[2] - B[2]); if (far < 90) return;
    let ink = 0; for (let i = 0; i < d.length; i += 4) ink += Math.min(1, (Math.abs(d[i] - B[0]) + Math.abs(d[i + 1] - B[1]) + Math.abs(d[i + 2] - B[2])) / far);
    const mine = ink / w, ratio = a.ink0 / mine;
    if (ratio > 1.14) a.wt = Math.min((ratio - 1.12) * 0.09 * a.size, 0.07 * a.size);
  } catch (e) { a.wt = 0; }
}
/* Convert the PDF's text (with your edits and added text) into Leaf blocks: headings, paragraphs and lists. Images and exact layout are not carried over. */
async function toBlocks() {
  const lines = []; let sizes = [];
  for (const p of pages) {
    const runs = (await runsFor(p.uid)).map(r => ({ ...r })), an = annots[p.uid] || [];
    for (const r of runs) { const e = an.find(a => a.t === 'edit' && Math.abs(a.x - r.x) < 1.5 && Math.abs(a.by - r.y) < 1.5); if (e) r.str = e.txt; }
    for (const a of an) if (a.t === 'text') runs.push({ x: a.x, y: a.y, size: a.s, str: a.txt, w: 1 });
    runs.sort((a, b) => b.y - a.y || a.x - b.x);
    const pl = [];
    for (const r of runs) {
      const l = pl[pl.length - 1];
      if (l && Math.abs(l.y - r.y) < 0.4 * Math.max(l.size, r.size)) { l.str += (l.str.endsWith(' ') || r.str.startsWith(' ') ? '' : ' ') + r.str; l.size = Math.max(l.size, r.size); }
      else pl.push({ y: r.y, size: r.size, str: r.str, x: r.x, page: p.uid });
    }
    for (const l of pl) { l.str = l.str.replace(/\s+/g, ' ').trim(); if (l.str) { lines.push(l); sizes.push(l.size); } }
  }
  sizes.sort((a, b) => a - b); const med = sizes[Math.floor(sizes.length / 2)] || 11;
  const blocks = []; let n = 0, cur = null; const id = () => 'b' + (++n);
  const flush = () => { if (cur) { blocks.push({ id: id(), type: 'paragraph', text: [{ t: cur.txt }] }); cur = null; } };
  let list = null; const flushList = () => { if (list) { blocks.push({ id: id(), type: 'list', items: list }); list = null; } };
  let prev = null;
  for (const l of lines) {
    const bullet = /^([•·▪◦*–-]|\d{1,2}[.)])\s+/.test(l.str);
    const heading = l.size >= med * 1.25 && l.str.length < 120;
    const gap = prev && prev.page === l.page ? prev.y - l.y : 999;
    if (heading) { flush(); flushList(); blocks.push({ id: id(), type: 'heading', level: l.size >= med * 1.7 ? 1 : 2, text: l.str }); }
    else if (bullet) { flush(); (list = list || []).push(l.str.replace(/^([•·▪◦*–-]|\d{1,2}[.)])\s+/, '')); }
    else if (list && gap < med * 1.6 && l.x > 1) { list[list.length - 1] += ' ' + l.str; }
    else {
      flushList();
      if (cur && gap < med * 1.7 && prev && Math.abs(prev.size - l.size) < 0.2 * med) cur.txt = cur.txt.replace(/([a-z])-$/, '$1') + (/[a-z]-$/.test(cur.txt) ? '' : ' ') + l.str;
      else { flush(); cur = { txt: l.str }; }
    }
    prev = l;
  }
  flush(); flushList();
  const first = blocks.find(b => b.type === 'heading');
  return { title: (first && first.text) || (fileName || 'document').replace(/\.pdf$/i, ''), blocks };
}
let editor = null;
const cssFam = a => a.fam === 'mono' ? '"Courier New",Courier,monospace' : a.fam === 'serif' ? '"Times New Roman",Times,serif' : 'Helvetica,Arial,sans-serif';
function closeEditor(commit) {
  if (!editor) return; const e = editor; editor = null; const val = e.input.value;
  e.input.onblur = null; e.input.remove();
  if (!commit) return;
  if (e.add) { if (!val.trim()) return; addAnn(e.uid, e.add.kind === 'note' ? { t: 'note', x: e.add.x, y: e.add.y, txt: val.trim() } : { t: 'text', x: e.add.x, y: e.add.y, s: e.add.s, txt: val }); return; }
  if (e.ann) { if (val !== e.ann.txt) { snap(); e.ann.txt = val; fitWeight(e.ann); drawOverlay(e.uid); } }
  else if (val !== e.run.str) { const na = { t: 'edit', x: e.run.x, by: e.run.y, w: e.run.w, size: e.run.size, orig: e.run.str, txt: val, bg: e.cols.bg, fg: e.cols.fg, fam: e.run.fam, bold: e.run.bold, italic: e.run.italic }; fitWeight(na, e.cols); addAnn(e.uid, na); }
}
function addInline(pt, kind) {
  closeEditor(true);
  const uid = pt.uid, vp = vps[uid], host = document.querySelector('.ppage[data-uid="' + uid + '"]'), hr = host.getBoundingClientRect(), k = hr.width / vp.width;
  const s = kind === 'note' ? 11 : (+$('#annSize').value || 12), col = kind === 'note' ? '#6b5300' : $('#annColor').value, [vx, vy] = vp.convertToViewportPoint(pt.x, pt.y);
  const input = document.createElement('input'); input.className = 'pedit'; input.type = 'text'; input.spellcheck = false; input.placeholder = kind === 'note' ? 'Type a note' : 'Type here';
  const fs = s * vp.scale * k;
  Object.assign(input.style, { left: vx * k - 2 + 'px', top: vy * k - fs * 1.05 + 'px', height: fs * 1.4 + 'px', width: '180px', fontSize: fs + 'px', fontFamily: 'Helvetica,Arial,sans-serif', color: col, background: kind === 'note' ? '#fff3b0' : 'rgba(255,255,255,.85)' });
  host.appendChild(input);
  const meas = document.createElement('canvas').getContext('2d'); const fit = () => { meas.font = fs + 'px Helvetica,Arial,sans-serif'; input.style.width = Math.max(120, meas.measureText(input.value).width + 24) + 'px'; };
  input.oninput = fit;
  input.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); closeEditor(true); } else if (ev.key === 'Escape') { ev.preventDefault(); closeEditor(false); } ev.stopPropagation(); };
  input.onblur = () => closeEditor(true);
  editor = { input, uid, add: { kind, x: pt.x, y: pt.y, s } }; setTimeout(() => input.focus(), 30);
}
async function startEdit(pt) {
  closeEditor(true);
  const uid = pt.uid, vp = vps[uid];
  let ann = (annots[uid] || []).find(a => a.t === 'edit' && inBox(editBox(a), pt)), run = null, cols = null;
  if (!ann) {
    const runs = await runsFor(uid);
    if (!runs.length) { say('This page has no editable text. If it is a scan, use Convert → Make text searchable first.'); return; }
    run = runs.find(r => inBox(bbox(r), pt) && !covered(uid, r));
    if (!run) { $('#editHint').textContent = 'No text there. Click directly on a line of text.'; return; }
    cols = sampleColors(uid, run);
  }
  const src = ann ? { x: ann.x, y: ann.by, w: ann.w, size: ann.size, fam: ann.fam, bold: ann.bold, italic: ann.italic } : run;
  const bb = bbox(src), [x1, y1, x2, y2] = vp.convertToViewportRectangle([bb.x, bb.y, bb.x + bb.w, bb.y + bb.h]);
  const host = document.querySelector('.ppage[data-uid="' + uid + '"]'), hr = host.getBoundingClientRect(), k = hr.width / vp.width;
  const input = document.createElement('input'); input.className = 'pedit'; input.type = 'text'; input.spellcheck = false;
  input.value = ann ? ann.txt : run.str;
  const c = ann || { ...cols, ...run }, fs = src.size * vp.scale * k;
  Object.assign(input.style, { left: Math.min(x1, x2) * k - 1 + 'px', top: Math.min(y1, y2) * k + 'px', height: Math.abs(y2 - y1) * k + 'px', width: Math.abs(x2 - x1) * k + 14 + 'px',
    fontSize: fs + 'px', fontFamily: cssFam(src), fontWeight: src.bold ? '700' : '400', fontStyle: src.italic ? 'italic' : 'normal', color: c.fg, background: c.bg });
  host.appendChild(input);
  const meas = document.createElement('canvas').getContext('2d');
  const fit = () => { meas.font = (src.italic ? 'italic ' : '') + (src.bold ? 'bold ' : '') + fs + 'px ' + cssFam(src); input.style.width = Math.max(Math.abs(x2 - x1) * k + 14, meas.measureText(input.value).width + 14) + 'px'; };
  input.oninput = fit; fit();
  input.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); closeEditor(true); } else if (ev.key === 'Escape') { ev.preventDefault(); closeEditor(false); } ev.stopPropagation(); };
  input.onblur = () => closeEditor(true);
  editor = { input, uid, ann, run, cols }; input.focus(); input.select();
}
$('#pdfPages').addEventListener('pointermove', async e => {
  if (tool !== 'edit' || draft || e.target.closest('.pedit')) return;
  const pt = pdfPoint(e), svg = e.target.closest('svg.ov'); if (!pt || !svg) return;
  let h = svg.querySelector('.hov'); const vp = vps[pt.uid];
  const a = (annots[pt.uid] || []).find(a => a.t === 'edit' && inBox(editBox(a), pt));
  let box = a ? editBox(a) : null;
  if (!box) { const r = (await runsFor(pt.uid)).find(r => inBox(bbox(r), pt) && !covered(pt.uid, r)); box = r && bbox(r); }
  if (!box) { if (h) h.remove(); return; }
  const [x1, y1, x2, y2] = vp.convertToViewportRectangle([box.x, box.y, box.x + box.w, box.y + box.h]);
  if (!h) { h = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); h.setAttribute('class', 'hov'); svg.appendChild(h); }
  h.setAttribute('x', Math.min(x1, x2)); h.setAttribute('y', Math.min(y1, y2)); h.setAttribute('width', Math.abs(x2 - x1)); h.setAttribute('height', Math.abs(y2 - y1));
  h.setAttribute('fill', '#14808a'); h.setAttribute('fill-opacity', '.08'); h.setAttribute('stroke', '#14808a'); h.setAttribute('stroke-dasharray', '3 2');
});
function pdfPoint(e) {
  const svg = e.target.closest('svg.ov'); if (!svg) return null;
  const uid = svg.dataset.uid, vp = vps[uid], r = svg.getBoundingClientRect();
  const [x, y] = vp.convertToPdfPoint((e.clientX - r.left) * vp.width / r.width, (e.clientY - r.top) * vp.height / r.height);
  return { uid, x, y };
}
const addAnn = (uid, a) => { if (['ink', 'rect', 'ell', 'line'].includes(a.t)) { a.c = a.c || $('#annColor').value; a.wd = a.wd || +$('#annWidth').value; } if (a.t === 'ul' || a.t === 'st') a.c = a.c || $('#annColor').value; if (a.t === 'hl') a.c = $('#hlColor').value; if (a.t === 'text') a.c = $('#annColor').value; snap(); a.id = 'a' + (++aidN); (annots[uid] = annots[uid] || []).push(a); drawOverlay(uid); };
let draft = null, insPng = null, insSize = null;
$('#pdfPages').addEventListener('pointerdown', e => {
  if (tool === 'none' || e.target.closest('.pf') || e.target.closest('.pedit')) return; const pt = pdfPoint(e); if (!pt) return; e.preventDefault();
  if (tool === 'edit') { startEdit(pt); return; }
  if (['hl', 'ul', 'st', 'rect', 'ell', 'line', 'arrow', 'link', 'redact', 'field'].includes(tool)) draft = { t: tool, uid: pt.uid, x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
  else if (tool === 'image') {
    if (!insPng) { say('Choose an image first.'); return; }
    const w = Math.min(220, insSize.w), h = w * insSize.h / insSize.w;
    addAnn(pt.uid, { t: 'img', x: pt.x - w / 2, y: pt.y - h / 2, w, h, png: insPng });
  } else if (tool === 'note') addInline(pt, 'note');
  else if (tool === 'stamp') {
    const [label, c] = $('#stampSel').value.split('|'), fs = 22, cx = document.createElement('canvas').getContext('2d'); cx.font = 'bold ' + fs + 'px Helvetica,Arial,sans-serif';
    const w = cx.measureText(label).width + 26, h = fs + 18; addAnn(pt.uid, { t: 'stamp', x: pt.x - w / 2, y: pt.y - h / 2, w, h, label, c, fs });
  } else if (tool === 'ink') draft = { t: 'ink', uid: pt.uid, pts: [[pt.x, pt.y]] };
  else if (tool === 'text') addInline(pt, 'text');
  else if (tool === 'sign') {
    if (!sigPng) { say('Create your signature in the Sign tab first.'); return; }
    const w = 170, h = w * sigSize.h / sigSize.w;
    addAnn(pt.uid, { t: 'img', x: pt.x - w / 2, y: pt.y - h / 2, w, h, png: sigPng });
  }
  if (draft) e.target.closest('svg').setPointerCapture(e.pointerId);
});
$('#pdfPages').addEventListener('pointermove', e => {
  if (!draft) return; const pt = pdfPoint(e); if (!pt || pt.uid !== draft.uid) return;
  if (draft.t === 'ink') draft.pts.push([pt.x, pt.y]); else { draft.x1 = pt.x; draft.y1 = pt.y; }
  drawOverlay(draft.uid);
});
// Highlight, underline and strike snap to the text lines the drag crosses, so a plain left-to-right drag works.
async function snapToText(uid, box) {
  const lines = (await runsFor(uid)).filter(r => r.str && r.str.trim()).map(bbox)
    .filter(b => b.x < box.x + box.w && b.x + b.w > box.x && b.y <= box.y + box.h + 2 && b.y + b.h >= box.y - 2);
  if (!lines.length) return box.h >= 6 ? box : { x: box.x, y: box.y + box.h / 2 - 6, w: box.w, h: 12 };
  const x0 = Math.max(box.x, Math.min(...lines.map(b => b.x))), x1 = Math.min(box.x + box.w, Math.max(...lines.map(b => b.x + b.w)));
  const y0 = Math.min(...lines.map(b => b.y)), y1 = Math.max(...lines.map(b => b.y + b.h));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: y1 - y0 };
}
$('#pdfPages').addEventListener('pointerup', async () => {
  if (!draft) return; const d = draft; draft = null;
  let box = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
  if (['hl', 'ul', 'st'].includes(d.t) && box.w > 3) box = await snapToText(d.uid, box);
  if (['hl', 'ul', 'st', 'rect', 'redact'].includes(d.t) && box.w > 3 && (box.h > 3 || ['hl', 'ul', 'st'].includes(d.t))) addAnn(d.uid, { t: d.t, ...box });
  else if (d.t === 'field' && box.w > 6 && box.h > 6) {
    const ft = $('#nfType').value, used = new Set([...fields.map(f => f.name), ...Object.values(annots).flat().filter(a => a.t === 'newfield').map(a => a.name)]);
    let name = ($('#nfName').value.trim() || 'field').replace(/[^\w\-]+/g, '_'), n = name, k = 2; while (used.has(n)) n = name + '_' + k++;
    const options = ft === 'dropdown' ? $('#nfOptions').value.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (ft === 'dropdown' && !options.length) { say('Add the dropdown options first, separated by commas.'); drawOverlay(d.uid); return; }
    addAnn(d.uid, { t: 'newfield', ...box, ft, name: n, options }); $('#nfName').value = '';
  }
  else if ((d.t === 'line' || d.t === 'arrow') && Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > 4) addAnn(d.uid, { t: 'line', x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, arrow: d.t === 'arrow' });
  else if (d.t === 'ell' && box.w > 3 && box.h > 3) addAnn(d.uid, { t: 'ell', ...box });
  else if (d.t === 'link' && box.w > 6 && box.h > 6) {
    let url = $('#linkUrl').value.trim(); if (!url) { say('Type the link address first (for example https://example.com), then drag a box.'); drawOverlay(d.uid); return; }
    if (!/^(https?:|mailto:)/i.test(url)) url = 'https://' + url; addAnn(d.uid, { t: 'link', ...box, url });
  }
  else if (d.t === 'ink' && d.pts.length > 1) addAnn(d.uid, { t: 'ink', pts: d.pts });
  else drawOverlay(d.uid);
});
document.querySelectorAll('button[data-tool]').forEach(b => b.onclick = () => setTool(tool === b.dataset.tool ? 'none' : b.dataset.tool));
document.querySelectorAll('.undoBtn').forEach(b => b.onclick = () => { const s = undo.pop(); if (!s) return; const o = JSON.parse(s); pages = o.pages; annots = o.annots; renderAll(); });
$('#nfType').onchange = () => { $('#nfOptWrap').hidden = $('#nfType').value !== 'dropdown'; };

/* ---------- pages: organize, merge, split ---------- */
$('#pdfThumbs').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const uid = b.closest('.thumb').dataset.uid, i = pages.findIndex(p => p.uid === uid), act = b.dataset.act;
  if (act === 'sel') { pages[i].sel = b.checked; b.closest('.thumb').classList.toggle('sel', b.checked); return; }
  snap();
  if (act === 'up' && i > 0) [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]];
  else if (act === 'down' && i < pages.length - 1) [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]];
  else if (act === 'rot') pages[i].rot = (pages[i].rot + 90) % 360;
  else if (act === 'del') { if (pages.length === 1) { undo.pop(); say('A PDF needs at least one page.'); return; } pages.splice(i, 1); }
  renderAll();
});
$('#addPdf').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { let b = new Uint8Array(await f.arrayBuffer()); b = await unlockIfNeeded(b, f.name); if (!b) return; snap(); const n = await addSource(b, f.name); renderAll(); say('Added ' + n + ' pages from ' + f.name + ' at the end.'); }
  catch (err) { say('Could not add that file: ' + err.message); }
};
$('#selAll').onclick = () => { const all = pages.every(p => p.sel); pages.forEach(p => p.sel = !all); renderAll(); };
$('#extractBtn').onclick = async () => {
  const sel = pages.filter(p => p.sel); if (!sel.length) { say('Tick the pages you want to extract in the page list first.'); return; }
  await saveBytes(await build(sel), base() + '-pages.pdf');
};
$('#splitBtn').onclick = async () => {
  if (pages.length < 2) { say('There is only one page.'); return; }
  const half = Math.ceil(pages.length / 2);
  await saveBytes(await build(pages.slice(0, half)), base() + '-part1.pdf');
  await saveBytes(await build(pages.slice(half)), base() + '-part2.pdf');
};

/* ---------- forms panel ---------- */
function renderFields() {
  if (!fields.length) { $('#formList').innerHTML = '<p class="note">This PDF has no fillable fields. Use Create fields to add some.</p>'; return; }
  $('#formList').innerHTML = fields.map((f, i) => {
    const id = 'ff' + i, v = values[f.name];
    if (f.type === 'check') return '<label class="ck"><input type="checkbox" id="' + id + '" data-f="' + esc(f.name) + '"' + (v ? ' checked' : '') + '> ' + esc(f.name) + '</label>';
    if (f.options.length) return '<label class="f" for="' + id + '">' + esc(f.name) + '</label><select class="t" id="' + id + '" data-f="' + esc(f.name) + '"><option value=""></option>' + f.options.map(o => '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
    return '<label class="f" for="' + id + '">' + esc(f.name) + '</label><input class="t" id="' + id + '" data-f="' + esc(f.name) + '" value="' + esc(v || '') + '">';
  }).join('');
}

/* ---------- stamps ---------- */
function syncStampUI() {
  $('#wmText').value = stamps.wm; $('#wmOpacity').value = stamps.wmOpacity; $('#pnOn').checked = stamps.pn; $('#pnFmt').value = stamps.pnFmt; $('#pnPos').value = stamps.pnPos;
  $('#batesOn').checked = stamps.bates; $('#batesPrefix').value = stamps.batesPrefix; $('#batesStart').value = stamps.batesStart; $('#batesDigits').value = stamps.batesDigits;
}
['wmText', 'wmOpacity', 'pnOn', 'pnFmt', 'pnPos', 'batesOn', 'batesPrefix', 'batesStart', 'batesDigits'].forEach(id => ['input', 'change'].forEach(ev => $('#' + id).addEventListener(ev, () => {
  stamps.wm = $('#wmText').value; stamps.wmOpacity = +$('#wmOpacity').value; stamps.pn = $('#pnOn').checked; stamps.pnFmt = $('#pnFmt').value || 'Page {n} of {total}'; stamps.pnPos = $('#pnPos').value;
  stamps.bates = $('#batesOn').checked; stamps.batesPrefix = $('#batesPrefix').value; stamps.batesStart = Math.max(0, parseInt($('#batesStart').value, 10) || 1); stamps.batesDigits = Math.min(12, Math.max(1, parseInt($('#batesDigits').value, 10) || 6));
  redrawOverlays();
})));

/* ---------- signature ---------- */
const pad = $('#sigPad'), pctx = pad.getContext('2d'); let drawing = false, drew = false;
function padReset() { pctx.clearRect(0, 0, pad.width, pad.height); pctx.lineWidth = 3; pctx.lineCap = 'round'; pctx.strokeStyle = '#10243f'; drew = false; }
padReset();
const padPt = e => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
pad.addEventListener('pointerdown', e => { drawing = true; drew = true; pad.setPointerCapture(e.pointerId); const [x, y] = padPt(e); pctx.beginPath(); pctx.moveTo(x, y); });
pad.addEventListener('pointermove', e => { if (!drawing) return; const [x, y] = padPt(e); pctx.lineTo(x, y); pctx.stroke(); });
pad.addEventListener('pointerup', () => { drawing = false; });
$('#sigClear').onclick = padReset;
function trimmed(canvas) {
  const ctx = canvas.getContext('2d'), d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let x0 = canvas.width, y0 = canvas.height, x1 = 0, y1 = 0;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (d[(y * canvas.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  if (x1 <= x0) return null;
  const o = document.createElement('canvas'); o.width = x1 - x0 + 12; o.height = y1 - y0 + 12;
  o.getContext('2d').drawImage(canvas, x0 - 6, y0 - 6, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}
$('#sigUseDraw').onclick = () => { if (!drew) { say('Draw your signature in the box first.'); return; } useSig(trimmed(pad)); };
$('#sigUseType').onclick = async () => {
  const name = $('#sigName').value.trim(); if (!name) { $('#sigName').focus(); say('Type your name first.'); return; }
  try { await document.fonts.load('64px "Caveat"'); } catch (e) {}
  const c = document.createElement('canvas'); c.width = 900; c.height = 200; const x = c.getContext('2d');
  x.font = '96px "Caveat", "Segoe Script", cursive'; x.fillStyle = '#10243f'; x.textBaseline = 'middle'; x.fillText(name, 20, 100);
  useSig(trimmed(c));
};
function useSig(c) {
  if (!c) { say('That signature looks empty.'); return; }
  sigPng = c.toDataURL('image/png'); sigSize = { w: c.width, h: c.height };
  $('#sigPreview').innerHTML = '<img alt="Your signature" src="' + sigPng + '">';
  setTool('sign'); say('Signature ready. Click on the page where it should go. You can place it more than once.');
}

/* ---------- OCR ---------- */
let ocrWorker = null;
$('#ocrBtn').onclick = async () => {
  if (!window.Tesseract) { say('The text recognition engine did not load in this view.'); return; }
  const list = pages.filter(p => p.sel).length ? pages.filter(p => p.sel) : pages;
  try {
    busy('Starting text recognition…');
    if (!ocrWorker) ocrWorker = await Tesseract.createWorker('eng', 1, { workerPath: new URL('tesseract-worker.min.js', location.href).href, corePath: new URL('./', location.href).href, langPath: new URL('./', location.href).href, gzip: true, workerBlobURL: false });
    let found = 0;
    for (let k = 0; k < list.length; k++) {
      const p = list[k]; busy('Reading page ' + (k + 1) + ' of ' + list.length + '…');
      const page = await pdfPage(p), vp = page.getViewport({ scale: 2.5, rotation: page.rotate });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const { data } = await ocrWorker.recognize(c, {}, { blocks: true });
      const lines = (data.blocks || []).flatMap(b => b.paragraphs || []).flatMap(pa => pa.lines || []);
      annots[p.uid] = (annots[p.uid] || []).filter(a => a.t !== 'ocr');
      for (const ln of lines) {
        const txt = (ln.text || '').trim(); if (!txt || ln.confidence < 40) continue;
        const [x0, y0] = vp.convertToPdfPoint(ln.bbox.x0, ln.bbox.y1), [x1, y1] = vp.convertToPdfPoint(ln.bbox.x1, ln.bbox.y0);
        (annots[p.uid] = annots[p.uid] || []).push({ id: 'a' + (++aidN), t: 'ocr', x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0), txt });
        found++;
      }
    }
    busy(''); $('#ocrResult').textContent = 'Found ' + found + ' lines of text on ' + list.length + (list.length === 1 ? ' page' : ' pages') + '. They are added as an invisible, searchable text layer when you save.';
  } catch (err) { busy(''); say('Text recognition could not run here: ' + (err && err.message || err)); }
};

/* ---------- build and save ---------- */
const base = () => fileName.replace(/\.pdf$/i, '').replace(/[^\w\- ]+/g, '').trim() || 'document';
const redsOf = uid => { const perm = $('#pEditPerm') && $('#pEditPerm').checked; return (annots[uid] || []).filter(a => a.t === 'redact' || (perm && a.t === 'edit')).map(a => a.t === 'edit' ? editBox(a) : a); };
async function rasterize(srcDoc, idx, reds) {
  const page = await srcDoc.getPage(idx + 1), vp = page.getViewport({ scale: 200 / 72, rotation: 0 });
  const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height); const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  ctx.fillStyle = '#000';
  for (const r of reds) { const [a, b, cc, d] = vp.convertToViewportRectangle([r.x, r.y, r.x + r.w, r.y + r.h]); ctx.fillRect(Math.min(a, cc) - 1, Math.min(b, d) - 1, Math.abs(cc - a) + 2, Math.abs(d - b) + 2); }
  const view = page.view;
  return { png: await new Promise(res => c.toBlob(b => b.arrayBuffer().then(res), 'image/png')), w: view[2] - view[0], h: view[3] - view[1], ox: view[0], oy: view[1] };
}
async function build(list) {
  const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;
  const loaded = await Promise.all(srcs.map(s => PDFDocument.load(s.bytes, { ignoreEncryption: true })));
  const anyRedact = list.some(p => redsOf(p.uid).length);
  const identity = !anyRedact && list.length === srcs[0].doc.numPages && list.every((p, i) => p.src === 0 && p.idx === i);
  if (fields.length) {
    const form = loaded[0].getForm();
    for (const f of fields) {
      const v = values[f.name];
      try {
        if (f.type === 'text') form.getTextField(f.name).setText(v ? String(v) : '');
        else if (f.type === 'check') v ? form.getCheckBox(f.name).check() : form.getCheckBox(f.name).uncheck();
        else if (f.type === 'drop' && v) form.getDropdown(f.name).select(v);
        else if (f.type === 'list' && v) form.getOptionList(f.name).select(v);
        else if (f.type === 'radio' && v) form.getRadioGroup(f.name).select(v);
      } catch (e) {}
    }
    if (!identity || $('#flatten').checked) form.flatten();
  }
  // redacted pages are rebuilt as images from the filled, flattened source, so nothing under the boxes survives
  let flatDoc0 = null;
  if (anyRedact) flatDoc0 = await pdfjsLib.getDocument({ data: await loaded[0].save() }).promise;
  let out, outPages;
  if (identity) { out = loaded[0]; outPages = out.getPages(); }
  else {
    out = await PDFDocument.create(); outPages = [];
    for (const p of list) {
      const reds = redsOf(p.uid);
      if (reds.length) {
        const srcDoc = p.src === 0 ? flatDoc0 : srcs[p.src].doc, r = await rasterize(srcDoc, p.idx, reds);
        const srcPage = loaded[p.src].getPage(p.idx), pg = out.addPage([r.w, r.h]);
        pg.setMediaBox(r.ox, r.oy, r.w, r.h);
        pg.drawImage(await out.embedPng(r.png), { x: r.ox, y: r.oy, width: r.w, height: r.h });
        pg.setRotation(srcPage.getRotation());
        outPages.push(pg);
      } else { const [cp] = await out.copyPages(loaded[p.src], [p.idx]); outPages.push(out.addPage(cp)); }
    }
  }
  const font = await out.embedFont(StandardFonts.Helvetica), fontB = await out.embedFont(StandardFonts.HelveticaBold), imgs = {};
  const newFields = [], efonts = {};
  const efont = async a => { const k = (a.fam || 'sans') + (a.bold ? 'B' : '') + (a.italic ? 'I' : ''); if (!efonts[k]) { const F = StandardFonts, m = { sans: [F.Helvetica, F.HelveticaBold, F.HelveticaOblique, F.HelveticaBoldOblique], serif: [F.TimesRoman, F.TimesRomanBold, F.TimesRomanItalic, F.TimesRomanBoldItalic], mono: [F.Courier, F.CourierBold, F.CourierOblique, F.CourierBoldOblique] }[a.fam || 'sans']; efonts[k] = await out.embedFont(m[(a.bold ? 1 : 0) + (a.italic ? 2 : 0)]); } return efonts[k]; };
  const hexRgb = h => { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
  const safeText = (f, t) => [...t.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u00a0/g, ' ')].map(ch => { try { f.encodeText(ch); return ch; } catch (e) { return '?'; } }).join('');
  for (let i = 0; i < list.length; i++) {
    const p = list[i], pg = outPages[i];
    if (p.rot) pg.setRotation(degrees((pg.getRotation().angle + p.rot) % 360));
    if (p.crop) { const mb = pg.getMediaBox(), c = p.crop; pg.setCropBox(mb.x + c.l, mb.y + c.b, mb.width - c.l - c.r, mb.height - c.t - c.b); }
    for (const a of annots[p.uid] || []) {
      if (a.t === 'hl') pg.drawRectangle({ x: a.x, y: a.y, width: a.w, height: a.h, color: hexRgb(a.c || '#ffd633'), opacity: 0.4 });
      else if (a.t === 'ul' || a.t === 'st') { const yy = a.t === 'ul' ? a.y : a.y + a.h / 2; pg.drawLine({ start: { x: a.x, y: yy }, end: { x: a.x + a.w, y: yy }, thickness: 1.2, color: hexRgb(a.c || '#d11111') }); }
      else if (a.t === 'ell') pg.drawEllipse({ x: a.x + a.w / 2, y: a.y + a.h / 2, xScale: a.w / 2, yScale: a.h / 2, borderColor: hexRgb(a.c || '#0b5d63'), borderWidth: a.wd || 1.6 });
      else if (a.t === 'line') {
        const col = hexRgb(a.c || '#0b5d63'), wd = a.wd || 1.6; pg.drawLine({ start: { x: a.x0, y: a.y0 }, end: { x: a.x1, y: a.y1 }, thickness: wd, color: col });
        if (a.arrow) { const L = 9 + wd * 2, ang = Math.atan2(a.y1 - a.y0, a.x1 - a.x0), sp = 0.45; for (const sg of [-1, 1]) pg.drawLine({ start: { x: a.x1, y: a.y1 }, end: { x: a.x1 - L * Math.cos(ang + sg * sp), y: a.y1 - L * Math.sin(ang + sg * sp) }, thickness: wd, color: col }); }
      }
      else if (a.t === 'stamp') { const col = hexRgb(a.c), fb = await out.embedFont(StandardFonts.HelveticaBold); pg.drawRectangle({ x: a.x, y: a.y, width: a.w, height: a.h, borderColor: col, borderWidth: 2.5 }); const tw = fb.widthOfTextAtSize(a.label, a.fs); pg.drawText(a.label, { x: a.x + (a.w - tw) / 2, y: a.y + (a.h - a.fs * 0.72) / 2, size: a.fs, font: fb, color: col }); }
      else if (a.t === 'link' || a.t === 'note') {
        try {
          const ctx = out.context, N = PDFLib.PDFName, S = PDFLib.PDFString;
          const d = a.t === 'link' ? { Type: 'Annot', Subtype: 'Link', Rect: [a.x, a.y, a.x + a.w, a.y + a.h], Border: [0, 0, 0], A: ctx.obj({ Type: 'Action', S: 'URI', URI: S.of(a.url) }) }
            : { Type: 'Annot', Subtype: 'Text', Rect: [a.x, a.y - 18, a.x + 18, a.y], Contents: PDFLib.PDFHexString.fromText(a.txt), Name: 'Comment', C: [1, 0.84, 0.2], F: 4 };
          pg.node.addAnnot(ctx.register(ctx.obj(d)));
        } catch (e) { console.warn('annotation', e); }
      }
      else if (a.t === 'rect') pg.drawRectangle({ x: a.x, y: a.y, width: a.w, height: a.h, borderColor: hexRgb(a.c || '#0b5d63'), borderWidth: a.wd || 1.4 });
      else if (a.t === 'edit') {
        const eb = editBox(a), f = await efont(a); pg.drawRectangle({ x: eb.x, y: eb.y, width: eb.w, height: eb.h, color: hexRgb(a.bg), borderWidth: 0 });
        const t = safeText(f, a.txt); if (t) { const fc = hexRgb(a.fg); if (a.wt) pg.pushOperators(PDFLib.pushGraphicsState(), PDFLib.setTextRenderingMode(PDFLib.TextRenderingMode.FillAndOutline), PDFLib.setLineWidth(a.wt), PDFLib.setStrokingColor(fc)); pg.drawText(t, { x: a.x, y: a.by, size: a.size, font: f, color: fc }); if (a.wt) pg.pushOperators(PDFLib.popGraphicsState()); }
      }
      else if (a.t === 'ink') for (let k = 1; k < a.pts.length; k++) pg.drawLine({ start: { x: a.pts[k - 1][0], y: a.pts[k - 1][1] }, end: { x: a.pts[k][0], y: a.pts[k][1] }, thickness: a.wd || 1.6, color: hexRgb(a.c || '#0b5d63') });
      else if (a.t === 'text') pg.drawText(a.txt, { x: a.x, y: a.y, size: a.s, font, color: hexRgb(a.c || '#111111') });
      else if (a.t === 'img') { imgs[a.png] = imgs[a.png] || await out.embedPng(a.png); pg.drawImage(imgs[a.png], { x: a.x, y: a.y, width: a.w, height: a.h }); }
      else if (a.t === 'ocr') { let size = Math.max(4, a.h * 0.8); const w = font.widthOfTextAtSize(a.txt, size); if (w > 0) size = Math.max(2, size * Math.min(1.3, a.w / w)); try { pg.drawText(a.txt, { x: a.x, y: a.y + a.h * 0.15, size, font, opacity: 0 }); } catch (e) {} }
      else if (a.t === 'newfield') newFields.push({ pg, a });
    }
    const { x: bx, y: by, width: bw, height: bh } = pg.getMediaBox();
    if (stamps.wm) {
      const size = 60, tw = fontB.widthOfTextAtSize(stamps.wm, size), cx = bx + bw / 2, cy = by + bh / 2, r = Math.PI / 4;
      pg.drawText(stamps.wm, { x: cx - (tw / 2) * Math.cos(r) + (size / 3) * Math.sin(r), y: cy - (tw / 2) * Math.sin(r) - (size / 3) * Math.cos(r), size, font: fontB, color: rgb(0.47, 0.47, 0.47), opacity: stamps.wmOpacity, rotate: degrees(45) });
    }
    { const hf = { t: ['hfL', 'hfC', 'hfR'].map(id => $('#' + id).value), b: ['ffL', 'ffC', 'ffR'].map(id => $('#' + id).value) };
      const fill = t => t.replace(/\{n\}/g, i + 1).replace(/\{total\}/g, list.length).replace(/\{date\}/g, new Date().toLocaleDateString());
      for (const [row, yy] of [['t', by + bh - 30], ['b', by + 30]]) hf[row].forEach((t, k) => { if (!t.trim()) return; const tx = fill(t), tw = font.widthOfTextAtSize(tx, 9), x = k === 0 ? bx + 36 : k === 1 ? bx + (bw - tw) / 2 : bx + bw - 36 - tw; pg.drawText(safeText(font, tx), { x, y: yy, size: 9, font, color: rgb(0.2, 0.2, 0.2) }); }); }
    for (const s of stampTexts(i, list.length)) {
      const size = 9, tw = font.widthOfTextAtSize(s.s, size), y = by + 22 - size * 0.3;
      if (s.k === 'bates') pg.drawText(s.s, { x: bx + bw - 36 - tw, y, size, font, color: rgb(0.13, 0.13, 0.13) });
      else { const pos = stamps.pnPos, x = pos === 'bl' ? bx + 36 : pos === 'br' ? bx + bw - 36 - tw : bx + (bw - tw) / 2; pg.drawText(s.s, { x, y: stamps.bates && pos === 'br' ? y + 12 : y, size, font, color: rgb(0.13, 0.13, 0.13) }); }
    }
  }
  if (newFields.length) {
    const form = out.getForm();
    for (const { pg, a } of newFields) {
      try {
        const opts = { x: a.x, y: a.y, width: a.w, height: a.h, font };
        if (a.ft === 'text') form.createTextField(a.name).addToPage(pg, opts);
        else if (a.ft === 'checkbox') form.createCheckBox(a.name).addToPage(pg, { x: a.x, y: a.y, width: Math.min(a.w, a.h), height: Math.min(a.w, a.h) });
        else if (a.ft === 'dropdown') { const d = form.createDropdown(a.name); d.addOptions(a.options); d.addToPage(pg, opts); }
      } catch (e) { console.warn('field', a.name, e); }
    }
  }
  if (anyRedact) { out.setTitle(''); out.setAuthor(''); out.setSubject(''); out.setKeywords([]); out.setCreator(''); }
  if (!anyRedact || $('#infoTitle').value || $('#infoAuthor').value || $('#infoSubject').value) { if ($('#infoTitle').value) out.setTitle($('#infoTitle').value); if ($('#infoAuthor').value) out.setAuthor($('#infoAuthor').value); if ($('#infoSubject').value) out.setSubject($('#infoSubject').value); }
  out.setProducer('Leaf Viewer (open source)');
  let bytes = await out.save({ useObjectStreams: true });
  const pw = $('#pwSet').value, restrict = !$('#permPrint').checked || !$('#permCopy').checked || !$('#permEdit').checked;
  if ($('#compress').checked && !pw && !restrict) { const r = await qpdf(['--recompress-flate', '--compression-level=9', '--object-streams=generate', '/in.pdf', '/out.pdf'], bytes); if (r.out && r.out.length < bytes.length) bytes = r.out; }
  if (pw || restrict) {
    const flags = ['--print=' + ($('#permPrint').checked ? 'full' : 'none'), '--extract=' + ($('#permCopy').checked ? 'y' : 'n'), '--modify=' + ($('#permEdit').checked ? 'all' : 'none')];
    const r = await qpdf(['--encrypt', pw, 'o' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2), '256', ...flags, '--', '/in.pdf', '/out.pdf'], bytes);
    if (r.code !== 0 || !r.out) throw new Error('password protection failed');
    bytes = r.out;
  }
  return bytes;
}

/* ---------- convert + insert image ---------- */
$('#imgPick').onchange = async e => {
  const f = e.target.files[0]; if (!f) return; const url = URL.createObjectURL(f);
  const im = new Image(); im.src = url; try { await im.decode(); } catch (x) { say('That image could not be read.'); return; }
  const c = document.createElement('canvas'), m = Math.min(1, 1600 / Math.max(im.width, im.height)); c.width = Math.round(im.width * m); c.height = Math.round(im.height * m);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  insPng = c.toDataURL('image/png'); insSize = { w: c.width, h: c.height }; $('#imgName').textContent = f.name; setTool('image'); e.target.value = '';
};
$('#exportPng').onclick = async () => {
  try {
    busy('Rendering pages…'); const entries = [];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i], page = await pdfPage(p), vp = page.getViewport({ scale: 150 / 72, rotation: (page.rotate + p.rot) % 360 });
      const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const buf = await new Promise(r => c.toBlob(b => b.arrayBuffer().then(r), 'image/png'));
      entries.push({ name: base() + '-page-' + String(i + 1).padStart(2, '0') + '.png', data: new Uint8Array(buf) });
    }
    busy(''); if (entries.length === 1) await saveBytes(entries[0].data, entries[0].name); else await saveBytes(Leaf.zipWrite(entries), base() + '-images.zip');
  } catch (err) { busy(''); say('Could not export images: ' + err.message); }
};
$('#extractTxt').onclick = async () => {
  try {
    busy('Reading text…'); let out = '';
    for (let i = 0; i < pages.length; i++) {
      const tc = await (await pdfPage(pages[i])).getTextContent();
      out += (i ? '\n\n' : '') + tc.items.map(it => it.str + (it.hasEOL ? '\n' : '')).join('');
    }
    busy(''); if (!out.trim()) { say('No text found. If this is a scan, use “Make text searchable” first.'); return; }
    await saveBytes(new TextEncoder().encode(out), base() + '.txt');
  } catch (err) { busy(''); say('Could not extract text: ' + err.message); }
};
const TABTOOL = { pedit: 'edit', predact: 'redact', pfield: 'none' };

/* ---------- find & replace, pages, crop, convert ---------- */
$('#frGo').onclick = async () => {
  const f = $('#frFind').value, r = $('#frWith').value; if (!f) { say('Type the text to find.'); return; }
  const re = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); let n = 0; snap();
  for (const p of pages) {
    const runs = await runsFor(p.uid);
    for (const run of runs) {
      if (!re.test(run.str)) { re.lastIndex = 0; continue; } re.lastIndex = 0;
      if (covered(p.uid, run)) continue;
      const txt = run.str.replace(re, () => { n++; return r; }), cols = sampleColors(p.uid, run);
      const na = { id: 'a' + (++aidN), t: 'edit', x: run.x, by: run.y, w: run.w, size: run.size, orig: run.str, txt, bg: cols.bg, fg: cols.fg, fam: run.fam, bold: run.bold, italic: run.italic }; fitWeight(na, cols); (annots[p.uid] = annots[p.uid] || []).push(na);
    }
    drawOverlay(p.uid);
  }
  if (!n) undo.pop();
  $('#frResult').textContent = n ? 'Replaced ' + n + ' match' + (n === 1 ? '' : 'es') + '. Press Save PDF to keep them.' : 'No matches found.';
};
async function newPdfSource(make, name) {
  const { PDFDocument } = PDFLib, d = await PDFDocument.create(); await make(d); return d.save();
}
$('#blankPg').onclick = async () => {
  try {
    const first = srcs[0].doc, pg1 = await first.getPage(1), v = pg1.view, w = v[2] - v[0], h = v[3] - v[1];
    const bytes = await newPdfSource(async d => { d.addPage([w, h]); }, 'Blank page'); snap();
    let at = pages.map(p => p.sel).lastIndexOf(true); at = at < 0 ? pages.length - 1 : at;
    const before = pages.length; await addSource(bytes, 'Blank page'); const added = pages.splice(before, 1)[0]; pages.splice(at + 1, 0, added); renderAll();
  } catch (err) { say('Could not add a blank page: ' + err.message); }
};
$('#imgToPdf').onchange = async e => {
  const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
  try {
    snap();
    for (const f of files) {
      const url = URL.createObjectURL(f), im = new Image(); im.src = url; await im.decode();
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); URL.revokeObjectURL(url);
      const png = await new Promise(r => c.toBlob(b => b.arrayBuffer().then(r), 'image/png')), sc = Math.min(1, 612 / im.width, 792 / im.height);
      const bytes = await newPdfSource(async d => { const img = await d.embedPng(png), pg = d.addPage([im.width * sc, im.height * sc]); pg.drawImage(img, { x: 0, y: 0, width: im.width * sc, height: im.height * sc }); }, f.name);
      await addSource(bytes, f.name);
    }
    renderAll(); say('Added ' + files.length + (files.length === 1 ? ' image' : ' images') + ' as pages at the end.');
  } catch (err) { say('Could not add the image: ' + err.message); }
};
$('#cropApply').onclick = () => {
  const m = { l: +$('#cropL').value || 0, r: +$('#cropR').value || 0, t: +$('#cropT').value || 0, b: +$('#cropB').value || 0 }, sel = pages.filter(p => p.sel), tgt = sel.length ? sel : pages; snap();
  tgt.forEach(p => { p.crop = (m.l || m.r || m.t || m.b) ? { ...m } : undefined; }); renderAll();
  $('#cropNote').textContent = (m.l || m.r || m.t || m.b) ? 'Cropping ' + tgt.length + (tgt.length === 1 ? ' page' : ' pages') + ' (shaded area is removed when you save).' : 'Cropping cleared.';
};
async function saveBytes(bytes, name) { await window.LeafApp.offer(name, bytes); }
$('#savePdfBtn').onclick = async () => {
  try { busy('Building your PDF…'); const bytes = await build(pages); busy(''); await saveBytes(bytes, base() + '-edited.pdf'); }
  catch (err) { busy(''); say('Could not build the PDF: ' + err.message); }
};

window.PDFWS = { name: () => fileName, toBlocks, onTab: t => { closeEditor(true); if (t in TABTOOL) setTool(TABTOOL[t]); else if (tool === 'edit' || tool === 'redact') setTool('none'); }, open, build: () => build(pages), state: () => ({ pages, annots, values, fields, stamps }) };
}
