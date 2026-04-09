const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
    buildArchiveReadme,
    getDirectoryStructure,
    hasTargetFiles,
    loadInstructionEntries,
} = require('../dist/src/archive_for_ai.js');

// ─── テスト用一時ディレクトリ ────────────────────────────────

function createTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-test-'));
}

function cleanup(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

// ─── hasTargetFiles ─────────────────────────────────────────

test('hasTargetFiles: returns true for dir with .md file', () => {
    const dir = createTempDir();
    try {
        fs.writeFileSync(path.join(dir, 'test.md'), '# test');
        assert.equal(hasTargetFiles(dir), true);
    } finally {
        cleanup(dir);
    }
});

test('hasTargetFiles: returns true for dir with .txt file', () => {
    const dir = createTempDir();
    try {
        fs.writeFileSync(path.join(dir, 'note.txt'), 'hello');
        assert.equal(hasTargetFiles(dir), true);
    } finally {
        cleanup(dir);
    }
});

test('hasTargetFiles: returns false for empty dir', () => {
    const dir = createTempDir();
    try {
        assert.equal(hasTargetFiles(dir), false);
    } finally {
        cleanup(dir);
    }
});

test('hasTargetFiles: returns false for dir with only non-target files', () => {
    const dir = createTempDir();
    try {
        fs.writeFileSync(path.join(dir, 'image.png'), Buffer.alloc(10));
        fs.writeFileSync(path.join(dir, 'data.json'), '{}');
        assert.equal(hasTargetFiles(dir), false);
    } finally {
        cleanup(dir);
    }
});

test('hasTargetFiles: returns true for nested .md file', () => {
    const dir = createTempDir();
    try {
        const sub = path.join(dir, 'sub');
        fs.mkdirSync(sub);
        fs.writeFileSync(path.join(sub, 'deep.md'), '# deep');
        assert.equal(hasTargetFiles(dir), true);
    } finally {
        cleanup(dir);
    }
});

// ─── getDirectoryStructure ──────────────────────────────────

test('getDirectoryStructure: shows .md files with 📄 emoji', () => {
    const dir = createTempDir();
    try {
        fs.writeFileSync(path.join(dir, 'file.md'), '# test');
        const result = getDirectoryStructure(dir, dir);
        assert.ok(result.includes('📄 file.md'));
    } finally {
        cleanup(dir);
    }
});

test('getDirectoryStructure: shows .txt files with 📄 emoji', () => {
    const dir = createTempDir();
    try {
        fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
        const result = getDirectoryStructure(dir, dir);
        assert.ok(result.includes('📄 notes.txt'));
    } finally {
        cleanup(dir);
    }
});

test('getDirectoryStructure: excludes non-target files', () => {
    const dir = createTempDir();
    try {
        fs.writeFileSync(path.join(dir, 'image.png'), Buffer.alloc(10));
        fs.writeFileSync(path.join(dir, 'doc.md'), '# doc');
        const result = getDirectoryStructure(dir, dir);
        assert.ok(!result.includes('image.png'));
        assert.ok(result.includes('doc.md'));
    } finally {
        cleanup(dir);
    }
});

test('getDirectoryStructure: shows folders with 📁 emoji', () => {
    const dir = createTempDir();
    try {
        const sub = path.join(dir, 'subdir');
        fs.mkdirSync(sub);
        fs.writeFileSync(path.join(sub, 'file.md'), '# hi');
        const result = getDirectoryStructure(dir, dir);
        assert.ok(result.includes('📁 subdir/'));
    } finally {
        cleanup(dir);
    }
});

test('getDirectoryStructure: indents nested items', () => {
    const dir = createTempDir();
    try {
        const sub = path.join(dir, 'nested');
        fs.mkdirSync(sub);
        fs.writeFileSync(path.join(sub, 'inner.md'), '# inner');
        const result = getDirectoryStructure(dir, dir);
        assert.ok(result.includes('  📄 inner.md'));
    } finally {
        cleanup(dir);
    }
});

test('getDirectoryStructure: returns empty for empty dir', () => {
    const dir = createTempDir();
    try {
        const result = getDirectoryStructure(dir, dir);
        assert.equal(result, '');
    } finally {
        cleanup(dir);
    }
});

test('getDirectoryStructure: skips folders without target files', () => {
    const dir = createTempDir();
    try {
        const sub = path.join(dir, 'images');
        fs.mkdirSync(sub);
        fs.writeFileSync(path.join(sub, 'photo.png'), Buffer.alloc(10));
        const result = getDirectoryStructure(dir, dir);
        assert.ok(!result.includes('images'));
    } finally {
        cleanup(dir);
    }
});

// ─── instructions の収集 ────────────────────────────────────

test('loadInstructionEntries: loads files from instructions directory when present', () => {
    const dir = createTempDir();
    try {
        fs.writeFileSync(path.join(dir, 'package.json'), '{}');
        fs.mkdirSync(path.join(dir, 'instructions', 'nested'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'instructions', 'sample.md'), '# common rules');
        fs.writeFileSync(path.join(dir, 'instructions', 'nested', 'memo.txt'), 'nested note');

        const entries = loadInstructionEntries([dir]);

        assert.deepEqual(
            entries.map(entry => entry.displayPath),
            [
                'instructions/sample.md',
                'instructions/nested/memo.txt',
            ]
        );
        assert.equal(entries[0].content.toString('utf-8'), '# common rules');
        assert.equal(entries[1].content.toString('utf-8'), 'nested note');
    } finally {
        cleanup(dir);
    }
});

test('loadInstructionEntries: returns empty when instructions directory is missing', () => {
    const dir = createTempDir();
    try {
        fs.writeFileSync(path.join(dir, 'package.json'), '{}');

        const entries = loadInstructionEntries([dir]);

        assert.deepEqual(entries, []);
    } finally {
        cleanup(dir);
    }
});

// ─── README 生成 ───────────────────────────────────────────

test('buildArchiveReadme: mentions drafting references and lists instruction files', () => {
    const readme = buildArchiveReadme('case', '📄 facts.md\n', [
        {
            archivePath: 'instructions/sample.md',
            displayPath: 'instructions/sample.md',
            content: Buffer.from('sample'),
            isCommonRules: true,
        },
        {
            archivePath: 'instructions/準備書面.md',
            displayPath: 'instructions/準備書面.md',
            content: Buffer.from('brief'),
            isCommonRules: false,
        },
    ]);

    assert.ok(readme.includes('reference material when drafting court documents'));
    assert.ok(readme.includes('Start with `instructions/sample.md`'));
    assert.ok(readme.includes('- `instructions/sample.md`'));
    assert.ok(readme.includes('- `instructions/準備書面.md`'));
});
