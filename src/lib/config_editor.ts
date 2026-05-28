import * as fs from 'fs';
import * as path from 'path';

type AnyConfig = Record<string, any>;

const DEFAULT_CONFIG: AnyConfig = {
    pdf: {
        engine: 'chrome',
        chromePath: '',
    },
    copper: {
        serverUri: 'ctip://cti.li/',
        user: 'user',
        password: 'kappa',
        properties: {
            'output.pdf.version': '1.4A-1',
        },
    },
    mail: {
        smtp: {
            host: 'YOUR_MAIL_SERVER',
            port: 465,
            secure: true,
            tlsMinVersion: 'TLSv1.2',
        },
        imap: {
            host: 'YOUR_MAIL_SERVER',
            port: 993,
            secure: true,
            tlsMinVersion: 'TLSv1.2',
        },
        user: 'YOUR_MAIL_ADDRESS',
        password: 'YOUR_MAIL_PASSWORD',
    },
    mfax: {
        sendPassword: 'YOUR_MFAX_SEND_PASSWORD',
        fromAddress: 'YOUR_FROM_ADDRESS',
        selfFax: '自分のFAX番号（数字のみ。送付書への記載分を除外するために利用）',
    },
};

function isObject(value: any): value is AnyConfig {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

function cloneConfig<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

function mergeDefaults(defaults: AnyConfig, config: AnyConfig): AnyConfig {
    const merged = cloneConfig(defaults);

    for (const [key, value] of Object.entries(config || {})) {
        if (isObject(value) && isObject(merged[key])) {
            merged[key] = mergeDefaults(merged[key], value);
        } else {
            merged[key] = value;
        }
    }

    return merged;
}

function getDefaultSearchRoots() {
    return [process.cwd(), __dirname, path.dirname(process.execPath)].filter(Boolean);
}

function findUpward(startDir: string, fileName: string) {
    let currentDir = path.resolve(startDir);

    while (true) {
        const candidate = path.join(currentDir, fileName);
        if (fs.existsSync(candidate)) {
            return candidate;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            return null;
        }

        currentDir = parentDir;
    }
}

function findProjectRoot(searchRoots = getDefaultSearchRoots()) {
    const seen = new Set<string>();

    for (const searchRoot of searchRoots) {
        let currentDir = path.resolve(searchRoot);

        while (!seen.has(currentDir)) {
            seen.add(currentDir);

            if (
                fs.existsSync(path.join(currentDir, 'package.json')) ||
                fs.existsSync(path.join(currentDir, 'config.template.json'))
            ) {
                return currentDir;
            }

            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) {
                break;
            }
            currentDir = parentDir;
        }
    }

    return process.cwd();
}

function findTemplatePath(searchRoots = getDefaultSearchRoots()) {
    for (const searchRoot of searchRoots) {
        const templatePath = findUpward(searchRoot, 'config.template.json');
        if (templatePath) {
            return templatePath;
        }
    }

    return null;
}

function loadDefaultConfig(searchRoots = getDefaultSearchRoots()) {
    const templatePath = findTemplatePath(searchRoots);
    if (!templatePath) {
        return cloneConfig(DEFAULT_CONFIG);
    }

    try {
        const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
        return mergeDefaults(DEFAULT_CONFIG, template);
    } catch (_err) {
        return cloneConfig(DEFAULT_CONFIG);
    }
}

function findExistingConfigPath(searchRoots = getDefaultSearchRoots()) {
    for (const searchRoot of searchRoots) {
        const configPath = findUpward(searchRoot, 'config.json');
        if (configPath) {
            return configPath;
        }
    }

    return null;
}

function resolveConfigPath(searchRoots = getDefaultSearchRoots()) {
    const existingConfigPath = findExistingConfigPath(searchRoots);
    if (existingConfigPath) {
        return existingConfigPath;
    }

    return path.join(findProjectRoot(searchRoots), 'config.json');
}

function ensureConfigExists(searchRoots = getDefaultSearchRoots()) {
    const existingConfigPath = findExistingConfigPath(searchRoots);
    if (existingConfigPath) {
        return {
            configPath: existingConfigPath,
            created: false,
            createdFromTemplate: false,
            templatePath: null,
        };
    }

    const configPath = path.join(findProjectRoot(searchRoots), 'config.json');
    const templatePath = findTemplatePath(searchRoots);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    // 初回起動時に手作業なしで設定画面へ進めるよう、テンプレートを実設定に昇格します。
    if (templatePath) {
        fs.copyFileSync(templatePath, configPath);
        return {
            configPath,
            created: true,
            createdFromTemplate: true,
            templatePath,
        };
    }

    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 4) + '\n', 'utf-8');
    return {
        configPath,
        created: true,
        createdFromTemplate: false,
        templatePath: null,
    };
}

function loadConfigForEditor(searchRoots = getDefaultSearchRoots()) {
    const ensured = ensureConfigExists(searchRoots);
    const configPath = ensured.configPath;
    const defaults = loadDefaultConfig(searchRoots);

    try {
        const currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return {
            configPath,
            exists: true,
            created: ensured.created,
            createdFromTemplate: ensured.createdFromTemplate,
            templatePath: ensured.templatePath,
            config: mergeDefaults(defaults, currentConfig),
            defaults,
            parseError: null,
        };
    } catch (err) {
        return {
            configPath,
            exists: fs.existsSync(configPath),
            created: ensured.created,
            createdFromTemplate: ensured.createdFromTemplate,
            templatePath: ensured.templatePath,
            config: defaults,
            defaults,
            parseError: err instanceof Error ? err.message : String(err),
        };
    }
}

function saveConfigFromEditor(config: AnyConfig, searchRoots = getDefaultSearchRoots()) {
    if (!isObject(config)) {
        throw new Error('設定はJSONオブジェクトである必要があります。');
    }

    const configPath = resolveConfigPath(searchRoots);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4) + '\n', 'utf-8');

    return {
        configPath,
        config,
    };
}

module.exports = {
    findProjectRoot,
    findExistingConfigPath,
    resolveConfigPath,
    ensureConfigExists,
    loadConfigForEditor,
    saveConfigFromEditor,
};
