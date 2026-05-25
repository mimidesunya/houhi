const fs = require('fs');
const path = require('path');

function getStartDirs() {
    return [process.cwd(), __dirname, path.dirname(process.execPath)].filter(Boolean);
}

function findUpward(fileName) {
    const startDirs = getStartDirs();
    const visited = new Set();

    for (const startDir of startDirs) {
        let currentDir = path.resolve(startDir);
        while (!visited.has(currentDir)) {
            visited.add(currentDir);
            const candidatePath = path.join(currentDir, fileName);
            if (fs.existsSync(candidatePath)) {
                return candidatePath;
            }
            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) {
                break;
            }
            currentDir = parentDir;
        }
    }

    return null;
}

function ensureConfigFromStart(startDir) {
    let currentDir = path.resolve(startDir);

    while (true) {
        const configPath = path.join(currentDir, 'config.json');
        if (fs.existsSync(configPath)) {
            return configPath;
        }

        const templatePath = path.join(currentDir, 'config.template.json');
        if (fs.existsSync(templatePath)) {
            fs.copyFileSync(templatePath, configPath);
            return configPath;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            break;
        }
        currentDir = parentDir;
    }

    return null;
}

function findConfigPath() {
    return findUpward('config.json');
}

function findTemplatePath() {
    return findUpward('config.template.json');
}

function ensureConfigPath() {
    for (const startDir of getStartDirs()) {
        const configPath = ensureConfigFromStart(startDir);
        if (configPath) {
            return configPath;
        }
    }

    return null;
}

function loadConfig() {
    const configPath = ensureConfigPath();
    if (!configPath || !fs.existsSync(configPath)) {
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

module.exports = {
    findConfigPath,
    findTemplatePath,
    ensureConfigPath,
    loadConfig
};
