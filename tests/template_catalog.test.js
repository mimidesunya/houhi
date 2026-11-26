const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');

const catalog = require('../dist/src/lib/template_catalog.js');
const kit = require('../dist/src/lib/drafting_kit.js');

const templatesDir = path.resolve('src/templates');
const templateFiles = fs.readdirSync(templatesDir).filter(name => name.endsWith('.md'));

function readWebAssignment(filePath, globalName) {
    const source = fs.readFileSync(path.resolve(filePath), 'utf-8').trim();
    const prefix = `window.${globalName} = `;
    return JSON.parse(source.slice(prefix.length).replace(/;\s*$/, ''));
}

function readKitSources() {
    return {
        rules: fs.readFileSync(path.resolve('src/base/court_doc_rules.md'), 'utf-8'),
        sample: fs.readFileSync(path.resolve('src/base/sample.md'), 'utf-8'),
        templates: templateFiles.map(name => ({ fileName: name, markdown: fs.readFileSync(path.join(templatesDir, name), 'utf-8') })),
    };
}

// ─── 並びと群 ─────────────────────────────────

test('template catalog: TEMPLATE_ORDER lists exactly the files in src/templates, once each', () => {
    assert.deepEqual([...catalog.TEMPLATE_ORDER].sort(), [...templateFiles].sort());
    assert.equal(new Set(catalog.TEMPLATE_ORDER).size, catalog.TEMPLATE_ORDER.length);
});

test('template catalog: よく使う group holds the six common documents in this order', () => {
    assert.deepEqual(catalog.FREQUENT_TEMPLATES, [
        '訴訟.答弁書.md',
        '訴訟.準備書面.md',
        '訴訟.証拠説明書.md',
        '訴訟.送付書.md',
        '訴訟.期日請書.md',
        '行政.開示請求.md',
    ]);
    for (const name of catalog.FREQUENT_TEMPLATES) {
        assert.ok(templateFiles.includes(name), name);
        assert.equal(catalog.getTemplateGroup(name), 'よく使う');
        assert.equal(catalog.getTemplateGroup(name.replace(/\.md$/, '')), 'よく使う');
    }
    assert.equal(catalog.getTemplateGroup('訴訟.訴状.md'), 'その他');
});

test('template catalog: sorting puts よく使う first, then TEMPLATE_ORDER, then unknown names by name', () => {
    const sorted = catalog.sortTemplateNames(['刑事.告訴状.md', '新しい.書面.md', '訴訟.訴状.md', '行政.開示請求.md', '訴訟.答弁書.md']);
    assert.deepEqual(sorted, ['訴訟.答弁書.md', '行政.開示請求.md', '訴訟.訴状.md', '刑事.告訴状.md', '新しい.書面.md']);
    const groups = catalog.groupTemplates(templateFiles, name => name);
    assert.deepEqual(groups.map(group => group.label), ['よく使う', 'その他']);
    assert.equal(groups[0].templates.length, 6);
    assert.equal(groups[0].templates.length + groups[1].templates.length, templateFiles.length);
});

test('template catalog: appendTemplateOptions builds one optgroup per group', () => {
    const created = [];
    const doc = {
        createElement(tag) {
            const element = { tag, children: [], appendChild(child) { this.children.push(child); } };
            created.push(element);
            return element;
        },
    };
    const select = doc.createElement('select');
    catalog.appendTemplateOptions(doc, select, templateFiles.map(name => ({ id: name, name: name.replace(/\.md$/, '') })));
    assert.deepEqual(select.children.map(group => [group.tag, group.label]), [['optgroup', 'よく使う'], ['optgroup', 'その他']]);
    assert.equal(select.children[0].children[0].value, '訴訟.答弁書.md');
    assert.equal(select.children[0].children[0].textContent, '訴訟.答弁書');
});

test('template catalog: splitTemplateAiNotes separates AI notes', () => {
    const parsed = catalog.splitTemplateAiNotes('# 書面\n<!--\n  AI NOTE: 注意\n-->\n\n\n本文');
    assert.equal(parsed.content, '# 書面\n\n本文');
    assert.equal(parsed.aiNotes, 'AI NOTE: 注意');
});

test('generated web drafting data follows the shared order and carries the group', () => {
    const data = readWebAssignment('web/drafting-data.js', 'HOUHI_DRAFTING_DATA');
    assert.deepEqual(data.templates.map(template => template.id), catalog.sortTemplateNames(templateFiles));
    assert.ok(data.templates.every(template => template.group === catalog.getTemplateGroup(template.id)));
    assert.ok(data.templates.some(template => template.id === '行政.保有個人情報利用停止請求書.md'));
});

test('generated archive instructions list every template in the shared order', () => {
    const data = readWebAssignment('web/archive-data.js', 'HOUHI_ARCHIVE_DATA');
    const instructionNames = data.instructions
        .map(item => item.displayPath.replace(/^instructions\//, ''))
        .filter(name => name.endsWith('.md') && !/START_HERE|仮想チーム構成|sample\.md/.test(name));
    assert.deepEqual(instructionNames, catalog.sortTemplateNames(templateFiles));
    const startHere = data.instructions.find(item => item.isWorkflowGuide);
    assert.match(startHere.content, /### よく使う\n\n- 訴訟\.答弁書/);
    for (const name of templateFiles) {
        assert.ok(startHere.content.includes(`- ${name.replace(/\.md$/, '')}`), name);
    }
});

// ─── START_HERE と AI 向けキット ────────────────────

test('drafting kit: START_HERE for the desktop zip and the web archive', () => {
    const zip = kit.buildStartHere(templateFiles, 'zip');
    const archive = kit.buildStartHere(templateFiles, 'archive');
    for (const text of [zip, archive]) {
        assert.match(text, /<success_criteria>/);
        assert.match(text, /<workflow>/);
        assert.match(text, /上告理由書と上告受理申立て理由書を混同・合体させない/);
        assert.match(text, /## 利用できる書面テンプレート/);
        assert.doesNotMatch(text, /sample$/m);
    }
    assert.match(zip, /## 最初の応答/);
    assert.match(zip, /mimidesunya\.github\.io\/houhi\/pdf\.html/);
    assert.doesNotMatch(archive, /## 最初の応答/);
});

test('drafting kit: rule files embed sample.md first and each template with its notes outside the Markdown block', () => {
    const files = kit.buildRuleInstructionFiles(readKitSources());
    assert.equal(files[0].name, 'sample.md');
    assert.deepEqual(files.slice(1).map(file => file.name), catalog.sortTemplateNames(templateFiles));
    const appeal = files.find(file => file.name === '訴訟.上告理由書.md');
    assert.match(appeal.content, /Template-specific AI notes:\n\nAI NOTE:/);
    assert.doesNotMatch(appeal.content, /<!--|-->/);
    assert.doesNotMatch(appeal.content, /```markdown\n```/);
});

test('drafting kit: the Claude skill fits claude.ai upload rules', () => {
    const files = kit.buildClaudeSkillFiles(readKitSources());
    const skill = files.find(file => file.path === `${kit.CLAUDE_SKILL_NAME}/SKILL.md`);
    assert.ok(skill, 'SKILL.md sits in the skill folder at the top of the ZIP');
    assert.ok(files.every(file => file.path.startsWith(`${kit.CLAUDE_SKILL_NAME}/`)));
    const front = skill.content.match(/^---\nname: (.+)\ndescription: (.+)\n---\n/);
    assert.ok(front, 'frontmatter with name and description');
    assert.equal(front[1], kit.CLAUDE_SKILL_NAME);
    assert.match(front[1], /^[a-z0-9-]{1,64}$/);
    assert.doesNotMatch(front[1], /anthropic|claude/);
    assert.ok([...front[2]].length <= kit.CLAUDE_SKILL_DESCRIPTION_MAX, `description ${[...front[2]].length} chars`);
    assert.ok(skill.content.split('\n').length < 500);
    assert.ok(files.some(file => file.path === `${kit.CLAUDE_SKILL_NAME}/reference/法匪Markdown規則.md`));
    assert.equal(files.filter(file => file.path.includes('/templates/')).length, templateFiles.length);
    // SKILL.md から全テンプレートへの道筋がある
    for (const name of templateFiles) {
        assert.ok(skill.content.includes(`templates/${name}`), name);
    }
});

test('drafting kit: the ChatGPT kit stays within the instruction and file limits', () => {
    const files = kit.buildChatGptKitFiles(readKitSources());
    const instructions = files.find(file => file.path === 'instructions.txt');
    assert.ok([...instructions.content].length <= kit.CHATGPT_INSTRUCTIONS_MAX);
    const knowledge = files.filter(file => file.path.startsWith('knowledge/'));
    assert.ok(knowledge.length >= 1 && knowledge.length <= kit.CHATGPT_KNOWLEDGE_FILES_MAX);
    for (const file of knowledge) {
        assert.ok(instructions.content.includes(file.path.replace(/^knowledge\//, '')), `instructions name ${file.path}`);
    }
    const templates = knowledge.find(file => /テンプレート集/.test(file.path));
    for (const name of templateFiles) {
        assert.ok(templates.content.includes(`## ${name.replace(/\.md$/, '')}\n`), name);
    }
    assert.doesNotMatch(templates.content, /<!--|-->/);
});

test('web/downloads: the committed AI kit ZIPs match the sources (run npm run build:ai-kits after editing templates)', () => {
    const { buildStoredZip } = require('../dist/src/web/zip.js');
    const encoder = new TextEncoder();
    const date = new Date(2026, 0, 1, 0, 0, 0);
    const expected = {
        'houhi-claude-skill.zip': kit.buildClaudeSkillFiles(readKitSources()),
        'houhi-chatgpt-kit.zip': kit.buildChatGptKitFiles(readKitSources()),
    };
    for (const [zipName, files] of Object.entries(expected)) {
        const zipPath = path.resolve('web/downloads', zipName);
        assert.ok(fs.existsSync(zipPath), zipPath);
        const built = buildStoredZip(files.map(file => ({ path: file.path, data: encoder.encode(file.content) })), { date });
        assert.ok(Buffer.from(built).equals(fs.readFileSync(zipPath)), `${zipName} is out of date`);
        const names = new AdmZip(zipPath).getEntries().map(entry => entry.entryName);
        assert.deepEqual(names, files.map(file => file.path));
    }
});
