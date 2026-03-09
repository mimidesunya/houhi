const fs = require('fs');
const path = require('path');
const os = require('os');
const { extractPdfToImages } = require('./pdf_to_image');
const { loadConfig } = require('./gemini_client');

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
    apiKey;
    baseUrl;
    model;
    timeoutMs;
    maxRetries;

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
                            max_completion_tokens: maxTokens,
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
 * ClaudeOcrProcessor と同等のインターフェース + OpenAI Batch API 対応
 */
class OpenAIOcrProcessor {
    client;
    apiKey;
    apiBaseUrl;
    model;

    constructor() {
        this.client = new OpenAIClient();
        const config = getOpenAIConfig();
        this.apiKey = config.apiKey;
        // baseUrl から /chat/completions を除いた API ベースURL を導出
        const configBaseUrl = config.baseUrl || "https://api.openai.com/v1/chat/completions";
        this.apiBaseUrl = configBaseUrl.replace(/\/chat\/completions\/?$/, '');
        this.model = config.chatModel || "gpt-4o";
    }

    /**
     * 同期（並列HTTP）モード — 既存の実装
     * @param {Array} requests - Gemini形式のリクエスト [{contents: [{role, parts}]}]
     * @param {object} progressState - 進捗状態 {completed, total, startTime}
     * @param {number} concurrency - 同時実行数
     * @returns {Array} Gemini形式のレスポンス配列
     */
    async runSync(requests, progressState, concurrency = 3) {
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

    /**
     * OpenAI Batch API を使用した本物のバッチ処理
     * JSONL ファイルをアップロードし、バッチジョブを作成・監視・結果取得する
     * @param {Array} requests - Gemini形式のリクエスト配列
     * @param {object} progressState - 進捗状態
     * @param {string|null} persistencePath - ジョブ再開用の永続化ファイルパス
     * @returns {Array} Gemini形式のレスポンス配列
     */
    async runFileBatch(requests, progressState, persistencePath = null) {
        let batchId;

        // 1) 保存済みジョブから再開を試みる
        if (persistencePath && fs.existsSync(persistencePath)) {
            try {
                const stored = JSON.parse(fs.readFileSync(persistencePath, 'utf8'));
                if (stored && stored.batchId) {
                    const batch = await this._getBatchStatus(stored.batchId);
                    const terminalStates = new Set(['failed', 'expired', 'cancelled']);
                    if (!terminalStates.has(batch.status) || batch.status === 'completed') {
                        console.log(`[OpenAI バッチ] 保存済みジョブを再開: ${stored.batchId} (Status: ${batch.status})`);
                        batchId = stored.batchId;
                    } else {
                        console.log(`[OpenAI バッチ] 保存済みジョブは終端状態: ${batch.status}。新規作成します。`);
                    }
                }
            } catch (e) {
                console.warn(`[OpenAI バッチ] レジューム情報の読み込み失敗: ${e.message}`);
            }
        }

        // 2) 新規バッチ作成
        let tempFilePath = null;
        if (!batchId) {
            console.log(`[OpenAI バッチ] ${requests.length} 件のリクエストでバッチ作成中...`);

            tempFilePath = path.join(os.tmpdir(), `openai_batch_${Date.now()}_${Math.random().toString(36).slice(2)}.jsonl`);

            try {
                await this._writeRequestsAsJsonl(requests, tempFilePath);

                const fileSize = fs.statSync(tempFilePath).size;
                console.log(`[OpenAI バッチ] JSONLファイル作成完了: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

                // ファイルアップロード
                console.log(`[OpenAI バッチ] ファイルアップロード中...`);
                const fileObj = await this._uploadFile(tempFilePath);
                console.log(`[OpenAI バッチ] アップロード完了: ${fileObj.id}`);

                // バッチ作成
                const batch = await this._createBatch(fileObj.id);
                batchId = batch.id;
                console.log(`[OpenAI バッチ] バッチ作成完了: ${batchId}`);

                // 永続化
                if (persistencePath) {
                    fs.writeFileSync(persistencePath, JSON.stringify({
                        batchId,
                        model: this.model,
                        requestCount: requests.length,
                        createdAt: new Date().toISOString()
                    }, null, 2));
                }
            } catch (e) {
                console.error(`[OpenAI バッチ] バッチ作成に失敗: ${e.message}`);
                throw e;
            } finally {
                if (tempFilePath && fs.existsSync(tempFilePath)) {
                    try { fs.unlinkSync(tempFilePath); } catch (_) { }
                }
            }
        }

        // 3) バッチ完了を待機して結果取得
        const results = await this._waitForCompletion(batchId, progressState, requests.length);

        // 4) 成功時は永続化ファイルを削除
        if (persistencePath && fs.existsSync(persistencePath)) {
            try { fs.unlinkSync(persistencePath); } catch (_) { }
        }

        return results;
    }

    /**
     * Gemini形式リクエストをOpenAI Batch API用のJSONLに変換して書き出す
     * 各行: {"custom_id": "request-N", "method": "POST", "url": "/v1/chat/completions", "body": {...}}
     */
    async _writeRequestsAsJsonl(requests, filePath) {
        const ws = fs.createWriteStream(filePath, { flags: 'w' });

        try {
            for (let i = 0; i < requests.length; i++) {
                const req = requests[i];
                const parts = req.contents[0].parts;
                const content = await this.client._convertPartsToOpenAI(parts);

                const line = JSON.stringify({
                    custom_id: `request-${i + 1}`,
                    method: "POST",
                    url: "/v1/chat/completions",
                    body: {
                        model: this.model,
                        max_completion_tokens: 16384,
                        messages: [{ role: "user", content }]
                    }
                }) + '\n';

                if (!ws.write(line)) {
                    await new Promise(r => ws.once('drain', r));
                }

                if ((i + 1) % 10 === 0 || i === requests.length - 1) {
                    console.log(`[OpenAI バッチ] JSONL変換: ${i + 1}/${requests.length}`);
                }
            }
        } finally {
            await new Promise((resolve, reject) => {
                ws.on('finish', resolve);
                ws.on('error', reject);
                ws.end();
            });
        }
    }

    /**
     * Files API で JSONL ファイルをアップロード
     */
    async _uploadFile(filePath) {
        const fileContent = fs.readFileSync(filePath);
        const blob = new Blob([fileContent], { type: 'application/jsonl' });
        const formData = new FormData();
        formData.append('file', blob, 'batch_input.jsonl');
        formData.append('purpose', 'batch');

        const response = await fetch(`${this.apiBaseUrl}/files`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: formData
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`ファイルアップロード失敗: ${response.status} ${errText}`);
        }
        return await response.json();
    }

    /**
     * Batches API でバッチジョブを作成
     */
    async _createBatch(inputFileId) {
        const response = await fetch(`${this.apiBaseUrl}/batches`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                input_file_id: inputFileId,
                endpoint: "/v1/chat/completions",
                completion_window: "24h"
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`バッチ作成失敗: ${response.status} ${errText}`);
        }
        return await response.json();
    }

    /**
     * バッチステータスを取得
     */
    async _getBatchStatus(batchId) {
        const response = await fetch(`${this.apiBaseUrl}/batches/${batchId}`, {
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`バッチステータス取得失敗: ${response.status} ${errText}`);
        }
        return await response.json();
    }

    /**
     * 出力ファイルの内容をダウンロード
     */
    async _downloadFileContent(fileId) {
        const response = await fetch(`${this.apiBaseUrl}/files/${fileId}/content`, {
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`ファイルダウンロード失敗: ${response.status} ${errText}`);
        }
        return await response.text();
    }

    /**
     * バッチ完了を待機し、結果を取得して返す
     */
    async _waitForCompletion(batchId, progressState, requestCount) {
        const pollMs = 30000; // 30秒
        const maxWaitMs = 24 * 60 * 60 * 1000; // 24時間 (OpenAI バッチの completion_window)
        const maxNoProgressMs = 30 * 60 * 1000; // 30分
        const startedAt = Date.now();
        let lastProgressAt = Date.now();
        let lastCompleted = 0;
        const terminalStates = new Set(['completed', 'failed', 'expired', 'cancelled']);

        console.log(`[OpenAI バッチ] 監視開始: batch=${batchId} | 最大待機: 24:00:00 | 進捗停滞上限: 00:30:00`);

        while (true) {
            const batch = await this._getBatchStatus(batchId);
            const completed = (batch.request_counts?.completed || 0) + (batch.request_counts?.failed || 0);
            const total = batch.request_counts?.total || requestCount;

            // 進捗更新
            if (progressState) {
                progressState.completed = completed;
                progressState.total = total;
            }

            // 進捗検出
            if (completed > lastCompleted) {
                lastCompleted = completed;
                lastProgressAt = Date.now();
            }

            const elapsed = Date.now() - startedAt;
            const stalled = Date.now() - lastProgressAt;

            // ログ出力
            const avg = completed > 0 ? elapsed / completed : 0;
            const remain = Math.max(0, total - completed);
            const eta = avg > 0 ? avg * remain : 0;
            let msg = `[OpenAI バッチ] Status: ${batch.status} | 経過: ${formatTime(elapsed)}`;
            if (total > 0) msg += ` | 進捗: ${completed}/${total}`;
            if (eta > 0) msg += ` | 残り(予想): ${formatTime(eta)}`;
            console.log(msg);

            if (terminalStates.has(batch.status)) {
                if (batch.status === 'completed') {
                    if (batch.output_file_id) {
                        console.log(`[OpenAI バッチ] 結果ダウンロード中...`);
                        const content = await this._downloadFileContent(batch.output_file_id);
                        console.log(`[OpenAI バッチ] 結果取得完了`);
                        return this._parseResultsJsonl(content, requestCount);
                    }
                    throw new Error('バッチは完了しましたが、output_file_id がありません。');
                }

                // エラーファイルがあれば詳細を取得
                let errorDetail = '';
                if (batch.error_file_id) {
                    try {
                        const errorContent = await this._downloadFileContent(batch.error_file_id);
                        errorDetail = ` / エラー詳細: ${errorContent.substring(0, 500)}`;
                    } catch (_) { }
                }
                throw new Error(`バッチジョブ失敗: ${batch.status}${errorDetail}`);
            }

            // タイムアウトチェック
            if (elapsed > maxWaitMs) {
                throw new Error(`バッチ待機がタイムアウトしました (${formatTime(elapsed)})`);
            }
            if (stalled > maxNoProgressMs) {
                throw new Error(`バッチ進捗が停滞しました (${formatTime(stalled)})`);
            }

            await new Promise(r => setTimeout(r, pollMs));
        }
    }

    /**
     * OpenAI Batch API の結果JSONL をパースし、Gemini互換形式に変換
     * 各行: {"custom_id": "request-N", "response": {"status_code": 200, "body": {...}}, "error": null}
     */
    _parseResultsJsonl(content, requestCount) {
        const results = new Array(requestCount).fill(null);
        const lines = content.split('\n').filter(l => l.trim());

        for (const line of lines) {
            try {
                const obj = JSON.parse(line);
                const customId = obj.custom_id;
                if (!customId) continue;
                const idx = parseInt(customId.replace('request-', ''), 10) - 1;
                if (idx < 0 || idx >= requestCount) continue;

                if (obj.response && obj.response.status_code === 200) {
                    const text = obj.response.body?.choices?.[0]?.message?.content || '';
                    results[idx] = {
                        response: {
                            candidates: [{
                                content: {
                                    parts: [{ text }]
                                }
                            }]
                        }
                    };
                } else {
                    const errMsg = obj.error?.message
                        || `HTTP ${obj.response?.status_code || 'unknown'}: ${JSON.stringify(obj.response?.body?.error || obj.error || 'unknown error')}`;
                    results[idx] = { error: { message: errMsg } };
                }
            } catch (e) {
                console.warn(`[OpenAI バッチ] 結果行のパースに失敗: ${e.message}`);
            }
        }

        // 未取得の結果を埋める
        for (let i = 0; i < results.length; i++) {
            if (!results[i]) {
                results[i] = { error: { message: 'バッチ結果にこのリクエストの結果がありません' } };
            }
        }

        return results;
    }
}

module.exports = { OpenAIClient, OpenAIOcrProcessor, getOpenAIConfig };
