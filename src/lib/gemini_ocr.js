const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const GeminiBatchProcessor = require('./gemini_batch');

const MODEL_ID = "gemini-3-flash-preview"; 

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
   - **Exclusions**: Omit printed page numbers from body.
   - **Margins**:
     - Headings text in margins: Format as \`(--# Text)\`.
     - Annotations/Notes in margins: Format as \`(--* Text)\`.
`;
}

function createOcrRequest(pdfBytes, numPages, contextInstruction = "") {
    const prompt = getOcrPrompt(numPages, contextInstruction);
    const base64Data = pdfBytes.toString('base64');

    return {
        contents: [
            {
                role: "user",
                parts: [
                    {
                        inlineData: {
                            mimeType: "application/pdf",
                            data: base64Data
                        }
                    },
                    { text: prompt }
                ]
            }
        ]
    };
}

async function runBatches(requests, batchProcessor, progressState) {
    let currentBatchRequests = [];
    let currentBatchSize = 0;
    const MAX_BATCH_SIZE = 19 * 1024 * 1024; // 19MB
    const allResults = [];

    const processBatch = async () => {
        if (currentBatchRequests.length === 0) return;
        
        const batchCount = currentBatchRequests.length;
        console.log(`[Batch] Sending batch job with ${batchCount} requests...`);
        
        const results = await batchProcessor.runInlineBatch(currentBatchRequests, MODEL_ID, progressState);
        allResults.push(...results);
        
        progressState.completed += batchCount;
        const elapsed = Date.now() - progressState.startTime;
        const avgTimePerRequest = elapsed / progressState.completed;
        const remainingRequests = progressState.total - progressState.completed;
        const estimatedRemaining = avgTimePerRequest * remainingRequests;

        console.log(`[Batch] Completed: ${progressState.completed}/${progressState.total} requests`);
        console.log(`[Batch] Elapsed: ${formatTime(elapsed)} | Remaining: ${formatTime(estimatedRemaining)} (est.)`);
        
        currentBatchRequests = [];
        currentBatchSize = 0;
    };

    for (const req of requests) {
        const reqSize = JSON.stringify(req).length;
        if (currentBatchSize + reqSize > MAX_BATCH_SIZE) {
            await processBatch();
        }
        currentBatchRequests.push(req);
        currentBatchSize += reqSize;
    }

    await processBatch();
    
    return allResults;
}

async function pdfToText(pdfPath, batchSize = 5, startPage = 1, endPage = null, contextInstruction = "") {
    const pdfBuffer = fs.readFileSync(pdfPath);
    const srcDoc = await PDFDocument.load(pdfBuffer);
    const totalPages = srcDoc.getPageCount();
    
    const actualEndPage = endPage || totalPages;
    console.log(`[INFO] Processing ${pdfPath} (Pages ${startPage} to ${actualEndPage} of ${totalPages})`);

    const pageIndices = [];
    for (let i = startPage; i <= actualEndPage; i++) {
        pageIndices.push(i);
    }

    // 1. Prepare all requests
    const requests = [];
    const batchMetadata = [];
    
    for (let i = 0; i < pageIndices.length; i += batchSize) {
        const batch = pageIndices.slice(i, i + batchSize);
        // console.log(`[INFO] Preparing batch: pages ${batch.join(', ')}`);

        const newDoc = await PDFDocument.create();
        for (const pNum of batch) {
            const [copiedPage] = await newDoc.copyPages(srcDoc, [pNum - 1]);
            newDoc.addPage(copiedPage);
        }

        const batchPdfBytes = await newDoc.save();
        requests.push(createOcrRequest(Buffer.from(batchPdfBytes), batch.length, contextInstruction));
        batchMetadata.push({ startPage: batch[0], numPages: batch.length });
    }

    // 2. Run Batch(es) with Retry Logic
    const batchProcessor = new GeminiBatchProcessor();
    const finalResults = new Array(requests.length).fill(null);
    let pendingIndices = requests.map((_, i) => i);
    let retryCount = 0;
    const MAX_RETRIES = 3;

    const progressState = {
        completed: 0,
        total: requests.length,
        startTime: Date.now()
    };

    while (pendingIndices.length > 0) {
        if (retryCount >= MAX_RETRIES) {
            console.error(`[ERROR] Max retries reached. ${pendingIndices.length} batches failed.`);
            break;
        }
        
        if (retryCount > 0) {
            console.log(`[INFO] Retrying ${pendingIndices.length} batches (Attempt ${retryCount}/${MAX_RETRIES})...`);
        }

        const currentRequests = pendingIndices.map(i => requests[i]);
        const batchResults = await runBatches(currentRequests, batchProcessor, progressState);

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
                    console.warn(`[WARN] Batch ${originalIndex} (Pages ${meta.startPage}-${meta.startPage + meta.numPages - 1}) validation failed. Expected ${meta.numPages} markers, found Begin:${beginCount}, End:${endCount}.`);
                }
            } else {
                console.warn(`[WARN] Batch ${originalIndex} API error: ${JSON.stringify(result.error || "No content")}`);
            }

            if (success) {
                finalResults[originalIndex] = text;
            } else {
                nextPendingIndices.push(originalIndex);
            }
        }

        pendingIndices = nextPendingIndices;
        retryCount++;
    }

    // 3. Assemble results
    let allMarkdown = "";
    for (let i = 0; i < finalResults.length; i++) {
        let text = finalResults[i];
        const meta = batchMetadata[i];

        if (!text) {
            text = `\n\n[ERROR: OCR Failed for pages ${meta.startPage}-${meta.startPage + meta.numPages - 1} after retries]\n\n`;
        } else {
             // Fix page numbers (Relative -> Absolute)
             text = text.replace(/### -- Begin Page (\d+)/g, (match, p1) => {
                 const relativePage = parseInt(p1, 10);
                 const absolutePage = meta.startPage + relativePage - 1;
                 return `### -- Begin Page ${absolutePage}`;
             });
        }
        allMarkdown += text + "\n\n";
    }

    const outputPath = pdfPath.replace(/\.pdf$/i, "_paged.md");
    fs.writeFileSync(outputPath, allMarkdown, 'utf-8');
    console.log(`[SUCCESS] Saved to ${outputPath}`);
    return outputPath;
}

module.exports = {
    pdfToText,
    getOcrPrompt
};
