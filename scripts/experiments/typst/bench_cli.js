// Typst CLI で3文書を字ごとに組み、時間・頁数・大きさを測る
// usage: node bench_cli.js <typst.exe> <fontsRoot> <outRoot> <runs>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { convert } = require('./md2typ.js');
const [typst, fontsRoot, outRoot, runsArg] = process.argv.slice(2);
const runs = +(runsArg || 5);
const docs = {
    '訴訟.訴状': path.resolve(__dirname, '../../../src/templates/訴訟.訴状.md'),
    '訴訟.準備書面': path.resolve(__dirname, '../../../src/templates/訴訟.準備書面.md'),
    '長い証拠説明書': path.join((process.env.TYPST_WORK || path.join(__dirname, 'work')), 'baseline/長い証拠説明書.md'),
};
const fonts = {
    msmincho: ['MS Mincho', 'win-msmincho'],
    yumin: ['Yu Mincho', 'win-yumin'],
    'noto-otf': ['Noto Serif JP', 'noto-otf'],
    'noto-vf': ['Noto Serif JP', 'win-notovf'],
};
const pre = fs.readFileSync(path.join(__dirname, 'court.typ'), 'utf8');
const rows = [];
for (const [fk, [family, dir]] of Object.entries(fonts)) {
    const od = path.join(outRoot, fk);
    fs.mkdirSync(od, { recursive: true });
    for (const [dk, md] of Object.entries(docs)) {
        const typ = path.join(od, dk + '.typ');
        const pdf = path.join(od, dk + '.pdf');
        fs.writeFileSync(typ, pre + '\n' + convert(fs.readFileSync(md, 'utf8')) + '\n');
        const args = ['compile', '--ignore-system-fonts', '--font-path', path.join(fontsRoot, dir), '--input', `font=${family}`, typ, pdf];
        const times = [];
        for (let i = 0; i < runs; i++) {
            const t0 = process.hrtime.bigint();
            execFileSync(typst, args, { stdio: 'pipe' });
            times.push(Number(process.hrtime.bigint() - t0) / 1e6);
        }
        times.sort((a, b) => a - b);
        rows.push({ font: fk, doc: dk, ms_median: Math.round(times[Math.floor(times.length / 2)]), ms_min: Math.round(times[0]), bytes: fs.statSync(pdf).size });
    }
}
console.table(rows);
fs.writeFileSync(path.join(outRoot, 'bench_cli.json'), JSON.stringify(rows, null, 1));
