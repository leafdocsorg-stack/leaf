# Leaf (Living Editable Authenticated Format): Format Specification v0.1 Draft

Status: draft for public discussion · November 2026 · License: CC BY 4.0 (see `LICENSE` in this folder)

## Overview

Leaf is an open, single-file document format. It looks the same everywhere, like PDF, but stores real structured content, so anyone can view, edit, fill and sign it in a browser without Acrobat. Files use the `.leaf` extension (`.lef` is accepted as a short form).

PDF is built for printing: inside, it is mostly instructions to draw text at fixed coordinates. That makes it reliable to view and painful to edit. Leaf keeps the reliability and stores the document's meaning (headings, paragraphs, tables, form fields) as the primary data.

**Goals**

- Identical pages on every device, printer and year.
- Edit, fill and sign in any modern browser, offline, with no account and no install.
- One self-contained file that can be emailed, archived and opened decades later.
- Every Leaf file can be exported to a standard PDF, and PDFs can be imported.
- Open spec, open-source reference code, no royalties.

**Non-goals for 1.0**

- Replacing design tools: complex print layouts, posters and magazines stay in PDF or design apps.
- Spreadsheets, slide decks or apps inside the file.
- Running code of any kind inside the document.

## Design principles

1. **Content first, layout second.** The document is a tree of meaningful blocks. Pages are computed from it, so editing never means moving text boxes.
2. **Same look everywhere.** A sealed layout snapshot travels with the file, so every viewer shows the exact same pages (see Layout).
3. **One file, offline, no account.** Everything the document needs is inside the file.
4. **No code in the file.** Documents are data only. All behavior lives in the viewer, which keeps files safe to email and open.
5. **Always exits to PDF.** Nobody on the receiving end is forced to adopt Leaf.
6. **Reuse proven standards.** ZIP, JSON, Unicode, a small CSS subset, OpenType/WOFF2 fonts and standard digital signatures. Nothing new where something good exists.
7. **Open by default.** Anyone may read, write or build tools for Leaf for free.

## Container

A Leaf file is a ZIP archive, the same approach as .docx and EPUB. The first entry is an uncompressed `mimetype` file so tools can identify the format from its first bytes.

```
mimetype                  application/vnd.leaf+zip
manifest.json             version, parts, hashes, required features
content/document.json     the block tree (Content model)
content/styles.json       page setup and styles (Layout)
layout/pages.json         sealed layout snapshot (optional, recommended)
assets/fonts/             embedded WOFF2 fonts
assets/images/            PNG, JPEG, WebP, sanitized SVG
data/values.json          form field values (Forms)
history/changes.jsonl     append-only edit log (Edit history)
comments/comments.json    comment threads
versions/                 frozen copies of sealed versions
signatures/               signatures over sealed versions
```

`manifest.json` lists every part with its SHA-256 hash, so any change to any part is detectable.

```json
{
  "leaf": "0.1",
  "title": "Lease agreement",
  "language": "en-US",
  "created": "2026-11-24T10:00:00Z",
  "requires": ["forms"],
  "parts": {
    "content/document.json": "sha256-…",
    "content/styles.json": "sha256-…",
    "layout/pages.json": "sha256-…"
  }
}
```

- Paths are relative, lowercase ASCII, with no `..` segments.
- Readers ignore parts they don't understand unless they are listed in `requires`.

## Content model

`document.json` is a tree of blocks. Every block has a stable `id` that never changes, so comments, history and signatures can point at it even after edits.

| Block type | Holds | Notes |
| --- | --- | --- |
| `heading` | level 1–6, inline text | drives the outline and the accessible structure |
| `paragraph` | inline text | |
| `list` | ordered or bullet items, nested | |
| `table` | rows, cells, header rows, merged cells | cells hold blocks |
| `image` | asset reference, alt text, caption | alt text required for conformance |
| `field` | a form field (Forms) | |
| `pageBreak` | forces a new page | |
| `section` | groups blocks; can change page setup | e.g. a landscape appendix |
| `header` / `footer` | blocks repeated on pages | page number and count fields |

Inline text is a list of runs with marks: bold, italic, underline, strikethrough, link, superscript, subscript, code, and a named style.

```json
{
  "type": "paragraph",
  "id": "b7Kq2",
  "style": "body",
  "text": [
    {"t": "Rent is due on the "},
    {"t": "1st", "marks": ["bold"]},
    {"t": " of each month."}
  ]
}
```

## Layout and pagination

Leaf guarantees identical pages with two layers: rules that compute pages from content, and a sealed snapshot of the result. This is the core difference from both PDF (snapshot only, hard to edit) and Word (rules only, pages drift between apps).

**Layer 1: layout rules.** `styles.json` holds page size, margins, columns and named styles, written in a small, fixed subset of CSS: fonts, sizes, line height, spacing, alignment, borders, colors and page breaks. Line breaking follows Unicode UAX #14, and only embedded fonts are used, so any conforming engine produces the same pages.

**Layer 2: the snapshot.** `layout/pages.json` stores every page as positioned runs of text, lines and images, plus a hash of the content it was computed from (`contentHash`). Viewers draw straight from it, so pages match exactly even if two layout engines would differ.

A viewer uses the snapshot whenever its hash matches the content; otherwise it re-runs layout. After an edit, the editor re-runs layout and writes a fresh snapshot on save. Signed versions keep their own snapshots, so a signed page never changes.

## Fonts and assets

Every font used in the document is embedded, which is what makes pages identical without relying on the reader's computer.

- **Fonts:** WOFF2. Subsetting to the characters used is allowed, but an editor that adds new text must embed the full font or re-subset. Only fonts whose license permits embedding may be included.
- **Default font set:** conforming viewers ship a small set of open-licensed fonts (serif, sans, mono, plus wide script coverage) so simple documents need no embedded fonts at all.
- **Images:** PNG, JPEG, WebP, and SVG stripped of scripts, links and external references.
- **Color:** sRGB. Print-specific color (CMYK, spot colors) is out of scope for 1.0.
- **No remote assets.** Everything is inside the file; a viewer never fetches anything to display a document.

## Forms and data

Form fields are ordinary blocks in the content, and their answers are kept separate in `data/values.json`. Filling a form never touches the document's layout, and the answers can be exported as clean data.

| Field type | Stores | Validation (declarative only) |
| --- | --- | --- |
| `text` | string | required, max length, pattern |
| `number` | number | required, min, max, decimals |
| `date` | ISO date | required, earliest, latest |
| `checkbox` | true or false | required |
| `choice` | one or more options | required, min and max picks |
| `signature` | link to a signature (Signatures) | required |

- Each field has a stable `name`, so `values.json` reads like `{"tenant_name": "Ana Ruiz", "move_in": "2027-01-01"}`.
- Rules are data, not scripts: a viewer checks them, the file never runs anything.
- Simple calculated fields (sums, totals with tax) are an open question for 0.2.

## Edit history and comments

Every saved change is appended to `history/changes.jsonl`, one line per change, so anyone can see who changed what and when, like tracked changes that are always on.

- Each entry records the author, the time, the block ids touched, and the operation (insert, delete, replace, move, format).
- Writers may compact old history into a single baseline, but never inside a sealed version.
- Comments live in `comments/comments.json` as threads anchored to block ids and character ranges, so they survive edits around them.
- Authors are identified by a display name and an optional email. Real identity is only proven by signatures.

## Versions, snapshots and signatures

A document stays freely editable until someone seals a version. Sealing freezes that exact content and its pages, and signatures always apply to a sealed version, never to a moving draft.

1. **Seal.** The editor copies the current content, styles, form values and layout snapshot into `versions/<n>/` and records their hashes.
2. **Sign.** A signer signs the hash list of that version. Signatures are stored in `signatures/` as JSON Web Signatures, using an X.509 certificate for legally recognized signing or a plain key pair for everyday use.
3. **Keep editing if needed.** Later edits create a new draft. Earlier sealed versions and their signatures stay in the file and remain verifiable.

- Several people can sign the same version, in order or in parallel.
- A viewer shows plainly which version is signed, by whom, and whether anything changed since.
- Timestamps from a trusted timestamp authority (RFC 3161) are optional but recommended for contracts.
- Exported PDFs of a sealed version carry a matching PDF signature where the signer's certificate allows it.

## Security model

A Leaf file contains no executable content, ever. PDF's JavaScript, launch actions and embedded files are among its most abused features, and Leaf leaves them out entirely.

- **No scripts, macros or plugins.** A part holding script is invalid and must be rejected.
- **No automatic network access.** Links open only when a person clicks them, and nothing loads from outside the file.
- **Sanitized SVG.** Scripts, event handlers, external references and `foreignObject` are stripped on import and rejected on read.
- **Safe unpacking.** Readers enforce limits on total size, part count and compression ratio (zip-bomb protection), and refuse unsafe paths.
- **Privacy option.** Editors offer a one-click clean copy that strips history, comments and author names before sharing.

## PDF interoperability

Every conforming editor must export any Leaf file to PDF, because the person on the other end may never have heard of Leaf. Import from PDF is what lets people start using Leaf on documents they already have.

**Export (required for editors)**

- The layout snapshot maps directly to PDF pages, so the export matches the Leaf pages exactly.
- Exports are tagged PDF (headings, lists, tables and alt text carried over) for accessibility.
- A PDF/A option is offered for long-term archiving.
- Form fields become fillable PDF fields; filled values are printed into the page.

**Import (recommended for editors)**

| Import mode | What you get | Best for |
| --- | --- | --- |
| Editable | headings, paragraphs, tables and fields rebuilt as Leaf blocks | text-based PDFs, forms |
| Faithful | each original page kept as a fixed background, with fields and notes added on top | complex layouts, scans |

- Tagged PDFs import best; untagged ones are rebuilt from text position, with a review step.
- Existing PDF form fields convert to Leaf fields with their names kept.
- Scanned pages can be read with optional text recognition, flagged for review.

## Conformance levels and versioning

Three conformance levels let small tools support Leaf without building everything.

| Level | Must do |
| --- | --- |
| Viewer | open any valid file, draw pages from the snapshot (or run layout), show fields, comments and signature status, print |
| Editor | everything a Viewer does, plus edit content, fill forms, re-run layout, save a valid file, export to PDF |
| Signer | everything an Editor does, plus seal versions, create and verify signatures |

- The `leaf` field in `manifest.json` gives the spec version (major.minor). A minor version only adds optional features; a reader of 1.x opens any 1.y file.
- Features a file can't be read without are listed in `requires`. A reader that doesn't support one says so instead of showing the file wrongly.
- An open test suite of sample files and expected page images defines conformance; the official name may only be used by tools that pass it.

## Licensing, trademark and governance

Leaf stays open source: the format and the core code are free for anyone to use, forever. The project keeps only the name.

| Part | License | Why |
| --- | --- | --- |
| This specification | CC BY 4.0, plus an Open Web Foundation patent commitment | anyone may implement it with no royalties and no risk of patent claims |
| Core library (read, write, layout, PDF export) | Apache 2.0 | permissive with a patent grant, so browsers, apps and companies can build it in |
| Reference viewer and editor app | AGPL-3.0 | modified hosted versions must share their changes |
| Name and logo | trademark | forks can't pass as the official format; "compatible" use is earned through the test suite |

- **Revenue model (open core):** the format, library and editor are free. Paid services cover hosted signing with audit trails, team workspaces, storage, templates and support.
- **Governance:** decisions are made in public on the spec repository. Once other organizations depend on Leaf, the spec moves to a neutral foundation (for example the Linux Foundation) and later to a standards body.

## Reference app: a full PDF toolkit

The open-source Leaf viewer also works on ordinary PDFs, with the capabilities of Acrobat Pro. People adopt it for the PDFs they already have, and Leaf spreads through the same tool. Everything runs in the browser; files are never uploaded.

| Capability | Built on | Phase |
| --- | --- | --- |
| View, search, print, zoom | PDF.js (Apache 2.0) | 1 |
| Highlights, comments, drawing, typed text | PDF.js + pdf-lib (MIT) | 1 |
| Fill PDF forms | pdf-lib | 1 |
| Sign (drawn or typed signature) | pdf-lib | 1 |
| Organize pages: rotate, delete, reorder, insert | pdf-lib | 1 |
| Merge and split | pdf-lib | 1 |
| Compress and optimize | qpdf (Apache 2.0) | 1, deeper in 2 |
| Create forms on any PDF | pdf-lib + field editor | 2 |
| True redaction (removes the content, not just covers it) | page rasterization | 2 |
| Text recognition for scans (OCR) | Tesseract.js (Apache 2.0) | 2 |
| Passwords, encryption, permissions | qpdf | 2 |
| Watermarks, headers, page numbers, Bates numbering | pdf-lib | 2 |
| Compare two versions | text and visual diff | 2 |
| Edit PDF text and layout | import to Leaf, edit, export clean PDF | 3 |
| Convert PDF to and from Word, Excel, images | Leaf import/export; optional server for Office files | 3 |
| Certificate-based digital signatures and timestamps | standard PDF signing (PAdES) | 3 |
| Accessibility check, PDF/A archiving | veraPDF rules; PDF/A export | 3 |
| Default app for .pdf and .leaf files | installable web app (file handler) | 4 |

- **Why Leaf makes PDF editing work:** a PDF stores text as positioned fragments, so editing it in place breaks layouts. "Edit PDF" in this app converts to Leaf, edits like a normal document, and exports a clean PDF.

## Open questions

- **How much CSS.** A smaller subset is easier to make identical across engines; a larger one handles more real documents. Where is the line for 1.0?
- **Calculated fields.** Allow simple formulas (sums, tax) in forms, or keep forms pure data in 1.0?
- **Real-time co-editing.** Should block ids and the change log be designed now to support live collaboration later?
- **Saving in every browser.** Chrome and Edge can save back to the same file; Safari and Firefox currently download a new copy. Is that acceptable for 1.0?
- **Accessibility.** Make alt text and reading order required for every file, or only for the "accessible" conformance badge?
- **Media type.** Register `application/vnd.leaf+zip` with IANA.
