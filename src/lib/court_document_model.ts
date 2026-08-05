export type CourtTextRun = {
    type: 'text';
    text: string;
    underline?: boolean;
    rubyText?: string;
};

export type CourtLineBreakRun = {
    type: 'break';
};

export type CourtInlineRun = CourtTextRun | CourtLineBreakRun;

export type CourtParagraphBlock = {
    type: 'paragraph';
    runs: CourtInlineRun[];
    kind?: 'body' | 'bullet' | 'title' | 'heading' | 'date' | 'destination' | 'end' | 'center' | 'blank' | 'separator' | 'break';
    alignment?: 'left' | 'center' | 'right' | 'justify';
    indentLevel?: number;
    firstLineIndent?: boolean;
    headingLevel?: number;
    pageBreakBefore?: boolean;
};

export type CourtTableCell = {
    runs: CourtInlineRun[];
    header?: boolean;
};

export type CourtTableBlock = {
    type: 'table';
    rows: CourtTableCell[][];
    headerRow?: boolean;
    evidence?: boolean;
    attachment?: boolean;
    alignment?: 'left' | 'right';
};

export type CourtImageBlock = {
    type: 'image';
    source: string;
    alt: string;
};

export type CourtTocBlock = {
    type: 'toc';
};

export type CourtDocumentBlock = CourtParagraphBlock | CourtTableBlock | CourtImageBlock | CourtTocBlock;

export type CourtDocumentModel = {
    title: string;
    compactFont: boolean;
    blocks: CourtDocumentBlock[];
};

const INLINE_SENTINELS = {
    plus: '\uE000',
    pipe: '\uE001',
    open: '\uE002',
    close: '\uE003'
};

function restoreEscapedInlineText(value: string) {
    return value
        .replaceAll(INLINE_SENTINELS.plus, '++')
        .replaceAll(INLINE_SENTINELS.pipe, '｜')
        .replaceAll(INLINE_SENTINELS.open, '《')
        .replaceAll(INLINE_SENTINELS.close, '》');
}

export function parseCourtInline(value: string): CourtInlineRun[] {
    const source = String(value || '')
        .replace(/\\\+\+/g, INLINE_SENTINELS.plus)
        .replace(/\\｜/g, INLINE_SENTINELS.pipe)
        .replace(/\\《/g, INLINE_SENTINELS.open)
        .replace(/\\》/g, INLINE_SENTINELS.close);
    const runs: CourtInlineRun[] = [];
    const tokenRegex = /<br\s*\/?>|\+\+([\s\S]+?)\+\+|｜([^《\r\n]+?)《([^》\r\n]+?)》/gi;
    let cursor = 0;
    let match: RegExpExecArray | null;

    const pushText = (text: string, underline = false, rubyText?: string) => {
        const restored = restoreEscapedInlineText(text);
        if (!restored) return;
        const run: CourtTextRun = { type: 'text', text: restored };
        if (underline) run.underline = true;
        if (rubyText !== undefined) run.rubyText = rubyText;
        runs.push(run);
    };

    while ((match = tokenRegex.exec(source)) !== null) {
        pushText(source.slice(cursor, match.index));
        if (/^<br/i.test(match[0])) {
            runs.push({ type: 'break' });
        } else if (match[1] !== undefined) {
            pushText(match[1], true);
        } else {
            pushText(match[2], false, restoreEscapedInlineText(match[3]));
        }
        cursor = match.index + match[0].length;
    }
    pushText(source.slice(cursor));
    return runs;
}

function stripHtmlComments(markdown: string) {
    return String(markdown || '').replace(/<!--[\s\S]*?-->/g, '');
}

function getLevelInfo(line: string) {
    const markers = [
        { level: 1, regex: /^#*\s*(第[0-9０-９]+)[　\s]/ },
        { level: 2, regex: /^#*\s*([0-9０-９]+)[　\s]/ },
        { level: 3, regex: /^#*\s*(\([0-9０-９]+\))[　\s]/ },
        { level: 4, regex: /^#*\s*([ア-ン])[　\s]/ },
        { level: 5, regex: /^#*\s*(\([ア-ン]\))[　\s]/ },
        { level: 6, regex: /^#*\s*([a-z])[　\s]/i },
        { level: 7, regex: /^#*\s*(\([a-z]\))[　\s]/i }
    ];

    for (const marker of markers) {
        const match = line.match(marker.regex);
        if (match) return { level: marker.level, marker: match[1] };
    }
    return null;
}

function paragraph(
    text: string,
    options: Omit<CourtParagraphBlock, 'type' | 'runs'> = {}
): CourtParagraphBlock {
    return {
        type: 'paragraph',
        runs: parseCourtInline(text),
        kind: 'body',
        alignment: 'justify',
        firstLineIndent: true,
        ...options
    };
}

function parsePipeCells(line: string) {
    const trimmed = line.trim();
    return trimmed.slice(1, -1).split('|').map(cell => cell.trim());
}

function isPipeSeparator(line: string) {
    const trimmed = line.trim();
    return /^\|[\s|:-]+\|$/.test(trimmed);
}

function isDateLine(text: string) {
    return /^(?:(?:令和|平成|昭和|大正|明治)\s*(?:[0-9０-９]{1,2}|[元〇○一二三四五六七八九十]{1,3})|[0-9０-９]{1,4})\s*年\s*(?:[0-9０-９]{1,2}|[〇○一二三四五六七八九十]{1,3})\s*月\s*(?:[0-9０-９]{1,2}|[元〇○一二三四五六七八九十]{1,3})\s*日$/.test(text);
}

function blockAlignment(blockSide: 'right' | 'left' | null) {
    if (blockSide === 'right') return 'right' as const;
    return 'left' as const;
}

export function parseCourtMarkdown(markdown: string, fallbackTitle = '裁判文書'): CourtDocumentModel {
    const lines = stripHtmlComments(markdown).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const blocks: CourtDocumentBlock[] = [];
    let title = fallbackTitle;
    let compactFont = false;
    let currentLevel = 0;
    let blockSide: 'right' | 'left' | null = null;
    let lastHeader = '';

    for (let index = 0; index < lines.length; index++) {
        const trimmed = lines[index].trim();
        if (!trimmed) continue;

        if (trimmed === '### --右') {
            blockSide = 'right';
            currentLevel = 0;
            continue;
        }
        if (trimmed === '### --左') {
            blockSide = 'left';
            currentLevel = 0;
            continue;
        }
        if (trimmed === '### --') {
            blockSide = null;
            currentLevel = 0;
            continue;
        }

        if (/^\|.*\|$/.test(trimmed)) {
            const tableLines: string[] = [];
            let next = index;
            while (next < lines.length) {
                const candidate = lines[next].trim();
                if (!candidate) {
                    next++;
                    continue;
                }
                if (!/^\|.*\|$/.test(candidate)) break;
                tableLines.push(candidate);
                next++;
            }
            index = next - 1;

            const hasHeader = tableLines.length > 1 && isPipeSeparator(tableLines[1]);
            const rowLines = tableLines.filter(line => !isPipeSeparator(line));
            const rawRows = rowLines.map(parsePipeCells);
            const evidence = rawRows[0]?.some(cell => cell.includes('号証')) || false;
            const rows = rawRows.map((cells, rowIndex) => cells.map(cell => ({
                runs: parseCourtInline(cell),
                header: hasHeader && rowIndex === 0
            })));
            blocks.push({
                type: 'table',
                rows,
                headerRow: hasHeader,
                evidence,
                alignment: blockAlignment(blockSide)
            });
            continue;
        }

        const firstListTable = trimmed.match(/^[-*]\s+(.+?)[：:](.*)$/);
        const firstNumberedTable = trimmed.match(/^([0-9０-９]+)[　\s]+(.+?)[：:](.*)$/);
        if (firstListTable || firstNumberedTable) {
            const rows: CourtTableCell[][] = [];
            let attachment = Boolean(firstNumberedTable) || lastHeader === '附属書類' || lastHeader === '証拠書類';
            let next = index;
            while (next < lines.length) {
                const candidate = lines[next].trim();
                if (!candidate) {
                    next++;
                    continue;
                }
                const listMatch = candidate.match(/^[-*]\s+(.+?)[：:](.*)$/);
                const numberedMatch = candidate.match(/^([0-9０-９]+)[　\s]+(.+?)[：:](.*)$/);
                if (!listMatch && !numberedMatch) break;
                if (numberedMatch) {
                    attachment = true;
                    rows.push([
                        { runs: parseCourtInline(`${numberedMatch[1]}　${numberedMatch[2].trim()}`) },
                        { runs: parseCourtInline(numberedMatch[3].trim()) }
                    ]);
                } else if (listMatch) {
                    rows.push([
                        { runs: parseCourtInline(listMatch[1].trim()) },
                        { runs: parseCourtInline(listMatch[2].trim()) }
                    ]);
                }
                next++;
            }
            index = next - 1;
            blocks.push({ type: 'table', rows, attachment, alignment: blockAlignment(blockSide) });
            continue;
        }

        const bulletMatch = trimmed.match(/^[*＊-]\s+(.+)$/);
        if (bulletMatch) {
            blocks.push(paragraph(bulletMatch[1], {
                kind: 'bullet',
                firstLineIndent: false,
                indentLevel: Math.max(currentLevel, 1),
                alignment: blockSide ? blockAlignment(blockSide) : 'left'
            }));
            continue;
        }

        const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        if (imageMatch) {
            blocks.push({ type: 'image', alt: imageMatch[1].trim(), source: imageMatch[2].trim() });
            continue;
        }

        if (trimmed === '### -') {
            blocks.push(paragraph('', { kind: 'blank', firstLineIndent: false, alignment: 'left' }));
            continue;
        }
        if (trimmed === '### --目次') {
            blocks.push({ type: 'toc' });
            currentLevel = 0;
            continue;
        }
        if (trimmed === '### ---') {
            blocks.push(paragraph('', { kind: 'separator', firstLineIndent: false, alignment: 'left' }));
            currentLevel = 0;
            continue;
        }
        const pageBreakMatch = trimmed.match(/^### --\s*(.*?)\s*--$/);
        if (pageBreakMatch) {
            const breakText = pageBreakMatch[1].trim();
            blocks.push(paragraph(breakText ? `(${breakText})` : '', {
                kind: 'break',
                pageBreakBefore: true,
                firstLineIndent: false,
                alignment: 'left'
            }));
            currentLevel = 0;
            continue;
        }

        const levelInfo = getLevelInfo(trimmed);
        const isHeader = trimmed.startsWith('#');
        const markerText = levelInfo
            ? trimmed.replace(/^#*\s*/, '').replace(levelInfo.marker, '').trim()
            : '';
        const isTocHeading = Boolean(levelInfo) && (
            isHeader || (levelInfo.level <= 2 && !markerText.includes('。') && !/[：:]/.test(markerText))
        );

        if (levelInfo && isTocHeading) {
            const headingText = `${levelInfo.marker}　${markerText}`;
            lastHeader = markerText;
            currentLevel = levelInfo.level;
            blocks.push(paragraph(headingText, {
                kind: 'heading',
                headingLevel: Math.min(levelInfo.level, 6),
                indentLevel: Math.max(levelInfo.level - 1, 0),
                firstLineIndent: false,
                alignment: 'left'
            }));
            continue;
        }

        const plainText = levelInfo
            ? markerText
            : trimmed.replace(/^#+\s*/, '').trim();

        if (isHeader && !levelInfo) {
            title = plainText || title;
            compactFont = compactFont || plainText === '送付書';
            lastHeader = plainText;
            currentLevel = 0;
            blocks.push(paragraph(plainText, {
                kind: 'title',
                alignment: 'center',
                firstLineIndent: false
            }));
            continue;
        }

        if (plainText === '以上') {
            currentLevel = 0;
            blocks.push(paragraph(plainText, { kind: 'end', alignment: 'right', firstLineIndent: false }));
            continue;
        }
        if (plainText === '記') {
            currentLevel = 0;
            blocks.push(paragraph(plainText, { kind: 'center', alignment: 'center', firstLineIndent: false }));
            continue;
        }

        if (levelInfo) currentLevel = levelInfo.level;
        const visibleText = levelInfo ? `${levelInfo.marker}　${plainText}` : plainText;
        let alignment: CourtParagraphBlock['alignment'] = blockSide ? blockAlignment(blockSide) : 'justify';
        let kind: CourtParagraphBlock['kind'] = 'body';
        let firstLineIndent = !levelInfo && !blockSide;

        if (isDateLine(plainText)) {
            alignment = 'right';
            kind = 'date';
            firstLineIndent = false;
        } else if (/.*[　\s](?:御中|様)$/.test(plainText)) {
            alignment = blockSide === 'right' ? 'right' : 'left';
            kind = 'destination';
            firstLineIndent = false;
        } else if (blockSide) {
            firstLineIndent = false;
        }

        blocks.push(paragraph(visibleText, {
            kind,
            alignment,
            indentLevel: levelInfo ? Math.max(levelInfo.level - 1, 0) : Math.max(currentLevel - 1, 0),
            firstLineIndent
        }));
    }

    return { title, compactFont, blocks };
}
