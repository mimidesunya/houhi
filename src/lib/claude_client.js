const fs = require('fs');
const path = require('path');

function getProjectRoot() {
    return path.dirname(path.dirname(path.dirname(__filename)));
}

function loadConfig() {
    const root = getProjectRoot();
    const configPath = path.join(root, 'config.json');
    if (!fs.existsSync(configPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (err) {
        console.error(`Config load error: ${err}`);
        return null;
    }
}

function getClaudeConfig() {
    const config = loadConfig();
    if (config && config.claude) {
        return config.claude;
    }
    return null;
}

function formatTime(ms) {
    if (isNaN(ms) || ms < 0) return "00:00:00";
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));
    return [hours, minutes, seconds].map(v => String(v).padStart(2, '0')).join(':');
}

/**
 * Claude API クライアント
 */
class ClaudeClient {
    constructor() {
        const config = getClaudeConfig();
        if (!config || !config.apiKey) throw new Error("Claude API Key not found in config.json");
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl || "https://api.anthropic.com/v1/messages";
        this.model = config.chatModel || "claude-opus-4-6";
        this.timeoutMs = config.timeoutMs || 300000;
        this.maxRetries = config.maxRetries || 3;
    }

    /**
     * Gemini形式のパーツ配列をClaude形式に変換してメッセージ送信
     * @param {Array} parts - Gemini形式のパーツ配列 [{text: "..."}, {inlineData: {mimeType, data}}]
     * @param {number} maxTokens - 最大トークン数
     * @returns {object} Claude APIレスポンス
     */
    async sendMessage(parts, maxTokens = 16384) {
        const claudeContent = this._convertParts(parts);

        const body = {
            model: this.model,
            max_tokens: maxTokens,
            messages: [{
                role: "user",
                content: claudeContent
            }]
        };

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

                const response = await fetch(this.baseUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': this.apiKey,
                        'anthropic-version': '2023-06-01'
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });

                clearTimeout(timeout);

                if (!response.ok) {
                    const errorText = await response.text().catch(() => '');
                    if (response.status === 429 || response.status >= 500) {
                        const waitMs = Math.min(2000 * Math.pow(2, attempt), 60000);
                        console.warn(`[Claude] API error ${response.status}, ${waitMs / 1000}秒後にリトライ (${attempt}/${this.maxRetries})...`);
                        await new Promise(r => setTimeout(r, waitMs));
                        continue;
                    }
                    throw new Error(`Claude API error: ${response.status} ${response.statusText} - ${errorText}`);
                }

                return await response.json();
            } catch (err) {
                if (err.name === 'AbortError') {
                    console.warn(`[Claude] タイムアウト, リトライ ${attempt}/${this.maxRetries}...`);
                    if (attempt === this.maxRetries) throw new Error('Claude API: タイムアウト回数超過');
                    continue;
                }
                if (attempt === this.maxRetries) throw err;
                console.warn(`[Claude] エラー: ${err.message}, リトライ ${attempt}/${this.maxRetries}...`);
                await new Promise(r => setTimeout(r, 2000 * attempt));
            }
        }
        throw new Error('Claude API: リトライ回数超過');
    }

    /**
     * Gemini形式パーツをClaude形式コンテンツに変換
     */
    _convertParts(parts) {
        return parts.map(part => {
            if (part.text) {
                return { type: "text", text: part.text };
            }
            if (part.inlineData) {
                const { mimeType, data } = part.inlineData;
                if (mimeType === 'application/pdf') {
                    return {
                        type: "document",
                        source: {
                            type: "base64",
                            media_type: mimeType,
                            data: data
                        }
                    };
                }
                // 画像ファイル
                return {
                    type: "image",
                    source: {
                        type: "base64",
                        media_type: mimeType,
                        data: data
                    }
                };
            }
            // フォールバック
            return { type: "text", text: JSON.stringify(part) };
        });
    }
}

/**
 * Claude OCR プロセッサ
 * GeminiBatchProcessor と同等のインターフェースで、リクエストを並行処理する
 */
class ClaudeOcrProcessor {
    constructor() {
        this.client = new ClaudeClient();
    }

    /**
     * Gemini形式のリクエスト配列を処理し、Gemini形式のレスポンスに変換して返す
     * @param {Array} requests - Gemini形式のリクエスト [{contents: [{role, parts}]}]
     * @param {object} progressState - 進捗状態 {completed, total, startTime}
     * @param {number} concurrency - 同時実行数
     * @returns {Array} Gemini形式のレスポンス配列
     */
    async runBatch(requests, progressState, concurrency = 2) {
        const results = new Array(requests.length).fill(null);
        let completedCount = 0;

        // タスクキュー
        const queue = requests.map((req, idx) => ({ req, idx }));

        const worker = async () => {
            while (queue.length > 0) {
                const item = queue.shift();
                if (!item) break;
                const { req, idx } = item;

                try {
                    const parts = req.contents[0].parts;
                    const response = await this.client.sendMessage(parts);

                    // Claude レスポンスを Gemini 形式に変換
                    results[idx] = {
                        response: {
                            candidates: [{
                                content: {
                                    parts: response.content
                                        .filter(c => c.type === 'text')
                                        .map(c => ({ text: c.text }))
                                }
                            }]
                        }
                    };
                } catch (err) {
                    console.error(`[Claude] リクエスト ${idx + 1}/${requests.length} 失敗: ${err.message}`);
                    results[idx] = { error: { message: err.message } };
                }

                completedCount++;
                if (progressState) {
                    progressState.completed = completedCount;
                    const elapsed = Date.now() - progressState.startTime;
                    const avg = completedCount > 0 ? elapsed / completedCount : 0;
                    const remain = Math.max(0, progressState.total - completedCount);
                    const eta = avg > 0 ? avg * remain : 0;
                    console.log(`[Claude] 進捗: ${completedCount}/${progressState.total} | 経過: ${formatTime(elapsed)} | 残り(予想): ${formatTime(eta)}`);
                }
            }
        };

        // 同時実行数分のワーカーを起動
        const workers = [];
        for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
            workers.push(worker());
        }
        await Promise.all(workers);

        return results;
    }
}

module.exports = { ClaudeClient, ClaudeOcrProcessor, getClaudeConfig };
