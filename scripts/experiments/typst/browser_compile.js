// typst.ts の WASM 版を本物の Chrome（headless）で動かす試験。
// 127.0.0.1 の小さなサーバーで wasm・字・.typ を配り、頁の中で組んだ PDF と時間を送り返させる。
// usage: node browser_compile.js <npmDir> <fontFile> <family> <typDir> <outDir> name...
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const [npmDir, fontFile, family, typDir, outDir, ...names] = process.argv.slice(2);
const pkg = path.join(npmDir, 'node_modules/@myriaddreamin/typst-ts-web-compiler/pkg');
fs.mkdirSync(outDir, { recursive: true });
const page = `<!doctype html><meta charset="utf-8"><body>running<script type="module">
const log = (o) => fetch('/result', { method: 'POST', body: JSON.stringify(o) });
try {
  const t0 = performance.now();
  const mod = await import('/pkg/typst_ts_web_compiler.mjs');
  await mod.default({ module_or_path: fetch('/pkg/typst_ts_web_compiler_bg.wasm') });
  const t1 = performance.now();
  const font = new Uint8Array(await (await fetch('/font')).arrayBuffer());
  const b = new mod.TypstCompilerBuilder();
  b.set_dummy_access_model();
  await b.add_raw_font(font);
  const c = await b.build();
  const t2 = performance.now();
  const results = [];
  for (const name of ${JSON.stringify(names)}) {
    const src = await (await fetch('/typ/' + encodeURIComponent(name))).text();
    const s = performance.now();
    c.add_source('/main.typ', src);
    const w = c.snapshot(null, '/main.typ', [['font', ${JSON.stringify(family)}]]);
    const r = w.get_artifact(1, 3);
    w.free();
    const ms = performance.now() - s;
    results.push({ name, ms: Math.round(ms), bytes: r.result ? r.result.length : null });
    if (r.result) await fetch('/save/' + encodeURIComponent(name), { method: 'POST', body: r.result });
  }
  await log({ ua: navigator.userAgent, wasmInitMs: Math.round(t1 - t0), fontAndBuildMs: Math.round(t2 - t1), results });
} catch (e) { await log({ error: String(e && e.stack || e) }); }
</script>`;
const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url);
    const send = (file, type) => { res.writeHead(200, { 'content-type': type }); fs.createReadStream(file).pipe(res); };
    if (u === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); }
    else if (u.startsWith('/pkg/')) send(path.join(pkg, path.basename(u)), u.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
    else if (u === '/font') send(fontFile, 'application/octet-stream');
    else if (u.startsWith('/typ/')) send(path.join(typDir, path.basename(u) + '.typ'), 'text/plain; charset=utf-8');
    else if (u.startsWith('/save/') || u === '/result') {
        const chunks = [];
        req.on('data', d => chunks.push(d));
        req.on('end', () => {
            res.end('ok');
            if (u === '/result') { console.log(Buffer.concat(chunks).toString()); finish(); }
            else fs.writeFileSync(path.join(outDir, path.basename(u) + '.pdf'), Buffer.concat(chunks));
        });
    } else { res.writeHead(404); res.end(); }
});
let chrome, profile;
function finish() { try { chrome.kill(); } catch {} server.close(); setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(0); }, 1500); }
server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-typst-'));
    chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, `http://127.0.0.1:${port}/`], { stdio: 'ignore' });
    setTimeout(() => { console.log('timeout'); finish(); }, 120000);
});
