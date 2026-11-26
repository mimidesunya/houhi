/**
 * 書面テンプレート（src/templates/*.md）の並びと群。
 *
 * Web の起案画面・PDF 画面のテンプレート選択、Web の drafting-data.js・archive-data.js、
 * デスクトップの起案キット（setup.ts）、AI 向けのキット（scripts/build_ai_kits.js）がこの並びを使う。
 * fs を使わないので、ブラウザの bundle にも入る。
 *
 * テンプレートを足したら、TEMPLATE_ORDER の然るべき位置に名前を足す（足さないと、群「その他」の末尾に名前順で並ぶ）。
 * tests/template_catalog.test.js が、ここに載っている名前と src/templates の中身が一致するかを確かめる。
 */

export const FREQUENT_GROUP_LABEL = 'よく使う';
export const OTHER_GROUP_LABEL = 'その他';

/**
 * 群「よく使う」に入れるテンプレート（この順に並べる）
 */
export const FREQUENT_TEMPLATES = [
    '訴訟.答弁書.md',
    '訴訟.準備書面.md',
    '訴訟.証拠説明書.md',
    '訴訟.送付書.md',
    '訴訟.期日請書.md',
    '行政.開示請求.md',
];

/**
 * 全テンプレートの並び。群「よく使う」のものもここに載せる（群の中ではこの並びではなく FREQUENT_TEMPLATES の順）。
 */
export const TEMPLATE_ORDER = [
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
    '訴訟.移送申立書.md',
    '訴訟.控訴状.md',
    '訴訟.控訴理由書.md',
    '訴訟.上告状兼上告受理申立書.md',
    '訴訟.上告理由書.md',
    '訴訟.上告受理申立て理由書.md',
    '訴訟.忌避申立書.md',
    '保全.発信者情報開示仮処分命令申立書.md',
    '保全.発信者情報消去禁止仮処分命令申立書.md',
    '保全.送達延期上申書.md',
    '非訟.発信者情報開示命令申立書兼提供命令申立書.md',
    '非訟.発信者情報開示命令申立書兼消去禁止命令申立書.md',
    '非訟.発信者情報開示命令申立事件併合上申書.md',
    '非訟.発信者情報開示命令申立て取下書.md',
    '反訳書.md',
    '行政.開示請求.md',
    '行政.個人情報開示請求の取下書.md',
    '行政.保有個人情報利用停止請求書.md',
    '行政.審査請求書.md',
    '行政.反論書.md',
    '行政.上申書.md',
    '行政.司法行政文書開示苦情申出書.md',
    '行政.保有個人情報開示苦情申出書.md',
    '行政.苦情申出の意見書.md',
    '行政.住民監査請求書.md',
    '刑事.告訴状.md',
];

const frequentRank = new Map(FREQUENT_TEMPLATES.map((name, index) => [name, index] as [string, number]));
const orderRank = new Map(TEMPLATE_ORDER.map((name, index) => [name, index] as [string, number]));

/**
 * ファイル名（`訴訟.答弁書.md`）でも書面名（`訴訟.答弁書`）でもよいように、末尾の .md をそろえる
 */
function toFileName(name: string) {
    const text = String(name || '');
    return /\.md$/i.test(text) ? text : `${text}.md`;
}

/**
 * テンプレートの群（「よく使う」か「その他」）
 */
export function getTemplateGroup(name: string) {
    return frequentRank.has(toFileName(name)) ? FREQUENT_GROUP_LABEL : OTHER_GROUP_LABEL;
}

/**
 * 並べ替えの比較。「よく使う」を先に FREQUENT_TEMPLATES の順で、残りを TEMPLATE_ORDER の順で並べ、
 * どちらにも載っていないものは最後に名前順で並べる。
 */
export function compareTemplateNames(a: string, b: string) {
    const fileA = toFileName(a);
    const fileB = toFileName(b);
    const groupA = frequentRank.has(fileA) ? 0 : 1;
    const groupB = frequentRank.has(fileB) ? 0 : 1;
    if (groupA !== groupB) return groupA - groupB;
    const rankA = groupA === 0 ? frequentRank.get(fileA)! : (orderRank.has(fileA) ? orderRank.get(fileA)! : Number.MAX_SAFE_INTEGER);
    const rankB = groupB === 0 ? frequentRank.get(fileB)! : (orderRank.has(fileB) ? orderRank.get(fileB)! : Number.MAX_SAFE_INTEGER);
    if (rankA !== rankB) return rankA - rankB;
    return fileA.localeCompare(fileB, 'ja');
}

export function sortTemplateNames<T extends string>(names: T[]) {
    return [...names].sort(compareTemplateNames);
}

/**
 * テンプレートを群ごとにまとめる（群の順は「よく使う」「その他」。空の群は返さない）。
 * getName は各要素のファイル名か書面名を返す。
 */
export function groupTemplates<T>(templates: T[], getName: (template: T) => string) {
    const sorted = [...templates].sort((a, b) => compareTemplateNames(getName(a), getName(b)));
    return [FREQUENT_GROUP_LABEL, OTHER_GROUP_LABEL]
        .map(label => ({ label, templates: sorted.filter(template => getTemplateGroup(getName(template)) === label) }))
        .filter(group => group.templates.length > 0);
}

/**
 * テンプレートの中の AI 向けの注意（`<!-- ... -->`）を本文から外す。
 * content は注意を除いたテンプレート、aiNotes は注意を空行でつないだもの。
 */
export function splitTemplateAiNotes(markdown: string) {
    const notes: string[] = [];
    const content = String(markdown || '').replace(/<!--([\s\S]*?)-->/g, (_match, note) => {
        const cleaned = String(note)
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
        aiNotes: notes.join('\n\n').trim(),
    };
}

/**
 * 書面名（拡張子なし）
 */
export function templateDisplayName(fileName: string) {
    return String(fileName || '').replace(/\.md$/i, '');
}

type OptionDocument = {
    createElement(tagName: string): any;
};

/**
 * `<select>` にテンプレートを群ごとの `<optgroup>` で入れる（Web の起案画面と PDF 画面で使う）
 */
export function appendTemplateOptions<T extends { id: string; name: string }>(doc: OptionDocument, select: any, templates: T[]) {
    for (const group of groupTemplates(templates, template => template.id)) {
        const optgroup = doc.createElement('optgroup');
        optgroup.label = group.label;
        for (const template of group.templates) {
            const option = doc.createElement('option');
            option.value = template.id;
            option.textContent = template.name;
            optgroup.appendChild(option);
        }
        select.appendChild(optgroup);
    }
}
