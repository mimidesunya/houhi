// houhi の Chrome エンジン（ヘッドレス Chrome + paged.js、dist の pdf_converter_chrome.js を読むだけ）で
// 3文書を組み、時間を測る。HTML は scratch に置き、出力も scratch に書く（worktree には書かない）。
// usage: node bench_chrome.js <outDir> <runs>
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '../../..');
const { convertHtmlToPdfWithChrome } = require(path.join(REPO, 'dist/src/lib/pdf_converter_chrome.js'));
const { convertMarkdownToCourtHtml } = require('../../../dist/src/base/court_markdown.js');
const [outDir, runsArg] = process.argv.slice(2);
const runs = +(runsArg || 3);
const docs = {
    '訴訟.訴状': path.join(REPO, 'src/templates/訴訟.訴状.md'),
    '訴訟.準備書面': path.join(REPO, 'src/templates/訴訟.準備書面.md'),
    '長い証拠説明書': path.join((process.env.TYPST_WORK || path.join(__dirname, 'work')), 'baseline/長い証拠説明書.md'),
};
(async () => {
    const rows = [];
    for (const [name, md] of Object.entries(docs)) {
        const html = `<!DOCTYPE html><html lang="ja" data-houhi-pdf-engine="chrome"><head><meta charset="UTF-8"><title>${name}</title>
<link rel="stylesheet" href="style.css">
<style>html[data-houhi-pdf-engine="chrome"], html[data-houhi-pdf-engine="chrome"] body, html[data-houhi-pdf-engine="chrome"] body * {
 font-family: "NotoSerifJP-Regular", "MS Mincho", "Hiragino Mincho ProN", serif; font-size: 12pt; }
@page { size: A4; counter-increment: page 1; }</style></head><body>${convertMarkdownToCourtHtml(fs.readFileSync(md, 'utf8'))}</body></html>`;
        const htmlPath = path.join(outDir, name + '.html');
        fs.writeFileSync(htmlPath, html);
        const times = [];
        for (let i = 0; i < runs; i++) {
            const t0 = process.hrtime.bigint();
            const log = console.log; console.log = () => {};
            try { await convertHtmlToPdfWithChrome(htmlPath, path.join(outDir, name + '.pdf'), path.join(__dirname, '../../../src/base'), path.join(REPO, 'src/base'), {}, {}); }
            finally { console.log = log; }
            times.push(Number(process.hrtime.bigint() - t0) / 1e6);
        }
        times.sort((a, b) => a - b);
        rows.push({ doc: name, ms_median: Math.round(times[Math.floor(times.length / 2)]), ms_min: Math.round(times[0]), bytes: fs.statSync(path.join(outDir, name + '.pdf')).size });
    }
    console.table(rows);
})().catch(e => { console.error(e); process.exit(1); });
