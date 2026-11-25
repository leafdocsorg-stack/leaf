import fs from 'node:fs';
import { jsPDF } from 'jspdf';
await import('../core/leaf-core.js');
const Leaf = globalThis.Leaf;

const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
const metrics = (t, b, s) => { pdf.setFont('helvetica', b ? 'bold' : 'normal'); return pdf.getStringUnitWidth(t) * s; };

const styles = {
  page: { size: 'letter', width: 612, height: 792, margin: [64, 72, 64, 72] },
  styles: {
    title: { size: 20, lh: 1.25, before: 0, after: 4 },
    h2: { size: 12.5, lh: 1.3, before: 14, after: 5 },
    body: { size: 10.5, lh: 1.45, after: 8 },
    small: { size: 9, lh: 1.4, after: 10, color: '#666666' },
    table: { size: 10, lh: 1.35, pad: 6, head: '#f1f3f4' },
    field: { label: 8.5, h: 22 }
  },
  footer: { text: 'Residential lease · Page {page} of {pages}', size: 8.5 }
};

const doc = {
  title: 'Residential lease agreement',
  language: 'en-US',
  blocks: [
    { id: 'h1', type: 'heading', level: 1, text: 'Residential Lease Agreement' },
    { id: 'p0', type: 'paragraph', style: 'small', text: [{ t: 'Sample document created to demonstrate the Leaf format. Names and addresses are fictional.' }] },
    { id: 'p1', type: 'paragraph', text: [{ t: 'This lease is made between ' }, { t: 'Lakeview Rentals LLC', b: true }, { t: ' ("Landlord") and the tenant named below ("Tenant") for the property described in this agreement. Both parties agree to the terms that follow.' }] },
    { id: 't1', type: 'table', header: true, widths: [0.34, 0.66], rows: [
      ['Term', 'Details'],
      ['Property', '1420 Harbor View Drive, Unit 3B, Omaha, NE 68102'],
      ['Monthly rent', '$1,450, due on the 1st of each month'],
      ['Security deposit', '$1,450, returned within 30 days after move-out'],
      ['Lease length', '12 months from the move-in date'],
      ['Utilities', 'Tenant pays electricity and internet; Landlord pays water and trash']
    ] },
    { id: 'h2a', type: 'heading', level: 2, text: '1. Rent and late fees' },
    { id: 'p2', type: 'paragraph', text: [{ t: 'Rent is paid online through the Landlord’s portal. A late fee of ' }, { t: '$50', b: true }, { t: ' applies if rent is not received by the 5th of the month. Returned payments carry a $35 fee.' }] },
    { id: 'h2b', type: 'heading', level: 2, text: '2. House rules' },
    { id: 'l1', type: 'list', items: [
      'Quiet hours are **10 pm to 7 am** every day.',
      'No smoking anywhere inside the unit or on the balcony.',
      'Pets are allowed only with written approval from the Landlord.',
      'Tenant reports any leak or damage within 48 hours.'
    ] },
    { id: 'h2c', type: 'heading', level: 2, text: '3. Maintenance and entry' },
    { id: 'p3', type: 'paragraph', text: [{ t: 'The Landlord handles repairs to plumbing, heating, electrical systems and appliances supplied with the unit. Except in an emergency, the Landlord gives at least 24 hours’ notice before entering the unit.' }] },
    { id: 'h2d', type: 'heading', level: 2, text: '4. Tenant details' },
    { id: 'f1', type: 'fields', fields: [
      { name: 'tenant_name', label: 'TENANT FULL NAME', ft: 'text' },
      { name: 'move_in', label: 'MOVE-IN DATE', ft: 'date' }
    ] },
    { id: 'f2', type: 'fields', fields: [
      { name: 'phone', label: 'PHONE', ft: 'text' },
      { name: 'email', label: 'EMAIL', ft: 'text' }
    ] },
    { id: 'f3', type: 'fields', fields: [
      { name: 'agree_rules', label: 'HOUSE RULES', ft: 'checkbox', text: 'I have read and agree to the house rules in section 2.' }
    ] },
    { id: 'h2e', type: 'heading', level: 2, text: '5. Signature' },
    { id: 'p4', type: 'paragraph', text: [{ t: 'By signing, Tenant confirms the details above and agrees to every term of this lease.' }] },
    { id: 's1', type: 'signature', name: 'tenant_signature', label: 'TENANT SIGNATURE' }
  ]
};

const snapshot = Leaf.layout(doc, styles, metrics);
snapshot.contentHash = await Leaf.contentHash(doc, styles);
snapshot.engine = 'leaf-reference-layout 0.1 (Helvetica metrics)';
const now = '2026-11-24T12:00:00Z';
const st = {
  doc, styles, snapshot, values: {}, created: now, modified: now,
  history: [{ time: now, author: 'Lakeview Rentals LLC', op: 'create', blocks: doc.blocks.length }],
  comments: { threads: [] }, versions: [], signatures: []
};
const { bytes } = await Leaf.pack(st);
fs.writeFileSync(new URL('../samples/lease-sample.leaf', import.meta.url), bytes);
// round-trip check
const back = await Leaf.unpack(bytes);
console.log('pages', snapshot.pages.length, 'items', snapshot.pages.map(p => p.items.length), 'bytes', bytes.length, 'tampered', back.tampered, 'hash ok', back.st.snapshot.contentHash === await Leaf.contentHash(back.st.doc, back.st.styles));
