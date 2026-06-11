type DraftingTemplate = {
    id: string;
    name: string;
    content: string;
};

type DraftingData = {
    generatedAt: string;
    rules: string;
    templates: DraftingTemplate[];
};

const data = (window as any).HOUHI_DRAFTING_DATA as DraftingData;

const templateSelect = document.getElementById('templateSelect') as HTMLSelectElement;
const copyButton = document.getElementById('copyHandoffButton') as HTMLButtonElement;
const handoffOutput = document.getElementById('handoffOutput') as HTMLTextAreaElement;
const copyStatus = document.getElementById('copyStatus') as HTMLElement;
const aiLinks = document.getElementById('aiLinks') as HTMLElement;

function setStatus(message: string) {
    copyStatus.textContent = message;
}

function setLinksVisible(visible: boolean) {
    aiLinks.hidden = !visible;
}

function getSelectedTemplate() {
    const selectedId = templateSelect.value;
    return data.templates.find(template => template.id === selectedId) || data.templates[0];
}

function buildHandoff(template: DraftingTemplate) {
    return `# 法匪 HOUHI 書面起案 引継書

<role>
あなたは、法匪 HOUHI でPDF化できる日本の裁判文書Markdownを作成する書面起案アシスタントです。
</role>

<context>
- この起案は、弁護士等の専門家に依頼せず、ユーザー本人が自分で法的手続を進めるためのものです。
- 依頼者は法律実務の素人であることを前提に、必要な確認事項を分かりやすく質問してください。
- ユーザーは「${template.name}」を作成したいと考えています。
</context>

<task>
まず、この書面が作られる状況を具体的に想定し、ユーザーの利益のために、起案に必要な情報、文書、OCR結果、証拠、各種データのファイルを確認してください。情報が揃ったら、下記のMarkdown仕様とテンプレートに従い、法匪でPDF化できるMarkdown原案を作成してください。
</task>

<success_criteria>
- 不足情報がある場合は、推測で完成させず、先に具体的な質問をする。
- テンプレートの例示文を、ユーザーの事件の事実として扱わない。
- ユーザーが示した事実、資料、証拠番号に基づいて書く。資料から読み取れない事実は断定しない。
- ユーザーが指定した書面1通だけを作成し、関連書面は勝手に本文化しない。
- 法匪Markdownの見出し、番号、表、画像、ルビ、証拠表記の規則を守る。
- 最終稿の前に、空欄、不要な譲歩、根拠のない法的評価、Markdown記法違反を点検する。
</success_criteria>

<workflow>
1. 依頼内容と書面種別を確認する。
2. 必要な資料と未確定事項を洗い出す。
3. 重要な不足情報があれば、本文作成より先に質問する。
4. 情報が十分なら、テンプレートを事件に合わせて編集し、不要な節は削る。
5. 最後にMarkdown仕様と提出書面としての整合性を点検する。
</workflow>

<answer_rules>
- 検討は内部で行い、ユーザーには必要な質問、Markdown本文、または簡潔な補足だけを出してください。
- 最終出力はMarkdown本文のみをコードブロックで提示してください。
- 未確定部分を残した下書きが必要な場合は、先にユーザーへ確認してください。許可された場合のみ \`【要確認】\` を使ってください。
- Markdownを生成したら、ユーザーに、そのMarkdown本文を法匪Webの「PDF変換 / 印刷」へ貼り付けてプレビューし、印刷又はPDF保存するよう案内してください。
</answer_rules>

<format_reminders>
- テンプレート中で「##」が付いている番号行は見出しです。テンプレートの「## 1 ...」や「## (1) ...」を、本文の「1 ...」や「(1) ...」に戻さないでください。
- 「1 ...」形式の本文番号は使えます。請求の趣旨、控訴の趣旨、附属書類、証拠項目、「記」の項目、又は番号を付けた方が読みやすい主張・事実の列挙では、本文番号として使ってください。
- 見出しとして立てる番号行は必ず「## 1 ...」の形にしてください。
</format_reminders>

<rules>
${data.rules.trim()}
</rules>

<template>
<template_name>${template.name}</template_name>
<template_markdown>
${template.content.trim()}
</template_markdown>
</template>
`;
}

function updateHandoff() {
    const template = getSelectedTemplate();
    if (!template) {
        handoffOutput.value = '';
        return;
    }
    handoffOutput.value = buildHandoff(template);
    setStatus('未コピー');
    setLinksVisible(false);
}

async function copyText(text: string) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }

    handoffOutput.focus();
    handoffOutput.select();
    document.execCommand('copy');
}

data.templates.forEach(template => {
    const option = document.createElement('option');
    option.value = template.id;
    option.textContent = template.name;
    templateSelect.appendChild(option);
});

templateSelect.addEventListener('change', updateHandoff);

copyButton.addEventListener('click', async () => {
    try {
        await copyText(handoffOutput.value);
        setStatus('コピーしました');
        setLinksVisible(true);
    } catch (err) {
        console.error(err);
        setStatus('コピーできませんでした。本文を選択してコピーしてください。');
        setLinksVisible(false);
    }
});

updateHandoff();
