const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const AdmZip = require('adm-zip');

const {
    buildArchiveManifest,
    buildArchiveReadme,
    buildCaseIndex,
    buildStartHere,
    buildWarningsMarkdown,
    getDirectoryStructure,
    hasTargetFiles,
    loadInstructionEntries,
    scanCaseDirectory,
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

test('loadInstructionEntries: expands houhi-drafting-kit.zip when present', () => {
    const dir = createTempDir();
    try {
        fs.writeFileSync(path.join(dir, 'package.json'), '{}');
        const zip = new AdmZip();
        zip.addFile('sample.md', Buffer.from('# common rules'));
        zip.addFile('nested/memo.txt', Buffer.from('nested note'));
        zip.writeZip(path.join(dir, 'houhi-drafting-kit.zip'));

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

test('loadInstructionEntries: prefers houhi-drafting-kit.zip over legacy directory', () => {
    const dir = createTempDir();
    try {
        fs.writeFileSync(path.join(dir, 'package.json'), '{}');
        fs.mkdirSync(path.join(dir, 'instructions'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'instructions', 'sample.md'), '# legacy rules');

        const zip = new AdmZip();
        zip.addFile('sample.md', Buffer.from('# zipped rules'));
        zip.writeZip(path.join(dir, 'houhi-drafting-kit.zip'));

        const entries = loadInstructionEntries([dir]);

        assert.equal(entries.length, 1);
        assert.equal(entries[0].displayPath, 'instructions/sample.md');
        assert.equal(entries[0].content.toString('utf-8'), '# zipped rules');
    } finally {
        cleanup(dir);
    }
});

test('loadInstructionEntries: still accepts legacy instructions.zip', () => {
    const dir = createTempDir();
    try {
        fs.writeFileSync(path.join(dir, 'package.json'), '{}');
        const zip = new AdmZip();
        zip.addFile('sample.md', Buffer.from('# legacy zip rules'));
        zip.writeZip(path.join(dir, 'instructions.zip'));

        const entries = loadInstructionEntries([dir]);

        assert.equal(entries.length, 1);
        assert.equal(entries[0].displayPath, 'instructions/sample.md');
        assert.equal(entries[0].content.toString('utf-8'), '# legacy zip rules');
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

// ─── AIアーカイブ用メタデータ ───────────────────────────────

test('scanCaseDirectory: stores case documents under case root and records skipped files', () => {
    const dir = createTempDir();
    try {
        fs.writeFileSync(path.join(dir, '訴状.md'), '# 訴状\n2026年5月1日\n甲1の説明');
        fs.mkdirSync(path.join(dir, 'evidence'));
        fs.writeFileSync(path.join(dir, 'evidence', '甲1_契約書.txt'), '令和6年1月2日 契約書');
        fs.writeFileSync(path.join(dir, 'evidence', 'photo.png'), Buffer.alloc(10));

        const scan = scanCaseDirectory(dir);

        assert.equal(scan.caseRoot, 'case');
        assert.equal(scan.caseFiles.length, 2);
        assert.ok(scan.caseFiles.every(file => file.displayPath.startsWith('case/')));
        assert.ok(scan.caseFiles.some(file => file.displayPath === 'case/訴状.md'));
        assert.ok(scan.caseFiles.some(file => file.evidenceNumber === '甲1'));
        assert.equal(scan.skippedFiles.length, 1);
        assert.equal(scan.skippedFiles[0].relativePath, 'evidence/photo.png');
        assert.ok(scan.warnings.some(warning => warning.message.includes('ZIPに含めていません')));
    } finally {
        cleanup(dir);
    }
});

test('buildStartHere: separates case documents from drafting instructions', () => {
    const dir = createTempDir();
    try {
        fs.writeFileSync(path.join(dir, 'facts.md'), '# facts');
        const scan = scanCaseDirectory(dir);
        const startHere = buildStartHere('matter', scan, [
            {
                archivePath: 'instructions/sample.md',
                displayPath: 'instructions/sample.md',
                content: Buffer.from('sample'),
                isCommonRules: true,
            },
        ]);

        assert.ok(startHere.includes('case/'));
        assert.ok(startHere.includes('instructions/'));
        assert.ok(startHere.includes('事件の事実そのものではありません'));
        assert.ok(startHere.includes('ユーザーから具体的な指示がない場合'));
        assert.ok(startHere.includes('次に取れる手'));
    } finally {
        cleanup(dir);
    }
});

test('buildCaseIndex: includes file metadata and skipped-file section', () => {
    const dir = createTempDir();
    try {
        fs.writeFileSync(path.join(dir, '甲1_契約書.txt'), '2024-01-02 contract');
        fs.writeFileSync(path.join(dir, 'scan.pdf'), Buffer.alloc(10));

        const scan = scanCaseDirectory(dir);
        const index = buildCaseIndex('matter', scan);

        assert.ok(index.includes('case/甲1_契約書.txt'));
        assert.ok(index.includes('甲1'));
        assert.ok(index.includes('2024-01-02'));
        assert.ok(index.includes('ZIPに含めなかったファイル'));
        assert.ok(index.includes('scan.pdf'));
    } finally {
        cleanup(dir);
    }
});

test('buildArchiveManifest: returns machine-readable counts and entrypoints', () => {
    const dir = createTempDir();
    try {
        fs.writeFileSync(path.join(dir, 'short.md'), 'x');
        const scan = scanCaseDirectory(dir);
        const manifest = buildArchiveManifest('matter', scan, []);

        assert.equal(manifest.archiveType, 'houhi-ai-case-archive');
        assert.equal(manifest.roots.caseDocuments, 'case/');
        assert.equal(manifest.counts.caseFiles, 1);
        assert.ok(manifest.entrypoints.includes('START_HERE.md'));
        assert.ok(manifest.entrypoints.includes('WARNINGS.md'));
        assert.equal(manifest.files[0].path, 'case/short.md');
        assert.ok(manifest.files[0].warnings.length > 0);
    } finally {
        cleanup(dir);
    }
});

test('buildWarningsMarkdown: renders warning table only when warnings exist', () => {
    assert.equal(buildWarningsMarkdown([]), '');

    const markdown = buildWarningsMarkdown([
        {
            path: 'case/empty.md',
            severity: 'warning',
            message: '空ファイルです。',
        },
    ]);

    assert.ok(markdown.includes('WARNINGS'));
    assert.ok(markdown.includes('case/empty.md'));
    assert.ok(markdown.includes('空ファイルです。'));
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

// ─── CLI ZIP 生成 ─────────────────────────────────────────

test('CLI archive: writes case root, AI entrypoints, manifest, and warnings', () => {
    const parentDir = createTempDir();
    try {
        const caseDir = path.join(parentDir, 'matter');
        fs.mkdirSync(caseDir);
        fs.writeFileSync(path.join(caseDir, 'facts.md'), '# facts\n甲1');
        fs.writeFileSync(path.join(caseDir, 'photo.png'), Buffer.alloc(10));

        const output = execFileSync(
            process.execPath,
            [path.join(process.cwd(), 'dist', 'src', 'archive_for_ai.js'), caseDir],
            { cwd: process.cwd(), stdio: 'pipe' }
        ).toString('utf-8');

        const zip = new AdmZip(path.join(parentDir, 'matter.zip'));
        const entryNames = zip.getEntries().map(entry => entry.entryName);

        assert.ok(output.includes('1 個のファイルを収録しました。'));
        assert.ok(!output.includes('ZIP を作成中'));
        assert.ok(output.includes('ChatGPTで使う場合'));
        assert.ok(output.includes('START_HERE.md と CASE_INDEX.md'));
        assert.ok(output.includes('何をしてほしいか'));
        assert.ok(entryNames.includes('case/facts.md'));
        assert.ok(!entryNames.includes('facts.md'));
        assert.ok(entryNames.includes('START_HERE.md'));
        assert.ok(entryNames.includes('CASE_INDEX.md'));
        assert.ok(entryNames.includes('manifest.json'));
        assert.ok(entryNames.includes('README.md'));
        assert.ok(entryNames.includes('WARNINGS.md'));

        const manifest = JSON.parse(zip.readAsText('manifest.json'));
        assert.equal(manifest.counts.caseFiles, 1);
        assert.equal(manifest.counts.skippedFiles, 1);
        assert.equal(manifest.files[0].path, 'case/facts.md');
    } finally {
        cleanup(parentDir);
    }
});
