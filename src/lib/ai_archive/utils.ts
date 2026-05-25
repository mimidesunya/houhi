import * as path from 'path';

/**
 * AI に渡す資料として収録する対象ファイルか判定する。
 * 画像や PDF などの重いバイナリは除外し、本文を直接読める Markdown / text に限定する。
 */
export function isTargetTextFile(filePath: string) {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.md' || ext === '.txt';
}

/**
 * 指示書や資料名を並べるための比較関数。
 * `sample.md` は共通ルールなので、常に先頭に出して AI が最初に参照しやすくする。
 */
export function compareInstructionNames(a: string, b: string) {
    if (a === 'sample.md') return -1;
    if (b === 'sample.md') return 1;
    return a.localeCompare(b, 'ja');
}

/**
 * `dir/file.md` のようなパスを階層ごとに比較する。
 * 単純な文字列比較だと親子関係や `sample.md` の優先順位が崩れやすいため、
 * パスを `/` で分解して、各階層で同じ並び規則を適用する。
 */
export function compareInstructionPaths(a: string, b: string) {
    const aParts = a.split('/');
    const bParts = b.split('/');
    const maxLength = Math.max(aParts.length, bParts.length);

    for (let i = 0; i < maxLength; i++) {
        const aPart = aParts[i];
        const bPart = bParts[i];

        if (aPart == null) return -1;
        if (bPart == null) return 1;
        if (aPart === bPart) continue;

        return compareInstructionNames(aPart, bPart);
    }

    return 0;
}

export function normalizeArchivePath(filePath: string) {
    return filePath.replace(/\\/g, '/');
}

export function getUtf8Text(content: Buffer) {
    return content.toString('utf-8');
}

export function countLines(text: string) {
    if (text.length === 0) {
        return 0;
    }

    return text.split(/\r\n|\r|\n/).length;
}

export function uniqueLimited(values: string[], limit: number) {
    const result: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
        const normalizedValue = value.replace(/\s+/g, '');
        if (seen.has(normalizedValue)) continue;

        seen.add(normalizedValue);
        result.push(value.trim());
        if (result.length >= limit) break;
    }

    return result;
}

export function formatBytes(sizeBytes: number) {
    if (sizeBytes < 1024) {
        return `${sizeBytes} B`;
    }

    if (sizeBytes < 1024 * 1024) {
        return `${(sizeBytes / 1024).toFixed(1)} KB`;
    }

    return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

export function escapeMarkdownTableCell(value: string | number | null | undefined) {
    if (value == null || value === '') {
        return '-';
    }

    return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
