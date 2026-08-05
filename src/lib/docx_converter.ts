const fs = require('fs');
const path = require('path');
const {
    AlignmentType,
    BorderStyle,
    Document,
    Footer,
    HeadingLevel,
    ImageRun,
    Packer,
    PageNumber,
    Paragraph,
    Table,
    TableBorders,
    TableCell,
    TableOfContents,
    TableRow,
    TextRun,
    VerticalAlign,
    WidthType
} = require('docx');
const {
    parseCourtMarkdown
} = require('./court_document_model');

import type {
    CourtDocumentBlock,
    CourtDocumentModel,
    CourtImageBlock,
    CourtInlineRun,
    CourtParagraphBlock,
    CourtTableBlock,
    CourtTableCell
} from './court_document_model';

const A4_WIDTH = 11906;
const A4_HEIGHT = 16838;
const PAGE_MARGINS = {
    top: 1984,    // 35 mm
    right: 1134,  // 20 mm
    bottom: 1531, // 27 mm
    left: 1701,   // 30 mm
    header: 720,
    footer: 720,
    gutter: 0
};
const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGINS.left - PAGE_MARGINS.right;
const NORMAL_LINE_SPACING = 388;
const NORMAL_FONT = 'MS Mincho';

type DocxWarning = {
    code: 'missing-image' | 'unsupported-image' | 'unsafe-image-path';
    message: string;
    source: string;
};

type DocxBuildResult = {
    buffer: Buffer;
    warnings: DocxWarning[];
};

type DocxWriteResult = {
    outputPath: string;
    warnings: DocxWarning[];
};

function alignmentValue(value: CourtParagraphBlock['alignment']) {
    if (value === 'center') return AlignmentType.CENTER;
    if (value === 'right') return AlignmentType.RIGHT;
    if (value === 'justify') return AlignmentType.JUSTIFIED;
    return AlignmentType.LEFT;
}

function headingValue(level?: number) {
    const headings = [
        HeadingLevel.HEADING_1,
        HeadingLevel.HEADING_2,
        HeadingLevel.HEADING_3,
        HeadingLevel.HEADING_4,
        HeadingLevel.HEADING_5,
        HeadingLevel.HEADING_6
    ];
    return headings[Math.max(0, Math.min((level || 1) - 1, headings.length - 1))];
}

function commonRunOptions(fontSize: number) {
    return {
        font: {
            ascii: NORMAL_FONT,
            hAnsi: NORMAL_FONT,
            eastAsia: NORMAL_FONT,
            cs: NORMAL_FONT
        },
        size: fontSize,
        sizeComplexScript: fontSize,
        language: { value: 'ja-JP', eastAsia: 'ja-JP' }
    };
}

function inlineRunsToDocx(runs: CourtInlineRun[], fontSize: number, options: { bold?: boolean; characterSpacing?: number } = {}) {
    const children: any[] = [];
    for (const run of runs) {
        if (run.type === 'break') {
            children.push(new TextRun({ ...commonRunOptions(fontSize), break: 1 }));
            continue;
        }

        children.push(new TextRun({
            ...commonRunOptions(fontSize),
            text: run.text,
            bold: Boolean(options.bold),
            underline: run.underline ? {} : undefined,
            characterSpacing: options.characterSpacing
        }));

        if (run.rubyText) {
            children.push(new TextRun({
                ...commonRunOptions(Math.max(12, Math.round(fontSize * 0.55))),
                text: `（${run.rubyText}）`,
                superScript: true
            }));
        }
    }
    return children;
}

function paragraphToDocx(block: CourtParagraphBlock, fontSize: number) {
    const isTitle = block.kind === 'title';
    const isHeading = block.kind === 'heading';
    const isBlank = block.kind === 'blank';
    const isSeparator = block.kind === 'separator';
    const marginKind = isTitle || block.kind === 'center' || block.kind === 'end' || block.kind === 'break';
    const before = marginKind ? NORMAL_LINE_SPACING : (isHeading && block.headingLevel === 1 ? NORMAL_LINE_SPACING : 0);
    const after = isBlank || marginKind ? NORMAL_LINE_SPACING : 0;
    const indentLevel = Math.max(0, block.indentLevel || 0);
    const paragraphOptions: Record<string, any> = {
        alignment: alignmentValue(block.alignment),
        pageBreakBefore: Boolean(block.pageBreakBefore),
        spacing: {
            before,
            after,
            line: NORMAL_LINE_SPACING,
            lineRule: 'auto'
        },
        indent: {
            left: indentLevel * 360,
            firstLine: block.firstLineIndent ? 240 : 0
        },
        keepNext: isTitle || isHeading,
        widowControl: true,
        children: inlineRunsToDocx(block.runs, fontSize, {
            characterSpacing: isTitle ? 120 : undefined
        })
    };

    if (block.kind === 'bullet') {
        paragraphOptions.bullet = { level: Math.max(0, Math.min(indentLevel, 5)) };
        paragraphOptions.indent = undefined;
    }
    if (isHeading) paragraphOptions.heading = headingValue(block.headingLevel);
    if (isSeparator) {
        paragraphOptions.border = {
            bottom: { style: BorderStyle.DOTTED, size: 4, color: '000000', space: 1 }
        };
    }
    return new Paragraph(paragraphOptions);
}

function textFromRuns(runs: CourtInlineRun[]) {
    return runs.map(run => run.type === 'text' ? run.text : '\n').join('').trim();
}

function calculateColumnWidths(table: CourtTableBlock, columnCount: number) {
    if (table.evidence && columnCount === 6) {
        return [780, 1700, 700, 1250, 1100, CONTENT_WIDTH - 5530];
    }

    const widths = new Array(columnCount).fill(Math.floor(CONTENT_WIDTH / Math.max(1, columnCount)));
    widths[widths.length - 1] += CONTENT_WIDTH - widths.reduce((sum, value) => sum + value, 0);
    return widths;
}

function tableBorders(table: CourtTableBlock) {
    if (!table.evidence && !table.headerRow) return TableBorders.NONE;
    const color = table.evidence ? '000000' : 'BFBFBF';
    const size = table.evidence ? 4 : 2;
    const border = { style: BorderStyle.SINGLE, size, color };
    return {
        top: border,
        bottom: border,
        left: border,
        right: border,
        insideHorizontal: border,
        insideVertical: border
    };
}

function findEvidenceRowSpan(rows: CourtTableCell[][], rowIndex: number, columnIndex: number) {
    if (rowIndex === 0 || !textFromRuns(rows[rowIndex][columnIndex]?.runs || [])) return 1;
    let span = 1;
    for (let next = rowIndex + 1; next < rows.length; next++) {
        const value = textFromRuns(rows[next][columnIndex]?.runs || []);
        if (value) break;
        span++;
    }
    return span;
}

function tableToDocx(table: CourtTableBlock, fontSize: number) {
    const columnCount = Math.max(1, ...table.rows.map(row => row.length));
    const columnWidths = calculateColumnWidths(table, columnCount);
    const skipped = new Set<string>();
    const rows = table.rows.map((row, rowIndex) => {
        const cells: any[] = [];
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
            if (skipped.has(`${rowIndex}:${columnIndex}`)) continue;
            const cell = row[columnIndex] || { runs: [] };
            const rowSpan = table.evidence
                ? findEvidenceRowSpan(table.rows, rowIndex, columnIndex)
                : 1;
            if (rowSpan > 1) {
                for (let offset = 1; offset < rowSpan; offset++) {
                    skipped.add(`${rowIndex + offset}:${columnIndex}`);
                }
            }

            cells.push(new TableCell({
                width: { size: columnWidths[columnIndex], type: WidthType.DXA },
                rowSpan: rowSpan > 1 ? rowSpan : undefined,
                verticalAlign: VerticalAlign.TOP,
                shading: cell.header ? { fill: 'F2F2F2' } : undefined,
                margins: { top: 40, bottom: 40, left: 80, right: 80 },
                children: [new Paragraph({
                    alignment: cell.header || (table.evidence && (columnIndex === 0 || columnIndex === 2))
                        ? AlignmentType.CENTER
                        : AlignmentType.LEFT,
                    spacing: { before: 0, after: 0, line: NORMAL_LINE_SPACING, lineRule: 'auto' },
                    children: inlineRunsToDocx(cell.runs, fontSize, { bold: Boolean(cell.header && !table.evidence) })
                })]
            }));
        }
        return new TableRow({
            children: cells,
            tableHeader: Boolean(table.headerRow && rowIndex === 0),
            cantSplit: true
        });
    });

    return new Table({
        rows,
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        indent: { size: 0, type: WidthType.DXA },
        columnWidths,
        borders: tableBorders(table),
        alignment: table.alignment === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
        margins: { top: 0, bottom: 0, left: 80, right: 80 }
    });
}

function getPngDimensions(data: Buffer) {
    if (data.length >= 24 && data.toString('ascii', 1, 4) === 'PNG') {
        return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    }
    return null;
}

function getGifDimensions(data: Buffer) {
    if (data.length >= 10 && /^GIF8[79]a$/.test(data.toString('ascii', 0, 6))) {
        return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
    }
    return null;
}

function getBmpDimensions(data: Buffer) {
    if (data.length >= 26 && data.toString('ascii', 0, 2) === 'BM') {
        return { width: Math.abs(data.readInt32LE(18)), height: Math.abs(data.readInt32LE(22)) };
    }
    return null;
}

function getJpegDimensions(data: Buffer) {
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
    let offset = 2;
    while (offset + 8 < data.length) {
        if (data[offset] !== 0xff) {
            offset++;
            continue;
        }
        const marker = data[offset + 1];
        const length = data.readUInt16BE(offset + 2);
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
            return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
        }
        if (length < 2) break;
        offset += length + 2;
    }
    return null;
}

function getImageDimensions(data: Buffer, type: string) {
    const dimensions = type === 'png'
        ? getPngDimensions(data)
        : type === 'jpg'
            ? getJpegDimensions(data)
            : type === 'gif'
                ? getGifDimensions(data)
                : getBmpDimensions(data);
    return dimensions && dimensions.width > 0 && dimensions.height > 0
        ? dimensions
        : { width: 640, height: 480 };
}

function resolveLocalImage(source: string, resourceDir: string) {
    if (/^(?:https?:|file:|data:|\\\\)/i.test(source)) return null;
    const root = path.resolve(resourceDir);
    const target = path.resolve(root, source);
    if (target !== root && !target.startsWith(root + path.sep)) return null;
    return target;
}

function imageType(source: string) {
    const extension = path.extname(source).toLowerCase();
    if (extension === '.png') return 'png';
    if (extension === '.jpg' || extension === '.jpeg') return 'jpg';
    if (extension === '.gif') return 'gif';
    if (extension === '.bmp') return 'bmp';
    return null;
}

function imageFallbackParagraph(block: CourtImageBlock, message: string, fontSize: number) {
    return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: NORMAL_LINE_SPACING, after: NORMAL_LINE_SPACING, line: NORMAL_LINE_SPACING },
        children: [new TextRun({
            ...commonRunOptions(fontSize),
            text: `[画像: ${block.alt || block.source}（${message}）]`,
            color: '666666'
        })]
    });
}

function imageToDocx(block: CourtImageBlock, resourceDir: string, fontSize: number, warnings: DocxWarning[]) {
    const type = imageType(block.source);
    if (!type) {
        warnings.push({ code: 'unsupported-image', source: block.source, message: `未対応の画像形式です: ${block.source}` });
        return imageFallbackParagraph(block, '未対応の画像形式', fontSize);
    }

    const imagePath = resolveLocalImage(block.source, resourceDir);
    if (!imagePath) {
        warnings.push({ code: 'unsafe-image-path', source: block.source, message: `文書フォルダ外又は外部の画像は埋め込みません: ${block.source}` });
        return imageFallbackParagraph(block, '外部画像は埋め込みません', fontSize);
    }
    if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) {
        warnings.push({ code: 'missing-image', source: block.source, message: `画像が見つかりません: ${block.source}` });
        return imageFallbackParagraph(block, '画像が見つかりません', fontSize);
    }

    const data = fs.readFileSync(imagePath);
    const dimensions = getImageDimensions(data, type);
    const maxWidth = 600;
    const maxHeight = 850;
    const scale = Math.min(1, maxWidth / dimensions.width, maxHeight / dimensions.height);
    const width = Math.max(1, Math.round(dimensions.width * scale));
    const height = Math.max(1, Math.round(dimensions.height * scale));

    return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: NORMAL_LINE_SPACING, after: NORMAL_LINE_SPACING },
        children: [new ImageRun({
            type,
            data,
            transformation: { width, height },
            altText: {
                title: block.alt || path.basename(block.source),
                description: block.alt || '',
                name: path.basename(block.source)
            }
        })]
    });
}

function tocToDocx(fontSize: number) {
    return [
        new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: NORMAL_LINE_SPACING, after: NORMAL_LINE_SPACING },
            keepNext: true,
            children: [new TextRun({
                ...commonRunOptions(fontSize),
                text: '目次',
                characterSpacing: 120
            })]
        }),
        new TableOfContents('目次', {
            hyperlink: true,
            headingStyleRange: '1-3',
            useAppliedParagraphOutlineLevel: true,
            beginDirty: true
        })
    ];
}

function blockToDocx(block: CourtDocumentBlock, resourceDir: string, fontSize: number, warnings: DocxWarning[]) {
    if (block.type === 'paragraph') return [paragraphToDocx(block, fontSize)];
    if (block.type === 'table') return [tableToDocx(block, fontSize)];
    if (block.type === 'image') return [imageToDocx(block, resourceDir, fontSize, warnings)];
    return tocToDocx(fontSize);
}

function defaultHeadingStyle(level: number, fontSize: number) {
    return {
        run: { ...commonRunOptions(fontSize), bold: false },
        paragraph: {
            spacing: { before: level === 1 ? NORMAL_LINE_SPACING : 0, after: 0, line: NORMAL_LINE_SPACING },
            keepNext: true,
            outlineLevel: level - 1
        }
    };
}

export async function buildCourtDocxBuffer(model: CourtDocumentModel, resourceDir: string): Promise<DocxBuildResult> {
    const warnings: DocxWarning[] = [];
    const fontSize = model.compactFont ? 21 : 24;
    const children = model.blocks.flatMap(block => blockToDocx(block, resourceDir, fontSize, warnings));
    const footer = new Footer({
        children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
                new TextRun({ ...commonRunOptions(fontSize), text: '- ' }),
                new TextRun({ ...commonRunOptions(fontSize), children: [PageNumber.CURRENT] }),
                new TextRun({ ...commonRunOptions(fontSize), text: ' -' })
            ]
        })]
    });
    const headingStyles = [1, 2, 3, 4, 5, 6].map(level => defaultHeadingStyle(level, fontSize));

    // features.updateFields は指定しません。w:updateFields があると、PAGE だけの文書でも
    // Word が起動時に外部ファイル参照を含む可能性について確認を表示するためです。
    const document = new Document({
        title: model.title,
        subject: 'HOUHI Word output',
        creator: 'HOUHI',
        description: 'HOUHI Markdownから生成した編集用Word文書',
        styles: {
            default: {
                document: {
                    run: commonRunOptions(fontSize),
                    paragraph: { spacing: { line: NORMAL_LINE_SPACING, before: 0, after: 0 } }
                },
                title: defaultHeadingStyle(1, fontSize),
                heading1: headingStyles[0],
                heading2: headingStyles[1],
                heading3: headingStyles[2],
                heading4: headingStyles[3],
                heading5: headingStyles[4],
                heading6: headingStyles[5]
            }
        },
        sections: [{
            properties: {
                page: {
                    size: { width: A4_WIDTH, height: A4_HEIGHT },
                    margin: PAGE_MARGINS,
                    pageNumbers: { start: 1 }
                }
            },
            footers: { default: footer },
            children
        }]
    });

    return { buffer: await Packer.toBuffer(document), warnings };
}

function createUniqueDocxPath(desiredPath: string) {
    if (!fs.existsSync(desiredPath)) return desiredPath;
    const directory = path.dirname(desiredPath);
    const baseName = path.basename(desiredPath, path.extname(desiredPath));
    for (let suffix = 2; suffix < 10000; suffix++) {
        const candidate = path.join(directory, `${baseName}_${suffix}.docx`);
        if (!fs.existsSync(candidate)) return candidate;
    }
    throw new Error(`出力先の連番を決められませんでした: ${desiredPath}`);
}

export async function convertCourtMarkdownToDocx(
    markdown: string,
    desiredOutputPath: string,
    resourceDir: string,
    fallbackTitle = '裁判文書'
): Promise<DocxWriteResult> {
    const outputPath = createUniqueDocxPath(desiredOutputPath);
    const model = parseCourtMarkdown(markdown, fallbackTitle);
    const result = await buildCourtDocxBuffer(model, resourceDir);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const temporaryPath = path.join(
        path.dirname(outputPath),
        `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp`
    );

    try {
        fs.writeFileSync(temporaryPath, result.buffer, { flag: 'wx' });
        fs.renameSync(temporaryPath, outputPath);
    } catch (error) {
        try {
            if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
        } catch (_cleanupError) {
            // 元のエラーを優先します。
        }
        throw error;
    }

    return { outputPath, warnings: result.warnings };
}

module.exports = {
    buildCourtDocxBuffer,
    convertCourtMarkdownToDocx,
    createUniqueDocxPath
};
