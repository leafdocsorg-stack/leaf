/* Leaf core v0.1 (Living Editable Authenticated Format): read, write, lay out, hash and sign Leaf files.
   Plain script: runs in the browser and in Node 18+. Exposes globalThis.Leaf. */
(function () {
  'use strict';
  const enc = new TextEncoder(), dec = new TextDecoder();

  /* ---------- hashing and canonical JSON ---------- */
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined)
        .map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
  }
  async function sha256(data) {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function contentHash(doc, styles) { return sha256(canon({ doc, styles })); }

  /* ---------- ZIP (store on write; store or deflate on read) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipWrite(entries) {
    const parts = [], central = []; let off = 0;
    for (const e of entries) {
      const name = enc.encode(e.name), data = e.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(8, 0, true); h.setUint16(12, 0x5D78, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true);
      h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(14, 0x5D78, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0)); let p = 0;
    for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const LIMITS = { files: 500, bytes: 50 * 1024 * 1024 };
  async function zipRead(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Not a ZIP-based Leaf file.');
    const count = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    if (count > LIMITS.files) throw new Error('Too many parts.');
    const files = {}; let total = 0;
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged file index.');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      if (name.startsWith('/') || name.split('/').includes('..')) throw new Error('Unsafe path: ' + name);
      total += usize; if (total > LIMITS.bytes) throw new Error('File too large to open safely.');
      const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      const raw = u8.subarray(ds, ds + csize);
      files[name] = method === 0 ? raw.slice() : method === 8 ? await inflateRaw(raw) : null;
      if (!files[name]) throw new Error('Unsupported compression in ' + name);
    }
    return files;
  }

  /* ---------- layout ---------- */
  // metrics(text, bold, size) -> width in points. Supplied by the caller (jsPDF font metrics in both places).
  function runsToText(runs) { return runs.map(r => r.b ? '**' + r.t + '**' : r.t).join(''); }
  function textToRuns(s) {
    const out = []; s.split(/(\*\*[^*]+\*\*)/).forEach(seg => {
      if (!seg) return; const b = seg.startsWith('**') && seg.endsWith('**');
      out.push(b ? { t: seg.slice(2, -2), b: true } : { t: seg });
    }); return out.length ? out : [{ t: '' }];
  }
  function wrap(runs, width, size, metrics) {
    const words = []; // {t, b, space}
    for (const r of runs) {
      const bits = r.t.split(/(\s+)/);
      for (const bit of bits) {
        if (!bit) continue;
        if (/^\s+$/.test(bit)) { if (words.length) words[words.length - 1].space = true; continue; }
        words.push({ t: bit, b: !!r.b, space: false });
      }
    }
    const lines = []; let line = [], w = 0;
    for (const wd of words) {
      const ww = metrics(wd.t, wd.b, size), sp = metrics(' ', wd.b, size);
      const need = line.length ? w + (line[line.length - 1].space ? sp : 0) + ww : ww;
      if (line.length && need > width) { lines.push(line); line = []; w = 0; }
      const prev = line[line.length - 1];
      const x = line.length ? w + (prev.space ? metrics(' ', prev.b, size) : 0) : 0;
      line.push({ ...wd, x }); w = x + ww;
    }
    if (line.length) lines.push(line);
    return lines.length ? lines : [[]];
  }
  function layout(doc, styles, metrics) {
    const pg = styles.page, S = styles.styles;
    const [mt, mr, mb, ml] = pg.margin, CW = pg.width - ml - mr, bottom = pg.height - mb;
    const pages = []; let items, y;
    const newPage = () => { items = []; pages.push({ items }); y = mt; };
    newPage();
    const ensure = h => { if (y + h > bottom && y > mt) newPage(); };
    const textLines = (lines, x, size, lh, id, color) => {
      for (const ln of lines) {
        ensure(size * lh);
        y += size * lh;
        for (const wd of ln) items.push({ k: 't', x: +(x + wd.x).toFixed(2), y: +(y - size * (lh - 1) / 2 - size * 0.22).toFixed(2), s: size, b: wd.b ? 1 : 0, c: color, txt: wd.t, id });
      }
    };
    for (const bl of doc.blocks) {
      if (bl.type === 'heading') {
        const st = bl.level === 1 ? S.title : S.h2;
        y += st.before || 0;
        const lines = wrap([{ t: bl.text, b: true }], CW, st.size, metrics);
        ensure(st.size * st.lh * lines.length + 40);
        textLines(lines, ml, st.size, st.lh, bl.id, st.color);
        y += st.after;
      } else if (bl.type === 'paragraph') {
        const st = bl.style === 'small' ? S.small : S.body;
        textLines(wrap(bl.text, CW, st.size, metrics), ml, st.size, st.lh, bl.id, st.color);
        y += st.after;
      } else if (bl.type === 'list') {
        const st = S.body, ind = 16;
        for (const it of bl.items) {
          const lines = wrap(textToRuns(it), CW - ind, st.size, metrics);
          ensure(st.size * st.lh);
          items.push({ k: 'dot', x: ml + 5, y: +(y + st.size * st.lh / 2 + 0.5).toFixed(2), id: bl.id });
          textLines(lines, ml + ind, st.size, st.lh, bl.id);
          y += 3;
        }
        y += st.after - 3;
      } else if (bl.type === 'table') {
        const st = S.table, pad = st.pad, ws = bl.widths.map(f => f * CW);
        bl.rows.forEach((row, ri) => {
          const head = bl.header && ri === 0;
          const cells = row.map((c, ci) => wrap([{ t: c, b: head || ci === 0 }], ws[ci] - pad * 2, st.size, metrics));
          const h = Math.max(...cells.map(l => l.length)) * st.size * st.lh + pad * 2;
          ensure(h);
          if (head) items.push({ k: 'r', x: ml, y, w: CW, h, fill: st.head });
          items.push({ k: 'l', x1: ml, y1: y + h, x2: ml + CW, y2: y + h, id: bl.id });
          let x = ml;
          cells.forEach((lines, ci) => {
            let yy = y + pad;
            for (const ln of lines) { yy += st.size * st.lh; for (const wd of ln) items.push({ k: 't', x: +(x + pad + wd.x).toFixed(2), y: +(yy - st.size * 0.32).toFixed(2), s: st.size, b: wd.b ? 1 : 0, txt: wd.t, id: bl.id }); }
            x += ws[ci];
          });
          if (ri === 0) items.push({ k: 'l', x1: ml, y1: y, x2: ml + CW, y2: y, id: bl.id });
          y += h;
        });
        y += S.body.after + 4;
      } else if (bl.type === 'fields') {
        const st = S.field, gap = 16, n = bl.fields.length, w = (CW - gap * (n - 1)) / n;
        const h = st.label + 4 + st.h;
        ensure(h + 8);
        bl.fields.forEach((f, i) => {
          const x = ml + i * (w + gap);
          items.push({ k: 't', x, y: +(y + st.label - 1).toFixed(2), s: st.label, b: 1, c: '#555555', txt: f.label, id: bl.id });
          items.push({ k: 'f', x, y: y + st.label + 4, w: f.ft === 'checkbox' ? 14 : w, h: f.ft === 'checkbox' ? 14 : st.h, name: f.name, ft: f.ft, label: f.label });
          if (f.ft === 'checkbox' && f.text) items.push({ k: 't', x: x + 22, y: +(y + st.label + 15).toFixed(2), s: S.body.size, b: 0, txt: f.text, id: bl.id });
        });
        y += h + 12;
      } else if (bl.type === 'signature') {
        const st = S.field, h = 56;
        ensure(h + st.label + 12);
        items.push({ k: 't', x: ml, y: +(y + st.label - 1).toFixed(2), s: st.label, b: 1, c: '#555555', txt: bl.label, id: bl.id });
        items.push({ k: 'f', x: ml, y: y + st.label + 4, w: CW * 0.6, h, name: bl.name, ft: 'signature', label: bl.label });
        y += st.label + 4 + h + 14;
      }
    }
    const ft = styles.footer;
    pages.forEach((p, i) => p.items.push({ k: 't', x: ml, y: pg.height - mb / 2, s: ft.size, b: 0, c: '#777777', txt: ft.text.replace('{page}', i + 1).replace('{pages}', pages.length) }));
    return { pages };
  }

  /* ---------- package ---------- */
  const PART_ORDER = ['content/document.json', 'content/styles.json', 'layout/pages.json', 'data/values.json', 'history/changes.jsonl', 'comments/comments.json'];
  function j(o) { return enc.encode(JSON.stringify(o, null, 2) + '\n'); }
  async function buildFiles(st) {
    const files = {
      'content/document.json': j(st.doc),
      'content/styles.json': j(st.styles),
      'layout/pages.json': j(st.snapshot),
      'data/values.json': j(st.values),
      'history/changes.jsonl': enc.encode(st.history.map(h => JSON.stringify(h)).join('\n') + (st.history.length ? '\n' : '')),
      'comments/comments.json': j(st.comments || { threads: [] })
    };
    for (const v of st.versions) for (const [k, val] of Object.entries(v.files)) files['versions/' + v.n + '/' + k] = val;
    st.signatures.forEach((s, i) => { files['signatures/sig-' + (i + 1) + '.json'] = j(s); });
    const parts = {};
    for (const k of Object.keys(files).sort()) parts[k] = { sha256: await sha256(files[k]), bytes: files[k].length };
    const manifest = { leaf: '0.1', title: st.doc.title, language: st.doc.language || 'en-US', created: st.created, modified: st.modified, generator: 'Leaf reference viewer 0.1', requires: ['forms'], parts };
    return { files, manifest };
  }
  async function pack(st) {
    const { files, manifest } = await buildFiles(st);
    const entries = [{ name: 'mimetype', data: enc.encode('application/vnd.leaf+zip') }, { name: 'manifest.json', data: j(manifest) }];
    const keys = Object.keys(files).sort((a, b) => (PART_ORDER.indexOf(a) + 1 || 99) - (PART_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
    for (const k of keys) entries.push({ name: k, data: files[k] });
    return { bytes: zipWrite(entries), manifest, files };
  }
  async function unpack(u8) {
    const files = await zipRead(u8);
    if (!files.mimetype || dec.decode(files.mimetype).trim() !== 'application/vnd.leaf+zip') throw new Error('This is not a Leaf file (missing or wrong mimetype).');
    const manifest = JSON.parse(dec.decode(files['manifest.json']));
    const bad = [];
    for (const [k, meta] of Object.entries(manifest.parts || {})) {
      if (!files[k]) { bad.push(k + ' (missing)'); continue; }
      if (await sha256(files[k]) !== meta.sha256) bad.push(k);
    }
    const J = k => files[k] ? JSON.parse(dec.decode(files[k])) : null;
    const versions = {};
    for (const k of Object.keys(files)) { const m = k.match(/^versions\/(\d+)\/(.+)$/); if (m) (versions[m[1]] = versions[m[1]] || { n: +m[1], files: {} }).files[m[2]] = files[k]; }
    const signatures = Object.keys(files).filter(k => k.startsWith('signatures/')).sort().map(J);
    const hist = files['history/changes.jsonl'] ? dec.decode(files['history/changes.jsonl']).split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    return {
      st: { doc: J('content/document.json'), styles: J('content/styles.json'), snapshot: J('layout/pages.json'), values: J('data/values.json') || {}, history: hist, comments: J('comments/comments.json'), versions: Object.values(versions).sort((a, b) => a.n - b.n), signatures, created: manifest.created, modified: manifest.modified },
      manifest, files, tampered: bad
    };
  }

  /* ---------- seal and sign ---------- */
  const b64 = u8 => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  function versionFiles(st) { return { 'document.json': j(st.doc), 'styles.json': j(st.styles), 'pages.json': j(st.snapshot), 'values.json': j(st.values) }; }
  async function versionHash(vfiles) {
    const list = {}; for (const k of Object.keys(vfiles).sort()) list[k] = await sha256(vfiles[k]);
    return { list, hash: await sha256(canon(list)) };
  }
  async function signVersion(st, signer) {
    const n = st.versions.length + 1, files = versionFiles(st), vh = await versionHash(files);
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const payload = canon({ version: n, hash: vh.hash, signer, time: new Date().toISOString() });
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, enc.encode(payload)));
    const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
    st.versions.push({ n, files });
    st.signatures.push({ alg: 'ES256', payload: JSON.parse(payload), parts: vh.list, publicKey: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, signature: b64(sig), keyType: 'demo key (not identity-verified)' });
    return n;
  }
  async function verifySignature(st, s) {
    const v = st.versions.find(x => x.n === s.payload.version);
    if (!v) return { ok: false, why: 'signed version is missing' };
    const vh = await versionHash(v.files);
    if (vh.hash !== s.payload.hash) return { ok: false, why: 'signed version was altered' };
    const key = await crypto.subtle.importKey('jwk', { ...s.publicKey, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64(s.signature), enc.encode(canon(s.payload)));
    if (!ok) return { ok: false, why: 'signature does not match' };
    const cur = await versionHash(versionFiles(st));
    return { ok: true, unchanged: cur.hash === vh.hash };
  }

  globalThis.Leaf = { canon, sha256, contentHash, zipWrite, zipRead, layout, wrap, runsToText, textToRuns, pack, unpack, signVersion, verifySignature };
})();
