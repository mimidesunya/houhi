const test = require('node:test');
const assert = require('node:assert/strict');

const { convertMarkdownToCourtHtml } = require('../dist/src/base/court_markdown.js');

// 2026-09-25 の証拠説明書3（TECH-20260925-001）の形。作成年月日が折り返さずに隣の列へはみ出し、
// 立証趣旨の列が狭くて表が次の頁へ送られていた。
const EVIDENCE_TABLE = [
    '| 乙A号証 | 標目 | 原本写 | 作成年月日 | 作成者 | 立証趣旨 |',
    '| :--- | :--- | :---: | :--- | :--- | :--- |',
    '| 39 | 横浜地方裁判所令和8年3月31日決定（令和7年（ヲ）第2254号）抜粋 | 写し | 令和8年3月31日 | 横浜地方裁判所第3民事部 | '
        + '前訴本案判決の確定に伴い、原告解放同盟の申立てに係る間接強制決定が取り消され、その余の債権者の申立てに係る決定も'
        + '兵庫県、東京都、福岡県及び京都府に係る部分を除いて取り消されたこと。 |',
    '| 40 | 毎日新聞石川地方版記事 | 写し | 令和8年8月26日 | 毎日新聞社 | 石川県の2団体が大阪市を訪問したこと。 |',
].join('\n');

function evidenceHtml() {
    const html = convertMarkdownToCourtHtml(EVIDENCE_TABLE);
    const table = html.match(/<table class="evidence">[\s\S]*?<\/table>/);
    assert.ok(table, 'evidence table should be rendered');
    return table[0];
}

function colWidths(table) {
    return [...table.matchAll(/<col style="width:([\d.]+)%">/g)].map(m => Number(m[1]));
}

test('evidence table: dates break only after 年', () => {
    const table = evidenceHtml();
    assert.match(table, /<td class="col-date"><span class="nw">令和8年<\/span><span class="nw">3月31日<\/span><\/td>/);
});

test('evidence table: 号証 and 作成年月日 headers break at word boundaries', () => {
    const table = evidenceHtml();
    assert.match(table, /<th class="col-no"><span class="nw">乙A<\/span><span class="nw">号証<\/span><\/th>/);
    assert.match(table, /<th class="col-date"><span class="nw">作成<\/span><span class="nw">年月日<\/span><\/th>/);
    // 折り返す列の見出しは塊にしない（狭い列からはみ出さない）
    assert.match(table, /<th class="col-orig">原本写<\/th>/);
});

test('evidence table: short columns stay narrow and 立証趣旨 gets the most width', () => {
    const widths = colWidths(evidenceHtml());
    assert.equal(widths.length, 6);
    assert.ok(Math.abs(widths.reduce((a, b) => a + b, 0) - 100) < 0.5, `widths should sum to 100%: ${widths}`);
    const [no, title, orig, date, author, purpose] = widths;
    assert.ok(purpose === Math.max(...widths), `立証趣旨 should be the widest: ${widths}`);
    assert.ok(no < 10 && orig < 10, `号証 and 原本写 should be narrow: ${widths}`);
    // 「3月31日」（和欧間込み約 4.25em）と余白が入る幅（本文 37.8em の 13% 前後）
    assert.ok(date >= 12, `作成年月日 should fit its longest chunk: ${widths}`);
    assert.ok(title >= 15, `標目 keeps at least 6em: ${widths}`);
    assert.ok(author > 0);
});
