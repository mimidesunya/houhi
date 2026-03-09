const fs = require('fs');
const path = require('path');

function getProjectRoot() {
    // src/lib/gemini_client.js -> src/lib -> src -> root
    return path.dirname(path.dirname(path.dirname(__filename)));
}

function loadConfig() {
    const root = getProjectRoot();
    const configPath = path.join(root, 'config.json');
    
    if (!fs.existsSync(configPath)) {
        return null;
    }
    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(content);
    } catch (err) {
        console.error(`Config load error: ${err}`);
        return null;
    }
}

function getApiKey() {
    const config = loadConfig();
    if (config && config.gemini) {
        return config.gemini.apiKey;
    }
    return process.env.GEMINI_API_KEY;
}

function getGeminiChatModel() {
    const config = loadConfig();
    if (config && config.gemini) {
        if (config.gemini.chatModel) {
            return config.gemini.chatModel;
        }
    }
    if (process.env.GEMINI_CHAT_MODEL) {
        return process.env.GEMINI_CHAT_MODEL;
    }
    throw new Error('Gemini chat model is not configured. Set gemini.chatModel in config.json or GEMINI_CHAT_MODEL.');
}

module.exports = {
    getProjectRoot,
    loadConfig,
    getApiKey,
    getGeminiChatModel
};
