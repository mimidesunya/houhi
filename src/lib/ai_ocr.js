const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const AdminZip = require('adm-zip');
const WordExtractor = require('word-extractor');
const GeminiBatchProcessor = require('./gemini_batch');
const { ClaudeOcrProcessor } = require('./claude_client');
const { OpenAIOcrProcessor } = require('./openai_client.js');
const os = require('os');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const { extractPdfToImages } = require('./pdf_to_image.js');
const { runNdlocr } = require('./ndlocr_runner.js');
const { loadConfig, getGeminiChatModel } = require('./gemini_client.js');

function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

function getOcrPrompt(numPages, contextInstruction = "") {
    return `
# ROLE
High-precision OCR engine converting Japanese PDF pages to clean Markdown.

${contextInstruction}

# INPUT
${numPages} pages of a Japanese document.

# OUTPUT RULES
1. **Markdown Only**: No conversational text.
2. **No Skipping**: Even if the first page starts mid-sentence or mid-paragraph (continuation from a previous unprovided page), transcribe it completely from the very first character.
3. **Page Markers**:
   - **Start**: At the start of content, output \`### -- Begin Page N {StartStatus} --\`.
     - N: Batch page index (1-${numPages}).
     - {StartStatus}: "(Continuation)" if the text at the very top of the page is a direct continuation of a paragraph from the previous page (cut off mid-sentence without a line break), else empty.
   - **End**: At the end of content, output \`### -- End {PrintedPageInfo} {EndStatus} --\`.
     - {PrintedPageInfo}: "(Printed Page X)" if a printed page number X is found (CONVERT Kanji/Roman to Arabic). If not found, leave empty.
     - {EndStatus}: "(Continuation)" if the paragraph is cut off mid-sentence and continues to the next page without an explicit line break, else empty.
4. **Transcription Rules**:
   - **No Indentation**: Standard Markdown paragraphs.
   - **Numbers**: Convert ALL full-width numbers to half-width (e.g., "１" -> "1"). 
   - **Corrections**: Fix obvious OCR errors (0 vs O). Keep original typos with \`(-- as is)\`.
   - **Visuals**: If there are photos or diagrams, provide an explanation for them in Japanese formatted as \`(--! Explanation)\`.
   - **Exclusions**: Omit printed page numbers from body.
     - **Redactions**: Replace blacked-out or redacted parts with "■".
     - **Margins**:
     - Headings text in margins: Format as \`(--# Text)\`.
     - Annotations/Notes in margins: Format as \`(--* Text)\`.
`;
}

function getWordPrompt(contextInstruction = "") {
    return `
# ROLE
High-precision document transcribing engine converting Japanese Word (.docx) content (XML and associated images) to clean Markdown.

${contextInstruction}

# INPUT
The following parts represent a Japanese Word (.docx) document:
1. **XML Content**: The raw \`word/document.xml\` containing text and structural tags.
2. **Images**: Visuals (photos, diagrams) extracted from the document.

# OUTPUT RULES
1. **Markdown Only**: No conversational text.
2. **No Skipping**: Transcribe everything from the very beginning. Use the XML tags to understand the structure (headings, tables, lists) and maintain the correct sequence.
3. **Page Markers**:
   - **Start**: At the start of each logical page, output \`### -- Begin Page N --\`.
     - N: Page index (1-based).
   - **End**: At the end of each logical page, output \`### -- End {PrintedPageInfo} --\`.
     - {PrintedPageInfo}: "(Printed Page X)" if a printed page number is identified.
4. **Transcription Rules**:
   - **No Indentation**: Standard Markdown paragraphs.
   - **Numbers**: Convert ALL full-width numbers to half-width.
   - **Visuals**: Correlate the provided images with their positions in the text/XML. For each, provide a Japanese explanation formatted as \`(--! Explanation)\`.
   - **Exclusions**: Omit system tags/metadata. Keep the content clean.
`;
}

function getDocTextPrompt(contextInstruction = "") {
    return `
# ROLE
High-precision document formatting engine converting extracted Japanese Word (.doc) text to clean Markdown.

${contextInstruction}

# INPUT
Plain text extracted from a Japanese Word (.doc) document. The text structure may be somewhat degraded due to the extraction process.

# OUTPUT RULES
1. **Markdown Only**: No conversational text.
2. **No Skipping**: Format everything from the very beginning.
3. **Page Markers**:
   - **Start**: At the start of each logical section/page, output \`### -- Begin Page N --\`.
     - N: Page index (1-based). Estimate page breaks based on content flow.
   - **End**: At the end of each logical section/page, output \`### -- End --\`.
4. **Formatting Rules**:
   - **No Indentation**: Standard Markdown paragraphs.
   - **Numbers**: Convert ALL full-width numbers to half-width.
   - **Structure**: Identify and format headings, lists, and tables appropriately.
   - **Cleanup**: Remove redundant whitespace and line breaks while preserving paragraph structure.
`;
}

function createDocTextRequest(extractedText, contextInstruction = "") {
    const prompt = getDocTextPrompt(contextInstruction);
    
    return {
        contents: [
            {
                role: "user",
                parts: [
                    { text: "--- EXTRACTED DOCUMENT TEXT START ---\n" + extractedText + "\n--- EXTRACTED DOCUMENT TEXT END ---" },
                    { text: prompt }
                ]
            }
        ]
    };
}

function createDocRequest(contentParts, contextInstruction = "", isWord = false) {
    const prompt = isWord ? getWordPrompt(contextInstruction) : getOcrPrompt(contentParts.numPages, contextInstruction);
    
    const parts = [
        ...contentParts.dataParts,
        { text: prompt }
    ];

    return {
        contents: [
            {
                role: "user",
                parts: parts
            }
        ]
    };
}

// Keep createOcrRequest for backward compatibility or direct PDF use
function createOcrRequest(pdfBytes, numPages, contextInstruction = "") {
    return createDocRequest({
        dataParts: [
            {
                inlineData: {
                    mimeType: "application/pdf",
                    data: pdfBytes.toString('base64')
                }
            }
        ],
        numPages: numPages
    }, contextInstruction, false);
}

async function runBatches(requests, metadata, batchProcessor, progressState, persistenceFile, processMode = 'batch') {
    const modelId = getGeminiChatModel();
    if (processMode === 'sync') {
        console.log(`[同期] ${requests.length} 件のリクエストを同期モードで処理中...`);
        return await batchProcessor.runSync(requests, modelId, progressState);
    }
    
    // リクエストサイズを見積もり、閾値に応じてインラインかファイルバッチを選択
    const INLINE_THRESHOLD = 15 * 1024 * 1024; // 15MB（安全マージン込み）
    
    const payloadEstimate = JSON.stringify(requests).length;
    const sizeMB = (payloadEstimate / 1024 / 1024).toFixed(2);
    
    console.log(`[バッチ] ${requests.length} 件のリクエストを送信中... (見積もりサイズ: ${sizeMB} MB)`);
    
    if (payloadEstimate < INLINE_THRESHOLD) {
        console.log(`[バッチ] インラインバッチを使用 (高速モード)`);
        const results = await batchProcessor.runInlineBatch(requests, modelId, progressState, "ocr-batch-job");
        return results;
    } else {
        console.log(`[バッチ] ファイルバッチを使用 (大容量モード)`);
        const results = await batchProcessor.runFileBatch(requests, modelId, progressState, "ocr-batch-job", persistenceFile);
        return results;
    }
}

async function runClaudeBatch(requests, progressState, processMode = 'batch') {
    const processor = new ClaudeOcrProcessor();
    if (processMode === 'sync') {
        console.log(`[Claude] ${requests.length} 件のリクエストを順次処理中...`);
        return await processor.runBatch(requests, progressState, 1);
    } else {
        console.log(`[Claude] ${requests.length} 件のリクエストを並列処理中...`);
        return await processor.runBatch(requests, progressState, 2);
    }
}

async function runOpenAIBatch(requests, progressState, processMode = 'batch', persistencePath = null) {
    const processor = new OpenAIOcrProcessor();
    if (processMode === 'sync') {
        console.log(`[OpenAI] ${requests.length} 件のリクエストを同期モードで処理中...`);
        return await processor.runSync(requests, progressState, 1);
    } else {
        console.log(`[OpenAI バッチ] ${requests.length} 件のリクエストをBatch APIで処理中...`);
        return await processor.runFileBatch(requests, progressState, persistencePath);
    }
}

// 単一または少数のリクエスト用ヘルパー（Word文書用）
async function runSingleBatch(requests, batchProcessor, progressState, displayName, persistenceFile, aiProvider = 'gemini', processMode = 'batch') {
    const modelId = getGeminiChatModel();
    if (aiProvider === 'claude') {
        return await runClaudeBatch(requests, progressState, processMode);
    }
    if (aiProvider === 'openai') {
        return await runOpenAIBatch(requests, progressState, processMode, persistenceFile);
    }
    
    if (processMode === 'sync') {
        console.log(`[同期] リクエストを同期モードで処理中...`);
        return await batchProcessor.runSync(requests, modelId, progressState);
    }
    
    const INLINE_THRESHOLD = 15 * 1024 * 1024; // 15MB
    
    const payloadEstimate = JSON.stringify(requests).length;
    const sizeMB = (payloadEstimate / 1024 / 1024).toFixed(2);
    
    console.log(`[バッチ] リクエスト送信中... (見積もりサイズ: ${sizeMB} MB)`);
    
    if (payloadEstimate < INLINE_THRESHOLD) {
        console.log(`[バッチ] インラインバッチを使用 (高速モード)`);
        return await batchProcessor.runInlineBatch(requests, modelId, progressState, displayName);
    } else {
        console.log(`[バッチ] ファイルバッチを使用 (大容量モード)`);
        return await batchProcessor.runFileBatch(requests, modelId, progressState, displayName, persistenceFile);
    }
}

function extractPagesFromMarkdown(content) {
    const pageMap = new Map();
    const regex = /### -- Begin Page (\d+)/g;
    let match;
    const positions = [];

    while ((match = regex.exec(content)) !== null) {
        positions.push({ pageNum: parseInt(match[1], 10), index: match.index });
    }

    for (let i = 0; i < positions.length; i++) {
        const start = positions[i].index;
        const end = (i + 1 < positions.length) ? positions[i + 1].index : content.length;
        const pageContent = content.substring(start, end).trim();
        if (!pageContent.includes("[ERROR: OCR Failed")) {
            pageMap.set(positions[i].pageNum, pageContent);
        }
    }
    return pageMap;
}

function normalizeNdlocrText(rawText) {
    const lines = rawText.replace(/\r\n/g, '\n').split('\n');
    const merged = [];

    const endsSentence = (text) => /[。．！？!?：:；;」』）)】\]]$/.test(text);
    const startsStructuredLine = (text) => {
        return /^[・●◯■□◆◇※▶▷▼▽▲△◆◇★☆]/.test(text)
            || /^[-*#]/.test(text)
            || /^\d+[\.)．、]/.test(text)
            || /^\([0-9０-９一二三四五六七八九十]+\)/.test(text)
            || /^[ 　]{2,}/.test(text);
    };

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed === '') {
            if (merged.length > 0 && merged[merged.length - 1] !== '') {
                merged.push('');
            }
            continue;
        }

        if (merged.length === 0 || merged[merged.length - 1] === '') {
            merged.push(trimmed);
            continue;
        }

        const prev = merged[merged.length - 1];
        if (endsSentence(prev) || startsStructuredLine(trimmed)) {
            merged.push(trimmed);
        } else {
            merged[merged.length - 1] = prev + trimmed;
        }
    }

    return merged.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function getNdlocrParallelJobs() {
    const config = loadConfig();
    const raw = config?.ndlocrLite?.parallelJobs;

    const cpuCount = (() => {
        try {
            const cpus = os.cpus();
            return Array.isArray(cpus) && cpus.length > 0 ? cpus.length : 1;
        } catch (_e) {
            return 1;
        }
    })();
    const autoJobs = Math.max(1, Math.min(8, cpuCount - 1));

    if (raw === undefined || raw === null || raw === '' || String(raw).toLowerCase() === 'auto') {
        return autoJobs;
    }

    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 1) return autoJobs;
    return Math.min(parsed, 16);
}

function buildPageRanges(pageIndices) {
    if (!pageIndices || pageIndices.length === 0) return [];
    const sorted = [...pageIndices].sort((a, b) => a - b);
    const ranges = [];
    let start = sorted[0];
    let prev = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        if (current === prev + 1) {
            prev = current;
            continue;
        }
        ranges.push({ start, end: prev });
        start = current;
        prev = current;
    }
    ranges.push({ start, end: prev });
    return ranges;
}

function getRawTextFormattingPrompt(contextInstruction = "") {
    return `
# ROLE
High-precision document formatting engine converting raw OCR text to clean Markdown.

${contextInstruction}

# INPUT
Raw text extracted by an OCR engine, separated by page markers. The content may contain some OCR errors or formatting artifacts.

# OUTPUT RULES
1. **Markdown Only**: No conversational text.
2. **Formatting**: Reconstruct the original document's structure into clean Markdown paragraphs. Merge lines that are part of the same logical sentence.
3. **Headings**: Identify probable headings and format them with Markdown (#, ##, etc.).
4. **Errors**: Correct obvious OCR text recognition errors using surrounding context if possible.
5. **Numbers**: Convert ALL full-width numbers to half-width (e.g., "１" -> "1").
6. **Page Markers**:
   - Retain the exact same \`### -- Begin Page N --\` and \`### -- End --\` markers around each page's content in your output.
7. **No Skipping**: Format the entire input text completely from the beginning to the end.
`;
}

function createRawTextRequest(batchPages, pageTextMap, contextInstruction = "") {
    let combinedText = "";
    for (let j = 0; j < batchPages.length; j++) {
        const pNum = batchPages[j];
        const sourceText = pageTextMap.get(pNum) || "[未検出]";
        combinedText += `\n### -- Begin Page ${j + 1} --\n${sourceText}\n### -- End --\n`;
    }

    const prompt = getRawTextFormattingPrompt(contextInstruction);
    return {
        contents: [
            {
                role: "user",
                parts: [
                    { text: prompt },
                    { text: "--- RAW OCR TEXT START ---\n" + combinedText + "\n--- RAW OCR TEXT END ---" }
                ]
            }
        ]
    };
}

async function extractEmbeddedTextFromPdfPages(pdfPath, pageNumbers) {
    const result = new Map();
    if (!pageNumbers || pageNumbers.length === 0) {
        return result;
    }

    const pdfjsPackageDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const standardFontDataUrl = path.join(pdfjsPackageDir, 'standard_fonts') + path.sep;
    const cMapUrl = path.join(pdfjsPackageDir, 'cmaps') + path.sep;
    const pdfBytes = fs.readFileSync(pdfPath);

    const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBytes),
        standardFontDataUrl,
        cMapUrl,
        cMapPacked: true,
        useSystemFonts: false,
        disableFontFace: true,
        useWorkerFetch: false,
        isEvalSupported: false
    });

    const srcPdf = await loadingTask.promise;
    try {
        for (const pageNum of pageNumbers) {
            const page = await srcPdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const lines = textContent.items
                .map(item => (item && typeof item.str === 'string') ? item.str.trim() : '')
                .filter(Boolean);

            const joined = lines.join('\n').trim();
            if (joined.replace(/[\s\u3000]/g, '').length > 0) {
                result.set(pageNum, joined);
            }

            if (typeof page.cleanup === 'function') {
                page.cleanup();
            }
        }
    } finally {
        if (typeof srcPdf.cleanup === 'function') {
            srcPdf.cleanup();
        }
    }

    return result;
}

async function pdfToText(pdfPath, batchSize = 5, startPage = 1, endPage = null, contextInstruction = "", aiProvider = "gemini", processMode = "batch", useNdlocr = false, ndlocrOnly = false, preferPdfText = false) {
    if (ndlocrOnly) {
        useNdlocr = true;
    }
    console.log(`[情報] AIプロバイダー: ${aiProvider} / モード: ${processMode === 'sync' ? '同期' : 'バッチ'} / ndlocr: ${useNdlocr ? (ndlocrOnly ? 'Only' : 'Pre-OCR') : 'Off'} / PDFテキスト優先: ${preferPdfText ? 'On' : 'Off'}`);
    const pdfBuffer = await fsPromises.readFile(pdfPath);
    const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const totalPages = srcDoc.getPageCount();
    
    const actualEndPage = endPage || totalPages;
    console.log(`[情報] 処理開始: ${pdfPath} (${totalPages} ページ中 ${startPage} から ${actualEndPage} ページまで)`);

    const errorPath = pdfPath.replace(/\.pdf$/i, "_ERROR_paged.md");
    const normalPath = pdfPath.replace(/\.pdf$/i, "_paged.md");
    
    let pageMap = new Map();
    if (!ndlocrOnly && fs.existsSync(errorPath)) {
        const existingContent = fs.readFileSync(errorPath, 'utf-8');
        pageMap = extractPagesFromMarkdown(existingContent);
        if (pageMap.size > 0) {
            console.log(`[情報] ${errorPath} から再開します (${pageMap.size} ページ完了済み)`);
        }
    }

    const pageIndices = [];
    for (let i = startPage; i <= actualEndPage; i++) {
        if (!pageMap.has(i)) {
            pageIndices.push(i);
        }
    }

    if (pageIndices.length === 0) {
        console.log(`[情報] すべての対象ページは既に完了しています。`);
        return fs.existsSync(errorPath) ? errorPath : normalPath;
    }

    let embeddedTextMap = new Map();
    if (preferPdfText) {
        try {
            console.log(`[PDFテキスト] 埋め込みテキストを確認中...`);
            embeddedTextMap = await extractEmbeddedTextFromPdfPages(pdfPath, pageIndices);
            console.log(`[PDFテキスト] ${embeddedTextMap.size}/${pageIndices.length} ページで埋め込みテキストを検出`);
        } catch (e) {
            console.warn(`[PDFテキスト] 抽出に失敗したためOCR処理へフォールバックします: ${e.message}`);
            embeddedTextMap = new Map();
        }
    }

    const ndlocrTargetPages = pageIndices.filter(pNum => !embeddedTextMap.has(pNum));

    let ndlocrOutDir = null;
    let tmpDir = null;
    if (useNdlocr && ndlocrTargetPages.length > 0) {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndlocr_'));
        const imagesDir = path.join(tmpDir, 'images');
        ndlocrOutDir = path.join(tmpDir, 'output');
        fs.mkdirSync(imagesDir);
        fs.mkdirSync(ndlocrOutDir);

        const parallelJobs = getNdlocrParallelJobs();
        const pageRanges = buildPageRanges(ndlocrTargetPages);
        
        console.log(`[ndlocr] 対象 ${ndlocrTargetPages.length} ページを処理します。`);
        console.log(`[ndlocr] 並列ワーカー数: ${parallelJobs}`);
        try {
            for (const range of pageRanges) {
                if (range.start === range.end) {
                    console.log(`[ndlocr] 画像化中: ページ ${range.start}`);
                } else {
                    console.log(`[ndlocr] 画像化中: ページ ${range.start}-${range.end}`);
                }
                await extractPdfToImages(pdfPath, imagesDir, 300, range.start, range.end);
            }

            const imageFiles = ndlocrTargetPages
                .map(pNum => path.join(imagesDir, `page_${String(pNum).padStart(4, '0')}.png`))
                .filter(fp => fs.existsSync(fp));

            if (imageFiles.length === 0) {
                throw new Error('ndlocr に渡す画像が見つかりませんでした');
            }

            const workerCount = Math.min(parallelJobs, imageFiles.length);
            const workerDirs = [];

            if (workerCount <= 1) {
                workerDirs.push({ srcDir: imagesDir, outDir: ndlocrOutDir });
            } else {
                const workersRoot = path.join(tmpDir, 'workers');
                fs.mkdirSync(workersRoot, { recursive: true });

                const chunks = Array.from({ length: workerCount }, () => []);
                imageFiles.forEach((fp, idx) => {
                    chunks[idx % workerCount].push(fp);
                });

                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    if (chunk.length === 0) continue;
                    const srcDir = path.join(workersRoot, `w${i + 1}`, 'images');
                    const outDir = path.join(workersRoot, `w${i + 1}`, 'output');
                    fs.mkdirSync(srcDir, { recursive: true });
                    fs.mkdirSync(outDir, { recursive: true });
                    for (const fp of chunk) {
                        const dest = path.join(srcDir, path.basename(fp));
                        fs.copyFileSync(fp, dest);
                    }
                    workerDirs.push({ srcDir, outDir });
                }
            }

            const seenPages = new Set();
            const totalPages = ndlocrTargetPages.length;
            const scanProgress = () => {
                for (const dirInfo of workerDirs) {
                    const outDir = dirInfo.outDir;
                    if (!fs.existsSync(outDir)) continue;
                    for (const fileName of fs.readdirSync(outDir)) {
                        const match = fileName.match(/^page_(\d+)\.txt$/i);
                        if (!match) continue;
                        const pageNum = parseInt(match[1], 10);
                        if (seenPages.has(pageNum)) continue;
                        seenPages.add(pageNum);
                        console.log(`[ndlocr] 完了: ページ ${pageNum} (${seenPages.size}/${totalPages})`);
                    }
                }
            };

            const timer = setInterval(scanProgress, 1000);

            try {
                await Promise.all(workerDirs.map((dirInfo, idx) => {
                    console.log(`[ndlocr] ワーカー ${idx + 1}/${workerDirs.length} 開始`);
                    return runNdlocr(dirInfo.srcDir, dirInfo.outDir, true);
                }));
            } finally {
                clearInterval(timer);
                scanProgress();
            }

            if (workerDirs.length > 1) {
                for (const dirInfo of workerDirs) {
                    const outDir = dirInfo.outDir;
                    if (!fs.existsSync(outDir)) continue;
                    for (const fileName of fs.readdirSync(outDir)) {
                        const src = path.join(outDir, fileName);
                        const dst = path.join(ndlocrOutDir, fileName);
                        fs.copyFileSync(src, dst);
                    }
                }
            }

            console.log(`[ndlocr] ndlocr-lite の処理が完了しました。`);
        } catch (err) {
            console.error(`[ndlocr エラー] ${err.message}`);
            if (ndlocrOnly) {
                throw err;
            }
            console.log(`[ndlocr] ndlocr-lite の結果なしで通常のAI OCRを続行します。`);
            useNdlocr = false;
        }
    } else if (useNdlocr && ndlocrTargetPages.length === 0) {
        console.log(`[ndlocr] すべての対象ページで埋め込みテキストを検出したため、ndlocr実行をスキップします。`);
    }

    if (ndlocrOnly) {
        console.log(`[ndlocr-only] AI後処理なしでテキストを組み立てます。`);
        for (const pNum of pageIndices) {
            let sourceText = null;
            if (embeddedTextMap.has(pNum)) {
                sourceText = embeddedTextMap.get(pNum);
            } else if (ndlocrOutDir) {
                const fileName = `page_${String(pNum).padStart(4, '0')}.txt`;
                const txtPath = path.join(ndlocrOutDir, fileName);
                if (fs.existsSync(txtPath)) {
                    sourceText = fs.readFileSync(txtPath, 'utf8');
                }
            }

            if (sourceText !== null) {
                const pageContent = normalizeNdlocrText(sourceText);
                pageMap.set(pNum, pageContent);
            }
        }
    } else {
        const pageTextMap = new Map();
        for (const pNum of pageIndices) {
            if (embeddedTextMap.has(pNum)) {
                pageTextMap.set(pNum, embeddedTextMap.get(pNum));
            } else if (useNdlocr && ndlocrOutDir) {
                const fileName = `page_${String(pNum).padStart(4, '0')}.txt`;
                const txtPath = path.join(ndlocrOutDir, fileName);
                if (fs.existsSync(txtPath)) {
                    pageTextMap.set(pNum, fs.readFileSync(txtPath, 'utf8'));
                }
            }
        }

        // 1. Prepare all requests
        const requests = [];
        const batchMetadata = [];
        const effectiveBatchSize = preferPdfText ? 1 : batchSize;
        
        for (let i = 0; i < pageIndices.length; i += effectiveBatchSize) {
            const batch = pageIndices.slice(i, i + effectiveBatchSize);

            const hasTextForAllPages = batch.every(pNum => pageTextMap.has(pNum));

            if (hasTextForAllPages) {
                requests.push(createRawTextRequest(batch, pageTextMap, contextInstruction));
                batchMetadata.push({ startPage: batch[0], numPages: batch.length, pages: batch });
                continue;
            }

            if (useNdlocr) {
                const fallbackTextMap = new Map();
                for (const pNum of batch) {
                    fallbackTextMap.set(pNum, pageTextMap.get(pNum) || "[未検出]");
                }
                requests.push(createRawTextRequest(batch, fallbackTextMap, contextInstruction));
                batchMetadata.push({ startPage: batch[0], numPages: batch.length, pages: batch });
                continue;
            }

            const newDoc = await PDFDocument.create();
            for (const pNum of batch) {
                const [copiedPage] = await newDoc.copyPages(srcDoc, [pNum - 1]);
                newDoc.addPage(copiedPage);
            }

            const batchPdfBytes = await newDoc.save();

            requests.push(createOcrRequest(Buffer.from(batchPdfBytes), batch.length, contextInstruction));
            
            batchMetadata.push({ startPage: batch[0], numPages: batch.length, pages: batch });
        }

        // 2. Run Batch(es) with Retry Logic
        const batchProcessor = aiProvider === 'claude' ? null : new GeminiBatchProcessor();
        let pendingIndices = requests.map((_, i) => i);
        let retryCount = 0;
        const MAX_RETRIES = 3;

        const progressState = {
            completed: 0,
            total: requests.length,
            startTime: Date.now()
        };

        // ページマップの中間結果をディスクに保存するヘルパー
        const saveIntermediateResults = () => {
            if (pageMap.size === 0) return;
            let tmpMarkdown = "";
            for (let i = startPage; i <= actualEndPage; i++) {
                if (pageMap.has(i)) {
                    tmpMarkdown += pageMap.get(i) + "\n\n";
                } else {
                    tmpMarkdown += `### -- Begin Page ${i} --\n\n[ERROR: OCR Failed for page ${i}]\n\n`;
                }
            }
            fs.writeFileSync(errorPath, tmpMarkdown, 'utf-8');
            console.log(`[情報] 中間結果を ${errorPath} に保存しました (${pageMap.size} ページ完了)`);
        };

        while (pendingIndices.length > 0) {
            if (retryCount >= MAX_RETRIES) {
                console.error(`[エラー] リトライ上限に達しました。${pendingIndices.length} 件のバッチが失敗しました。`);
                break;
            }
            
            if (retryCount > 0) {
                console.log(`[情報] ${pendingIndices.length} 件のバッチをリトライ中 (試行 ${retryCount}/${MAX_RETRIES})...`);
            }

            const currentRequests = pendingIndices.map(i => requests[i]);
            const currentMetadata = pendingIndices.map(i => batchMetadata[i]);
            
            let batchResults;
            try {
                if (aiProvider === 'claude') {
                    batchResults = await runClaudeBatch(currentRequests, progressState, processMode);
                } else if (aiProvider === 'openai') {
                    const persistenceFile = `${pdfPath}.batch_state.txt`;
                    batchResults = await runOpenAIBatch(currentRequests, progressState, processMode, persistenceFile);
                } else {
                    // Resilience: Use a persistence file for the batch state
                    const persistenceFile = `${pdfPath}.batch_state.txt`;
                    batchResults = await runBatches(currentRequests, currentMetadata, batchProcessor, progressState, persistenceFile, processMode);
                }
            } catch (batchError) {
                console.error(`[エラー] バッチAPI呼び出しが失敗しました: ${batchError.message}`);
                // バッチ全体が失敗した場合、中間結果を保存してリトライを続行
                saveIntermediateResults();
                retryCount++;
                continue;
            }

            const nextPendingIndices = [];

            for (let i = 0; i < batchResults.length; i++) {
                const originalIndex = pendingIndices[i];
                const result = batchResults[i];
                const meta = batchMetadata[originalIndex];
                
                let success = false;
                let text = "";

                if (!result.error && result.response?.candidates?.[0]?.content?.parts) {
                    text = result.response.candidates[0].content.parts.map(p => p.text).join('');
                    
                    // Validation
                    const beginCount = (text.match(/### -- Begin Page \d+/g) || []).length;
                    const endCount = (text.match(/### -- End/g) || []).length;

                    if (beginCount === meta.numPages && endCount === meta.numPages) {
                        success = true;
                    } else {
                        console.warn(`[警告] バッチ ${originalIndex} (ページ ${meta.pages.join(',')}) の検証に失敗しました。期待されるマーカー数: ${meta.numPages}, 実際: 開始:${beginCount}, 終了:${endCount}。`);
                    }
                } else {
                    console.warn(`[警告] バッチ ${originalIndex} APIエラー: ${JSON.stringify(result.error || "内容なし")}`);
                }

                if (success) {
                    // Fix page numbers (Relative -> Absolute)
                    const absoluteText = text.replace(/### -- Begin Page (\d+)/g, (match, p1) => {
                        const relativePage = parseInt(p1, 10);
                        const absolutePage = meta.pages[relativePage - 1];
                        return `### -- Begin Page ${absolutePage}`;
                    });
                    
                    const batchPages = extractPagesFromMarkdown(absoluteText);
                    for (const [pNum, pContent] of batchPages) {
                        pageMap.set(pNum, pContent);
                    }
                } else {
                    nextPendingIndices.push(originalIndex);
                }
            }

            pendingIndices = nextPendingIndices;
            retryCount++;

            // リトライ間で中間結果を保存（クラッシュ耐性）
            if (pendingIndices.length > 0 && pageMap.size > 0) {
                saveIntermediateResults();
            }
        }
    }

    // 3. Assemble results
    let allMarkdown = "";
    let hasError = false;

    if (ndlocrOnly) {
        for (let i = startPage; i <= actualEndPage; i++) {
            if (pageMap.has(i)) {
                allMarkdown += `----- Page ${i} -----\n${pageMap.get(i)}\n\n`;
            } else {
                allMarkdown += `----- Page ${i} -----\n[ERROR: OCR Failed for page ${i}]\n\n`;
                hasError = true;
            }
        }
    } else {
        for (let i = startPage; i <= actualEndPage; i++) {
            if (pageMap.has(i)) {
                allMarkdown += pageMap.get(i) + "\n\n";
            } else {
                allMarkdown += `### -- Begin Page ${i} --\n\n[ERROR: OCR Failed for page ${i}]\n\n`;
                hasError = true;
            }
        }
    }

    if (tmpDir && fs.existsSync(tmpDir)) {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (e) {
            console.warn(`[警告] 一時ディレクトリの削除に失敗しました: ${e.message}`);
        }
    }

    if (hasError) {
        fs.writeFileSync(errorPath, allMarkdown, 'utf-8');
        console.log(`[警告] エラーを含んだ状態で ${errorPath} に保存されました`);
        if (fs.existsSync(normalPath)) fs.unlinkSync(normalPath);
        return errorPath;
    } else {
        fs.writeFileSync(normalPath, allMarkdown, 'utf-8');
        console.log(`[成功] ${normalPath} に保存されました`);
        if (fs.existsSync(errorPath)) fs.unlinkSync(errorPath);
        return normalPath;
    }
}

async function docToText(docPath, contextInstruction = "", aiProvider = "gemini", processMode = "batch") {
    console.log(`[情報] Word文書(doc)の解析を開始: ${docPath} (AI: ${aiProvider}, モード: ${processMode === 'sync' ? '同期' : 'バッチ'})`);
    const normalPath = docPath.replace(/\.doc$/i, "_paged.md");

    try {
        // word-extractorを使用してテキストを抽出
        const extractor = new WordExtractor();
        const extracted = await extractor.extract(docPath);
        const extractedText = extracted.getBody();
        
        if (!extractedText || extractedText.trim().length === 0) {
            throw new Error("テキストを抽出できませんでした");
        }
        
        console.log(`[情報] テキスト抽出完了 (${extractedText.length} 文字)`);

        const batchProcessor = aiProvider === 'claude' ? null : new GeminiBatchProcessor();
        const progressState = {
            completed: 0,
            total: 1,
            startTime: Date.now()
        };

        const request = createDocTextRequest(extractedText, contextInstruction);

        const persistenceFile = `${docPath}.batch_state.txt`;
        const results = await runSingleBatch([request], batchProcessor, progressState, "word-batch-job", persistenceFile, aiProvider, processMode);
        const result = results[0];

        if (!result.error && result.response?.candidates?.[0]?.content?.parts) {
            let text = result.response.candidates[0].content.parts.map(p => p.text).join('');
            fs.writeFileSync(normalPath, text, 'utf-8');
            console.log(`[成功] ${normalPath} に保存されました`);
            return normalPath;
        } else {
            throw new Error(JSON.stringify(result.error || "内容なし"));
        }
    } catch (e) {
        const errorMsg = `[エラー] Word文書(doc)の処理に失敗しました: ${e.message}`;
        console.error(errorMsg);
        throw e;
    }
}

async function docxToText(docxPath, contextInstruction = "", aiProvider = "gemini", processMode = "batch") {
    console.log(`[情報] Word文書(docx)の解析を開始: ${docxPath} (AI: ${aiProvider}, モード: ${processMode === 'sync' ? '同期' : 'バッチ'})`);
    const normalPath = docxPath.replace(/\.docx$/i, "_paged.md");

    try {
        const zip = new AdminZip(docxPath);
        const dataParts = [];

        // 1. 本文XMLの抽出
        const documentXml = zip.readAsText("word/document.xml");
        if (documentXml) {
            dataParts.push({ text: "--- WORD DOCUMENT XML START ---\n" + documentXml + "\n--- WORD DOCUMENT XML END ---" });
        }

        // 2. 画像ファイルの抽出 (word/media/ 内の全ファイル)
        const entries = zip.getEntries();
        for (const entry of entries) {
            if (entry.entryName.startsWith("word/media/") && !entry.isDirectory) {
                const buffer = entry.getData();
                const ext = path.extname(entry.entryName).toLowerCase();
                let mimeType = "image/jpeg"; // default
                if (ext === ".png") mimeType = "image/png";
                else if (ext === ".webp") mimeType = "image/webp";
                else if (ext === ".gif") mimeType = "image/gif";

                dataParts.push({
                    inlineData: {
                        mimeType: mimeType,
                        data: buffer.toString('base64')
                    }
                });
            }
        }

        const batchProcessor = aiProvider === 'claude' ? null : new GeminiBatchProcessor();
        const progressState = {
            completed: 0,
            total: 1,
            startTime: Date.now()
        };

        const request = createDocRequest(
            { dataParts: dataParts, numPages: "Unknown" },
            contextInstruction,
            true
        );

        const persistenceFile = `${docxPath}.batch_state.txt`;
        const results = await runSingleBatch([request], batchProcessor, progressState, "word-batch-job", persistenceFile, aiProvider, processMode);
        const result = results[0];

        if (!result.error && result.response?.candidates?.[0]?.content?.parts) {
            let text = result.response.candidates[0].content.parts.map(p => p.text).join('');
            fs.writeFileSync(normalPath, text, 'utf-8');
            console.log(`[成功] ${normalPath} に保存されました`);
            return normalPath;
        } else {
            throw new Error(JSON.stringify(result.error || "内容なし"));
        }
    } catch (e) {
        const errorMsg = `[エラー] Word文書の処理に失敗しました: ${e.message}`;
        console.error(errorMsg);
        throw e;
    }
}

async function odtToText(odtPath, contextInstruction = "", aiProvider = "gemini", processMode = "batch") {
    console.log(`[情報] ODT文書の解析を開始: ${odtPath} (AI: ${aiProvider}, モード: ${processMode === 'sync' ? '同期' : 'バッチ'})`);
    const normalPath = odtPath.replace(/\.odt$/i, "_paged.md");

    try {
        const zip = new AdminZip(odtPath);
        const dataParts = [];

        // 1. 本文XMLの抽出
        const contentXml = zip.readAsText("content.xml");
        if (contentXml) {
            dataParts.push({ text: "--- ODT CONTENT XML START ---\n" + contentXml + "\n--- ODT CONTENT XML END ---" });
        }

        // 2. スタイルXMLの抽出（構造の理解に役立つ）
        const stylesXml = zip.readAsText("styles.xml");
        if (stylesXml) {
            dataParts.push({ text: "--- ODT STYLES XML START ---\n" + stylesXml + "\n--- ODT STYLES XML END ---" });
        }

        // 3. 画像ファイルの抽出 (Pictures/ 内の全ファイル)
        const entries = zip.getEntries();
        for (const entry of entries) {
            if (entry.entryName.startsWith("Pictures/") && !entry.isDirectory) {
                const buffer = entry.getData();
                const ext = path.extname(entry.entryName).toLowerCase();
                let mimeType = "image/jpeg";
                if (ext === ".png") mimeType = "image/png";
                else if (ext === ".webp") mimeType = "image/webp";
                else if (ext === ".gif") mimeType = "image/gif";
                else if (ext === ".svg") continue; // SVGはスキップ

                dataParts.push({
                    inlineData: {
                        mimeType: mimeType,
                        data: buffer.toString('base64')
                    }
                });
            }
        }

        const batchProcessor = aiProvider === 'claude' ? null : new GeminiBatchProcessor();
        const progressState = { completed: 0, total: 1, startTime: Date.now() };

        const prompt = getWordPrompt(contextInstruction); // Word用プロンプトを流用（XML→Markdown変換として十分）
        const request = {
            contents: [{
                role: "user",
                parts: [...dataParts, { text: prompt }]
            }]
        };

        const persistenceFile = `${odtPath}.batch_state.txt`;
        const results = await runSingleBatch([request], batchProcessor, progressState, "odt-batch-job", persistenceFile, aiProvider, processMode);
        const result = results[0];

        if (!result.error && result.response?.candidates?.[0]?.content?.parts) {
            let text = result.response.candidates[0].content.parts.map(p => p.text).join('');
            fs.writeFileSync(normalPath, text, 'utf-8');
            console.log(`[成功] ${normalPath} に保存されました`);
            return normalPath;
        } else {
            throw new Error(JSON.stringify(result.error || "内容なし"));
        }
    } catch (e) {
        console.error(`[エラー] ODT文書の処理に失敗しました: ${e.message}`);
        throw e;
    }
}

function getPptxPrompt(contextInstruction = "") {
    return `
# ROLE
High-precision document transcribing engine converting Japanese PowerPoint (.pptx) slide content (XML and associated images) to clean Markdown.

${contextInstruction}

# INPUT
The following parts represent a Japanese PowerPoint (.pptx) presentation:
1. **XML Content**: The raw slide XML files containing text and structural tags.
2. **Images**: Visuals (photos, diagrams) extracted from the slides.

# OUTPUT RULES
1. **Markdown Only**: No conversational text.
2. **No Skipping**: Transcribe every slide from the very beginning.
3. **Page Markers**:
   - **Start**: At the start of each slide, output \`### -- Begin Page N --\`.
     - N: Slide number (1-based).
   - **End**: At the end of each slide, output \`### -- End --\`.
4. **Transcription Rules**:
   - **No Indentation**: Standard Markdown paragraphs.
   - **Numbers**: Convert ALL full-width numbers to half-width.
   - **Slide Titles**: Use ## for slide titles.
   - **Bullet Points**: Use standard Markdown list syntax.
   - **Tables**: Format as Markdown tables.
   - **Visuals**: Correlate the provided images with their positions. For each, provide a Japanese explanation formatted as \`(--! Explanation)\`.
   - **Speaker Notes**: If present in the XML, include them formatted as \`> Note: ...\`.
   - **Exclusions**: Omit system tags/metadata. Keep the content clean.
`;
}

async function pptxToText(pptxPath, contextInstruction = "", aiProvider = "gemini", processMode = "batch") {
    console.log(`[情報] PowerPoint文書の解析を開始: ${pptxPath} (AI: ${aiProvider}, モード: ${processMode === 'sync' ? '同期' : 'バッチ'})`);
    const normalPath = pptxPath.replace(/\.pptx$/i, "_paged.md");

    try {
        const zip = new AdminZip(pptxPath);
        const dataParts = [];

        // 1. スライドXMLの抽出（番号順にソート）
        const entries = zip.getEntries();
        const slideEntries = entries
            .filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
            .sort((a, b) => {
                const numA = parseInt(a.entryName.match(/slide(\d+)/)[1]);
                const numB = parseInt(b.entryName.match(/slide(\d+)/)[1]);
                return numA - numB;
            });

        for (const entry of slideEntries) {
            const xml = zip.readAsText(entry.entryName);
            const slideNum = entry.entryName.match(/slide(\d+)/)[1];
            dataParts.push({ text: `--- SLIDE ${slideNum} XML START ---\n${xml}\n--- SLIDE ${slideNum} XML END ---` });
        }

        // 2. ノートの抽出
        const noteEntries = entries
            .filter(e => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(e.entryName))
            .sort((a, b) => {
                const numA = parseInt(a.entryName.match(/notesSlide(\d+)/)[1]);
                const numB = parseInt(b.entryName.match(/notesSlide(\d+)/)[1]);
                return numA - numB;
            });

        for (const entry of noteEntries) {
            const xml = zip.readAsText(entry.entryName);
            const noteNum = entry.entryName.match(/notesSlide(\d+)/)[1];
            dataParts.push({ text: `--- NOTES FOR SLIDE ${noteNum} START ---\n${xml}\n--- NOTES FOR SLIDE ${noteNum} END ---` });
        }

        // 3. 画像ファイルの抽出 (ppt/media/ 内)
        for (const entry of entries) {
            if (entry.entryName.startsWith("ppt/media/") && !entry.isDirectory) {
                const buffer = entry.getData();
                const ext = path.extname(entry.entryName).toLowerCase();
                let mimeType = "image/jpeg";
                if (ext === ".png") mimeType = "image/png";
                else if (ext === ".webp") mimeType = "image/webp";
                else if (ext === ".gif") mimeType = "image/gif";
                else if (ext === ".emf" || ext === ".wmf" || ext === ".svg") continue; // 非対応形式はスキップ

                dataParts.push({
                    inlineData: {
                        mimeType: mimeType,
                        data: buffer.toString('base64')
                    }
                });
            }
        }

        console.log(`[情報] ${slideEntries.length} スライドを検出`);

        const batchProcessor = aiProvider === 'claude' ? null : new GeminiBatchProcessor();
        const progressState = { completed: 0, total: 1, startTime: Date.now() };

        const prompt = getPptxPrompt(contextInstruction);
        const request = {
            contents: [{
                role: "user",
                parts: [...dataParts, { text: prompt }]
            }]
        };

        const persistenceFile = `${pptxPath}.batch_state.txt`;
        const results = await runSingleBatch([request], batchProcessor, progressState, "pptx-batch-job", persistenceFile, aiProvider, processMode);
        const result = results[0];

        if (!result.error && result.response?.candidates?.[0]?.content?.parts) {
            let text = result.response.candidates[0].content.parts.map(p => p.text).join('');
            fs.writeFileSync(normalPath, text, 'utf-8');
            console.log(`[成功] ${normalPath} に保存されました`);
            return normalPath;
        } else {
            throw new Error(JSON.stringify(result.error || "内容なし"));
        }
    } catch (e) {
        console.error(`[エラー] PowerPoint文書の処理に失敗しました: ${e.message}`);
        throw e;
    }
}

module.exports = {
    pdfToText,
    docToText,
    docxToText,
    odtToText,
    pptxToText,
    getOcrPrompt
};
