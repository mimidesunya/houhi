const { loadConfig } = require('./config_loader');
const { convertHtmlToPdfWithChrome } = require('./pdf_converter_chrome');
const { convertHtmlToPdfWithCopper } = require('./pdf_converter_copper');

const PDF_ENGINE_COPPER = 'copper';
const PDF_ENGINE_CHROME = 'chrome';
const DEFAULT_PDF_ENGINE = PDF_ENGINE_CHROME;

function normalizePdfEngine(engine) {
    const value = String(engine || '').trim().toLowerCase();
    if (!value) return DEFAULT_PDF_ENGINE;
    if (['copper', 'copper-pdf', 'cti'].includes(value)) return PDF_ENGINE_COPPER;
    if (['chrome', 'chromium', 'headless-chrome'].includes(value)) return PDF_ENGINE_CHROME;
    throw new Error(`未対応のPDFエンジンです: ${engine}`);
}

function getConfiguredPdfEngine(config, options) {
    const pdfConfig = (config && config.pdf) || {};
    return normalizePdfEngine(
        options.engine ||
        options.pdfEngine ||
        pdfConfig.engine ||
        config?.pdfEngine ||
        DEFAULT_PDF_ENGINE
    );
}

async function convertHtmlToPdf(htmlPath, outputPath, resourceDir, defaultTemplateDir = null, options = {}) {
    const config = loadConfig();
    const engine = getConfiguredPdfEngine(config, options || {});

    if (engine === PDF_ENGINE_CHROME) {
        return convertHtmlToPdfWithChrome(htmlPath, outputPath, resourceDir, defaultTemplateDir, config, options || {});
    }

    return convertHtmlToPdfWithCopper(htmlPath, outputPath, resourceDir, defaultTemplateDir, config);
}

function resolvePdfEngine(options = {}) {
    return getConfiguredPdfEngine(loadConfig(), options || {});
}

module.exports = {
    PDF_ENGINE_CHROME,
    PDF_ENGINE_COPPER,
    DEFAULT_PDF_ENGINE,
    convertHtmlToPdf,
    normalizePdfEngine,
    resolvePdfEngine
};
