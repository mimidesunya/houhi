const { GoogleGenAI } = require("@google/genai");
const { getApiKey } = require('./gemini_client');

class GeminiBatchProcessor {
    constructor() {
        const apiKey = getApiKey();
        if (!apiKey) throw new Error("API Key not found");
        this.ai = new GoogleGenAI({ apiKey });
    }

    /**
     * Runs an inline batch job.
     * @param {Array} requests Array of GenerateContentRequest objects
     * @param {string} modelId Model ID (e.g., "gemini-1.5-flash")
     * @param {string} displayName Optional display name for the job
     * @returns {Promise<Array>} Array of results (text content)
     */
    async runInlineBatch(requests, modelId, progressState, displayName = "batch-job") {
        // Check size estimate (rough check)
        const sizeEstimate = JSON.stringify(requests).length;
        console.log(`[Batch] Request size estimate: ${(sizeEstimate / 1024 / 1024).toFixed(2)} MB`);
        
        if (sizeEstimate > 19 * 1024 * 1024) { // 19MB to be safe
            throw new Error(`Batch request size (${(sizeEstimate / 1024 / 1024).toFixed(2)} MB) exceeds safe limit for inline batch.`);
        }

        console.log(`[Batch] Creating batch job with ${requests.length} requests for ${modelId}...`);
        
        let job;
        try {
            job = await this.ai.batches.create({
                model: modelId,
                src: requests,
                config: { displayName: displayName },
            });
        } catch (e) {
            console.error("Failed to create batch job:", e);
            throw e;
        }

        console.log(`[Batch] Job created: ${job.name}`);
        return await this.waitForCompletion(job.name, progressState);
    }

    async waitForCompletion(jobName, progressState) {
        const completed = new Set([
            "JOB_STATE_SUCCEEDED",
            "JOB_STATE_FAILED",
            "JOB_STATE_CANCELLED",
            "JOB_STATE_EXPIRED",
        ]);

        let cur = await this.ai.batches.get({ name: jobName });

        while (!completed.has(cur.state)) {
            if (progressState) {
                const elapsed = Date.now() - progressState.startTime;
                const avgTimePerRequest = progressState.completed > 0 ? elapsed / progressState.completed : 0;
                const remainingRequests = progressState.total - progressState.completed;
                const estimatedRemaining = avgTimePerRequest * remainingRequests;

                let timeInfo = `Elapsed: ${this.formatTime(elapsed)}`;
                if (estimatedRemaining > 0) {
                    timeInfo += ` | Remaining: ${this.formatTime(estimatedRemaining)} (est.)`;
                }
                console.log(`[Batch] Status: ${cur.state} (${timeInfo})`);
            } else {
                console.log(`[Batch] Status: ${cur.state} (Waiting 30s...)`);
            }
            
            await new Promise(r => setTimeout(r, 30000)); // 30 seconds poll
            cur = await this.ai.batches.get({ name: cur.name });
        }

        console.log(`[Batch] Final Status: ${cur.state}`);

        if (cur.state === "JOB_STATE_SUCCEEDED") {
            if (cur.dest && cur.dest.inlinedResponses) {
                return cur.dest.inlinedResponses;
            } else {
                throw new Error("Job succeeded but no inlined responses found.");
            }
        } else {
            throw new Error(`Batch job failed with state: ${cur.state}`);
        }
    }

    formatTime(ms) {
        if (isNaN(ms) || ms < 0) return "00:00:00";
        const seconds = Math.floor((ms / 1000) % 60);
        const minutes = Math.floor((ms / (1000 * 60)) % 60);
        const hours = Math.floor(ms / (1000 * 60 * 60));
        return [hours, minutes, seconds].map(v => v.toString().padStart(2, '0')).join(':');
    }
}

module.exports = GeminiBatchProcessor;
