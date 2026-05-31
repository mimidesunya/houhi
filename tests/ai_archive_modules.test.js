const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const AdmZip = require('adm-zip');

const {
    extractDateCandidates,
    extractEvidenceNumber,
    inferDocumentKind,
    normalizeEvidenceNumber,
} = require('../dist/src/lib/ai_archive/inference.js');
const {
    buildInstructionStructure,
} = require('../dist/src/lib/ai_archive/instruction_structure_renderer.js');
const {
    buildCaseIndex,
} = require('../dist/src/lib/ai_archive/case_index_renderer.js');
const {
    buildArchiveReadme,
} = require('../dist/src/lib/ai_archive/readme_renderer.js');
const {
    buildStartHere,
} = require('../dist/src/lib/ai_archive/start_here_renderer.js');
const {
    buildWarningsMarkdown,
} = require('../dist/src/lib/ai_archive/warnings_renderer.js');
const {
    buildArchiveManifest,
} = require('../dist/src/lib/ai_archive/manifest.js');
const {
    scanCaseDirectory,
} = require('../dist/src/lib/ai_archive/scanner.js');
const {
    writeAiArchive,
} = require('../dist/src/lib/ai_archive/archive_writer.js');

function createTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-ai-archive-module-'));
}

function cleanup(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

function makeInstruction(displayPath, isCommonRules = false) {
    return {
        archivePath: displayPath,
        displayPath,
        content: Buffer.from('instruction'),
        isCommonRules,
    };
}

test('inference module: extracts evidence number, date candidates, and document kind', () => {
    const text = '# 準備書面\n令和6年1月2日\n契約書（甲1）について';

    assert.equal(extractEvidenceNumber('brief.md', text), '甲1');
    assert.deepEqual(extractDateCandidates('brief.md', text), ['令和6年1月2日']);
    assert.equal(inferDocumentKind('brief.md', text), '準備書面');
});

test('inference module: normalizes legacy evidence number styles', () => {
    assert.equal(normalizeEvidenceNumber('甲第1号証'), '甲1');
    assert.equal(normalizeEvidenceNumber('乙２号証'), '乙2');
    assert.equal(extractEvidenceNumber('brief.md', '確認メール（甲第3号証）'), '甲3');
});

test('scanner module: scans case files and skipped files directly', () => {
    const dir = createTempDir();
    try {
        fs.writeFileSync(path.join(dir, '訴状.md'), '# 訴状\n2026年5月1日');
        fs.writeFileSync(path.join(dir, '添付.pdf'), Buffer.alloc(4));

        const scan = scanCaseDirectory(dir);

        assert.equal(scan.caseRoot, 'case');
        assert.equal(scan.caseFiles.length, 1);
        assert.equal(scan.caseFiles[0].displayPath, 'case/訴状.md');
        assert.equal(scan.caseFiles[0].documentKind, '訴状');
        assert.equal(scan.skippedFiles.length, 1);
        assert.equal(scan.skippedFiles[0].relativePath, '添付.pdf');
    } finally {
        cleanup(dir);
    }
});

test('renderer modules: generate each AI-facing markdown artifact directly', () => {
    const scan = {
        caseRoot: 'case',
        caseFiles: [
            {
                relativePath: '訴状.md',
                displayPath: 'case/訴状.md',
                documentKind: '訴状',
                evidenceNumber: null,
                dateCandidates: ['2026年5月1日'],
                sizeBytes: 1200,
                lineCount: 30,
                warnings: [],
            },
        ],
        skippedFiles: [
            {
                relativePath: 'scan.pdf',
                extension: '.pdf',
                sizeBytes: 10,
                reason: '除外',
            },
        ],
        warnings: [
            {
                path: '(archive)',
                severity: 'info',
                message: '非対象ファイルがあります。',
            },
        ],
    };
    const instructions = [
        makeInstruction('instructions/sample.md', true),
        makeInstruction('instructions/準備書面.md'),
    ];

    assert.ok(buildInstructionStructure(instructions).includes('📄 sample.md'));
    assert.ok(buildStartHere('matter', scan, instructions).includes('事件の事実そのものではありません'));
    assert.ok(buildStartHere('matter', scan, instructions).includes('何を作成・整理しますか'));
    assert.ok(buildCaseIndex('matter', scan).includes('ZIPに含めなかったファイル'));
    assert.ok(buildWarningsMarkdown(scan.warnings).includes('非対象ファイルがあります。'));
    assert.ok(buildArchiveReadme('matter', '📄 訴状.md\n', instructions, scan).includes('START_HERE.md'));
});

test('manifest module: exposes roots, entrypoints, and warning counts', () => {
    const scan = {
        caseRoot: 'case',
        caseFiles: [],
        skippedFiles: [],
        warnings: [],
    };

    const manifest = buildArchiveManifest('matter', scan, []);

    assert.equal(manifest.archiveType, 'houhi-ai-case-archive');
    assert.equal(manifest.roots.caseDocuments, 'case/');
    assert.ok(manifest.entrypoints.includes('START_HERE.md'));
    assert.equal(manifest.counts.warnings, 0);
});

test('archive writer module: writes ZIP with AI entrypoints directly', () => {
    const parentDir = createTempDir();
    try {
        const caseDir = path.join(parentDir, 'matter');
        fs.mkdirSync(caseDir);
        fs.writeFileSync(path.join(caseDir, 'facts.md'), '# facts\n甲1');

        const result = writeAiArchive(caseDir);

        assert.ok(result);
        assert.equal(result.caseFileCount, 1);
        assert.equal(result.skippedFileCount, 0);

        const zip = new AdmZip(result.zipPath);
        const entryNames = zip.getEntries().map(entry => entry.entryName);

        assert.ok(entryNames.includes('case/facts.md'));
        assert.ok(entryNames.includes('START_HERE.md'));
        assert.ok(entryNames.includes('CASE_INDEX.md'));
        assert.ok(entryNames.includes('manifest.json'));
    } finally {
        cleanup(parentDir);
    }
});
