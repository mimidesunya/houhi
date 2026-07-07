export const VIRTUAL_TEAM_INSTRUCTION_FILE_NAME = '仮想チーム構成.md';
export const VIRTUAL_TEAM_INSTRUCTION_ARCHIVE_PATH = `instructions/${VIRTUAL_TEAM_INSTRUCTION_FILE_NAME}`;
export const VIRTUAL_TEAM_INSTRUCTION_DOC_PATH_PARTS = ['docs', VIRTUAL_TEAM_INSTRUCTION_FILE_NAME];
const AI_ARCHIVE_SECTION_HEADING = '## AIアーカイブで使う場合';

function normalizeNewlines(value: string) {
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function extractMarkdownSection(markdown: string, heading: string) {
    const lines = normalizeNewlines(markdown).split('\n');
    const startIndex = lines.findIndex(line => line.trim() === heading);
    if (startIndex < 0) {
        return null;
    }

    const sectionLines: string[] = [];
    for (let index = startIndex + 1; index < lines.length; index++) {
        const line = lines[index];
        if (/^##\s+/.test(line.trim())) {
            break;
        }
        sectionLines.push(line);
    }

    return sectionLines.join('\n').trim();
}

export function buildVirtualTeamArchiveInstructionContent(sourceContent: Buffer | string) {
    const sourceText = Buffer.isBuffer(sourceContent) ? sourceContent.toString('utf-8') : String(sourceContent);
    const archiveSection = extractMarkdownSection(sourceText, AI_ARCHIVE_SECTION_HEADING);
    if (!archiveSection) {
        return Buffer.from(`${normalizeNewlines(sourceText).trim()}\n`, 'utf-8');
    }

    return Buffer.from(`# 仮想チーム構成\n\n${archiveSection}\n`, 'utf-8');
}

export function buildVirtualTeamStartHereSection() {
    return `## 仮想チームで処理する場合

ユーザーが「この訴訟フォルダで仮想チームを結成して」「この訴訟フォルダでAIエージェントによる仮想チームを結成して」「法匪で整理して」「この訴訟フォルダを整理して」など、チーム作業又はフォルダ整理を依頼している場合は、まず \`${VIRTUAL_TEAM_INSTRUCTION_ARCHIVE_PATH}\` を読んでください。

このファイルが、AIアーカイブでの仮想チーム構成と担当別出力の扱いを定義する一次指示です。AIアーカイブは整理済み資料として扱い、OCR、文書ごとの分割・結合、フォルダ作成、フォルダ振り分けは完了済み又は別工程で扱う前提です。Chat AI が作成するのは Markdown までであり、PDF 作成、号証スタンプ、PDF 結合、FAX 向け PDF 化は HOUHI（https://github.com/mimidesunya/houhi）で行う前提です。ユーザー環境に HOUHI がない場合は、HOUHI のセットアップを促してください。
`;
}
