/**
 * Claude の Skill と ChatGPT（プロジェクト・GPT）用の起案キットを作り、web/downloads/ に ZIP で置く。
 * 元は src/base/court_doc_rules.md・src/base/sample.md・src/templates/*.md（起案キット・Web の起案画面と同じ）。
 *
 *   npm run build:ai-kits
 *
 * ZIP の中の日時は固定するので、元が変わらなければ ZIP も変わらない（Web に置くファイルの差分を増やさない）。
 * 上限（Skill の説明の字数、ChatGPT の指示文の字数と知識ファイルの本数）を超えたらエラーにする。
 */
const fs = require('fs');
const path = require('path');
const { requireTs } = require('./ts_loader');

const projectRoot = path.resolve(__dirname, '..');
const downloadsDir = path.join(projectRoot, 'web', 'downloads');
const FIXED_ZIP_DATE = new Date(2026, 0, 1, 0, 0, 0);

const SKILL_ZIP = 'houhi-claude-skill.zip';
const CHATGPT_ZIP = 'houhi-chatgpt-kit.zip';

function readKitSources() {
  const baseDir = path.join(projectRoot, 'src/base');
  const templatesDir = path.join(projectRoot, 'src/templates');
  return {
    rules: fs.readFileSync(path.join(baseDir, 'court_doc_rules.md'), 'utf-8'),
    sample: fs.readFileSync(path.join(baseDir, 'sample.md'), 'utf-8'),
    templates: fs.readdirSync(templatesDir)
      .filter(name => name.endsWith('.md'))
      .map(name => ({ fileName: name, markdown: fs.readFileSync(path.join(templatesDir, name), 'utf-8') }))
  };
}

function checkLimits(kit, skillFiles, chatGptFiles) {
  const errors = [];
  const description = kit.buildClaudeSkillDescription();
  if ([...description].length > kit.CLAUDE_SKILL_DESCRIPTION_MAX) {
    errors.push(`Skill の説明が ${[...description].length} 字で、上限 ${kit.CLAUDE_SKILL_DESCRIPTION_MAX} 字を超えています。`);
  }
  if (!/^[a-z0-9-]{1,64}$/.test(kit.CLAUDE_SKILL_NAME) || /anthropic|claude/.test(kit.CLAUDE_SKILL_NAME)) {
    errors.push(`Skill の名前「${kit.CLAUDE_SKILL_NAME}」が規則に合いません。`);
  }
  const skillMd = skillFiles.find(file => file.path.endsWith('/SKILL.md'));
  if (!skillMd || skillMd.content.split('\n').length > 500) {
    errors.push('SKILL.md が無いか、500行を超えています。');
  }
  const instructions = chatGptFiles.find(file => file.path === 'instructions.txt');
  if (!instructions || [...instructions.content].length > kit.CHATGPT_INSTRUCTIONS_MAX) {
    errors.push(`ChatGPT の指示文が ${instructions ? [...instructions.content].length : 0} 字で、上限 ${kit.CHATGPT_INSTRUCTIONS_MAX} 字を超えています。`);
  }
  const knowledgeCount = chatGptFiles.filter(file => file.path.startsWith('knowledge/')).length;
  if (knowledgeCount > kit.CHATGPT_KNOWLEDGE_FILES_MAX) {
    errors.push(`ChatGPT の知識ファイルが ${knowledgeCount} 本で、上限 ${kit.CHATGPT_KNOWLEDGE_FILES_MAX} 本を超えています。`);
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }
  return {
    descriptionLength: [...description].length,
    skillLines: skillMd.content.split('\n').length,
    instructionsLength: [...instructions.content].length,
    knowledgeCount
  };
}

function toZip(zip, files) {
  const encoder = new TextEncoder();
  return zip.buildStoredZip(files.map(file => ({ path: file.path, data: encoder.encode(file.content) })), { date: FIXED_ZIP_DATE });
}

function buildAiKits({ quiet = false } = {}) {
  const kit = requireTs(path.join(projectRoot, 'src/lib/drafting_kit.ts'));
  const zip = requireTs(path.join(projectRoot, 'src/web/zip.ts'));
  const sources = readKitSources();
  const skillFiles = kit.buildClaudeSkillFiles(sources);
  const chatGptFiles = kit.buildChatGptKitFiles(sources);
  const stats = checkLimits(kit, skillFiles, chatGptFiles);

  fs.mkdirSync(downloadsDir, { recursive: true });
  fs.writeFileSync(path.join(downloadsDir, SKILL_ZIP), toZip(zip, skillFiles));
  fs.writeFileSync(path.join(downloadsDir, CHATGPT_ZIP), toZip(zip, chatGptFiles));

  if (!quiet) {
    console.log(`[ai-kits] built web/downloads/${SKILL_ZIP}（${skillFiles.length} ファイル、SKILL.md ${stats.skillLines} 行、説明 ${stats.descriptionLength} 字）`);
    console.log(`[ai-kits] built web/downloads/${CHATGPT_ZIP}（指示文 ${stats.instructionsLength} 字、知識ファイル ${stats.knowledgeCount} 本）`);
  }
  return { skillFiles, chatGptFiles, stats };
}

if (require.main === module) {
  try {
    buildAiKits();
  } catch (err) {
    console.error(`[ai-kits] ${err.message}`);
    process.exit(1);
  }
}

module.exports = { buildAiKits, SKILL_ZIP, CHATGPT_ZIP };
