const test = require('node:test');
const assert = require('node:assert/strict');

const { getKatakana, getAlphabet, renumberLines } = require('../dist/src/renumber_markdown.js');

test('katakana and alphabet helpers map indexes predictably', () => {
    assert.equal(getKatakana(1), 'ア');
    assert.equal(getKatakana(2), 'イ');
    assert.equal(getKatakana(3), 'ウ');
    assert.equal(getKatakana(0), '?');

    assert.equal(getAlphabet(1), 'a');
    assert.equal(getAlphabet(26), 'z');
    assert.equal(getAlphabet(27), 'a');
});

test('renumberLines renumbers nested legal markdown markers and resets child counters', () => {
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

    const actual = renumberLines(input);

    assert.deepEqual(actual, [
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
