const test = require('node:test');
const assert = require('node:assert/strict');

const { getKatakana, getAlphabet, renumberLines } = require('../dist/src/renumber_markdown.js');

// ─── getKatakana ────────────────────────────────────────────

test('getKatakana: maps 1-based index to correct katakana', () => {
    assert.equal(getKatakana(1), 'ア');
    assert.equal(getKatakana(2), 'イ');
    assert.equal(getKatakana(3), 'ウ');
    assert.equal(getKatakana(4), 'エ');
    assert.equal(getKatakana(5), 'オ');
});

test('getKatakana: returns ? for 0 or negative', () => {
    assert.equal(getKatakana(0), '?');
    assert.equal(getKatakana(-1), '?');
});

test('getKatakana: wraps around after full katakana list', () => {
    // KATAKANA has 46 entries (ア-ン)
    assert.equal(getKatakana(46), 'ン');
    assert.equal(getKatakana(47), 'ア'); // wraps
});

test('getKatakana: mid-range katakana カ行, サ行', () => {
    assert.equal(getKatakana(6), 'カ');
    assert.equal(getKatakana(7), 'キ');
    assert.equal(getKatakana(11), 'サ');
});

// ─── getAlphabet ────────────────────────────────────────────

test('getAlphabet: maps index to lowercase letter', () => {
    assert.equal(getAlphabet(1), 'a');
    assert.equal(getAlphabet(2), 'b');
    assert.equal(getAlphabet(26), 'z');
});

test('getAlphabet: wraps around after z', () => {
    assert.equal(getAlphabet(27), 'a');
    assert.equal(getAlphabet(52), 'z');
});

test('getAlphabet: returns ? for 0 or negative', () => {
    assert.equal(getAlphabet(0), '?');
    assert.equal(getAlphabet(-5), '?');
});

// ─── renumberLines: level 1 (第N) ──────────────────────────

test('renumberLines: renumbers 第N markers', () => {
    const input = ['第5 概要', '第9 詳細'];
    assert.deepEqual(renumberLines(input), ['第1 概要', '第2 詳細']);
});

test('renumberLines: renumbers ## 第N markers', () => {
    const input = ['## 第3 概要', '## 第7 詳細'];
    assert.deepEqual(renumberLines(input), ['## 第1 概要', '## 第2 詳細']);
});

// ─── renumberLines: level 2 (N) ─────────────────────────────

test('renumberLines: renumbers plain numeric markers', () => {
    const input = ['5 項目A', '9 項目B', '3 項目C'];
    assert.deepEqual(renumberLines(input), ['1 項目A', '2 項目B', '3 項目C']);
});

// ─── renumberLines: level 3 ((N)) ───────────────────────────

test('renumberLines: renumbers parenthetical numbers', () => {
    const input = ['(3) 小項目', '(7) 次の小項目'];
    assert.deepEqual(renumberLines(input), ['(1) 小項目', '(2) 次の小項目']);
});

// ─── renumberLines: level 4 (katakana) ──────────────────────

test('renumberLines: renumbers katakana markers', () => {
    const input = ['ウ 三番目', 'エ 四番目'];
    assert.deepEqual(renumberLines(input), ['ア 三番目', 'イ 四番目']);
});

// ─── renumberLines: child counter reset ─────────────────────

test('renumberLines: resets child counters when parent level changes', () => {
    const input = [
        '## 第9 総則',
        '## 9 目的',
        '## (8) 項目',
        '## イ 小項目',
        '通常の本文行',
        '## 4 次項',
        '## (3) 再開',
        '## ア 別の小項目'
    ];
    assert.deepEqual(renumberLines(input), [
        '## 第1 総則',
        '## 1 目的',
        '## (1) 項目',
        '## ア 小項目',
        '通常の本文行',
        '## 2 次項',
        '## (1) 再開',
        '## ア 別の小項目'
    ]);
});

// ─── renumberLines: non-marker lines ────────────────────────

test('renumberLines: preserves non-marker lines unchanged', () => {
    const input = [
        '通常のテキスト',
        '',
        '# 見出し',
        '- リスト項目',
        '> 引用'
    ];
    assert.deepEqual(renumberLines(input), input);
});

// ─── renumberLines: deep nesting ────────────────────────────

test('renumberLines: handles all 7 levels of nesting', () => {
    const input = [
        '第5 大項目',
        '3 中項目',
        '(2) 小項目',
        'ウ カタカナ項目',
        '(エ) カッコカタカナ',
        'c アルファベット',
        '(d) カッコアルファベット'
    ];
    assert.deepEqual(renumberLines(input), [
        '第1 大項目',
        '1 中項目',
        '(1) 小項目',
        'ア カタカナ項目',
        '(ア) カッコカタカナ',
        'a アルファベット',
        '(a) カッコアルファベット'
    ]);
});

// ─── renumberLines: multiple level 1 with resets ────────────

test('renumberLines: multiple 第N sections reset lower counters', () => {
    const input = [
        '第3 第一部',
        '5 項目',
        '(2) 詳細',
        '第7 第二部',
        '9 項目',  // should be 1 again
        '(4) 詳細' // should be 1 again
    ];
    assert.deepEqual(renumberLines(input), [
        '第1 第一部',
        '1 項目',
        '(1) 詳細',
        '第2 第二部',
        '1 項目',
        '(1) 詳細'
    ]);
});

// ─── renumberLines: empty input ─────────────────────────────

test('renumberLines: handles empty array', () => {
    assert.deepEqual(renumberLines([]), []);
});

// ─── renumberLines: suffix with full-width space ────────────

test('renumberLines: handles full-width space after marker', () => {
    const input = ['## 第3\u3000概要'];
    assert.deepEqual(renumberLines(input), ['## 第1\u3000概要']);
});
