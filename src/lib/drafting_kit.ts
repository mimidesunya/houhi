/**
 * チャット AI に渡す起案の資料の組み立て（fs を使わない）。
 *
 * 次の3つが同じ元（src/base/court_doc_rules.md・src/base/sample.md・src/templates/*.md）から作られる。
 * - デスクトップの起案キット houhi-drafting-kit.zip（setup.ts）と、Web の AI アーカイブに入る指示（scripts/build_web.js）
 * - Claude の Skill（`houhi-court-docs/SKILL.md` ほか）
 * - ChatGPT のプロジェクト・GPT 用の指示文と知識ファイル
 * Skill と ChatGPT 用は scripts/build_ai_kits.js が ZIP にして web/downloads/ に置く。
 */
import { FREQUENT_GROUP_LABEL, getTemplateGroup, groupTemplates, sortTemplateNames, splitTemplateAiNotes, templateDisplayName } from './template_catalog';

export const HOUHI_WEB_URL = 'https://mimidesunya.github.io/houhi/';
export const HOUHI_WEB_PDF_URL = `${HOUHI_WEB_URL}pdf.html`;

/** Skill の名前（英小文字・数字・ハイフン、64字以内。フォルダ名と同じにする） */
export const CLAUDE_SKILL_NAME = 'houhi-court-docs';
/** Skill の説明（claude.ai にアップロードするときの上限 200 字に収める） */
export const CLAUDE_SKILL_DESCRIPTION_MAX = 200;
/** ChatGPT の指示文の上限（GPT の Instructions 欄は 8000 字。プロジェクトの指示もこの範囲に収める） */
export const CHATGPT_INSTRUCTIONS_MAX = 8000;
/** ChatGPT の知識ファイルの本数の上限（無料のプロジェクトは 5 件。GPT は 20 件） */
export const CHATGPT_KNOWLEDGE_FILES_MAX = 5;

const RULES_PLACEHOLDER = /```markdown\r?\n```/;

export type TemplateSource = {
    /** ファイル名（`訴訟.答弁書.md`） */
    fileName: string;
    /** テンプレートの中身（AI 向けの注意 `<!-- -->` を含んだまま） */
    markdown: string;
};

export type KitSources = {
    /** src/base/court_doc_rules.md */
    rules: string;
    /** src/base/sample.md（共通の書式の見本） */
    sample: string;
    /** src/templates/*.md */
    templates: TemplateSource[];
};

export type KitFile = {
    path: string;
    content: string;
};

function normalizeNewlines(value: string) {
    return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * テンプレート固有の AI 向けの注意の節（英語の見出し。court_doc_rules.md の書き方に合わせる）
 */
export function buildTemplateNotesSection(aiNotes: string) {
    const notes = String(aiNotes || '').trim();
    return notes ? `Template-specific AI notes:\n\n${notes}\n\n` : '';
}

/**
 * court_doc_rules.md の空の Markdown ブロックに、テンプレート（と AI 向けの注意）を入れる
 */
export function embedTemplateInRules(rules: string, templateContent: string, aiNotes = '') {
    const replacement = `${buildTemplateNotesSection(aiNotes)}\`\`\`markdown\n${templateContent}\n\`\`\``;
    return rules.replace(RULES_PLACEHOLDER, () => replacement);
}

/**
 * 書面名の一覧を、群（よく使う・その他）の小見出しつきの Markdown の箇条書きにする
 */
export function buildTemplateList(fileNames: string[], format: (fileName: string) => string = name => templateDisplayName(name)) {
    return groupTemplates(fileNames, name => name)
        .map(group => `### ${group.label}\n\n${group.templates.map(name => `- ${format(name)}`).join('\n')}`)
        .join('\n\n');
}

const START_HERE_HEADER = `# START_HERE - Chat AIへの指示

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
`;

const PDF_GUIDANCE = `生成したMarkdown本文は、法匪Webの「PDF変換 / 印刷」（${HOUHI_WEB_PDF_URL}）に貼り付ければ、プレビューと提出前チェックを経て、ブラウザの印刷機能で裁判所提出用のPDFにできます。デスクトップ版を使っている場合は、\`.md\` ファイルとして保存して「PDF作成」にドロップしても同じです。`;

/**
 * START_HERE の本文。
 * - `zip`: デスクトップの起案キット（houhi-drafting-kit.zip）の 00_START_HERE.md。ZIP だけを渡されたときの最初の応答も書く。
 * - `archive`: Web の AI アーカイブに入る instructions/00_START_HERE.md。
 */
export function buildStartHere(templateFileNames: string[], variant: 'zip' | 'archive') {
    const templateList = buildTemplateList(sortTemplateNames(templateFileNames.filter(name => name !== 'sample.md')));

    if (variant === 'archive') {
        return `${START_HERE_HEADER}
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

${templateList}
`;
    }

    return `${START_HERE_HEADER}
## 最初の応答

ユーザーがZIPと一緒に「訴状を起案してほしい」「証拠説明書を作ってほしい」などの具体的な要望を送っている場合は、その要望を優先してください。
書面種別や目的が読み取れる場合は、改めて「何を作りたいか」だけを質問せず、必要なテンプレートを確認したうえで、不足している情報を具体的に質問してください。
ユーザーが上告理由と上告受理申立て理由の両方を求めている場合でも、1通にまとめず、「上告理由書」と「上告受理申立て理由書」を別々に作成してください。

このZIPだけを受け取り、ユーザーから何をしてほしいかが明確に示されていない場合は、まだ書面を作り始めないでください。
その場合は、次のように自己紹介し、ユーザーが何の書面を作りたいかを尋ねてください。

例:
「法匪の書面起案アシスタントです。訴状、答弁書、準備書面、控訴理由書、証拠説明書など、どの書面を作成しますか。事件資料やOCR結果があれば一緒に添付してください。」

## 対話の進め方

<workflow>
1. 最初のメッセージに具体的な要望があれば、それを作業目的として扱ってください。
2. 書面種別が未確定なら、ユーザーに作成したい書面種別を確認してください。
3. 書面種別に対応するMarkdownファイルをこのZIP内から探し、まず共通ルール \`sample.md\` と該当テンプレートを読んでください。
4. 事件資料、OCR結果、当事者情報、裁判所名、事件番号、請求内容、主張したい結論、証拠番号など、書面作成に必要な情報が不足していれば質問してください。
5. 情報が揃うまでは、推測で本文を完成させず、不足点を具体的に聞き返してください。
6. 情報が揃ったら、法匪のMarkdown仕様に従って書面本文を生成してください。
7. ユーザーが特定の書面名を指定している場合は、その書面1通だけを作成してください。
8. 証拠説明書、送付書、添付書類一覧、決定案などの関連書面は、ユーザーが明示的に依頼した場合に限り作成してください。必要と思われる場合でも、勝手に本文を作らず「必要であれば別途作成できます」と案内するにとどめてください。
9. 生成後に、PDFの作り方を案内してください。案内の中身: ${PDF_GUIDANCE}
</workflow>

## 追加質問の考え方

- 書面種別が未確定なら、候補を示して選ばせてください。
- 事件資料が不足しているなら、まず資料やOCR結果の添付を求めてください。
- 書面の宛先、当事者、事件番号、日付、請求・申立ての趣旨、理由、証拠番号が必要な書面では、それらを個別に確認してください。
- 法的評価と事実関係は分け、資料から読み取れない事実は断定しないでください。
- ユーザーが急いでいる場合は、未確定部分を \`【要確認】\` として下書きを作るか確認してください。

## 出力形式

- 最終成果物はMarkdownコードブロックで提示してください。
- ファイル名の候補も示してください。例: \`訴訟.訴状.md\`
- Markdown本文以外の説明は、本文の前後に分けて簡潔に書いてください。
- PDF化の案内は最後に短く添えてください。
- 検討は内部で行い、最終回答では必要な質問、Markdown本文、または短い補足だけを出してください。
- 最終稿を出す前に、空欄、不要な譲歩、根拠のない断定、テンプレート例示文の残存、金額表記の揺れ、Markdown記法違反がないか確認してください。

## 利用できる書面テンプレート

${templateList}
`;
}

/**
 * 起案キット（ZIP）や AI アーカイブに入れる、規則にテンプレートを入れた指示ファイル。
 * 最初が sample.md（共通の書式の見本）、続いてテンプレートを並びの順に。
 */
export function buildRuleInstructionFiles(sources: KitSources) {
    const files: Array<{ name: string; content: string }> = [];
    const sample = splitTemplateAiNotes(sources.sample);
    files.push({ name: 'sample.md', content: embedTemplateInRules(sources.rules, sample.content, sample.aiNotes) });
    const byName = new Map(sources.templates.map(template => [template.fileName, template] as [string, TemplateSource]));
    for (const fileName of sortTemplateNames([...byName.keys()])) {
        const parsed = splitTemplateAiNotes(byName.get(fileName)!.markdown);
        files.push({ name: fileName, content: embedTemplateInRules(sources.rules, parsed.content, parsed.aiNotes) });
    }
    return files;
}

/**
 * テンプレート1件を、AI 向けの注意と Markdown に分けて読める形にする（Skill・ChatGPT の知識ファイル用）
 */
function renderTemplateReference(fileName: string, content: string, aiNotes: string, headingLevel: number) {
    const hashes = '#'.repeat(headingLevel);
    const notes = aiNotes ? `${hashes}# AI向けの注意（本文に書き写さない）\n\n${aiNotes}\n\n` : '';
    return `${hashes} ${templateDisplayName(fileName)}\n\n群: ${getTemplateGroup(fileName)}\n\n${notes}${hashes}# テンプレート\n\n\`\`\`\`markdown\n${content}\n\`\`\`\`\n`;
}

function buildRulesReference(sources: KitSources) {
    const sample = splitTemplateAiNotes(sources.sample);
    return normalizeNewlines(embedTemplateInRules(sources.rules, sample.content, sample.aiNotes)).trim() + '\n';
}

/**
 * Claude の Skill のファイル（`houhi-court-docs/` の下）。SKILL.md、規則1つ、テンプレート。
 */
export function buildClaudeSkillFiles(sources: KitSources): KitFile[] {
    const root = CLAUDE_SKILL_NAME;
    const fileNames = sortTemplateNames(sources.templates.map(template => template.fileName));
    const byName = new Map(sources.templates.map(template => [template.fileName, template] as [string, TemplateSource]));
    const description = buildClaudeSkillDescription();
    const templateList = buildTemplateList(fileNames, name => `${templateDisplayName(name)}: \`templates/${name}\``);

    const skill = `---
name: ${CLAUDE_SKILL_NAME}
description: ${description}
---

# 法匪（HOUHI）の書面起案

日本の裁判所や行政機関に出す書面（訴状、答弁書、準備書面、証拠説明書、開示請求書など）を、法匪（HOUHI）のMarkdownで起案するための手順です。法匪は、このMarkdownを裁判書類の体裁のPDFにする道具で、弁護士に依頼せず本人が手続を進める人が使います。

## 進め方

1. 依頼された書面の種類を確かめ、下の一覧から該当するテンプレートを読みます。一覧に無い書面は、近いテンプレートを土台にします。
2. 書式の規則 \`reference/法匪Markdown規則.md\` を必ず読みます。見出しの番号、当事者の欄（\`### --左\` \`### --右\`）、証拠説明書の表、金額や日付の書き方はここに従います。
3. 事件の資料、当事者、裁判所、事件番号、請求の趣旨、証拠番号などで足りないものがあれば、推測で埋めずに先に短く質問します。急ぐと言われたときだけ、分からない所を \`【要確認】\` として下書きにします。
4. 情報が揃ったら、テンプレートを事件に合わせて書き換え、不要な節は削ります。テンプレートの例示文や「〇〇」を事件の事実として残さないようにし、AI向けの注意は本文に書き写しません。
5. 頼まれた書面1通だけを作ります。証拠説明書や送付書などの関連書面は、頼まれたときだけ別に作ります。上告理由書と上告受理申立て理由書は1通にまとめません。
6. 最後に、空欄、根拠のない断定、テンプレートの例示文の残り、金額表記の揺れ、証拠説明書の作成年月日が西暦になっていないか、号証番号が飛んだり重なったりしていないかを見直します。

## 出力

- 書面はMarkdownのコードブロック1つで示し、ファイル名の候補（例: \`訴訟.準備書面.md\`）を添えます。
- 最後に、PDFの作り方を短く案内します。案内の中身: ${PDF_GUIDANCE}

## テンプレート

${templateList}
`;

    const files: KitFile[] = [
        { path: `${root}/SKILL.md`, content: skill },
        { path: `${root}/reference/法匪Markdown規則.md`, content: buildRulesReference(sources) },
    ];
    for (const fileName of fileNames) {
        const parsed = splitTemplateAiNotes(byName.get(fileName)!.markdown);
        files.push({ path: `${root}/templates/${fileName}`, content: renderTemplateReference(fileName, parsed.content, parsed.aiNotes, 1) });
    }
    return files;
}

export function buildClaudeSkillDescription() {
    return '日本の訴状・答弁書・準備書面・証拠説明書・情報公開の開示請求などを、法匪（HOUHI）のMarkdownで起案する。本人訴訟や行政への請求で、裁判所や役所に出す書面を作るときに使う。';
}

/**
 * ChatGPT のプロジェクト（又は GPT）用。指示文1つと知識ファイル2つ（規則、テンプレート集）と、人が読む設定手順。
 */
export function buildChatGptKitFiles(sources: KitSources): KitFile[] {
    const fileNames = sortTemplateNames(sources.templates.map(template => template.fileName));
    const byName = new Map(sources.templates.map(template => [template.fileName, template] as [string, TemplateSource]));
    const rulesFile = '01_法匪Markdown規則.md';
    const templatesFile = '02_書面テンプレート集.md';
    const frequent = fileNames.filter(name => getTemplateGroup(name) === FREQUENT_GROUP_LABEL).map(templateDisplayName).join('、');

    const instructions = `あなたは「法匪（HOUHI）」の書面起案アシスタントです。日本の裁判所や行政機関に出す書面を、法匪のMarkdownで起案します。利用者は弁護士に依頼せず本人で手続を進める人で、法律実務に慣れていないことを前提に、分かりやすく質問してください。

# 知識ファイル
- ${rulesFile}: 法匪Markdownの書式の規則と共通の見本。見出しの番号、当事者の欄（### --左、### --右）、証拠説明書の表、金額や日付の書き方は必ずこれに従う。
- ${templatesFile}: 書面ごとのテンプレート${fileNames.length}件と、テンプレートごとのAI向けの注意。よく使うのは ${frequent}。

# 進め方
1. 依頼された書面の種類を確かめ、テンプレート集から該当するテンプレートを探して読む。無い書面は近いテンプレートを土台にする。
2. 事件の資料、当事者、裁判所、事件番号、請求や申立ての趣旨、主張したい結論、証拠番号などで足りないものがあれば、推測で埋めずに先に短く具体的に質問する。
3. 利用者が急ぐと言ったときだけ、分からない所を【要確認】とした下書きを作る。
4. 情報が揃ったら、テンプレートを事件に合わせて書き換え、不要な節は削る。テンプレートの例示文や「〇〇」を事件の事実として残さない。AI向けの注意は本文に書き写さない。
5. 頼まれた書面1通だけを作る。証拠説明書、送付書、添付書類一覧などの関連書面は、頼まれたときだけ別に作る。上告理由書と上告受理申立て理由書は1通にまとめない。
6. 最終稿の前に、空欄、根拠のない断定、不要な譲歩、テンプレートの例示文の残り、金額表記の揺れ、証拠説明書の作成年月日が西暦になっていないか、号証番号の飛びや重なり、当事者欄と差出人欄の名前の食い違いを見直す。

# 出力
- 書面はMarkdownのコードブロック1つで示し、ファイル名の候補（例: 訴訟.準備書面.md）を添える。説明は本文の前後に短く分ける。
- 資料から読み取れない事実は断定せず、事実、証拠、法的な主張を混ぜない。
- 最後に、PDFの作り方を短く案内する。案内の中身: ${PDF_GUIDANCE}
`;

    const templateBodies = fileNames.map(fileName => {
        const parsed = splitTemplateAiNotes(byName.get(fileName)!.markdown);
        return renderTemplateReference(fileName, parsed.content, parsed.aiNotes, 2);
    });
    const templatesContent = `# 法匪（HOUHI）書面テンプレート集

書面ごとのテンプレートです。「AI向けの注意」は起案するときの注意で、書面の本文には書き写しません。テンプレートの例示文や「〇〇」は書式の例で、利用者の事件の事実ではありません。

${buildTemplateList(fileNames)}

${templateBodies.join('\n')}`;

    const readme = `法匪（HOUHI）ChatGPT 用の起案キット

このZIPには、ChatGPT に法匪のMarkdownで書面を起案させるための指示文と知識ファイルが入っています。

instructions.txt
  プロジェクトの「指示」（GPT なら「Instructions」）に貼り付ける文です。

knowledge/${rulesFile}
knowledge/${templatesFile}
  プロジェクトの「ファイル」（GPT なら「Knowledge」）に追加するファイルです。

ChatGPT のプロジェクトで使う手順
  1. ChatGPT でプロジェクトを新しく作ります（名前は「法匪 書面起案」など）。
  2. プロジェクトの設定を開き、instructions.txt の中身を指示の欄に貼り付けます。
  3. knowledge フォルダの2つのファイルをプロジェクトに追加します。
  4. プロジェクトの中で新しいチャットを始め、作りたい書面と事件の資料を渡します。

作った書面は、法匪Web の「PDF変換 / 印刷」（${HOUHI_WEB_PDF_URL}）に貼り付けると、提出前チェックとプレビューを経てPDFにできます。
書類の中身は ChatGPT に送られます。OpenAI のデータの扱い（学習に使うかどうかの設定）を確かめてから使ってください。
`;

    return [
        { path: 'instructions.txt', content: instructions },
        { path: `knowledge/${rulesFile}`, content: buildRulesReference(sources) },
        { path: `knowledge/${templatesFile}`, content: templatesContent },
        { path: 'はじめに読む.txt', content: readme },
    ];
}
