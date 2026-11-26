import { degrees } from 'pdf-lib';
import { buildStoredZip } from './zip';
import type { StampTextPainter } from '../lib/stamp_core';
import {
    DEFAULT_FONT_SIZE,
    DEFAULT_TAB_STEPS,
    buildCombinedName,
    buildOutputFilename,
    buildStampText,
    compareSortKeys,
    convertImageBytesToPdf,
    extractEvidenceNumber,
    getExtname,
    getMaterialKind,
    isImageFileName,
    mergeStampedPdfBytes,
    naturalSortKey,
    normalizeCombinedName,
    stampPdfBytes,
    toPageSpace,
} from '../lib/stamp_core';

type SelectedStampFile = {
    file: File;
    evidenceNumber: string | null;
    supported: boolean;
};

type WebStampOptions = {
    allPages: boolean;
    insertBlankPages: boolean;
    tab: boolean;
    tabSteps: number;
    mints: boolean;
    combinedName: string | null;
};

type StampedPdf = {
    filename: string;
    evidenceNumber: string;
    bytes: Uint8Array;
    pageCount: number;
};

const STAMP_FONT_FAMILY = '"Noto Sans JP", sans-serif';
const CANVAS_SCALE = 3;
// 文字の基準線を、PNG の上端から（余白＋字の大きさのこの倍率）の位置に置く。和字の上端は 0.88 なので上は足りる
const BASELINE_RATIO = 0.95;
const IMAGE_HEIGHT_RATIO = 1.32;

const fileInput = document.getElementById('stampFileInput') as HTMLInputElement;
const dropZone = document.getElementById('stampDropZone') as HTMLElement;
const chooseFilesButton = document.getElementById('chooseStampFilesButton') as HTMLButtonElement;
const stampButton = document.getElementById('stampButton') as HTMLButtonElement;
const allPagesCheckbox = document.getElementById('stampAllPages') as HTMLInputElement;
const noBlankPagesCheckbox = document.getElementById('stampNoBlankPages') as HTMLInputElement;
const tabCheckbox = document.getElementById('stampTab') as HTMLInputElement;
const tabStepsInput = document.getElementById('stampTabSteps') as HTMLInputElement;
const mintsCheckbox = document.getElementById('stampMints') as HTMLInputElement;
const combinedNameInput = document.getElementById('stampCombinedName') as HTMLInputElement;
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

function isPdfFile(file: File) {
    return getExtname(file.name) === '.pdf' || file.type === 'application/pdf';
}

function isSupportedFile(file: File) {
    return isPdfFile(file) || isImageFileName(file.name);
}

async function ensureStampFont(fontSizePx: number) {
    const fonts = (document as any).fonts;
    if (!fonts) {
        return;
    }

    await fonts.load(`700 ${fontSizePx}px "Noto Sans JP"`);
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

function getCanvasContext(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Canvasを初期化できませんでした。');
    }
    return context;
}

/**
 * 白で縁取った赤い番号を PNG に描く。寸法は pt で返す（PNG は 3 倍の解像度）。
 * baseline は PNG の上端から文字の基準線まで、padding は左端から文字の左端まで。
 */
async function createStampImage(stampText: string, fontSize: number, outline: number) {
    const fontSizePx = fontSize * CANVAS_SCALE;
    await ensureStampFont(fontSizePx);

    const font = `700 ${fontSizePx}px ${STAMP_FONT_FAMILY}`;
    const measureContext = getCanvasContext(document.createElement('canvas'));
    measureContext.font = font;
    const textWidthPx = measureContext.measureText(stampText).width;

    const paddingPx = Math.ceil((outline + 3) * CANVAS_SCALE);
    const baselinePx = paddingPx + fontSizePx * BASELINE_RATIO;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(textWidthPx + paddingPx * 2);
    canvas.height = Math.ceil(fontSizePx * IMAGE_HEIGHT_RATIO + paddingPx * 2);

    const context = getCanvasContext(canvas);
    context.font = font;
    context.textBaseline = 'alphabetic';
    context.lineJoin = 'round';
    context.lineWidth = Math.max(1, outline * 2 * CANVAS_SCALE);
    context.strokeStyle = '#ffffff';
    context.fillStyle = '#ff0000';
    context.strokeText(stampText, paddingPx, baselinePx);
    context.fillText(stampText, paddingPx, baselinePx);

    return {
        bytes: await canvasToPngBytes(canvas),
        width: canvas.width / CANVAS_SCALE,
        height: canvas.height / CANVAS_SCALE,
        textWidth: textWidthPx / CANVAS_SCALE,
        baseline: baselinePx / CANVAS_SCALE,
        padding: paddingPx / CANVAS_SCALE,
    };
}

/**
 * ブラウザのフォントで描いた PNG を貼って番号を刷る道具。文字の大きさごとに PNG を作って使い回す。
 */
async function makeImagePainter(pdfDoc: any, stampText: string): Promise<StampTextPainter> {
    const measureContext = getCanvasContext(document.createElement('canvas'));
    await ensureStampFont(DEFAULT_FONT_SIZE * CANVAS_SCALE);
    const images = new Map<number, Promise<{ image: any; stamp: Awaited<ReturnType<typeof createStampImage>> }>>();
    const imageFor = (size: number, outline: number) => {
        const key = Math.round(size * 1000) / 1000;
        if (!images.has(key)) {
            images.set(key, createStampImage(stampText, key, outline).then(async stamp => ({
                stamp,
                image: await pdfDoc.embedPng(stamp.bytes),
            })));
        }
        return images.get(key)!;
    };

    return {
        widthAt(size) {
            measureContext.font = `700 ${size * CANVAS_SCALE}px ${STAMP_FONT_FAMILY}`;
            return measureContext.measureText(stampText).width / CANVAS_SCALE;
        },
        async draw(page, { x, y, size, outline, rotation }) {
            const { image, stamp } = await imageFor(size, outline);
            // (x, y) は文字の基準線の左端（表示したときの座標）。PNG の左下をそこから余白と基準線の分だけずらす
            const left = x - stamp.padding;
            const bottom = y - (stamp.height - stamp.baseline);
            const { width: pageW, height: pageH } = page.getSize();
            const point = toPageSpace(rotation, pageW, pageH, left, bottom);
            page.drawImage(image, {
                x: point.x,
                y: point.y,
                width: stamp.width,
                height: stamp.height,
                rotate: degrees(rotation),
            });
        },
    };
}

async function readInputPdfBytes(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return isImageFileName(file.name)
        ? await convertImageBytesToPdf(bytes, getExtname(file.name) === '.png')
        : bytes;
}

async function processFile(selectedFile: SelectedStampFile, options: WebStampOptions, tabIndex: number): Promise<StampedPdf | null> {
    if (!selectedFile.evidenceNumber || !selectedFile.supported) {
        return null;
    }

    appendLog(`処理中: ${selectedFile.file.name}`);
    const inputBytes = await readInputPdfBytes(selectedFile.file);
    const result = await stampPdfBytes(
        inputBytes,
        selectedFile.evidenceNumber,
        (pdfDoc, stampText) => makeImagePainter(pdfDoc, stampText),
        {
            allPages: options.allPages,
            mints: options.mints,
            tab: options.tab,
            tabIndex,
            tabSteps: options.tabSteps,
        },
    );

    appendLog(`完了: ${result.stampText}`);
    return {
        filename: buildOutputFilename(selectedFile.file.name, selectedFile.evidenceNumber, options.mints),
        evidenceNumber: selectedFile.evidenceNumber,
        bytes: result.bytes,
        pageCount: result.pageCount,
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
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * ZIP の名前。mints は `mints_号証一式.zip`、それ以外は番号の種別から（`stamped_号証一式.zip` など）。
 */
function buildZipName(evidenceNumbers: string[], mints: boolean) {
    if (mints) return 'mints_号証一式.zip';
    const kinds = new Set(evidenceNumbers.map(getMaterialKind));
    return kinds.size === 1 ? `stamped_${[...kinds][0]}一式.zip` : 'stamped_一式.zip';
}

function buildOutputZip(stampedPdfs: StampedPdf[], folder: string, merged: { name: string; bytes: Uint8Array } | null) {
    const entries = stampedPdfs.map(pdf => ({
        path: `${folder}/${pdf.filename}`,
        data: pdf.bytes,
    }));

    if (merged) {
        entries.push({
            path: `${folder}/${merged.name}`,
            data: merged.bytes,
        });
    }

    return buildStoredZip(entries);
}

function getOptions(): WebStampOptions {
    const mints = mintsCheckbox.checked;
    const steps = Math.floor(Number(tabStepsInput.value));
    return {
        allPages: allPagesCheckbox.checked,
        insertBlankPages: !noBlankPagesCheckbox.checked,
        tab: !mints && tabCheckbox.checked,
        tabSteps: Number.isFinite(steps) && steps >= 1 ? Math.min(steps, 20) : DEFAULT_TAB_STEPS,
        mints,
        combinedName: combinedNameInput.value,
    };
}

function updateOptionAvailability() {
    const mints = mintsCheckbox.checked;
    // mints は1証拠1ファイルで結合せず、帯も付けない
    for (const input of [tabCheckbox, noBlankPagesCheckbox, combinedNameInput]) {
        input.disabled = mints;
    }
    tabStepsInput.disabled = mints || !tabCheckbox.checked;
}

function getStampTargets() {
    return selectedFiles.filter(item => item.supported && item.evidenceNumber);
}

function updateSelectedFiles(files: File[]) {
    selectedFiles = files
        .map(file => ({
            file,
            evidenceNumber: extractEvidenceNumber(file.name),
            supported: isSupportedFile(file),
        }))
        .sort((a, b) => {
            // 番号の読めないファイルは後ろへ
            const aTarget = a.supported && a.evidenceNumber ? 0 : 1;
            const bTarget = b.supported && b.evidenceNumber ? 0 : 1;
            return aTarget - bTarget
                || compareSortKeys(naturalSortKey(a.file.name), naturalSortKey(b.file.name))
                || a.file.name.localeCompare(b.file.name, 'ja');
        });

    renderSelection();
}

function renderSelection() {
    const mints = mintsCheckbox.checked;
    const stampable = getStampTargets();
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
            appendLog(`除外: ${item.file.name}（ファイル名の先頭に号証番号・資料番号がありません）`);
        } else {
            appendLog(`対象: ${buildStampText(item.evidenceNumber, mints)} ← ${item.file.name}`);
        }
    }
}

async function runStamp() {
    if (!(window as any).PDFLib) {
        setStatus('PDF処理ライブラリを読み込めませんでした。ネットワークを確認してください。');
        return;
    }

    const targets = getStampTargets();
    if (targets.length === 0) {
        return;
    }

    const options = getOptions();
    let combinedName: string | null = null;
    try {
        combinedName = options.mints ? null : normalizeCombinedName(options.combinedName);
    } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
        combinedNameInput.focus();
        return;
    }
    // 結合PDFの名前が個別のPDFの名前と同じだと、ZIP の中で重なる
    if (combinedName && targets.length > 1) {
        const clash = targets.find(item => buildOutputFilename(item.file.name, item.evidenceNumber!).toLowerCase() === combinedName!.toLowerCase());
        if (clash) {
            setStatus(`結合PDFの名前「${combinedName}」が、個別のPDF（${clash.file.name}）と同じです。別の名前にしてください。`);
            combinedNameInput.focus();
            return;
        }
    }

    const merging = !options.mints && targets.length > 1;
    const totalSteps = targets.length + (merging ? 1 : 0);
    stampButton.disabled = true;
    setStatus('作成中...');
    setProgress(0, totalSteps);
    stampLog.value = '';

    try {
        const stampedPdfs: StampedPdf[] = [];

        // 帯の段は、スタンプするファイルの中での順番で決める（隣り合う号証は必ず別の段になる）
        for (let index = 0; index < targets.length; index++) {
            const stampedPdf = await processFile(targets[index], options, index);
            if (stampedPdf) {
                stampedPdfs.push(stampedPdf);
            }
            setProgress(index + 1, totalSteps);
        }

        if (stampedPdfs.length === 1) {
            downloadBytes(stampedPdfs[0].filename, stampedPdfs[0].bytes, 'application/pdf');
            setProgress(1, 1);
            if (combinedName) {
                appendLog(`結合PDFは2件以上のときだけ作るので、「${combinedName}」は作りませんでした。`);
            }
            setStatus('作成しました。');
            return;
        }

        const evidenceNumbers = stampedPdfs.map(pdf => pdf.evidenceNumber);
        const zipName = buildZipName(evidenceNumbers, options.mints);
        if (options.mints) {
            downloadBytes(zipName, buildOutputZip(stampedPdfs, 'mints', null), 'application/zip');
            setStatus(`作成しました。mints 提出用の${stampedPdfs.length}件を ZIP にまとめました（結合PDFは作りません）。`);
            return;
        }

        const merged = await mergeStampedPdfBytes(stampedPdfs.map(pdf => pdf.bytes), { insertBlankPages: options.insertBlankPages });
        const mergedName = buildCombinedName(evidenceNumbers, combinedName);
        downloadBytes(zipName, buildOutputZip(stampedPdfs, 'stamped', { name: mergedName, bytes: merged.bytes }), 'application/zip');
        setProgress(totalSteps, totalSteps);
        appendLog(`結合PDF: ${mergedName}（${merged.totalPages}ページ、空白ページ ${merged.blankPages}ページ）`);
        setStatus(`作成しました。${stampedPdfs.length}件と結合PDFを ZIP にまとめました。`);
    } catch (err) {
        console.error(err);
        appendLog(`エラー: ${err instanceof Error ? err.message : String(err)}`);
        setStatus('作成に失敗しました。ファイルを確認してください。');
    } finally {
        stampButton.disabled = getStampTargets().length === 0;
    }
}

function filesFromInput(fileList: FileList | null) {
    return Array.from(fileList || []);
}

chooseFilesButton.addEventListener('click', () => fileInput.click());
stampButton.addEventListener('click', runStamp);
fileInput.addEventListener('change', () => updateSelectedFiles(filesFromInput(fileInput.files)));
mintsCheckbox.addEventListener('change', () => {
    updateOptionAvailability();
    renderSelection();
});
tabCheckbox.addEventListener('change', updateOptionAvailability);

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
    }
});
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
updateOptionAvailability();
updateSelectedFiles([]);
