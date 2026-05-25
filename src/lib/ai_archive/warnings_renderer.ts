import type { ArchiveWarning } from './types';
import { escapeMarkdownTableCell } from './utils';

export function buildWarningsMarkdown(warnings: ArchiveWarning[]) {
    if (warnings.length === 0) {
        return '';
    }

    const rows = warnings
        .map(warning => `| ${escapeMarkdownTableCell(warning.severity)} | \`${escapeMarkdownTableCell(warning.path)}\` | ${escapeMarkdownTableCell(warning.message)} |`)
        .join('\n');

    return `# WARNINGS - AI読み込み時の注意

以下は、AIがアーカイブを読むときに注意すべき点です。警告があるファイルは、内容の欠落、文字化け、長大化、または参照時の取り違えに注意してください。

| 種別 | パス | 内容 |
| --- | --- | --- |
${rows}
`;
}
