// typst.ts の WASM 版コンパイラ（@myriaddreamin/typst-ts-web-compiler）を Node で動かし、
// CLI と同じ .typ から PDF を作って時間を測る。ブラウザと同じ WASM をそのまま読む。
// usage: node wasm_compile.mjs <npmDir> <fontFile> <family> <outDir> [pdfStandard] <a.typ> [b.typ ...]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [npmDir, fontFile, family, outDir, std, ...typs] = process.argv.slice(2);
const pkg = path.join(npmDir, 'node_modules/@myriaddreamin/typst-ts-web-compiler/pkg');
const t0 = performance.now();
const mod = await import(pathToFileURL(path.join(pkg, 'typst_ts_web_compiler.mjs')).href);
await mod.default({ module_or_path: fs.readFileSync(path.join(pkg, 'typst_ts_web_compiler_bg.wasm')) });
const t1 = performance.now();
const builder = new mod.TypstCompilerBuilder();
builder.set_dummy_access_model();
await builder.add_raw_font(new Uint8Array(fs.readFileSync(fontFile)));
if (std && std !== '-') {
    if (typeof builder.set_pdf_opts !== 'function') { console.log('set_pdf_opts なし（この版は PDF 規格を指定できない）'); process.exit(2); }
    builder.set_pdf_opts({ pdf_standard: std });
}
const compiler = await builder.build();
const t2 = performance.now();
console.log(`wasm init ${Math.round(t1 - t0)} ms, font load + build ${Math.round(t2 - t1)} ms`);
fs.mkdirSync(outDir, { recursive: true });
for (const typ of typs) {
    const times = [];
    let pdf;
    for (let i = 0; i < 4; i++) {
        const s = performance.now();
        compiler.add_source('/main.typ', fs.readFileSync(typ, 'utf8'));
        const world = compiler.snapshot(null, '/main.typ', [['font', family]]);
        const res = world.get_artifact(1, 3);
        world.free();
        times.push(performance.now() - s);
        if (!res || !res.result) { console.log(typ, 'FAILED', JSON.stringify(res && res.diagnostics).slice(0, 800)); break; }
        pdf = res.result;
        if (typeof compiler.evict_cache === 'function') compiler.evict_cache(10);
    }
    if (!pdf) continue;
    const out = path.join(outDir, path.basename(typ).replace(/\.typ$/, '.pdf'));
    fs.writeFileSync(out, pdf);
    console.log(`${path.basename(typ)}: first ${Math.round(times[0])} ms, next ${times.slice(1).map(Math.round).join('/')} ms, ${pdf.length} bytes`);
}
