/**
 * src の TypeScript のモジュールを、tsc でビルドせずに Node で読み込む（scripts/build_web.js・build_ai_kits.js 用）。
 * transpileModule で1ファイルずつ CommonJS にして評価する。相対の import は .ts を探し、それ以外は Node の require に任せる。
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const cache = new Map();

function compileTs(filePath) {
  const source = fs.readFileSync(filePath, 'utf-8');
  return ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      noEmitOnError: false
    },
    fileName: filePath
  }).outputText;
}

function resolveTsPath(fromDir, request) {
  const base = path.resolve(fromDir, request);
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (candidate.endsWith('.ts') && fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`TypeScript のモジュールが見つかりません: ${request}（${fromDir}）`);
}

function requireTs(filePath) {
  const absolutePath = path.resolve(filePath);
  if (cache.has(absolutePath)) return cache.get(absolutePath).exports;

  const module = { exports: {} };
  cache.set(absolutePath, module);
  const localRequire = request => (request.startsWith('.')
    ? requireTs(resolveTsPath(path.dirname(absolutePath), request))
    : require(request));
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', compileTs(absolutePath))(localRequire, module, module.exports);
  return module.exports;
}

module.exports = { compileTs, requireTs };
