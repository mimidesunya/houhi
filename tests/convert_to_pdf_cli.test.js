const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseArgs } = require('../dist/src/convert_to_pdf.js');

test('convert_to_pdf: does not open the PDF unless --open is given', () => {
    assert.deepEqual(parseArgs(['--copper', '書面.md']), {
        files: ['書面.md'],
        pdfOptions: { engine: 'copper' },
        openOutput: false,
        help: false
    });
    assert.equal(parseArgs(['--open', '書面.md']).openOutput, true);
    assert.equal(parseArgs(['--open', '--no-open', '書面.md']).openOutput, false);
    assert.deepEqual(parseArgs(['--no-open', '書面.md']).files, ['書面.md']);
});

test('convert_to_pdf: --open does not disturb the engine flags', () => {
    const parsed = parseArgs(['--pdf-engine=chrome', '--open', 'a.md', 'b.md']);
    assert.deepEqual(parsed.pdfOptions, { engine: 'chrome' });
    assert.deepEqual(parsed.files, ['a.md', 'b.md']);
    assert.equal(parsed.openOutput, true);
});

test('GUI: keeps opening the PDF after PDF作成 by passing --open', () => {
    const renderer = fs.readFileSync(path.resolve('src/gui/renderer.ts'), 'utf-8');
    assert.match(renderer, /if \(currentScript === 'pdf'\) \{[\s\S]*?opts\.push\('--open'\)/);
});
