const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');

const { buildStoredZip } = require('../dist/src/web/zip.js');

test('buildStoredZip: creates a readable UTF-8 zip archive', () => {
    const encoder = new TextEncoder();
    const bytes = buildStoredZip([
        {
            path: 'case/訴状.md',
            data: encoder.encode('# 訴状\n本文'),
        },
        {
            path: 'START_HERE.md',
            data: encoder.encode('まず読む'),
        },
    ]);

    const zip = new AdmZip(Buffer.from(bytes));
    const entryNames = zip.getEntries().map(entry => entry.entryName);

    assert.deepEqual(entryNames, ['case/訴状.md', 'START_HERE.md']);
    assert.equal(zip.readAsText('case/訴状.md'), '# 訴状\n本文');
    assert.equal(zip.readAsText('START_HERE.md'), 'まず読む');
});
