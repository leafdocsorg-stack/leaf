# Leaf

**An open document format to replace PDF: view, edit, fill and sign documents in any browser.**

Leaf stands for **Living Editable Authenticated Format**. A `.leaf` file looks the same on every device, like a PDF, but it stores real content (headings, paragraphs, tables, form fields), so it stays editable like a doc. It can be sealed and signed without a signing service, and it always exports to a standard PDF.

The Leaf Viewer is a free, open-source app that opens `.leaf` files and also works as a full PDF toolkit. Everything runs in your browser. Files never leave your device.

## What you can do

**With `.leaf` files**
- Read documents that look identical everywhere
- Edit text like a doc; the pages re-flow on their own
- Fill form fields
- Seal a version and sign it; anyone can verify the signature and see if anything changed since
- See every part inside the file, and the full edit history
- Export to PDF

**With PDF files**
- Annotate: highlight, draw, add text, images and signatures
- Fill existing PDF forms, and create new form fields on any PDF
- Organize pages: reorder, rotate, delete, insert, merge, split
- Redact for real (the content is removed, not covered)
- Watermarks, page numbers and Bates numbering
- Make scanned pages searchable with OCR
- Add or remove passwords

## Try it

```
npm install
npm run build      # builds the viewer into dist/
npm start          # serves dist/ at http://localhost:8080
```

`dist/` is a plain static site: upload it to any host (GitHub Pages, Cloudflare Pages, Netlify). Open it in Chrome or Edge and choose **Install** to make Leaf a desktop app that opens `.leaf` and `.pdf` files when you double-click them.

## What's in this repository

| Folder | What it is | License |
| --- | --- | --- |
| `spec/` | The Leaf format specification, v0.1 draft | CC BY 4.0 |
| `core/` | `leaf-core.js`: read, write, lay out, hash and sign Leaf files (browser and Node 18+) | Apache 2.0 |
| `viewer/` | The Leaf Viewer app | AGPL-3.0 |
| `samples/` | Example `.leaf` files | CC BY 4.0 |
| `tools/` | Build scripts | Apache 2.0 |

The format and the core library are permissive so anyone, including browsers and companies, can build Leaf support in. The viewer is AGPL so hosted forks share their improvements. The name "Leaf" and the logo identify the official format and apps.

## How a Leaf file works

A `.leaf` file is a ZIP package:

```
mimetype                  application/vnd.leaf+zip
manifest.json             version, parts, and a SHA-256 hash for every part
content/document.json     the content as a tree of blocks
content/styles.json       page size, margins, styles
layout/pages.json         sealed page layout, so every viewer draws identical pages
data/values.json          form answers
history/changes.jsonl     edit history
versions/                 sealed versions
signatures/               signatures over sealed versions
```

Rename one to `.zip` and you can look inside. See [`spec/leaf-spec-0.1.md`](spec/leaf-spec-0.1.md) for the full format.

## Status

Version 0.1 is an early draft. The format will change before 1.0. Signatures in the viewer use keys made in the browser and are for demonstration; certificate-based signing is planned.

Feedback on the spec is welcome: open an issue.
