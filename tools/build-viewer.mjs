import crypto from 'node:crypto';
// Builds the website into dist/: node tools/build-viewer.mjs
//   dist/            landing page (site/)
//   dist/spec/       the specification, rendered from spec/leaf-spec-0.1.md
//   dist/app/        the Leaf Viewer
//   dist/samples/    sample .leaf file
import fs from 'node:fs'; import path from 'node:path';
import { marked } from 'marked';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'dist'); fs.rmSync(out, { recursive: true, force: true });
const mk = (...p) => { const d = path.join(out, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
mk();

// Landing page and shared assets
for (const f of ['index.html', 'style.css', 'favicon.svg']) fs.copyFileSync(path.join(root, 'site', f), path.join(out, f));
fs.copyFileSync(path.join(root, 'site/developers.html'), path.join(mk('developers'), 'index.html'));

// Viewer at /app/
const app = mk('app');
const core = fs.readFileSync(path.join(root, 'core/leaf-core.js'), 'utf8');
const sample = fs.readFileSync(path.join(root, 'samples/lease-sample.leaf')).toString('base64');
let html = fs.readFileSync(path.join(root, 'viewer/viewer.template.html'), 'utf8');
html = html.replace('/*CORE*/', () => core).replace("'/*SAMPLE*/'", () => `'${sample}'`);
// Version the app script by its content so every deploy reaches returning visitors.
const ptHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'viewer/pdf-tools.js'))).digest('hex').slice(0, 10);
html = html.replace('<script src="pdf-tools.js"></script>', `<script src="pdf-tools.js?v=${ptHash}"></script>`);
fs.writeFileSync(path.join(app, 'index.html'), html);
// Self-contained readers. "Save" fills one with a document so the .leaf.html file opens in any browser.
//   reader.html      Leaf documents (small)
//   reader-pdf.html  documents that keep their original page design (adds the PDF page renderer)
const V = f => fs.readFileSync(path.join(root, 'viewer/vendor', f), 'utf8');
function makeReader(withPdf) {
  let rd = fs.readFileSync(path.join(root, 'viewer/viewer.template.html'), 'utf8');
  const hide = withPdf ? '#pdfBtn,#newDocBtn,#homeBtn,.install,header label.btn:has(#fileIn)' : '#pdfBtn,#leafBtn,#newDocBtn,#homeBtn,.install,header label.btn:has(#fileIn)';
  const tail = withPdf
    ? '});\n</script>\n<script>\naddEventListener(\'DOMContentLoaded\', () => {\n' + fs.readFileSync(path.join(root, 'viewer/pdf-tools.js'), 'utf8') + '\n});\n</script>'
    : '});\n</script>';
  rd = rd.replace('/*CORE*/', () => core).replace("'/*SAMPLE*/'", "''")
    .replace(/<link rel="manifest"[^>]*>\n?/, '')
    .replace('}\n</script>\n<script src="pdf-tools.js"></script>', () => tail)
    .replace(/<script src="(jspdf\.umd|qpdf|tesseract)[^"]*"><\/script>\n/g, '')
    .replace(/<script src="pdf\.min\.js"><\/script>\n/, () => withPdf ? '<script>' + V('pdf.min.js') + '\n</script>\n<script type="text/plain" id="pdfworker">' + V('pdf.worker.min.js') + '\n</script>\n<script>pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([document.getElementById("pdfworker").textContent], { type: "text/javascript" }));</script>\n' : '')
    .replace(/<script src="pdf-lib\.min\.js"><\/script>\n/, () => withPdf ? '<script>' + V('pdf-lib.min.js') + '\n</script>\n' : '')
    .replace('<script>\n{\nconst SAMPLE', "<script>\naddEventListener('DOMContentLoaded', () => {\nconst SAMPLE")
    .replace('</head>', () => '<script>document.addEventListener("readystatechange", function () { if (document.readyState === "interactive") window.__LEAF_READER_SRC = "<!doctype html>\\n" + document.documentElement.outerHTML; });</script>\n<style>' + hide + '{display:none!important}</style>\n</head>')
    .replace('<body>', '<body>\n<script type="text/plain" id="leafdata"></script>\n<div id="nojsMsg" style="max-width:520px;margin:40px auto;padding:24px;font:16px/1.5 system-ui,sans-serif;color:#0d2b2d;border:1px solid #d5dbdc;border-radius:12px;background:#fff"><b style="font-size:20px">This is a Leaf document.</b><p>This preview cannot show it. To open it, use a web browser:</p><p><b>On a phone:</b> go to <a href="https://leafdocs.org/app/">leafdocs.org/app</a>, tap <b>Open a file</b> and choose this file.</p><p><b>On a computer:</b> double-click the file, or open it with Chrome, Edge, Safari or Firefox.</p></div>')
    .replace('</head>', '<style id="nojsHide">body>*:not(#nojsMsg){display:none!important}</style>\n</head>')
    .replace("addEventListener('DOMContentLoaded', () => {\nconst SAMPLE", "addEventListener('DOMContentLoaded', () => {\ndocument.getElementById('nojsMsg')?.remove(); document.getElementById('nojsHide')?.remove();\nconst SAMPLE")
    .replace(/href="\/(?!\/)/g, 'href="https://leafdocs.org/');
  if (/<script src=/.test(rd) || !rd.includes('id="leafdata"') || !rd.includes('DOMContentLoaded') || (withPdf && !rd.includes('id="pdfworker"'))) throw new Error('reader build failed');
  return rd;
}
fs.writeFileSync(path.join(app, 'reader.html'), makeReader(false));
fs.writeFileSync(path.join(app, 'reader-pdf.html'), makeReader(true));
for (const f of ['pdf-tools.js', 'manifest.webmanifest', 'sw.js', 'icon.svg', 'icon-192.png', 'icon-512.png']) fs.copyFileSync(path.join(root, 'viewer', f), path.join(app, f));
for (const f of fs.readdirSync(path.join(root, 'viewer/vendor'))) fs.copyFileSync(path.join(root, 'viewer/vendor', f), path.join(app, f));

// Spec at /spec/
const md = fs.readFileSync(path.join(root, 'spec/leaf-spec-0.1.md'), 'utf8');
const body = marked.parse(md);
fs.writeFileSync(path.join(mk('spec'), 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Leaf format specification v0.1 draft</title>
<meta name="description" content="The Leaf (Living Editable Authenticated Format) specification, version 0.1 draft.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/style.css">
<link rel="canonical" href="https://leafdocs.org/spec/"></head><body>
<header class="top"><div class="wrap"><a class="brand" href="/"><img src="/favicon.svg" alt="" width="26" height="26">Leaf</a>
<nav><a href="/app/">Open editor</a><a href="/developers/">Developers</a><a href="/spec/">Spec</a><a href="https://github.com/leafdocsorg-stack/leaf">GitHub</a></nav></div></header>
<main class="wrap doc">${body}
<p><a href="/spec/leaf-spec-0.1.md">Download this spec as Markdown</a></p></main>
<footer><div class="wrap"><span>Specification text: CC BY 4.0</span><span><a href="/">Home</a> · <a href="https://github.com/leafdocsorg-stack/leaf/issues">Give feedback</a></span></div></footer>
</body></html>`);
fs.copyFileSync(path.join(root, 'spec/leaf-spec-0.1.md'), path.join(out, 'spec', 'leaf-spec-0.1.md'));

// Samples
fs.copyFileSync(path.join(root, 'samples/lease-sample.leaf'), path.join(mk('samples'), 'lease-sample.leaf'));

// Crawler files and headers
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://leafdocs.org/sitemap.xml\n');
fs.writeFileSync(path.join(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>https://leafdocs.org/</loc></url>\n<url><loc>https://leafdocs.org/developers/</loc></url>\n<url><loc>https://leafdocs.org/spec/</loc></url>\n<url><loc>https://leafdocs.org/app/</loc></url>\n</urlset>\n');
fs.writeFileSync(path.join(out, '_headers'), '/samples/*\n  Content-Type: application/vnd.leaf+zip\n  Content-Disposition: attachment\n/app/*\n  Cache-Control: no-cache\n');
// Version shared assets by content so a new logo or stylesheet reaches returning visitors at once.
{
  const h = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(out, f))).digest('hex').slice(0, 10);
  const ver = { 'style.css': h('style.css'), 'favicon.svg': h('favicon.svg'), 'app/icon.svg': h('app/icon.svg') };
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(out).filter(f => f.endsWith('.html') && !/reader(-pdf)?\.html$/.test(f))) {
    const t = fs.readFileSync(f, 'utf8');
    const n = t.replace(/((?:href|src)=")((?:\/)?(?:style\.css|favicon\.svg))"/g, (m, a, u) => a + u + '?v=' + ver[u.replace(/^\//, '')] + '"')
      .replace(/(href=")icon\.svg"/g, (m, a) => a + 'icon.svg?v=' + ver['app/icon.svg'] + '"');
    if (n !== t) fs.writeFileSync(f, n);
  }
}
console.log('Built dist/. Serve it with any static host, e.g. npx serve dist');
