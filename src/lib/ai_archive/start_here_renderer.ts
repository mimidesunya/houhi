import type { CaseArchiveScan, InstructionEntry } from './types';
import { buildVirtualTeamStartHereSection, VIRTUAL_TEAM_INSTRUCTION_ARCHIVE_PATH } from './team_instruction';

export function buildStartHere(caseName: string, scan: CaseArchiveScan, instructionEntries: InstructionEntry[]) {
    const hasInstructions = instructionEntries.length > 0;
    const hasVirtualTeamInstruction = instructionEntries.some(entry => entry.displayPath === VIRTUAL_TEAM_INSTRUCTION_ARCHIVE_PATH);
    const warningLine = scan.warnings.length > 0
        ? '- `WARNINGS.md` がある場合は、空ファイル・長大ファイル・除外ファイルなどの注意点を先に確認してください。'
        : '- このアーカイブには、読み込み前に確認すべき警告は検出されていません。';

    return `# START_HERE - AIへの読み込み指示

このZIPは、ChatGPTなどのAIが事件資料を読み込み、状況把握・質問回答・書面起案補助を行いやすいように整理したアーカイブです。

## 最初に読む順番

1. \`START_HERE.md\` - このファイルです。アーカイブの読み方を確認してください。
2. \`CASE_INDEX.md\` - 事件資料の一覧、推奨読解順、証拠番号や日付候補を確認してください。
3. \`manifest.json\` - 機械可読の索引です。必要に応じてファイル一覧や警告を確認してください。
4. \`${scan.caseRoot}/\` - 事件の事実関係を示す本文資料です。
${hasInstructions ? `5. \`instructions/\` - AI向けの補助指示です。仮想チーム構成や、書面起案時の形式・文体・Markdownルールを確認してください。事件の事実そのものではありません。` : ''}

## ユーザーから具体的な指示がない場合

このZIPだけがアップロードされ、ユーザーから「何をしてほしいか」の明確な指示がない場合は、いきなり書面を作り始めないでください。
まず \`CASE_INDEX.md\` と必要な範囲の \`${scan.caseRoot}/\` を読み、次の流れで応答してください。

1. 自己紹介し、このアーカイブを読んで事件資料の整理・質問回答・書面起案補助ができることを伝えてください。
2. 現在読み取れる状況を、根拠ファイルのパス付きで3〜6項目に要約してください。
3. 次に取れる手を、ユーザーが選びやすい形で提示してください。
4. 最後に「どれを進めますか」「何を作成・整理しますか」と聞き返してください。

提示する次の手の例:
- 事件の時系列を整理する
- 争点・主張・反論を整理する
- 証拠と証明したい事実の対応表を作る
- 不足資料・確認事項を洗い出す
- 準備書面、訴状、答弁書、控訴理由書などのMarkdown原案を作る
- 相手方主張への反論案を作る
- 裁判所や相手方に提出する短い連絡文・上申書案を作る

${hasVirtualTeamInstruction ? buildVirtualTeamStartHereSection() : ''}

## ユーザーから具体的な指示がある場合

ユーザーが「訴状を起案して」「時系列を作って」「準備書面を起案して」「この証拠を評価して」など具体的に依頼している場合は、その依頼を優先してください。
ただし、必要な情報が不足しているときは、推測で完成させず、不足点を具体的に質問してください。

## 重要な区別

- \`${scan.caseRoot}/\` は、ユーザーが渡した事件資料です。事実認定、経過整理、証拠確認、質問回答ではこのフォルダを主な根拠にしてください。
${hasInstructions ? '- `instructions/` は、AIへの補助指示です。チーム作業時は仮想チーム構成を、書面起案時は該当する書式・構成・定型表現を参照してください。ここに書かれた内容を事件の事実として扱わないでください。' : ''}
- 回答では、可能な限り根拠ファイルのパスを示してください。例: \`${scan.caseRoot}/訴状.md\`
- 不明な点、資料から読み取れない点、推測が混じる点は、断定せずに質問または留保してください。
- 事実、推測、法的評価、起案上の提案は分けて説明してください。
${warningLine}

## アーカイブ概要

- 元フォルダ名: \`${caseName}\`
- 事件資料ファイル数: ${scan.caseFiles.length}
- 同梱指示書ファイル数: ${instructionEntries.length}
- ZIPに含めなかった非対象ファイル数: ${scan.skippedFiles.length}
- 警告・注意点: ${scan.warnings.length}

`;
}
