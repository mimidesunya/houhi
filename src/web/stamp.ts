import { buildStoredZip } from './zip';

declare const PDFLib: any;

type SelectedStampFile = {
    file: File;
    evidenceNumber: string | null;
    supported: boolean;
    sortKey: [number, number];
};

type StampOptions = {
    allPages: boolean;
    insertBlankPages: boolean;
    fontSize: number;
};

type StampedPdf = {
    filename: string;
    evidenceNumber: string;
    bytes: Uint8Array;
    pageCount: number;
};

const DEFAULT_FONT_SIZE = 20;
const MARGIN_RIGHT = 15;
const MARGIN_TOP = 12;
const STAMP_OUTLINE = 1.5;
const STAMP_SUFFIX = '号証';
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const IMAGE_MARGIN = 36;
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

const fileInput = document.getElementById('stampFileInput') as HTMLInputElement;
const dropZone = document.getElementById('stampDropZone') as HTMLElement;
const chooseFilesButton = document.getElementById('chooseStampFilesButton') as HTMLButtonElement;
const stampButton = document.getElementById('stampButton') as HTMLButtonElement;
const allPagesCheckbox = document.getElementById('stampAllPages') as HTMLInputElement;
const noBlankPagesCheckbox = document.getElementById('stampNoBlankPages') as HTMLInputElement;
const fontSizeInput = document.getElementById('stampFontSize') as HTMLInputElement;
const stampStatus = document.getElementById('stampStatus') as HTMLElement;
const stampSummary = document.getElementById('stampSummary') as HTMLElement;
const stampLog = document.getElementById('stampLog') as HTMLTextAreaElement;
const stampProgress = document.getElementById('stampProgress') as HTMLProgressElement;
const stampProgressText = document.getElementById('stampProgressText') as HTMLElement;

let selectedFiles: SelectedStampFile[] = [];

function setStatus(message: string) {
    stampStatus.textContent = message;
}

function appendLog(message: string) {
    stampLog.value = stampLog.value ? `${stampLog.value}\n${message}` : message;
    stampLog.scrollTop = stampLog.scrollHeight;
}

function setProgress(done: number, total: number) {
    const safeTotal = Math.max(1, total);
    stampProgress.max = safeTotal;
    stampProgress.value = Math.min(done, safeTotal);
    stampProgressText.textContent = `${Math.round((stampProgress.value / safeTotal) * 100)}%`;
}

function toHalfWidthDigits(value: string) {
    return value.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function getBasename(filePath: string) {
    const normalized = filePath.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || normalized;
}

function getExtname(filePath: string) {
    const basename = getBasename(filePath);
    const dotIndex = basename.lastIndexOf('.');

    if (dotIndex <= 0) {
        return '';
    }

    return basename.slice(dotIndex).toLowerCase();
}

function stripExtname(filePath: string) {
    const basename = getBasename(filePath);
    const dotIndex = basename.lastIndexOf('.');
    return dotIndex <= 0 ? basename : basename.slice(0, dotIndex);
}

function extractEvidenceNumber(filename: string) {
    const normalizedName = toHalfWidthDigits(getBasename(filename));
    const match = normalizedName.match(/^([甲乙丙丁戊証疎][0-9]+(?:[\-ー－の][0-9]+)?)/);

    if (!match) {
        return null;
    }

    return match[1].replace(/[ー－]/g, '-');
}

function naturalSortKey(filename: string): [number, number] {
    const evidenceNumber = extractEvidenceNumber(filename);
    const match = evidenceNumber?.match(/[甲乙丙丁戊証疎]([0-9]+)(?:[\-の]([0-9]+))?/);

    if (!match) {
        return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
    }

    return [Number(match[1]), match[2] ? Number(match[2]) : 0];
}

function isImageFile(file: File) {
    return IMAGE_EXTENSIONS.includes(getExtname(file.name));
}

function isPdfFile(file: File) {
    return getExtname(file.name) === '.pdf' || file.type === 'application/pdf';
}

function isSupportedFile(file: File) {
    return isPdfFile(file) || isImageFile(file);
}

function getA4PrintScaleForPage(width: number, height: number) {
    const isLandscape = width > height;
    const [a4W, a4H] = isLandscape ? [A4_HEIGHT, A4_WIDTH] : [A4_WIDTH, A4_HEIGHT];
    return Math.min(a4W / width, a4H / height);
}

function getStampMetricsForA4Print(pageWidth: number, pageHeight: number, fontSize = DEFAULT_FONT_SIZE) {
    const printScale = getA4PrintScaleForPage(pageWidth, pageHeight);
    const metricScale = printScale > 0 ? 1 / printScale : 1;
    return {
        printScale,
        fontSize: fontSize * metricScale,
        marginRight: MARGIN_RIGHT * metricScale,
        marginTop: MARGIN_TOP * metricScale,
        outline: STAMP_OUTLINE * metricScale,
    };
}

async function ensureStampFont(fontSize: number) {
    const fonts = (document as any).fonts;
    if (!fonts) {
        return;
    }

    await fonts.load(`700 ${fontSize}px "Noto Sans JP"`);
    await fonts.ready;
}

async function canvasToPngBytes(canvas: HTMLCanvasElement) {
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(result => {
            if (result) resolve(result);
            else reject(new Error('スタンプ画像を作成できませんでした。'));
        }, 'image/png');
    });

    return new Uint8Array(await blob.arrayBuffer());
}

async function createStampImage(stampText: string, fontSize: number, outline: number) {
    await ensureStampFont(fontSize);

    const scale = 3;
    const measureCanvas = document.createElement('canvas');
    const measureContext = measureCanvas.getContext('2d');
    if (!measureContext) {
        throw new Error('Canvasを初期化できませんでした。');
    }

    const font = `700 ${fontSize * scale}px "Noto Sans JP", sans-serif`;
    measureContext.font = font;

    const padding = Math.ceil((outline + 3) * scale);
    const measured = measureContext.measureText(stampText);
    const widthPx = Math.ceil(measured.width + padding * 2);
    const heightPx = Math.ceil(fontSize * 1.32 * scale + padding * 2);
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;

    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Canvasを初期化できませんでした。');
    }

    context.font = font;
    context.textBaseline = 'top';
    context.lineJoin = 'round';
    context.lineWidth = Math.max(1, outline * 2 * scale);
    context.strokeStyle = '#ffffff';
    context.fillStyle = '#ff0000';
    context.strokeText(stampText, padding, padding);
    context.fillText(stampText, padding, padding);

    return {
        bytes: await canvasToPngBytes(canvas),
        width: widthPx / scale,
        height: heightPx / scale,
    };
}

async function ensureA4Pages(pdfBytes: Uint8Array) {
    const srcDoc = await PDFLib.PDFDocument.load(pdfBytes);
    const srcPages = srcDoc.getPages();
    const needsResize = srcPages.some((page: any) => {
        const { width, height } = page.getSize();
        const isLandscape = width > height;
        const [a4W, a4H] = isLandscape ? [A4_HEIGHT, A4_WIDTH] : [A4_WIDTH, A4_HEIGHT];
        return width < a4W && height < a4H;
    });

    if (!needsResize) {
        return pdfBytes;
    }

    const newDoc = await PDFLib.PDFDocument.create();
    for (let index = 0; index < srcPages.length; index++) {
        const srcPage = srcPages[index];
        const { width, height } = srcPage.getSize();
        const isLandscape = width > height;
        const [a4W, a4H] = isLandscape ? [A4_HEIGHT, A4_WIDTH] : [A4_WIDTH, A4_HEIGHT];

        if (width < a4W && height < a4H) {
            const newPage = newDoc.addPage([a4W, a4H]);
            const embedded = await newDoc.embedPage(srcPage);
            newPage.drawPage(embedded, {
                x: (a4W - width) / 2,
                y: (a4H - height) / 2,
            });
        } else {
            const [copiedPage] = await newDoc.copyPages(srcDoc, [index]);
            newDoc.addPage(copiedPage);
        }
    }

    return await newDoc.save();
}

async function convertImageToPdf(file: File) {
    const imageBytes = new Uint8Array(await file.arrayBuffer());
    const pdfDoc = await PDFLib.PDFDocument.create();
    const image = getExtname(file.name) === '.png'
        ? await pdfDoc.embedPng(imageBytes)
        : await pdfDoc.embedJpg(imageBytes);
    const isLandscape = image.width > image.height;
    const [pageW, pageH] = isLandscape ? [A4_HEIGHT, A4_WIDTH] : [A4_WIDTH, A4_HEIGHT];
    const page = pdfDoc.addPage([pageW, pageH]);
    const maxW = pageW - IMAGE_MARGIN * 2;
    const maxH = pageH - IMAGE_MARGIN * 2;
    const scale = Math.min(maxW / image.width, maxH / image.height, 1);
    const drawW = image.width * scale;
    const drawH = image.height * scale;

    page.drawImage(image, {
        x: (pageW - drawW) / 2,
        y: (pageH - drawH) / 2,
        width: drawW,
        height: drawH,
    });

    return await pdfDoc.save();
}

async function stampPdfBytes(inputBytes: Uint8Array, evidenceNumber: string, options: StampOptions) {
    const existingPdfBytes = await ensureA4Pages(inputBytes);
    const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
    const pages = pdfDoc.getPages();
    const pagesToStamp = options.allPages ? pages : pages.slice(0, 1);

    for (const page of pagesToStamp) {
        const { width, height } = page.getSize();
        const metrics = getStampMetricsForA4Print(width, height, options.fontSize);
        const stamp = await createStampImage(`${evidenceNumber}${STAMP_SUFFIX}`, metrics.fontSize, metrics.outline);
        const stampImage = await pdfDoc.embedPng(stamp.bytes);

        page.drawImage(stampImage, {
            x: width - stamp.width - metrics.marginRight,
            y: height - stamp.height - metrics.marginTop,
            width: stamp.width,
            height: stamp.height,
        });
    }

    return {
        bytes: await pdfDoc.save(),
        pageCount: pages.length,
    };
}

async function processFile(selectedFile: SelectedStampFile, options: StampOptions): Promise<StampedPdf | null> {
    if (!selectedFile.evidenceNumber || !selectedFile.supported) {
        return null;
    }

    appendLog(`処理中: ${selectedFile.file.name}`);

    const inputBytes = isImageFile(selectedFile.file)
        ? await convertImageToPdf(selectedFile.file)
        : new Uint8Array(await selectedFile.file.arrayBuffer());
    const result = await stampPdfBytes(inputBytes, selectedFile.evidenceNumber, options);

    appendLog(`完了: ${selectedFile.evidenceNumber}${STAMP_SUFFIX}`);
    return {
        filename: `${stripExtname(selectedFile.file.name)}.pdf`,
        evidenceNumber: selectedFile.evidenceNumber,
        bytes: result.bytes,
        pageCount: result.pageCount,
    };
}

async function mergeStampedPdfs(stampedPdfs: StampedPdf[], insertBlankPages: boolean) {
    const mergedDoc = await PDFLib.PDFDocument.create();
    let totalPages = 0;
    let blankPages = 0;

    for (let index = 0; index < stampedPdfs.length; index++) {
        const sourceDoc = await PDFLib.PDFDocument.load(stampedPdfs[index].bytes);
        const copiedPages = await mergedDoc.copyPages(sourceDoc, sourceDoc.getPageIndices());

        for (const page of copiedPages) {
            mergedDoc.addPage(page);
            totalPages++;
        }

        if (insertBlankPages && copiedPages.length % 2 !== 0 && index < stampedPdfs.length - 1) {
            const lastPage = copiedPages[copiedPages.length - 1];
            const { width, height } = lastPage.getSize();
            mergedDoc.addPage([width, height]);
            totalPages++;
            blankPages++;
        }
    }

    return {
        bytes: await mergedDoc.save(),
        totalPages,
        blankPages,
    };
}

function makeDownloadBlob(bytes: Uint8Array, mimeType: string) {
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Blob([arrayBuffer], { type: mimeType });
}

function downloadBytes(filename: string, bytes: Uint8Array, mimeType: string) {
    const url = URL.createObjectURL(makeDownloadBlob(bytes, mimeType));
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function buildOutputZip(stampedPdfs: StampedPdf[], mergedBytes: Uint8Array | null) {
    const entries = stampedPdfs.map(pdf => ({
        path: `stamped/${pdf.filename}`,
        data: pdf.bytes,
    }));

    if (mergedBytes) {
        entries.push({
            path: 'stamped/_結合_号証一式.pdf',
            data: mergedBytes,
        });
    }

    return buildStoredZip(entries);
}

function updateSelectedFiles(files: File[]) {
    selectedFiles = files
        .map(file => ({
            file,
            evidenceNumber: extractEvidenceNumber(file.name),
            supported: isSupportedFile(file),
            sortKey: naturalSortKey(file.name),
        }))
        .sort((a, b) => a.sortKey[0] - b.sortKey[0] || a.sortKey[1] - b.sortKey[1] || a.file.name.localeCompare(b.file.name, 'ja'));

    const supported = selectedFiles.filter(item => item.supported);
    const stampable = selectedFiles.filter(item => item.supported && item.evidenceNumber);
    const skipped = selectedFiles.length - stampable.length;

    stampSummary.textContent = selectedFiles.length === 0
        ? 'PDF、JPG、PNGを選択してください。'
        : `${selectedFiles.length}件を選択中。スタンプ対象 ${stampable.length}件、除外 ${skipped}件。`;
    stampButton.disabled = stampable.length === 0;
    setStatus(stampable.length === 0 ? '対象ファイルなし' : '作成できます');

    stampLog.value = '';
    for (const item of selectedFiles) {
        if (!item.supported) {
            appendLog(`除外: ${item.file.name}（PDF/JPG/PNGではありません）`);
        } else if (!item.evidenceNumber) {
            appendLog(`除外: ${item.file.name}（ファイル名の先頭に号証番号がありません）`);
        } else {
            appendLog(`対象: ${item.evidenceNumber}${STAMP_SUFFIX} ← ${item.file.name}`);
        }
    }

    if (supported.length === 0 && selectedFiles.length > 0) {
        setStatus('対象ファイルなし');
    }
}

function getOptions(): StampOptions {
    const fontSize = Number(fontSizeInput.value);
    return {
        allPages: allPagesCheckbox.checked,
        insertBlankPages: !noBlankPagesCheckbox.checked,
        fontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : DEFAULT_FONT_SIZE,
    };
}

async function runStamp() {
    if (!(window as any).PDFLib) {
        setStatus('PDF処理ライブラリを読み込めませんでした。ネットワークを確認してください。');
        return;
    }

    const targets = selectedFiles.filter(item => item.supported && item.evidenceNumber);
    if (targets.length === 0) {
        return;
    }

    stampButton.disabled = true;
    setStatus('作成中...');
    setProgress(0, targets.length + (targets.length > 1 ? 1 : 0));
    stampLog.value = '';

    try {
        const options = getOptions();
        const stampedPdfs: StampedPdf[] = [];

        for (let index = 0; index < targets.length; index++) {
            const target = targets[index];
            const stampedPdf = await processFile(target, options);
            if (stampedPdf) {
                stampedPdfs.push(stampedPdf);
            }
            setProgress(index + 1, targets.length + (targets.length > 1 ? 1 : 0));
        }

        if (stampedPdfs.length === 1) {
            downloadBytes(stampedPdfs[0].filename, stampedPdfs[0].bytes, 'application/pdf');
            setProgress(1, 1);
            setStatus('作成しました。');
            return;
        }

        const merged = await mergeStampedPdfs(stampedPdfs, options.insertBlankPages);
        const zipBytes = buildOutputZip(stampedPdfs, merged.bytes);
        downloadBytes('stamped_号証一式.zip', zipBytes, 'application/zip');
        setProgress(targets.length + 1, targets.length + 1);
        appendLog(`結合PDF: ${merged.totalPages}ページ（空白ページ ${merged.blankPages}ページ）`);
        setStatus(`作成しました。${stampedPdfs.length}件をZIPにまとめました。`);
    } catch (err) {
        console.error(err);
        appendLog(`エラー: ${err instanceof Error ? err.message : String(err)}`);
        setStatus('作成に失敗しました。ファイルを確認してください。');
    } finally {
        stampButton.disabled = selectedFiles.filter(item => item.supported && item.evidenceNumber).length === 0;
    }
}

function filesFromInput(fileList: FileList | null) {
    return Array.from(fileList || []);
}

chooseFilesButton.addEventListener('click', () => fileInput.click());
stampButton.addEventListener('click', runStamp);
fileInput.addEventListener('change', () => updateSelectedFiles(filesFromInput(fileInput.files)));

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', event => {
    event.preventDefault();
    dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', event => {
    event.preventDefault();
    dropZone.classList.remove('drag-over');
    updateSelectedFiles(filesFromInput(event.dataTransfer?.files || null));
});

stampButton.disabled = true;
setProgress(0, 1);
updateSelectedFiles([]);
