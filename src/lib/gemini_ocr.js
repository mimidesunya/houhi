const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const GeminiBatchProcessor = require('./gemini_batch');

const MODEL_ID = "gemini-3-flash-preview"; 

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
   - **Start**: At the start of content, output \`=-- Begin Page N {StartStatus} --=\`.
     - N: Batch page index (1-${numPages}).
     - {StartStatus}: "(Continuation)" if the text at the very top of the page is a direct continuation of a paragraph from the previous page (cut off mid-sentence without a line break), else empty.
   - **End**: At the end of content, output \`=-- End Printed Page X {EndStatus} --=\`.
     - X: Printed page number. **CONVERT** Kanji (一, 二) or Roman (I, II) to Arabic (1, 2). If not found, use "N/A".
     - {EndStatus}: "(Continuation)" if the paragraph is cut off mid-sentence and continues to the next page without an explicit line break, else empty.
4. **Transcription Rules**:
   - **No Indentation**: Standard Markdown paragraphs.
   - **Numbers**: Convert ALL full-width numbers to half-width (e.g., "１" -> "1"). 
   - **Corrections**: Fix obvious OCR errors (0 vs O). Keep original typos with \`［ママ］\`.
   - **Exclusions**: Omit printed page numbers from body.
   - **Margins**:
     - Headings in margins: Format as \`【#Text】\`.
     - Annotations/Notes in margins: Format as \`【*Text】\`.
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
    }

    // 2. Run Batch(es)
    const batchProcessor = new GeminiBatchProcessor();
    let allMarkdown = "";

    let currentBatchRequests = [];
    let currentBatchSize = 0;
    const MAX_BATCH_SIZE = 19 * 1024 * 1024; // 19MB

    const batchResults = [];

    for (const req of requests) {
        const reqSize = JSON.stringify(req).length;
        if (currentBatchSize + reqSize > MAX_BATCH_SIZE) {
            if (currentBatchRequests.length > 0) {
                console.log(`[INFO] Sending batch job with ${currentBatchRequests.length} requests...`);
                const results = await batchProcessor.runInlineBatch(currentBatchRequests, MODEL_ID);
                batchResults.push(...results);
                currentBatchRequests = [];
                currentBatchSize = 0;
            }
        }
        currentBatchRequests.push(req);
        currentBatchSize += reqSize;
    }

    if (currentBatchRequests.length > 0) {
        console.log(`[INFO] Sending final batch job with ${currentBatchRequests.length} requests...`);
        const results = await batchProcessor.runInlineBatch(currentBatchRequests, MODEL_ID);
        batchResults.push(...results);
    }

    // 3. Process results
    for (const result of batchResults) {
        if (result.error) {
            console.error(`[ERROR] Batch item failed: ${JSON.stringify(result.error)}`);
            allMarkdown += "\n\n[ERROR: OCR Failed for this section]\n\n";
        } else if (result.response && result.response.candidates && result.response.candidates[0].content.parts) {
             const text = result.response.candidates[0].content.parts.map(p => p.text).join('');
             allMarkdown += text + "\n\n";
        }
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
