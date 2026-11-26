/**
 * 提出前チェック。法匪 Markdown の書面に、出す前に直すべき所が残っていないかを見る（fs を使わない。Web にも入る）。
 *
 * - 【要確認】と、テンプレートの「〇〇」の残り
 * - 証拠説明書の作成年月日が西暦（和暦で書く）
 * - 証拠説明書の号証番号の飛び・重複（番号の列は「1」「2-1」だけで、甲・乙は見出しの「乙号証」にある）
 * - 当事者欄（`### --左` の `- 原告:〇〇`）と差出人欄（`### --右`）の名前の食い違い
 *
 * AI 向けの注意（`<!-- -->`）の中は見ない。行番号は 1 から数える。
 */
import { findWesternDatesInEvidenceTables } from './court_markdown';
import { normalizeEvidenceNumber } from '../lib/ai_archive/inference';

export type CourtCheckKind = 'needs-confirmation' | 'placeholder' | 'western-date' | 'evidence-gap' | 'evidence-duplicate' | 'evidence-order' | 'party-mismatch';

export type CourtCheckIssue = {
    kind: CourtCheckKind;
    message: string;
    /** 問題のある行（1 から数える）。分からなければ null */
    line: number | null;
};

const CHECK_LABELS: Record<CourtCheckKind, string> = {
    'needs-confirmation': '【要確認】の残り',
    placeholder: '〇〇の残り',
    'western-date': '作成年月日が西暦',
    'evidence-gap': '号証番号の飛び',
    'evidence-duplicate': '号証番号の重複',
    'evidence-order': '号証番号の順番',
    'party-mismatch': '当事者名の食い違い',
};

export function getCourtCheckLabel(kind: CourtCheckKind) {
    return CHECK_LABELS[kind] || kind;
}

/**
 * HTML コメントを、行の数を変えずに空白へ置き換える（行番号を保つ）
 */
function blankComments(markdown: string) {
    return String(markdown || '').replace(/<!--[\s\S]*?-->/g, comment => comment.replace(/[^\n]/g, ' '));
}

function toHalfWidth(value: string) {
    return String(value)
        .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
        .replace(/[Ａ-Ｚａ-ｚ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function excerpt(line: string, index: number, length: number) {
    const start = Math.max(0, index - 8);
    const end = Math.min(line.length, index + length + 8);
    return `${start > 0 ? '…' : ''}${line.slice(start, end).trim()}${end < line.length ? '…' : ''}`;
}

// 〇〇・○○（2字以上）と、「令和〇年」「〇月〇日」「第〇号」のような1字の〇。
// 「金一〇〇万円」「二〇二四年」のような漢数字の中の〇は除く（前が漢数字の〇は拾わない）
const PLACEHOLDER_PATTERN = /(?<![一二三四五六七八九十百千〇○])(?:[〇○]{2,}|[〇○](?=[年月日号部条項]))/g;

function findPlaceholders(lines: string[]) {
    const issues: CourtCheckIssue[] = [];
    lines.forEach((line, index) => {
        const confirm = line.indexOf('【要確認】');
        if (confirm >= 0) {
            issues.push({
                kind: 'needs-confirmation',
                line: index + 1,
                message: `【要確認】が残っています（${excerpt(line, confirm, 5)}）。確かめて書き直してください。`,
            });
        }
        const placeholders = [...line.matchAll(PLACEHOLDER_PATTERN)];
        if (placeholders.length > 0) {
            issues.push({
                kind: 'placeholder',
                line: index + 1,
                message: `テンプレートの「〇〇」が残っています（${excerpt(line, placeholders[0].index || 0, placeholders[0][0].length)}）。`,
            });
        }
    });
    return issues;
}

/**
 * Markdown の表の行をセルに分ける。表の行でなければ null。
 */
function splitTableRow(line: string) {
    const m = line.trim().match(/^\|(.*)\|$/);
    return m ? m[1].split('|').map(cell => cell.trim()) : null;
}

type EvidenceEntry = {
    prefix: string;
    main: number;
    branch: number | null;
    label: string;
    line: number;
};

/**
 * 号証番号の見出し（「乙号証」「甲A号証」「乙第号証」）から、甲・乙などの記号を取る
 */
function evidencePrefixFromHeader(header: string) {
    const m = toHalfWidth(header).replace(/\s+/g, '').match(/^([甲乙丙丁戊疎証][A-Z]?)(?:第)?号証/);
    return m ? m[1] : '';
}

/**
 * 番号の列の値を、見出しの記号と合わせて「乙2-1」の形に直し、主番号と枝番に分ける
 */
function parseEvidenceCell(prefix: string, cell: string) {
    let value = toHalfWidth(cell).replace(/\s+/g, '').replace(/[ー－‐−]/g, '-');
    if (!value) return null;
    if (!/^[甲乙丙丁戊疎証]/.test(value)) {
        value = `${prefix}${value}`;
    }
    const normalized = normalizeEvidenceNumber(value).replace(/号証$|号$/, '');
    const m = normalized.match(/^([甲乙丙丁戊疎証][A-Z]?)(?:第)?(\d+)(?:[-の](\d+))?$/);
    if (!m) return null;
    return {
        prefix: m[1],
        main: parseInt(m[2], 10),
        branch: m[3] ? parseInt(m[3], 10) : null,
        label: `${m[1]}${m[2]}${m[3] ? `-${m[3]}` : ''}`,
    };
}

function collectEvidenceEntries(lines: string[]) {
    const entries: EvidenceEntry[] = [];
    let numberCol = -1;
    let prefix = '';
    lines.forEach((line, index) => {
        const cells = splitTableRow(line);
        if (!cells) {
            numberCol = -1;
            return;
        }
        if (cells.some(c => c.includes('号証')) && cells.some(c => c.includes('標目') || c.includes('立証趣旨'))) {
            numberCol = cells.findIndex(c => c.includes('号証'));
            prefix = evidencePrefixFromHeader(cells[numberCol]);
            return;
        }
        if (numberCol < 0 || /^[\s|:-]+$/.test(cells.join('|'))) return;
        const parsed = parseEvidenceCell(prefix, cells[numberCol] || '');
        if (parsed) {
            entries.push({ ...parsed, line: index + 1 });
        }
    });
    return entries;
}

/**
 * 号証番号の飛び・重複・順番を見る。記号（甲・乙・乙A など）ごとに、書面に出てくる順で見る。
 * 最初の番号は 1 でなくてよい（続きの証拠説明書は途中の番号から始まる）。
 */
function findEvidenceNumberIssues(lines: string[]) {
    const issues: CourtCheckIssue[] = [];
    const byPrefix = new Map<string, EvidenceEntry[]>();
    for (const entry of collectEvidenceEntries(lines)) {
        if (!byPrefix.has(entry.prefix)) byPrefix.set(entry.prefix, []);
        byPrefix.get(entry.prefix)!.push(entry);
    }

    for (const [prefix, entries] of byPrefix) {
        const seen = new Map<string, EvidenceEntry>();
        for (const entry of entries) {
            const first = seen.get(entry.label);
            if (first) {
                issues.push({
                    kind: 'evidence-duplicate',
                    line: entry.line,
                    message: `号証番号 ${entry.label} が2回出てきます（${first.line}行目と${entry.line}行目）。`,
                });
            } else {
                seen.set(entry.label, entry);
            }
        }

        // 枝番のある号証と、同じ主番号の枝番のない号証が両方あるのは食い違い
        const mains = new Set(entries.map(entry => entry.main));
        for (const main of mains) {
            const sameMain = entries.filter(entry => entry.main === main);
            const plain = sameMain.find(entry => entry.branch === null);
            const branched = sameMain.find(entry => entry.branch !== null);
            if (plain && branched) {
                issues.push({
                    kind: 'evidence-duplicate',
                    line: branched.line,
                    message: `${prefix}${main} と ${branched.label} が両方あります。枝番を付けるなら ${prefix}${main} にも付けてください。`,
                });
            }
        }

        let previous: EvidenceEntry | null = null;
        for (const entry of entries) {
            if (previous && entry.label !== previous.label) {
                if (entry.main === previous.main) {
                    const expected = (previous.branch ?? 0) + 1;
                    if (entry.branch !== null && entry.branch > expected) {
                        issues.push({
                            kind: 'evidence-gap',
                            line: entry.line,
                            message: `${previous.label} の次が ${entry.label} で、${prefix}${entry.main}-${expected} が抜けています。`,
                        });
                    } else if (entry.branch !== null && previous.branch !== null && entry.branch < previous.branch) {
                        issues.push({
                            kind: 'evidence-order',
                            line: entry.line,
                            message: `${previous.label} の後に ${entry.label} があり、枝番の順番が前後しています。`,
                        });
                    }
                } else if (entry.main > previous.main + 1) {
                    const missing = entry.main - previous.main === 2
                        ? `${prefix}${previous.main + 1}`
                        : `${prefix}${previous.main + 1}〜${prefix}${entry.main - 1}`;
                    issues.push({
                        kind: 'evidence-gap',
                        line: entry.line,
                        message: `${previous.label} の次が ${entry.label} で、${missing} が抜けています。`,
                    });
                } else if (entry.main < previous.main) {
                    issues.push({
                        kind: 'evidence-order',
                        line: entry.line,
                        message: `${previous.label} の後に ${entry.label} があり、号証番号の順番が前後しています。`,
                    });
                }
                if (entry.main !== previous.main && entry.branch !== null && entry.branch > 1) {
                    issues.push({
                        kind: 'evidence-gap',
                        line: entry.line,
                        message: `${entry.label} の前に ${prefix}${entry.main}-1 がありません。`,
                    });
                }
            }
            if (!previous && entry.branch !== null && entry.branch > 1) {
                issues.push({
                    kind: 'evidence-gap',
                    line: entry.line,
                    message: `${entry.label} の前に ${prefix}${entry.main}-1 がありません。`,
                });
            }
            previous = entry;
        }
    }

    return issues.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

type PartyItem = {
    role: string;
    names: string[];
    rawName: string;
    line: number;
};

/**
 * 役割（「被告」「被控訴人（1審原告）」）を比べる形にする。括弧の中と空白を除く。
 */
function normalizeRole(role: string) {
    return role.replace(/[（(][^）)]*[）)]/g, '').replace(/[\s　]+/g, '');
}

function normalizeName(name: string) {
    return toHalfWidth(name).normalize('NFKC').replace(/[\s　]+/g, '');
}

/**
 * `### --左` と `### --右` の囲みの中の `- 役割:名前` を集める
 */
function collectBlockItems(lines: string[]) {
    const left: PartyItem[] = [];
    const right: PartyItem[] = [];
    let block: 'left' | 'right' | null = null;
    lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed === '### --左') { block = 'left'; return; }
        if (trimmed === '### --右') { block = 'right'; return; }
        if (/^###\s*--/.test(trimmed) || /^#{1,2}\s/.test(trimmed)) { block = null; return; }
        if (!block) return;
        const m = trimmed.match(/^[-*]\s+(.+?)[：:](.*)$/);
        if (!m) return;
        const role = normalizeRole(m[1]);
        const rawName = m[2].trim();
        if (!role || !rawName) return;
        const names = rawName.split(/[、，,]|及び/).map(normalizeName).filter(Boolean);
        (block === 'left' ? left : right).push({ role, names, rawName, line: index + 1 });
    });
    return { left, right };
}

/**
 * 当事者欄と差出人欄で、同じ役割（原告・被告・申立人など）の名前が違わないかを見る。
 * どちらかの名前が「〇〇」のままなら比べない（〇〇の残りとして別に出る）。
 */
function findPartyMismatches(lines: string[]) {
    const issues: CourtCheckIssue[] = [];
    const { left, right } = collectBlockItems(lines);
    const partiesByRole = new Map<string, PartyItem[]>();
    for (const item of left) {
        if (!partiesByRole.has(item.role)) partiesByRole.set(item.role, []);
        partiesByRole.get(item.role)!.push(item);
    }

    for (const sender of right) {
        const parties = partiesByRole.get(sender.role);
        if (!parties || /[〇○]/.test(sender.rawName)) continue;
        const partyNames = parties.flatMap(item => item.names);
        if (partyNames.some(name => /[〇○]/.test(name))) continue;
        const unknown = sender.names.filter(name => !partyNames.includes(name));
        if (unknown.length > 0) {
            const partyText = parties.map(item => item.rawName).join('、');
            issues.push({
                kind: 'party-mismatch',
                line: sender.line,
                message: `差出人欄の${sender.role}「${sender.rawName}」が、当事者欄の${sender.role}「${partyText}」（${parties[0].line}行目）と違います。`,
            });
        }
    }
    return issues;
}

/**
 * 提出前チェック。見つかった問題を行の順に返す（問題がなければ空の配列）。
 */
export function checkCourtMarkdown(markdown: string): CourtCheckIssue[] {
    const text = blankComments(markdown);
    const lines = text.split(/\r?\n/);
    const westernDates: CourtCheckIssue[] = [];
    const westernFound = findWesternDatesInEvidenceTables(text);
    if (westernFound.length > 0) {
        // 行番号を付けるため、作成年月日の文字列で行を探す（同じ日付が何行もあれば順に当てる）
        let searchFrom = 0;
        for (const { exhibit, date } of westernFound) {
            let lineIndex = lines.findIndex((line, index) => index >= searchFrom && line.includes(date) && /^\s*\|/.test(line));
            if (lineIndex >= 0) searchFrom = lineIndex + 1;
            westernDates.push({
                kind: 'western-date',
                line: lineIndex >= 0 ? lineIndex + 1 : null,
                message: `証拠説明書の作成年月日が西暦です（${exhibit}: ${date}）。和暦で書いてください。`,
            });
        }
    }

    return [
        ...findPlaceholders(lines),
        ...westernDates,
        ...findEvidenceNumberIssues(lines),
        ...findPartyMismatches(lines),
    ].sort((a, b) => (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER));
}

/**
 * 問題を1行ずつの文にする（CLI の警告、印刷前の確認に使う）
 */
export function formatCourtCheckIssue(issue: CourtCheckIssue) {
    return issue.line ? `${issue.line}行目: ${issue.message}` : issue.message;
}
