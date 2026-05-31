import { LARGE_TEXT_FILE_BYTES, MAX_DATE_CANDIDATES, VERY_SHORT_TEXT_CHARS } from './constants';
import { getPathBasename, getPathExtname, uniqueLimited } from './utils';

function toHalfWidthDigits(value: string) {
    return value.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

export function normalizeEvidenceNumber(value: string) {
    const compact = toHalfWidthDigits(value.replace(/\s+/g, ''));
    const match = compact.match(/^([甲乙丙丁戊疎証])(?:第)?([0-9]+(?:[-ー－の][0-9]+)?)(?:号証|号)?$/);
    if (!match) {
        return compact;
    }

    return `${match[1]}${match[2].replace(/[ー－]/g, '-')}`;
}

export function extractEvidenceNumber(relativePath: string, text: string) {
    const searchText = `${relativePath}\n${text.slice(0, 2000)}`;
    const match = searchText.match(/(?:^|[\/\s_\-（(])([甲乙丙丁戊疎証]\s*(?:第\s*)?[0-9０-９]+(?:\s*(?:-|ー|－|の)\s*[0-9０-９]+)?\s*(?:号証|号)?)/);
    if (!match) {
        return null;
    }

    return normalizeEvidenceNumber(match[1]);
}

export function extractDateCandidates(relativePath: string, text: string) {
    const searchText = `${relativePath}\n${text.slice(0, 4000)}`;
    const patterns = [
        /\b\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}\b/g,
        /\b\d{4}年\s*\d{1,2}月\s*\d{1,2}日/g,
        /(?:令和|平成|昭和)\s*\d{1,2}年\s*\d{1,2}月\s*\d{1,2}日/g,
    ];

    const candidates: string[] = [];
    for (const pattern of patterns) {
        for (const match of searchText.matchAll(pattern)) {
            candidates.push(match[0]);
        }
    }

    return uniqueLimited(candidates, MAX_DATE_CANDIDATES);
}

export function inferDocumentKind(relativePath: string, text: string) {
    const searchText = `${relativePath}\n${text.slice(0, 1200)}`;
    const patterns: Array<[string, RegExp]> = [
        ['訴状', /訴状/],
        ['答弁書', /答弁書/],
        ['準備書面', /準備書面/],
        ['証拠説明書', /証拠説明書|証拠目録/],
        ['反訳書', /反訳書|反訳|文字起こし/],
        ['告訴状', /告訴状/],
        ['送付書', /送付書/],
        ['期日請書', /期日請書/],
        ['控訴理由書', /控訴理由書/],
        ['控訴状', /控訴状/],
        ['上告理由書', /上告理由書/],
        ['上告状', /上告状|上告受理申立/],
        ['移送申立書', /移送申立/],
        ['忌避申立書', /忌避申立/],
        ['行政手続書面', /開示請求|審査請求|反論書/],
        ['メモ', /メモ|memo|note/i],
    ];

    for (const [kind, pattern] of patterns) {
        if (pattern.test(searchText)) {
            return kind;
        }
    }

    if (extractEvidenceNumber(relativePath, text)) {
        return '証拠資料';
    }

    return getPathExtname(relativePath).toLowerCase() === '.md' ? 'Markdown資料' : 'テキスト資料';
}

export function buildFileWarnings(relativePath: string, content: Buffer, text: string) {
    const warnings: string[] = [];
    const trimmedText = text.trim();

    if (content.length === 0 || trimmedText.length === 0) {
        warnings.push('空ファイル、または本文が空白のみです。AI が内容を把握できません。');
    } else if (trimmedText.length < VERY_SHORT_TEXT_CHARS) {
        warnings.push('本文が非常に短いため、OCR漏れや未完成ファイルの可能性があります。');
    }

    if (content.length > LARGE_TEXT_FILE_BYTES) {
        warnings.push('長大なテキストです。AI が一度に読み切れない場合は、このファイルを分割して確認してください。');
    }

    if (text.includes('\uFFFD')) {
        warnings.push('文字化けの可能性があります。UTF-8として読めない文字が含まれているようです。');
    }

    if (getPathBasename(relativePath).trim().length === 0) {
        warnings.push('ファイル名が空白に見えます。参照時に取り違えないよう注意してください。');
    }

    return warnings;
}
