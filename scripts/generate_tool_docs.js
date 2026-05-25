const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const srcDir = path.join(repoRoot, 'src');
const outputPath = path.join(repoRoot, 'docs', 'ツール詳細.md');

const DISPLAY_NAMES = {
    archive_for_ai: 'AIアーカイブ',
    convert_to_pdf: 'PDF変換',
    fax_prepare_pdf: 'FAX PDF化',
    fax_send: 'mfax FAX送信',
    stamp_evidence_number: '号証スタンプ'
};

const ORDER = [
    'convert_to_pdf',
    'archive_for_ai',
    'stamp_evidence_number',
    'fax_send',
    'fax_prepare_pdf'
];

function extractLeadingComment(source) {
    const match = source.match(/^\s*\/\*\*([\s\S]*?)\*\//);
    if (!match) {
        return '説明コメントが見つかりません。';
    }

    const lines = match[1]
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*\* ?/, '').replace(/\s+$/, ''));

    while (lines.length > 0 && lines[0] === '') lines.shift();
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    return lines.join('\n');
}

function buildSection(fileName) {
    const baseName = path.basename(fileName, '.ts');
    const displayName = DISPLAY_NAMES[baseName] || fileName;
    const filePath = path.join(srcDir, fileName);
    const relSourcePath = `src/${fileName}`;
    const source = fs.readFileSync(filePath, 'utf8');
    const comment = extractLeadingComment(source);

    return [
        `## ${displayName}`,
        '',
        `- ソース: [${relSourcePath}](../${relSourcePath})`,
        '',
        comment,
        ''
    ].join('\n');
}

function main() {
    const files = fs.readdirSync(srcDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
        .map((entry) => entry.name);

    const orderedFiles = ORDER
        .filter((name) => files.includes(`${name}.ts`))
        .map((name) => `${name}.ts`);

    const remainingFiles = files
        .filter((file) => !orderedFiles.includes(file))
        .sort((a, b) => a.localeCompare(b, 'ja'));

    const sections = [...orderedFiles, ...remainingFiles].map(buildSection);

    const content = [
        '# ツール詳細',
        '',
        'この文書は `src/` 直下ツールの先頭コメントから自動生成しています。',
        '更新するには `npm run docs:tools` を実行してください。',
        '',
        ...sections
    ].join('\n');

    fs.writeFileSync(outputPath, content, 'utf8');
    console.log(`[成功] ツール詳細を生成しました: ${outputPath}`);
}

main();
