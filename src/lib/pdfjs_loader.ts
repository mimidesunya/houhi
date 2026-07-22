'use strict';

const { builtinModules } = require('module');

// PDF.js 4 supports Node.js 20, but its optional Node canvas loader uses the
// process.getBuiltinModule API that was added later. Provide the same limited
// built-in-module lookup on older Node.js 20 releases before importing PDF.js.
const builtinModuleNames = new Set(
    builtinModules.map((name: string) => name.replace(/^node:/, ''))
);

type ProcessWithBuiltinModule = NodeJS.Process & {
    getBuiltinModule?: (specifier: string) => unknown;
};

function ensureGetBuiltinModule() {
    const nodeProcess = process as ProcessWithBuiltinModule;
    if (typeof nodeProcess.getBuiltinModule === 'function') {
        return;
    }

    Object.defineProperty(nodeProcess, 'getBuiltinModule', {
        configurable: true,
        value(specifier: string) {
            const normalized = specifier.replace(/^node:/, '');
            if (!builtinModuleNames.has(normalized)) {
                return undefined;
            }
            return require(normalized);
        },
    });
}

const importEsmModule = new Function('specifier', 'return import(specifier)') as
    (specifier: string) => Promise<any>;
let pdfjsLibPromise: Promise<any> | undefined;

function loadPdfJs() {
    ensureGetBuiltinModule();
    pdfjsLibPromise ??= importEsmModule('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjsLibPromise;
}

module.exports = { loadPdfJs };
