const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getApiKey } = require('./gemini_client.js');

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

async function runOcr(pdfBytes, numPages, contextInstruction = "") {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("API Key not found");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_ID });

    const prompt = getOcrPrompt(numPages, contextInstruction);
    const base64Data = pdfBytes.toString('base64');

    const result = await model.generateContent([
        {
            inlineData: {
                data: base64Data,
                mimeType: "application/pdf"
            }
        },
        { text: prompt }
    ]);

    const response = await result.response;
    return response.text();
}

async function pdfToText(pdfPath, batchSize = 5, startPage = 1, endPage = null, contextInstruction = "") {
    const pdfBuffer = fs.readFileSync(pdfPath);
    const srcDoc = await PDFDocument.load(pdfBuffer);
    const totalPages = srcDoc.getPageCount();
    
    const actualEndPage = endPage || totalPages;
    console.log(`[INFO] Processing ${pdfPath} (Pages ${startPage} to ${actualEndPage} of ${totalPages})`);

    let allMarkdown = "";
    const pageIndices = [];
    for (let i = startPage; i <= actualEndPage; i++) {
        pageIndices.push(i);
    }

    // バッチ処理
    for (let i = 0; i < pageIndices.length; i += batchSize) {
        const batch = pageIndices.slice(i, i + batchSize);
        console.log(`[INFO] Processing batch: pages ${batch.join(', ')}`);

        const newDoc = await PDFDocument.create();
        for (const pNum of batch) {
            const [copiedPage] = await newDoc.copyPages(srcDoc, [pNum - 1]);
            newDoc.addPage(copiedPage);
        }

        const batchPdfBytes = await newDoc.save();
        
        try {
            const markdown = await runOcr(Buffer.from(batchPdfBytes), batch.length, contextInstruction);
            allMarkdown += markdown + "\n\n";
        } catch (err) {
            console.error(`[ERROR] Batch failed: ${err}`);
        }
    }

    const outputPath = pdfPath.replace(/\.pdf$/i, "_paged.md");
    fs.writeFileSync(outputPath, allMarkdown, 'utf-8');
    console.log(`[SUCCESS] Saved to ${outputPath}`);
}

module.exports = {
    pdfToText,
    getOcrPrompt
};
