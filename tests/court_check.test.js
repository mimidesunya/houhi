const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { checkCourtMarkdown, formatCourtCheckIssue, getCourtCheckLabel } = require('../dist/src/base/court_check.js');

function kinds(issues) {
    return issues.map(issue => issue.kind);
}

const PARTIES = [
    '### --左',
    '令和6年（ワ）第123号　損害賠償請求事件',
    '- 原告:甲野　太郎',
    '- 被告:乙山　次郎',
    '### --',
    '',
    '# 証拠説明書',
    '',
];

function evidenceTable(header, rows) {
    return [
        `| ${header} | 標目 | 原本写 | 作成年月日 | 作成者 | 立証趣旨 |`,
        '| :--- | :--- | :---: | :--- | :--- | :--- |',
        ...rows.map(([number, date = '令和5年4月1日']) => `| ${number} | 書証 | 写し | ${date} | 甲野太郎 | 事実 |`),
    ];
}

test('checkCourtMarkdown: a finished document has no issues', () => {
    const md = [
        ...PARTIES,
        '### --右',
        '- 被告:乙山　次郎',
        '### --',
        '',
        ...evidenceTable('乙号証', [['1'], ['2-1'], ['2-2'], ['3']]),
    ].join('\n');
    assert.deepEqual(checkCourtMarkdown(md), []);
});

test('checkCourtMarkdown: finds 【要確認】 with its line number', () => {
    const issues = checkCourtMarkdown('# 準備書面\n\n原告は【要確認】に契約した。\n');
    assert.deepEqual(kinds(issues), ['needs-confirmation']);
    assert.equal(issues[0].line, 3);
    assert.match(issues[0].message, /【要確認】/);
    assert.equal(formatCourtCheckIssue(issues[0]).startsWith('3行目: '), true);
    assert.equal(getCourtCheckLabel('needs-confirmation'), '【要確認】の残り');
});

test('checkCourtMarkdown: finds 〇〇 / ○○ and single 〇 in dates, but not kanji numerals', () => {
    const issues = checkCourtMarkdown([
        '被告は、〇〇という行為をした。',
        '令和〇年〇月〇日',
        '○○地方裁判所　御中',
        '金一〇〇万円を支払え。',
        '二〇二四年の記事',
    ].join('\n'));
    assert.deepEqual(issues.map(issue => issue.line), [1, 2, 3]);
    assert.ok(issues.every(issue => issue.kind === 'placeholder'));
});

test('checkCourtMarkdown: ignores AI notes in HTML comments but keeps line numbers', () => {
    const issues = checkCourtMarkdown('<!--\nAI NOTE: 〇〇 と【要確認】\n-->\n# 書面\n〇〇\n');
    assert.deepEqual(issues.map(issue => [issue.kind, issue.line]), [['placeholder', 5]]);
});

test('checkCourtMarkdown: western dates in the evidence table, with the line', () => {
    const md = [...PARTIES, ...evidenceTable('甲号証', [['1', '2024年2月6日'], ['2', '令和6年2月6日'], ['3', '2026-09-22']])].join('\n');
    const issues = checkCourtMarkdown(md);
    assert.deepEqual(kinds(issues), ['western-date', 'western-date']);
    assert.equal(issues[0].message, '証拠説明書の作成年月日が西暦です（1: 2024年2月6日）。和暦で書いてください。');
    assert.equal(issues[0].line, PARTIES.length + 3);
    assert.equal(issues[1].line, PARTIES.length + 5);
});

test('checkCourtMarkdown: gaps in main and branch numbers, using the prefix from the header', () => {
    const md = [...PARTIES, ...evidenceTable('乙号証', [['1'], ['2-1'], ['2-3'], ['5']])].join('\n');
    const issues = checkCourtMarkdown(md);
    assert.deepEqual(kinds(issues), ['evidence-gap', 'evidence-gap']);
    assert.match(issues[0].message, /乙2-2 が抜けています/);
    assert.match(issues[1].message, /乙3〜乙4 が抜けています/);
});

test('checkCourtMarkdown: a later evidence description may start in the middle', () => {
    const md = [...PARTIES, ...evidenceTable('甲号証', [['15'], ['16'], ['17-1'], ['17-2']])].join('\n');
    assert.deepEqual(checkCourtMarkdown(md), []);
});

test('checkCourtMarkdown: duplicates, plain and branched numbers together, and order', () => {
    const md = [...PARTIES, ...evidenceTable('甲号証', [['1'], ['2'], ['2-1'], ['3'], ['3'], ['4'], ['ー']])].join('\n');
    const issues = checkCourtMarkdown(md);
    assert.ok(issues.some(issue => issue.kind === 'evidence-duplicate' && /甲3 が2回/.test(issue.message)));
    assert.ok(issues.some(issue => issue.kind === 'evidence-duplicate' && /甲2 と 甲2-1/.test(issue.message)));
    const reversed = checkCourtMarkdown([...PARTIES, ...evidenceTable('甲号証', [['1'], ['3'], ['2']])].join('\n'));
    assert.ok(reversed.some(issue => issue.kind === 'evidence-order'));
});

test('checkCourtMarkdown: accepts full-width digits, 第 and 号証 in the number column and lettered groups', () => {
    const md = [...PARTIES, ...evidenceTable('乙A号証', [['乙A第１号証'], ['２'], ['3の1'], ['3の2']])].join('\n');
    assert.deepEqual(checkCourtMarkdown(md), []);
    const gap = checkCourtMarkdown([...PARTIES, ...evidenceTable('乙A号証', [['1'], ['3']])].join('\n'));
    assert.match(gap[0].message, /乙A2 が抜けています/);
});

test('checkCourtMarkdown: tells apart 甲 and 乙 tables in one document', () => {
    const md = [
        ...PARTIES,
        ...evidenceTable('甲号証', [['1'], ['2']]),
        '',
        ...evidenceTable('乙号証', [['1'], ['2']]),
    ].join('\n');
    assert.deepEqual(checkCourtMarkdown(md), []);
});

test('checkCourtMarkdown: sender name differs from the party in the case caption', () => {
    const md = [...PARTIES, '### --右', '- 被告:乙山　三郎', '### --'].join('\n');
    const issues = checkCourtMarkdown(md);
    assert.deepEqual(kinds(issues), ['party-mismatch']);
    assert.equal(issues[0].line, PARTIES.length + 2);
    assert.match(issues[0].message, /差出人欄の被告「乙山　三郎」が、当事者欄の被告「乙山　次郎」（4行目）と違います/);
});

test('checkCourtMarkdown: party names compare without spaces and with parenthesised roles; unrelated labels are ignored', () => {
    const md = [
        '### --左',
        '令和6年（ネ）第1号',
        '- 控訴人（1審被告）:乙山 次郎',
        '- 被控訴人（1審原告）:甲野　太郎',
        '### --',
        '### --右',
        '- 控訴人:乙山次郎',
        '- 電話:03-0000-0000',
        '### --',
    ].join('\n');
    assert.deepEqual(checkCourtMarkdown(md), []);
});

test('checkCourtMarkdown: several parties on one side', () => {
    const md = [
        '### --左',
        '- 原告:甲野　太郎、甲野　花子',
        '- 被告:乙山　次郎',
        '### --',
        '### --右',
        '- 原告:甲野　花子',
        '### --',
    ].join('\n');
    assert.deepEqual(checkCourtMarkdown(md), []);
});

test('checkCourtMarkdown: the templates only report leftover placeholders', () => {
    const templatesDir = path.resolve('src/templates');
    const allowed = new Set(['placeholder', 'needs-confirmation']);
    const unexpected = [];
    for (const name of fs.readdirSync(templatesDir).filter(file => file.endsWith('.md'))) {
        for (const issue of checkCourtMarkdown(fs.readFileSync(path.join(templatesDir, name), 'utf-8'))) {
            if (!allowed.has(issue.kind)) {
                unexpected.push(`${name}: ${formatCourtCheckIssue(issue)}`);
            }
        }
    }
    assert.deepEqual(unexpected, []);
});

test('checkCourtMarkdown: the templates are flagged as unfinished (they still contain 〇〇)', () => {
    const issues = checkCourtMarkdown(fs.readFileSync(path.resolve('src/templates/訴訟.準備書面.md'), 'utf-8'));
    assert.ok(issues.length > 0);
    assert.ok(issues.every(issue => issue.kind === 'placeholder'));
});
