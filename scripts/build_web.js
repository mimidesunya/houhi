const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');
const webDir = path.join(projectRoot, 'web');
const vendorDir = path.join(webDir, 'vendor');

const pdfEntryId = 'src/web/app';
const draftingEntryId = 'src/web/drafting';
const archiveEntryId = 'src/web/archive';
const stampEntryId = 'src/web/stamp';
const faxEntryId = 'src/web/fax';
const virtualTeamInstructionFileName = '仮想チーム構成.md';
const virtualTeamArchiveSectionHeading = '## AIアーカイブで使う場合';
const moduleFiles = {
  'src/base/court_markdown': path.join(projectRoot, 'src/base/court_markdown.ts'),
  'src/lib/paged_toc': path.join(projectRoot, 'src/lib/paged_toc.ts'),
  'src/lib/ai_archive/case_index_renderer': path.join(projectRoot, 'src/lib/ai_archive/case_index_renderer.ts'),
  'src/lib/ai_archive/constants': path.join(projectRoot, 'src/lib/ai_archive/constants.ts'),
  'src/lib/ai_archive/inference': path.join(projectRoot, 'src/lib/ai_archive/inference.ts'),
  'src/lib/ai_archive/instruction_structure_renderer': path.join(projectRoot, 'src/lib/ai_archive/instruction_structure_renderer.ts'),
  'src/lib/ai_archive/manifest': path.join(projectRoot, 'src/lib/ai_archive/manifest.ts'),
  'src/lib/ai_archive/readme_renderer': path.join(projectRoot, 'src/lib/ai_archive/readme_renderer.ts'),
  'src/lib/ai_archive/renderers': path.join(projectRoot, 'src/lib/ai_archive/renderers.ts'),
  'src/lib/ai_archive/start_here_renderer': path.join(projectRoot, 'src/lib/ai_archive/start_here_renderer.ts'),
  'src/lib/ai_archive/team_instruction': path.join(projectRoot, 'src/lib/ai_archive/team_instruction.ts'),
  'src/lib/ai_archive/utils': path.join(projectRoot, 'src/lib/ai_archive/utils.ts'),
  'src/lib/ai_archive/warnings_renderer': path.join(projectRoot, 'src/lib/ai_archive/warnings_renderer.ts'),
  'src/web/document_title': path.join(projectRoot, 'src/web/document_title.ts'),
  'src/web/markdown_normalizer': path.join(projectRoot, 'src/web/markdown_normalizer.ts'),
  [pdfEntryId]: path.join(projectRoot, 'src/web/app.ts'),
  [draftingEntryId]: path.join(projectRoot, 'src/web/drafting.ts'),
  'src/web/zip': path.join(projectRoot, 'src/web/zip.ts'),
  [archiveEntryId]: path.join(projectRoot, 'src/web/archive.ts'),
  [stampEntryId]: path.join(projectRoot, 'src/web/stamp.ts'),
  [faxEntryId]: path.join(projectRoot, 'src/web/fax.ts')
};

const draftingTemplateOrder = [
  '訴訟.訴状.md',
  '訴訟.答弁書.md',
  '訴訟.準備書面.md',
  '訴訟.証拠説明書.md',
  '訴訟.送付書.md',
  '訴訟.期日請書.md',
  '訴訟.事務連絡.md',
  '訴訟.上申書.md',
  '訴訟.発信者情報開示請求訴状.md',
  '訴訟.発信者情報開示命令異議の訴え訴状.md',
  '訴訟.秘匿決定申立書.md',
  '訴訟.秘匿事項届出書面.md',
  '訴訟.移送申立書.md',
  '訴訟.控訴状.md',
  '訴訟.控訴理由書.md',
  '訴訟.上告状兼上告受理申立書.md',
  '訴訟.上告理由書.md',
  '訴訟.上告受理申立て理由書.md',
  '訴訟.忌避申立書.md',
  '保全.投稿記事削除仮処分命令申立書.md',
  '保全.発信者情報開示仮処分命令申立書.md',
  '保全.発信者情報消去禁止仮処分命令申立書.md',
  '保全.投稿記事削除及び発信者情報開示仮処分命令申立書.md',
  '保全.送達延期上申書.md',
  '非訟.発信者情報開示命令申立書兼提供命令申立書.md',
  '非訟.発信者情報開示命令申立書兼消去禁止命令申立書.md',
  '非訟.発信者情報開示命令申立事件併合上申書.md',
  '非訟.発信者情報開示命令申立て取下書.md',
  '反訳書.md',
  '行政.住民監査請求書.md',
  '行政.審査請求書.md',
  '行政.反論書.md',
  '行政.上申書.md',
  '行政.開示請求.md',
  '行政.個人情報開示請求の取下書.md',
  '行政.司法行政文書開示苦情申出書.md',
  '行政.保有個人情報開示苦情申出書.md',
  '刑事.告訴状.md'
];

const draftingTemplateRank = new Map(draftingTemplateOrder.map((name, index) => [name, index]));

function normalizeModuleId(value) {
  return value.replace(/\\/g, '/').replace(/\.(ts|js)$/, '');
}

function compileTs(filePath) {
  const source = fs.readFileSync(filePath, 'utf-8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      noEmitOnError: false
    },
    fileName: filePath
  });
  return result.outputText;
}

function jsString(value) {
  return JSON.stringify(value);
}

function normalizeNewlines(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function extractMarkdownSection(markdown, heading) {
  const lines = normalizeNewlines(markdown).split('\n');
  const startIndex = lines.findIndex(line => line.trim() === heading);
  if (startIndex < 0) return null;

  const sectionLines = [];
  for (let index = startIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    if (/^##\s+/.test(line.trim())) break;
    sectionLines.push(line);
  }

  return sectionLines.join('\n').trim();
}

function buildVirtualTeamArchiveInstructionContent(sourceContent) {
  const sourceText = normalizeNewlines(sourceContent);
  const archiveSection = extractMarkdownSection(sourceText, virtualTeamArchiveSectionHeading);
  if (!archiveSection) return `${sourceText.trim()}\n`;

  return `# 仮想チーム構成\n\n${archiveSection}\n`;
}

function splitTemplateAiNotes(markdown) {
  const notes = [];
  const content = String(markdown || '').replace(/<!--([\s\S]*?)-->/g, (_match, note) => {
    const cleaned = note
      .split(/\r?\n/)
      .map(line => line.trim())
      .join('\n')
      .trim();
    if (cleaned) {
      notes.push(cleaned);
    }
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();

  return {
    content,
    aiNotes: notes.join('\n\n').trim()
  };
}

function buildTemplateNotesSection(aiNotes) {
  const notes = String(aiNotes || '').trim();
  return notes ? `Template-specific AI notes:\n\n${notes}\n\n` : '';
}

fs.mkdirSync(webDir, { recursive: true });
fs.mkdirSync(vendorDir, { recursive: true });

function buildBundle(entryId, selectedModuleFiles) {
  const modulesSource = Object.entries(selectedModuleFiles)
    .map(([id, filePath]) => {
    const code = compileTs(filePath);
    return `${jsString(normalizeModuleId(id))}: function(require, module, exports) {\n${code}\n}`;
  })
  .join(',\n');

  return `// Generated by scripts/build_web.js. Do not edit directly.
(function () {
  var modules = {
${modulesSource}
  };
  var cache = {};
  function resolve(from, request) {
    if (request.charAt(0) !== '.') return request;
    var parts = from.split('/');
    parts.pop();
    var raw = parts.concat(request.split('/'));
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var part = raw[i];
      if (!part || part === '.') continue;
      if (part === '..') out.pop();
      else out.push(part);
    }
    return out.join('/').replace(/\\.(js|ts)$/, '');
  }
  function load(id) {
    if (cache[id]) return cache[id].exports;
    if (!modules[id]) throw new Error('Module not found: ' + id);
    var module = { exports: {} };
    cache[id] = module;
    modules[id](function (request) { return load(resolve(id, request)); }, module, module.exports);
    return module.exports;
  }
  load(${jsString(entryId)});
}());
`;
}

function readDraftingData() {
  const rulesPath = path.join(projectRoot, 'src/base/court_doc_rules.md');
  const templatesDir = path.join(projectRoot, 'src/templates');
  const templates = fs.readdirSync(templatesDir)
    .filter(name => name.endsWith('.md'))
    .sort((a, b) => {
      const rankA = draftingTemplateRank.has(a) ? draftingTemplateRank.get(a) : Number.MAX_SAFE_INTEGER;
      const rankB = draftingTemplateRank.has(b) ? draftingTemplateRank.get(b) : Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.localeCompare(b, 'ja');
    })
    .map(name => {
      const parsed = splitTemplateAiNotes(fs.readFileSync(path.join(templatesDir, name), 'utf-8'));
      return {
        id: name,
        name: path.basename(name, '.md'),
        content: parsed.content,
        aiNotes: parsed.aiNotes
      };
    });

  return {
    generatedAt: new Date().toISOString(),
    rules: fs.readFileSync(rulesPath, 'utf-8'),
    templates
  };
}

function readInstructionSources() {
  const baseDir = path.join(projectRoot, 'src/base');
  const templatesDir = path.join(projectRoot, 'src/templates');
  const instructionPath = path.join(baseDir, 'court_doc_rules.md');
  const instructionContent = fs.readFileSync(instructionPath, 'utf-8');
  const placeholder = /```markdown\r?\n```/;
  const files = [];

  const samplePath = path.join(baseDir, 'sample.md');
  if (fs.existsSync(samplePath)) {
    files.push({ path: samplePath, name: 'sample.md' });
  }

  const templateFiles = fs.readdirSync(templatesDir)
    .filter(name => name.endsWith('.md'))
    .sort((a, b) => {
      const rankA = draftingTemplateRank.has(a) ? draftingTemplateRank.get(a) : Number.MAX_SAFE_INTEGER;
      const rankB = draftingTemplateRank.has(b) ? draftingTemplateRank.get(b) : Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.localeCompare(b, 'ja');
    })
    .map(name => ({ path: path.join(templatesDir, name), name }));

  files.push(...templateFiles);

  return { instructionContent, placeholder, files };
}

function buildArchiveStartHere(files) {
  const documentTypes = files
    .filter(file => file.name !== 'sample.md')
    .map(file => path.basename(file.name, '.md'))
    .map(name => `- ${name}`)
    .join('\n');

  return `# START_HERE - Chat AIへの指示

<role>
あなたは「法匪（HOUHI）」の書面起案アシスタントです。
</role>

<context>
このZIPには、日本の裁判実務向けMarkdown書面を作るための共通ルールと書面別テンプレートが入っています。
</context>

<success_criteria>
- ユーザーの具体的な要望を優先し、書面種別と目的を取り違えない。
- 共通ルール、該当テンプレート、ユーザーが添付した根拠資料を区別して読む。
- テンプレート内の例示文を、ユーザーの事件の事実として扱わない。
- テンプレート固有のAI向け注意が別記されている場合は、それをテンプレート本文とは区別して読む。
- 不足情報があれば推測で埋めず、短く具体的に質問する。
- ユーザーが指定した書面1通だけを作成し、関連書面は勝手に本文化しない。
- 上告理由書と上告受理申立て理由書を混同・合体させない。両方必要な場合は別々の書面として作成する。
- 最終稿では法匪Markdownの見出し、番号、表、画像、ルビ、証拠表記、金額表記の規則を守る。
</success_criteria>

ユーザーが具体的な要望を送っている場合は、その要望を優先してください。
必要な資料や情報が不足している場合は、推測で完成させず、具体的に質問してください。
ユーザーが特定の書面名を指定している場合は、その書面1通だけを作成してください。
ユーザーが上告理由と上告受理申立て理由の両方を求めている場合でも、1通にまとめず、「上告理由書」と「上告受理申立て理由書」を別々に作成してください。
証拠説明書、送付書、添付書類一覧、決定案などの関連書面は、ユーザーが明示的に依頼した場合に限り作成してください。必要と思われる場合でも、勝手に本文を作らず「必要であれば別途作成できます」と案内するにとどめてください。

<workflow>
1. 依頼内容と書面種別を確認してください。
2. 書面種別に対応するテンプレートと共通ルールを確認してください。
3. 事件資料、OCR結果、当事者情報、裁判所名、事件番号、請求内容、主張したい結論、証拠番号などの不足を確認してください。
4. 不足情報があれば本文作成より先に質問してください。
5. 情報が揃ったら、テンプレートを事件に合わせて編集し、不要な節は削ってください。
6. 最終稿の前に、空欄、不要な譲歩、根拠のない断定、テンプレート例示文の残存、金額表記の揺れ、Markdown記法違反がないか確認してください。
</workflow>

最終的に書面を作るときは、法匪のMarkdown仕様に従ってMarkdown本文を生成し、法匪Webの「PDF変換 / 印刷」に貼り付けてプレビューするよう案内してください。

## 利用できる書面テンプレート

${documentTypes}
`;
}

function readArchiveData() {
  const { instructionContent, placeholder, files } = readInstructionSources();
  const instructions = [
    {
      displayPath: 'instructions/00_START_HERE.md',
      content: buildArchiveStartHere(files),
      isCommonRules: false,
      isWorkflowGuide: true,
      isTeamGuide: false
    }
  ];

  const virtualTeamInstructionPath = path.join(projectRoot, 'docs', virtualTeamInstructionFileName);
  if (fs.existsSync(virtualTeamInstructionPath)) {
    instructions.push({
      displayPath: `instructions/${virtualTeamInstructionFileName}`,
      content: buildVirtualTeamArchiveInstructionContent(fs.readFileSync(virtualTeamInstructionPath, 'utf-8')),
      isCommonRules: false,
      isWorkflowGuide: false,
      isTeamGuide: true
    });
  }

  for (const file of files) {
    const parsed = splitTemplateAiNotes(fs.readFileSync(file.path, 'utf-8'));
    const replacement = `${buildTemplateNotesSection(parsed.aiNotes)}\`\`\`markdown\n${parsed.content}\n\`\`\``;
    instructions.push({
      displayPath: `instructions/${file.name}`,
      content: instructionContent.replace(placeholder, replacement),
      isCommonRules: file.name === 'sample.md',
      isWorkflowGuide: false,
      isTeamGuide: false
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    instructions
  };
}

fs.writeFileSync(path.join(webDir, 'app.js'), buildBundle(pdfEntryId, {
  'src/base/court_markdown': moduleFiles['src/base/court_markdown'],
  'src/lib/paged_toc': moduleFiles['src/lib/paged_toc'],
  'src/web/document_title': moduleFiles['src/web/document_title'],
  'src/web/markdown_normalizer': moduleFiles['src/web/markdown_normalizer'],
  [pdfEntryId]: moduleFiles[pdfEntryId]
}), 'utf-8');
fs.writeFileSync(path.join(webDir, 'drafting.js'), buildBundle(draftingEntryId, {
  [draftingEntryId]: moduleFiles[draftingEntryId]
}), 'utf-8');
fs.writeFileSync(path.join(webDir, 'archive.js'), buildBundle(archiveEntryId, {
  'src/lib/ai_archive/case_index_renderer': moduleFiles['src/lib/ai_archive/case_index_renderer'],
  'src/lib/ai_archive/constants': moduleFiles['src/lib/ai_archive/constants'],
  'src/lib/ai_archive/inference': moduleFiles['src/lib/ai_archive/inference'],
  'src/lib/ai_archive/instruction_structure_renderer': moduleFiles['src/lib/ai_archive/instruction_structure_renderer'],
  'src/lib/ai_archive/manifest': moduleFiles['src/lib/ai_archive/manifest'],
  'src/lib/ai_archive/readme_renderer': moduleFiles['src/lib/ai_archive/readme_renderer'],
  'src/lib/ai_archive/renderers': moduleFiles['src/lib/ai_archive/renderers'],
  'src/lib/ai_archive/start_here_renderer': moduleFiles['src/lib/ai_archive/start_here_renderer'],
  'src/lib/ai_archive/team_instruction': moduleFiles['src/lib/ai_archive/team_instruction'],
  'src/lib/ai_archive/utils': moduleFiles['src/lib/ai_archive/utils'],
  'src/lib/ai_archive/warnings_renderer': moduleFiles['src/lib/ai_archive/warnings_renderer'],
  'src/web/zip': moduleFiles['src/web/zip'],
  [archiveEntryId]: moduleFiles[archiveEntryId]
}), 'utf-8');
fs.writeFileSync(path.join(webDir, 'stamp.js'), buildBundle(stampEntryId, {
  'src/web/zip': moduleFiles['src/web/zip'],
  [stampEntryId]: moduleFiles[stampEntryId]
}), 'utf-8');
fs.writeFileSync(path.join(webDir, 'fax.js'), buildBundle(faxEntryId, {
  [faxEntryId]: moduleFiles[faxEntryId]
}), 'utf-8');
fs.writeFileSync(
  path.join(webDir, 'drafting-data.js'),
  `window.HOUHI_DRAFTING_DATA = ${JSON.stringify(readDraftingData())};\n`,
  'utf-8'
);
fs.writeFileSync(
  path.join(webDir, 'archive-data.js'),
  `window.HOUHI_ARCHIVE_DATA = ${JSON.stringify(readArchiveData())};\n`,
  'utf-8'
);
fs.copyFileSync(path.join(projectRoot, 'src/base/style.css'), path.join(webDir, 'court.css'));
fs.copyFileSync(
  path.join(projectRoot, 'node_modules/pagedjs/dist/paged.polyfill.min.js'),
  path.join(vendorDir, 'paged.polyfill.min.js')
);

console.log('[web] built web/app.js');
console.log('[web] built web/drafting.js');
console.log('[web] built web/drafting-data.js');
console.log('[web] built web/archive.js');
console.log('[web] built web/archive-data.js');
console.log('[web] built web/stamp.js');
console.log('[web] built web/fax.js');
console.log('[web] copied web/court.css');
console.log('[web] copied web/vendor/paged.polyfill.min.js');
