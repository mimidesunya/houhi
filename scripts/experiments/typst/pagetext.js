// usage: node pagetext.js <a.pdf> <b.pdf>
// 頁ごとの本文（pdfjs、NFKC、空白除去）を並べ、同じかどうかを出す
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const PDFJS = path.resolve(__dirname, '../../../node_modules/pdfjs-dist/legacy/build/pdf.mjs');
async function pages(file) {
    const pdfjs = await import(pathToFileURL(PDFJS).href);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: false, verbosity: 0 }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const tc = await (await doc.getPage(i)).getTextContent();
        out.push(tc.items.map(it => it.str).join('').normalize('NFKC').replace(/\s+/g, ''));
    }
    return out;
}
(async () => {
    const [a, b] = process.argv.slice(2);
    const pa = await pages(a), pb = await pages(b);
    console.log(`${path.basename(a)}: ${pa.length}p / ${path.basename(b)}: ${pb.length}p`);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
        const x = pa[i] || '', y = pb[i] || '';
        // 頁番号を除き、字の並び順（PDF の中の書き出し順はエンジンで違う）を無視して比べる
        const strip = (s) => s.replace(/-\d+-/g, '');
        const bag = (s) => [...strip(s)].sort().join('');
        const same = strip(x) === strip(y);
        const sameBag = bag(x) === bag(y);
        console.log(`p${i + 1}: ${same ? 'same' : (sameBag ? 'same chars (order differs)' : 'DIFF')} (${strip(x).length} / ${strip(y).length} chars)`);
        if (!sameBag) { console.log('  A: ' + x); console.log('  B: ' + y); }
    }
})();
