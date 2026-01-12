const { GoogleGenAI } = require("@google/genai");
const { getApiKey } = require("./gemini_client");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Readable } = require("stream");
const readline = require("readline");

class GeminiBatchProcessor {
  constructor() {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("API Key not found");
    this.apiKey = apiKey;
    this.ai = new GoogleGenAI({ apiKey });
  }

  /**
   * Inline batch (<= 20MB total request size guideline)
   * @param {Array<object>} requests GenerateContentRequest objects (or {request: GenerateContentRequest})
   */
  async runInlineBatch(requests, modelId, progressState, displayName = "batch-job") {
    const normalized = requests.map((r) => (r && r.request ? r.request : r));

    // Rough size check
    const payloadEstimate = JSON.stringify({
      model: modelId,
      src: normalized,
      config: { displayName },
    }).length;
    console.log(`[バッチ] リクエストサイズ見積もり: ${(payloadEstimate / 1024 / 1024).toFixed(2)} MB`);

    if (payloadEstimate > 19 * 1024 * 1024) {
      throw new Error(
        `バッチリクエストサイズ (${(payloadEstimate / 1024 / 1024).toFixed(2)} MB) がインラインバッチの安全制限を超えています。`
      );
    }

    const job = await this.ai.batches.create({
      model: modelId,
      src: normalized,
      config: { displayName },
    });

    console.log(`[バッチ] ジョブ作成: ${job.name}`);
    return await this.waitForCompletion(job.name, progressState);
  }

  /**
   * File batch (JSONL upload)
   * - persistencePath があれば jobName を保存し、失敗時に残す（レジューム用）
   * @param {Array<object>} requests GenerateContentRequest objects, or {key, request}, or {request}
   */
  async runFileBatch(
    requests,
    modelId,
    progressState,
    displayName = "batch-job",
    persistencePath = null
  ) {
    let jobName;

    // 1) Resume if possible
    if (persistencePath && fs.existsSync(persistencePath)) {
      try {
        const stored = JSON.parse(fs.readFileSync(persistencePath, "utf8"));
        if (stored && stored.jobName) {
          const job = await this.ai.batches.get({ name: stored.jobName });
          const terminal = new Set([
            "JOB_STATE_SUCCEEDED",
            "JOB_STATE_FAILED",
            "JOB_STATE_CANCELLED",
            "JOB_STATE_EXPIRED",
          ]);
          // SUCCEEDED なら「結果取得だけ」もできるので、ここでは再開扱いにする
          if (!terminal.has(job.state) || job.state === "JOB_STATE_SUCCEEDED") {
            console.log(`[バッチ] 保存済みジョブを再開: ${stored.jobName} (State: ${job.state})`);
            jobName = stored.jobName;
          } else {
            console.log(`[バッチ] 保存済みジョブは終端状態: ${job.state}。新規作成します。`);
          }
        }
      } catch (e) {
        console.warn(`[バッチ] レジューム情報の読み込み失敗: ${e.message}`);
      }
    }

    // 2) Create new job if not resumed
    let tempFilePath = null;
    if (!jobName) {
      console.log(`[バッチ] ${modelId} / ${requests.length}件でファイルバッチ作成...`);

      // JSONL: each line must be {"key": "...", "request": {...}}  (official)
      // 既に {key, request} で来た場合はそれを尊重。keyが無ければ採番。
      const jsonlLines = requests.map((r, i) => {
        if (r && r.key && r.request) return { key: String(r.key), request: r.request };
        if (r && r.request) return { key: `request-${i + 1}`, request: r.request };
        return { key: `request-${i + 1}`, request: r };
      });

      tempFilePath = path.join(
        os.tmpdir(),
        `gemini_batch_${Date.now()}_${Math.random().toString(36).slice(2)}.jsonl`
      );

      try {
        await this.writeJsonlFile(tempFilePath, jsonlLines);

        console.log("[バッチ] JSONLファイルをアップロード中...");
        const uploadedFile = await this.ai.files.upload({
          file: tempFilePath,
          config: { mimeType: "jsonl" }, // official example
        });

        console.log(`[バッチ] アップロード完了: ${uploadedFile.name}`);

        const job = await this.ai.batches.create({
          model: modelId,
          src: uploadedFile.name,
          config: { displayName },
        });

        jobName = job.name;
        console.log(`[バッチ] 新規ジョブ作成: ${jobName}`);

        if (persistencePath) {
          fs.writeFileSync(
            persistencePath,
            JSON.stringify(
              {
                jobName,
                modelId,
                requestCount: requests.length,
                createdAt: new Date().toISOString(),
              },
              null,
              2
            )
          );
        }
      } catch (e) {
        console.error("バッチジョブの作成(ファイルアップロード含む)に失敗:", e);
        throw e;
      } finally {
        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      }
    }

    // 3) Wait / Retrieve
    const results = await this.waitForCompletion(jobName, progressState);

    // 4) Success cleanup: persistence only (job is intentionally NOT deleted)
    if (persistencePath && fs.existsSync(persistencePath)) {
      fs.unlinkSync(persistencePath);
    }

    // Sort results by key (request-N) to match input requests order
    // Because the caller (gemini_ocr.js) expects results[i] to match requests[i]
    if (Array.isArray(results)) {
      const orderedResults = new Array(requests.length).fill(null);
      for (const res of results) {
        if (typeof res.key === 'string' && res.key.startsWith('request-')) {
          const idx = parseInt(res.key.replace('request-', ''), 10) - 1; // 1-based to 0-based
          if (idx >= 0 && idx < requests.length) {
            orderedResults[idx] = res;
          }
        } else if (res.key && !isNaN(res.key)) {
             // Handle case where key might be just number string
             const idx = parseInt(res.key, 10) - 1;
             if (idx >= 0 && idx < requests.length) orderedResults[idx] = res;
        }
      }
      // Fill gaps with error placeholders
      for(let i=0; i<orderedResults.length; i++) {
          if (!orderedResults[i]) {
              orderedResults[i] = { error: { message: "Result missing for this request item" } };
          }
      }
      return orderedResults;
    }

    return results;
  }

  async waitForCompletion(jobName, progressState, pollMs = 30000) {
    const completedStates = new Set([
      "JOB_STATE_SUCCEEDED",
      "JOB_STATE_FAILED",
      "JOB_STATE_CANCELLED",
      "JOB_STATE_EXPIRED",
    ]);

    let cur = await this.ai.batches.get({ name: jobName });

    while (!completedStates.has(cur.state)) {
      this.logProgress(cur, progressState);
      await new Promise((r) => setTimeout(r, pollMs));
      cur = await this.ai.batches.get({ name: cur.name });
    }

    console.log(`[バッチ] 最終ステータス: ${cur.state}`);

    if (cur.state !== "JOB_STATE_SUCCEEDED") {
      const err = cur.error
        ? typeof cur.error === "string"
          ? cur.error
          : cur.error.message || JSON.stringify(cur.error)
        : null;
      throw new Error(`バッチジョブ失敗: ${cur.state}${err ? ` / ${err}` : ""}`);
    }

    // Results are in cur.dest.fileName (SDK example) or cur.response.responsesFile (REST spec)
    // Try both.
    const responsesFileName =
      cur?.dest?.fileName ||
      cur?.dest?.file_name ||
      cur?.response?.responsesFile ||
      cur?.response?.responses_file ||
      cur?.output?.responsesFile ||
      cur?.output?.responses_file ||
      null;

    if (responsesFileName) {
      // 1) Prefer SDK download
      try {
        const buf = await this.ai.files.download({ file: responsesFileName });
        // Buffer -> stream lines
        const stream = Readable.from(buf.toString("utf-8"));
        return await this.parseJsonlStream(stream);
      } catch (e) {
        // 2) Fallback: official download endpoint (no API key in URL; use header)
        // REST example: https://generativelanguage.googleapis.com/download/v1beta/$responses_file_name:download?alt=media
        const url = `https://generativelanguage.googleapis.com/download/v1beta/${responsesFileName}:download?alt=media`;
        const res = await fetch(url, {
          headers: { "x-goog-api-key": this.apiKey },
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(
            `結果ファイルダウンロード失敗: ${res.status} ${res.statusText}${t ? ` / ${t}` : ""}`
          );
        }
        const nodeStream = Readable.fromWeb(res.body);
        return await this.parseJsonlStream(nodeStream);
      }
    }

    // Inline responses (SDK example)
    const inlined = cur?.dest?.inlinedResponses || cur?.response?.inlinedResponses || null;
    if (inlined) return inlined;

    throw new Error("ジョブは成功しましたが、結果（responsesFile / inlinedResponses）が見つかりませんでした。");
  }

  logProgress(cur, progressState) {
    // Prefer batchStats if available (API defines it)
    const stats = cur.batchStats || null;
    let completed = null;
    let total = null;

    if (stats) {
      const ok = Number(stats.successfulRequestCount ?? stats.successful_request_count ?? 0);
      const ng = Number(stats.failedRequestCount ?? stats.failed_request_count ?? 0);
      const all = Number(stats.requestCount ?? stats.request_count ?? 0);
      completed = ok + ng;
      total = all || null;
      if (progressState) {
        progressState.completed = completed;
        progressState.total = total ?? progressState.total;
      }
    }

    if (progressState) {
      const elapsed = Date.now() - progressState.startTime;
      const done = progressState.completed ?? 0;
      const tot = progressState.total ?? total ?? 0;

      const avg = done > 0 ? elapsed / done : 0;
      const remain = tot > 0 ? Math.max(0, tot - done) : 0;
      const eta = avg > 0 ? avg * remain : 0;

      let msg = `[バッチ] ステータス: ${cur.state} | 経過: ${this.formatTime(elapsed)}`;
      if (tot > 0) msg += ` | 進捗: ${done}/${tot}`;
      if (eta > 0) msg += ` | 残り(予想): ${this.formatTime(eta)}`;
      console.log(msg);
    } else {
      console.log(`[バッチ] ステータス: ${cur.state} (${Math.floor(30000 / 1000)}秒待機...)`);
    }
  }

  async writeJsonlFile(filePath, objects) {
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(filePath, { flags: "w" });
      ws.on("error", reject);
      ws.on("finish", resolve);

      (async () => {
        try {
          for (const obj of objects) {
            const line = JSON.stringify(obj) + "\n";
            if (!ws.write(line)) {
              await new Promise((r) => ws.once("drain", r));
            }
          }
          ws.end();
        } catch (e) {
          ws.destroy();
          reject(e);
        }
      })();
    });
  }

  async parseJsonlStream(stream) {
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const out = [];

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const json = JSON.parse(trimmed);

        // File output: docs say each line is either GenerateContentResponse or a status object.
        // In practice you may also see wrappers with key/metadata + response/error.
        // Normalize to: { key, response, error, raw }
        const key = json.key ?? json.metadata?.key ?? null;

        if (json.response || json.error) {
          out.push({
            key,
            response: json.response ?? null,
            error: json.error ?? null,
            raw: json,
          });
        } else {
          // Either a plain GenerateContentResponse, or a status object
          out.push({
            key,
            response: json.candidates || json.promptFeedback ? json : null,
            error: json.error || (json.code && json.message ? json : null),
            raw: json,
          });
        }
      } catch (e) {
        out.push({ key: null, response: null, error: { message: "JSON parse failed" }, raw: line });
      }
    }
    return out;
  }

  formatTime(ms) {
    if (isNaN(ms) || ms < 0) return "00:00:00";
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));
    return [hours, minutes, seconds].map((v) => String(v).padStart(2, "0")).join(":");
  }
}

module.exports = GeminiBatchProcessor;
