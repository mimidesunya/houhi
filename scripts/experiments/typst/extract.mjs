import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const pdfjs = await import(new URL('../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href);
for (const f of process.argv.slice(2)) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), verbosity: 0 }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  const s = tc.items.map(i => i.str).join('');
  const odd = [...s].filter(c => /[\u2E80-\u2FDF\uF900-\uFAFF]/.test(c));
  console.log(f.split(/[\/]/).pop(), 'radicals/compat:', JSON.stringify(odd.join('')), '|', s.replace(/\s+/g, '').slice(0, 80));
}
