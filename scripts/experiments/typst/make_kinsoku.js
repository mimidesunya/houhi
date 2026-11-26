// 禁則と字詰めの試験用の Markdown を作る。本文幅は 37.8em なので、1行目（1字下げ）は36字、2行目以降は37字。
// usage: node make_kinsoku.js <out.md>
const fs = require('fs');
const a = (n) => 'あ'.repeat(n);
const cases = [
    ['A 句点が2行目の頭', a(36) + '。' + 'う'.repeat(10)],
    ['B 閉じかぎが2行目の頭', a(36) + '」' + 'う'.repeat(10)],
    ['C 開き括弧が1行目の末尾', a(35) + '（いいい）' + 'う'.repeat(10)],
    ['D 促音が2行目の頭', a(36) + 'った' + 'う'.repeat(10)],
    ['E 長音が2行目の頭', a(36) + 'ーた' + 'う'.repeat(10)],
    ['F 三点リーダーが行をまたぐ', a(35) + '……' + 'う'.repeat(10)],
    ['G 数字が行をまたぐ', a(34) + '12345' + 'う'.repeat(10)],
    ['H 閉じ括弧と句点が2行目の頭', a(36) + '）。' + 'う'.repeat(10)],
    ['I 読点の連続と括弧の連続', 'あ、「い」、（う）、『え』。' + a(20) + '」」。' + a(30)],
    ['J 中黒が行頭', a(36) + '・い' + 'う'.repeat(10)],
    ['K 欧文の語が行をまたぐ', a(30) + 'Copper PDF and Typst' + 'う'.repeat(10)],
    ['L 句点が1行目の末尾にちょうど入る', a(35) + '。' + 'う'.repeat(40)],
];
let md = '# 禁則試験\n\n';
for (const [name, body] of cases) md += `## 第${cases.findIndex(c => c[0] === name) + 1} ${name}\n\n${body}\n\n`;
fs.writeFileSync(process.argv[2], md);
