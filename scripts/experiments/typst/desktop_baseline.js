// usage: node desktop_baseline.js <repoRoot> <mdDir> <outJson>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [repo, mdDir, outJson] = process.argv.slice(2);
(async () => {
  const pdfjs = await import(require('url').pathToFileURL(path.join(repo, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  const result = {};
  for (const name of fs.readdirSync(mdDir).filter(n => n.endsWith('.md')).sort()) {
    const md = path.join(mdDir, name);
    const pdf = md.replace(/\.md$/, '.pdf');
    try { fs.unlinkSync(pdf); } catch {}
    try {
      execFileSync(process.execPath, [path.join(repo, 'dist/src/convert_to_pdf.js'), '--chrome', md], { cwd: repo, stdio: 'pipe', timeout: 120000 });
    } catch (e) { result[name] = { error: String(e.stderr || e.message).slice(0, 500) }; continue; }
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), useSystemFonts: false }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      pages.push(tc.items.map(it => it.str).join('').normalize('NFKC').replace(/\s+/g, ''));
    }
    result[name] = { pages, bytes: fs.statSync(pdf).size };
    process.stdout.write(`${name}: ${pages.length}p\n`);
  }
  fs.writeFileSync(outJson, JSON.stringify(result, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
