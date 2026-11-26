// houhi の HTML と style.css を、paged.js を使わずに Chrome の印刷で PDF にする（行の折り返しを見るため）。
// usage: node chrome_plain.js <in.md> <out.pdf>
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const { convertMarkdownToCourtHtml } = require('../../../dist/src/base/court_markdown.js');
const [inMd, outPdf] = process.argv.slice(2);
const body = convertMarkdownToCourtHtml(fs.readFileSync(inMd, 'utf8'));
// src/convert_to_pdf.ts の CHROME_PAGE_NUMBER_STYLE と同じ字の指定
const html = `<!DOCTYPE html><html lang="ja" data-houhi-pdf-engine="chrome"><head><meta charset="UTF-8">
<link rel="stylesheet" href="${pathToFileURL(path.join(__dirname, '../../../src/base/style.css')).href}">
<style>html[data-houhi-pdf-engine="chrome"], html[data-houhi-pdf-engine="chrome"] body, html[data-houhi-pdf-engine="chrome"] body * {
 font-family: "NotoSerifJP-Regular", "MS Mincho", "Hiragino Mincho ProN", serif; font-size: 12pt; }</style>
</head><body>${body}</body></html>`;
const htmlPath = path.resolve(outPdf).replace(/\.pdf$/, '.chrome.html');
fs.writeFileSync(htmlPath, html);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-plain-'));
execFileSync('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, '--no-pdf-header-footer',
    `--print-to-pdf=${path.resolve(outPdf)}`, pathToFileURL(htmlPath).href,
], { stdio: 'pipe', timeout: 60000 });
fs.rmSync(profile, { recursive: true, force: true });
