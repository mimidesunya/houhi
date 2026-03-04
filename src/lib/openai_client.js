const fs = require('fs');
const path = require('path');
const os = require('os');
const { extractPdfToImages } = require('./pdf_to_image.js');
const { loadConfig } = require('./gemini_client.js');

function formatTime(ms) {
    if (isNaN(ms) || ms < 0) return "00:00:00";
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return [h, m, s % 60].map(v => String(v).padStart(2, '0')).join(':');
}

function getOpenAIConfig() {
    const config = loadConfig();
    return config?.openai || null;
}

/**
 * OpenAI API クライアント
 * PDFはページ画像に変換してから送信（OpenAIはPDFを直接受け付けないため）
 */
class OpenAIClient {
    constructor() {
        const config = getOpenAIConfig();
        if (!config || !config.apiKey) throw new Error("OpenAI API Key not found in config.json");
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl || "https://api.openai.com/v1/chat/completions";
        this.model = config.chatModel || "gpt-4o";
        this.timeoutMs = config.timeoutMs || 300000;
        this.maxRetries = config.maxRetries || 3;
    }

    /**
     * Gemini形式のパーツ配列をOpenAI形式に変換
     * PDFはページ画像(PNG)に変換して送信
     */
    async _convertPartsToOpenAI(parts) {
        const content = [];
        for (const part of parts) {
            if (part.text) {
                content.push({ type: "text", text: part.text });
            } else if (part.inlineData) {
                const { mimeType, data } = part.inlineData;
                if (mimeType === 'application/pdf') {
                    // PDFをページ画像に変換
                    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oai_pdf_'));
                    try {
                        const pdfPath = path.join(tmpDir, 'batch.pdf');
                        fs.writeFileSync(pdfPath, Buffer.from(data, 'base64'));
                        await extractPdfToImages(pdfPath, tmpDir, 150);
                        const imageFiles = fs.readdirSync(tmpDir)
                            .filter(f => f.endsWith('.png'))
                            .sort();
                        for (const imgFile of imageFiles) {
                            const imgData = fs.readFileSync(path.join(tmpDir, imgFile)).toString('base64');
                            content.push({
                                type: "image_url",
                                image_url: { url: `data:image/png;base64,${imgData}`, detail: "high" }
                            });
                        }
                    } finally {
                        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) { }
                    }
                } else if (mimeType.startsWith('image/')) {
                    content.push({
                        type: "image_url",
                        image_url: { url: `data:${mimeType};base64,${data}`, detail: "high" }
                    });
                }
            }
        }
        return content;
    }

    /**
     * Gemini形式パーツを送信し、OpenAI APIレスポンスを返す
     */
    async sendMessage(parts, maxTokens = 16384) {
        const content = await this._convertPartsToOpenAI(parts);
        let lastError = null;

        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
                try {
                    const response = await fetch(this.baseUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.apiKey}`
                        },
                        signal: controller.signal,
                        body: JSON.stringify({
                            model: this.model,
                            max_tokens: maxTokens,
                            messages: [{ role: "user", content }]
                        })
                    });
                    if (!response.ok) {
                        const errText = await response.text();
                        throw new Error(`OpenAI API error ${response.status}: ${errText}`);
                    }
                    return await response.json();
                } finally {
                    clearTimeout(timeoutId);
                }
            } catch (err) {
                lastError = err;
                if (attempt < this.maxRetries - 1) {
                    console.warn(`[OpenAI] リクエスト失敗 (試行 ${attempt + 1}/${this.maxRetries}): ${err.message}`);
                    await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
                }
            }
        }
        throw lastError;
    }
}

/**
 * OpenAI OCR プロセッサ
 * ClaudeOcrProcessor と同等のインターフェース
 */
class OpenAIOcrProcessor {
    constructor() {
        this.client = new OpenAIClient();
    }

    /**
     * Gemini形式のリクエスト配列を処理し、Gemini形式のレスポンスに変換して返す
     * @param {Array} requests - Gemini形式のリクエスト [{contents: [{role, parts}]}]
     * @param {object} progressState - 進捗状態 {completed, total, startTime}
     * @param {number} concurrency - 同時実行数
     * @returns {Array} Gemini形式のレスポンス配列
     */
    async runBatch(requests, progressState, concurrency = 3) {
        const results = new Array(requests.length).fill(null);
        let completedCount = 0;
        const queue = requests.map((req, idx) => ({ req, idx }));

        const worker = async () => {
            while (queue.length > 0) {
                const item = queue.shift();
                if (!item) break;
                const { req, idx } = item;

                try {
                    const parts = req.contents[0].parts;
                    const response = await this.client.sendMessage(parts);
                    const text = response.choices?.[0]?.message?.content || '';

                    // OpenAI レスポンスを Gemini 形式に変換
                    results[idx] = {
                        response: {
                            candidates: [{
                                content: {
                                    parts: [{ text }]
                                }
                            }]
                        }
                    };
                } catch (err) {
                    console.error(`[OpenAI] リクエスト ${idx + 1}/${requests.length} 失敗: ${err.message}`);
                    results[idx] = { error: { message: err.message } };
                }

                completedCount++;
                if (progressState) {
                    progressState.completed = completedCount;
                    const elapsed = Date.now() - progressState.startTime;
                    const avg = completedCount > 0 ? elapsed / completedCount : 0;
                    const remain = Math.max(0, progressState.total - completedCount);
                    const eta = avg > 0 ? avg * remain : 0;
                    console.log(`[OpenAI] 進捗: ${completedCount}/${progressState.total} | 経過: ${formatTime(elapsed)} | 残り(予想): ${formatTime(eta)}`);
                }
            }
        };

        const workers = [];
        for (let i = 0; i < Math.min(concurrency, Math.max(1, queue.length)); i++) {
            workers.push(worker());
        }
        await Promise.all(workers);
        return results;
    }
}

module.exports = { OpenAIClient, OpenAIOcrProcessor, getOpenAIConfig };
