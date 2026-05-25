import type { CaseArchiveScan, CaseFileEntry } from './types';
import { compareInstructionPaths, escapeMarkdownTableCell, formatBytes } from './utils';

function getReadingPriority(file: CaseFileEntry) {
    const kind = file.documentKind;
    if (/訴状|答弁書|準備書面|控訴|上告/.test(kind)) return 10;
    if (/証拠説明書/.test(kind)) return 20;
    if (/告訴状|行政手続書面|申立書/.test(kind)) return 25;
    if (/反訳書/.test(kind)) return 30;
    if (/証拠資料/.test(kind)) return 40;
    if (/メモ/.test(kind)) return 50;
    return 60;
}

export function buildCaseIndex(caseName: string, scan: CaseArchiveScan) {
    const sortedFiles = [...scan.caseFiles].sort((a, b) => {
        const priorityDiff = getReadingPriority(a) - getReadingPriority(b);
        if (priorityDiff !== 0) return priorityDiff;
        return compareInstructionPaths(a.relativePath, b.relativePath);
    });

    const readingOrder = sortedFiles
        .map((file, index) => {
            const evidence = file.evidenceNumber ? ` / 証拠番号: ${file.evidenceNumber}` : '';
            const dates = file.dateCandidates.length > 0 ? ` / 日付候補: ${file.dateCandidates.join(', ')}` : '';
            return `${index + 1}. \`${file.displayPath}\` - ${file.documentKind}${evidence}${dates}`;
        })
        .join('\n');

    const fileRows = scan.caseFiles
        .map(file => {
            return `| \`${escapeMarkdownTableCell(file.displayPath)}\` | ${escapeMarkdownTableCell(file.documentKind)} | ${escapeMarkdownTableCell(file.evidenceNumber)} | ${escapeMarkdownTableCell(file.dateCandidates.join(', '))} | ${escapeMarkdownTableCell(formatBytes(file.sizeBytes))} | ${escapeMarkdownTableCell(file.lineCount)} | ${escapeMarkdownTableCell(file.warnings.length > 0 ? file.warnings.join('<br>') : '')} |`;
        })
        .join('\n');

    const skippedSection = scan.skippedFiles.length > 0
        ? `
## ZIPに含めなかったファイル

このツールは \`.md\` / \`.txt\` だけをAI用本文資料として収録します。以下のファイルは元フォルダに存在しましたが、ZIPには含めていません。

| 元パス | 拡張子 | サイズ | 理由 |
| --- | --- | ---: | --- |
${scan.skippedFiles.map(file => `| \`${escapeMarkdownTableCell(file.relativePath)}\` | ${escapeMarkdownTableCell(file.extension || '(なし)')} | ${escapeMarkdownTableCell(formatBytes(file.sizeBytes))} | ${escapeMarkdownTableCell(file.reason)} |`).join('\n')}
`
        : '';

    return `# CASE_INDEX - 事件資料目録

元フォルダ名: \`${caseName}\`

## 読み方

- 事件の事実関係は \`${scan.caseRoot}/\` 配下のファイルから把握してください。
- \`instructions/\` は起案用の参照資料であり、事件資料ではありません。
- 下記の種別、証拠番号、日付候補はファイル名と本文冒頭からの自動推定です。必要に応じて本文で確認してください。

## 推奨読解順

${readingOrder || '- 事件資料ファイルがありません。'}

## 事件資料一覧

| パス | 推定種別 | 証拠番号 | 日付候補 | サイズ | 行数 | 注意 |
| --- | --- | --- | --- | ---: | ---: | --- |
${fileRows || '| - | - | - | - | - | - | - |'}
${skippedSection}
`;
}
