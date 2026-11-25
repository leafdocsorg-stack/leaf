# Third-party components

The Leaf Viewer bundles these open-source libraries in `viewer/vendor/`:

| Component | Version | License |
| --- | --- | --- |
| PDF.js (pdfjs-dist) | 3.11.174 | Apache 2.0 |
| pdf-lib | 1.17.1 | MIT |
| jsPDF | 2.5.1 | MIT |
| qpdf (WebAssembly build, @neslinesli93/qpdf-wasm) | 0.3.x | Apache 2.0 |
| Tesseract.js and tesseract.js-core | 7.x | Apache 2.0 |
| Tesseract English model (eng.traineddata) | 4.0.0 | Apache 2.0 |

`tesseract-worker.min.js` is patched to load the English model from `eng.traineddata.gz.b64.txt` (a base64 copy of `eng.traineddata.gz`) so the app can be served from hosts that refuse `.gz` files.
