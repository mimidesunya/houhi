# AI キット（Claude の Skill と ChatGPT のプロジェクト用）

法匪の書式の規則（`src/base/court_doc_rules.md` と `src/base/sample.md`）と書面テンプレート（`src/templates/*.md`）を、チャット AI に一度覚えさせておくためのキットです。Web の起案画面で書面ごとにコピーする引継書と同じ元から作るので、中身はそろっていて、テンプレートを直したら `npm run build:ai-kits`（`npm run build:web` でも作られる）で作り直します。

| ファイル | 中身 |
| :--- | :--- |
| `web/downloads/houhi-claude-skill.zip` | Claude の Skill。`houhi-court-docs/SKILL.md`（進め方とテンプレートの一覧）、`reference/法匪Markdown規則.md`（規則1つ）、`templates/*.md`（テンプレート36件。AI 向けの注意は本文と分けてある） |
| `web/downloads/houhi-chatgpt-kit.zip` | ChatGPT 用。`instructions.txt`（指示文）、`knowledge/01_法匪Markdown規則.md` と `knowledge/02_書面テンプレート集.md`（知識ファイル2本）、`はじめに読む.txt`（設定の手順） |

ZIP の中の日時は固定してあるので、元が変わらなければ ZIP も同じバイト列になり、`tests/template_catalog.test.js` が、置いてある ZIP が元から作ったものと一致するかを確かめます。

## 上限と、それに収めた形

`scripts/build_ai_kits.js` が次の上限を確かめ、超えたらエラーにします。数字は 2026-11-26 に公式の説明で確かめたもので、変わることがあります。

- Claude の Skill（claude.com/docs/skills/how-to、support.claude.com の custom skills の記事、platform.claude.com の Agent Skills の概要）
  - ZIP の一番上に Skill のフォルダを置き、その中に `SKILL.md` を置く（ZIP の直下の `SKILL.md` は Skill と見なされない）。
  - `name` は英小文字・数字・ハイフンで64字まで、フォルダ名と同じにし、`anthropic`・`claude` を含めない。`houhi-court-docs` にした。
  - `description` は、Agent Skills の仕様では1024字までだが、claude.ai の記事は200字までとしているので、200字に収めた（今は91字）。
  - `SKILL.md` の本文は500行より短くするよう勧められているので、規則とテンプレートは別のファイルに分け、`SKILL.md` からそこを指した（今は67行）。
- ChatGPT
  - 新しい GPT（カスタム GPT）は、個人のアカウント（Free・Go・Plus・Pro）では作れず公開もできなくなっていて、GPT 自体も 2026-12-11 に終わる予定と公式の記事（help.openai.com の Creating and editing GPTs）にある。そこで、個人のアカウントでも使えるプロジェクトを主な使い道にした。
  - プロジェクトのファイルは、無料で5件、Go・Plus で25件、Pro などで40件まで（help.openai.com の Projects in ChatGPT）なので、知識ファイルを2本に絞った（上限の確かめは5本）。
  - 指示文の字数の上限は、プロジェクトでは公式の記事に見当たらず、GPT の Instructions 欄は8000字までと広く知られているので、8000字に収めた（今は約1100字）。GPT を作れる組織のアカウントなら、同じ指示文と知識ファイルで GPT も作れる。
  - GPT の後を継ぐ「プラグイン」と「Skills」は、2026-11-26 の時点で、個人のアカウントで作れるとは書かれていない（Skills は Business・Enterprise・Healthcare・Edu）。使えるようになったら、Claude の Skill の ZIP を元にした形を検討する。

## 利用者の使い方

### Claude

1. 法匪 Web の起案画面で「Claude の Skill（ZIP）」を落とします。
2. claude.ai（又は Claude のデスクトップ版）の「Customize」から「Skills」を開き、ZIP を展開せずにアップロードして、有効にします。Skill を使うにはコードの実行（Code execution）を有効にしておく必要があります。
3. 新しいチャットで「準備書面を作りたい」のように頼み、事件の資料を渡すと、Skill の規則とテンプレートに沿って質問しながら Markdown を作ります。
4. できた Markdown を法匪 Web の「PDF変換 / 印刷」に貼り付け、提出前チェックを確かめてから PDF にします。

### ChatGPT

1. 法匪 Web の起案画面で「ChatGPT のプロジェクト用（ZIP）」を落として展開します。
2. ChatGPT でプロジェクトを新しく作り、プロジェクトの設定の指示の欄に `instructions.txt` の中身を貼り付け、`knowledge` の2つのファイルをプロジェクトのファイルに追加します。
3. そのプロジェクトの中で新しいチャットを始め、作りたい書面と事件の資料を渡します。

どちらも、書類の中身が AI の事業者に送られます。学習に使わせない設定（Claude はプライバシーの設定、ChatGPT はデータコントロールの「すべての人のためにモデルを改善する」）を確かめてから使うよう、起案画面と `はじめに読む.txt` に書いてあります。

## 公開の手順（ユーザーが行う）

キットを配るのは、GitHub Pages の `web/downloads/` だけで足ります。main に合流して `web/` が変わると、`.github/workflows/pages.yml` が配備し、起案画面のリンクから落とせるようになります。そのほかに公開するかどうかは、次のとおりユーザーが決めます。

1. Claude の Skill を組織で配る場合は、Team・Enterprise の組織で Skill をアップロードし、「Customize」→「Skills」の共有（Share・Publish to org）で配ります。誰でも使える公開の置き場（リンクで配る仕組み）は、2026-11-26 の時点で claude.ai には見当たりません。
2. ChatGPT で GPT として公開する場合は、GPT を作れる組織のアカウントで、新しい GPT の Instructions に `instructions.txt` を、Knowledge に `knowledge` の2ファイルを入れ、共有の範囲を選びます。ただし GPT は 2026-12-11 に終わる予定なので、勧めません。
3. GitHub の Releases にも添付したい場合は、`npm run build:ai-kits` で作った2つの ZIP を、リリースの添付ファイルに加えます。

公開の前に、次を確かめてください。

- `npm run build:ai-kits` で作り直した ZIP が、`git status` で変わっていないこと（変わっていれば、テンプレートの変更を反映してコミットする）。
- claude.ai に実際にアップロードして、Skill として認められ、テンプレートを1つ読んで書面を作れること。
- ChatGPT のプロジェクトに入れて、知識ファイルからテンプレートを探して書面を作れること。
