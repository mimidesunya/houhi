# 法匪（HOUHI）

**「法匪（HOUHI）」は、法的文書の作成・分析プロセスをAIと連携して革新する、法律実務家のためのリーガルテックツールです。**

Markdown形式で裁判文書を起案し、チャットAIと組み合わせて証拠分析・書面起案・PDF生成までを一貫して行えます。

## 特徴

1. **Markdown特化**: 裁判所提出文書向けの書式（インデント・表・右寄せなど）をテキストで管理できます。
2. **AI連携前提**: OCR結果や証拠資料をチャットAIへ渡し、書面起案を補助させます。
3. **実務向け自動化**: 号証スタンプ・ページ結合・FAX送信などの周辺作業をまとめて処理できます。

## 主な機能

| ツール名 | 機能概要 | 対応形式 |
| :--- | :--- | :--- |
| **PDF変換** | Markdownを裁判所提出用PDF（CSS組版）に変換します。 | `.md`, `.html` |
| **一般OCR** | 証拠資料（PDF / Word / ODT / PowerPoint）をOCRしてMarkdown化します。 | `.pdf`, `.docx`, `.doc`, `.odt`, `.pptx` |
| **裁判OCR** | 相手方書面・判決文（PDF / Word）をOCRして引用しやすいMarkdownに変換します。 | `.pdf`, `.docx`, `.doc` |
| **ページ結合** | OCRで分割されたMarkdownファイルを1つに結合します。 | `.md` |
| **番号振直** | ズレた項番（第1、1、(1)...）を階層ごとに自動修正します。 | `.md` |
| **AIアーカイブ** | フォルダ内の `.md` / `.txt` を収集してZIPアーカイブを作成します（主にChatGPT向け）。 | フォルダ |
| **号証スタンプ** | 証拠PDFの右上に「甲第〇号証」などの証拠番号を赤文字で追記します。 | `.pdf` |
| **mfax FAX送信** | 送付書Markdownと添付PDFを結合し、メールFAXとして送信します。 | `.pdf`, `.md` |

各ツールの詳細は [docs/ツール詳細.md](docs/%E3%83%84%E3%83%BC%E3%83%AB%E8%A9%B3%E7%B4%B0.md) を参照してください。

## 使い方

### GUI の起動

- `bin/法匪.exe` をダブルクリック（Windows環境）
- 開発環境の場合: `npm run gui`

### 操作の流れ

1. 上部のツールカードから使いたい機能を選びます。
2. OCR系ツールでは、必要に応じて AI プロバイダーや処理モードを切り替えます。
3. 対象ファイル（またはフォルダ）を中央のドロップゾーンへドラッグ＆ドロップします。
4. 処理ログは画面下部または別ウィンドウに表示されます。
5. 出力ファイルは、多くの場合、入力ファイルと同じ場所に生成されます。

Markdown の記法については [docs/Markdown仕様書.md](docs/Markdown%E4%BB%95%E6%A7%98%E6%9B%B8.md) を参照してください。

## チャットAIとの連携

### 書面の起案

`instructions/` フォルダには、訴状・答弁書・控訴理由書などの書面をチャットAIに起案させるための指示書が入っています。  
対応する `.md` ファイル（例: `instructions/訴状.md`）をチャットAIへドラッグ＆ドロップし、事件の事実関係や証拠資料を添えて依頼します。

```text
添付した instructions/訴状.md の指示に従って、訴状の Markdown 原案を作成してください。
文体は日本の民事訴訟実務に合わせ、事実関係は下記資料に基づいて整理してください。

[事件の事実関係メモ]

[証拠の要約またはOCR結果]
```

資料の渡し方:
- 短いメモや要約はチャット欄へ直接記載
- OCR結果ファイルはそのままドロップ
- 複数の資料をまとめて渡す場合は **AIアーカイブ** ツールでZIP化してから添付（主にChatGPT向け）

### 典型的なワークフロー

```
証拠資料（PDF / 画像）
    ↓ 一般OCR
証拠のMarkdown化
    ↓ AIアーカイブ（大量資料をChatGPTへ渡す場合）
チャットAIに instructions/*.md + 事実関係を添えて起案を依頼
    ↓
書面の Markdown 原案
    ↓ 番号振直（必要に応じて）
    ↓ PDF変換
裁判所提出用PDF
    ↓ 号証スタンプ（証拠PDFの場合）
    ↓ mfax FAX送信（FAX対応の場合）
```

## セットアップ

### 必要環境

- Node.js v16 以上
- インターネット接続（Copper PDF 公開サーバーを使用）

### インストール

```bash
npm install
npm run build
npm run setup
```

`setup` は `instructions/` フォルダへの指示書生成と初期設定ファイルの確認を行います。  
セットアップとドキュメント再生成をまとめて行う場合は `setup.sh` も使えます。

```bash
sh ./setup.sh
```

### AI・サーバーの設定

`config.template.json` を `config.json` にコピーして編集します。

```json
{
    "gemini": {
        "apiKey": "YOUR_GEMINI_API_KEY",
        "chatModel": "gemini-2.0-flash-exp"
    },
    "copper": {
        "serverUri": "ctip://cti.li/",
        "user": "user",
        "password": "kappa"
    }
}
```

### 開発者向けコマンド

| コマンド | 内容 |
| :--- | :--- |
| `npm run gui` | TypeScript をビルドして GUI を起動 |
| `npm run build` | TypeScript をビルド（`dist/` に出力） |
| `npm run setup` | ビルド後に指示書と初期設定を生成 |
| `npm test` | ビルド後にユニットテストを実行 |
| `npm run docs:tools` | ツールコメントから `docs/ツール詳細.md` を再生成 |

## Markdown 記法の概要

詳細は [docs/Markdown仕様書.md](docs/Markdown%E4%BB%95%E6%A7%98%E6%9B%B8.md) を参照してください。

```markdown
## 第1　請求の趣旨
## 1　被告は、原告に対し...
## (1) 損害の内訳

### --右
令和〇年〇月〇日
原告　甲野　太郎
### --

- 訴訟物の価格：1,600,000円
- 貼用印紙額：13,000円
```

## フォルダ構成

```text
.
├── bin/法匪.exe                 # 起動ランチャー
├── copper_drivers/             # Copper PDF用ドライバ
├── docs/                       # 補足ドキュメント
│   ├── ツール詳細.md            # 各ツールの詳細説明（自動生成）
│   └── Markdown仕様書.md       # Markdown拡張書式の仕様
├── instructions/               # 書面起案用の指示書（チャットAIへ渡すMarkdown）
├── src/                        # TypeScript ソースコード
│   ├── base/                   # 文書書式（CSS/HTML）定義・サンプル
│   ├── gui/                    # GUI アプリケーション
│   ├── lib/                    # 共通ライブラリ（AI クライアント含む）
│   ├── templates/              # 書面テンプレート
│   └── *.ts                    # 各ツールスクリプト
├── tests/                      # ユニットテスト
├── dist/                       # ビルド成果物（生成・git管理外）
├── config.json                 # 設定ファイル
└── setup.sh                    # セットアップ + ドキュメント生成
```

## 技術スタック

- **言語**: Node.js / TypeScript
- **UI**: Electron
- **AI**: Google Gemini API（OCR・起案補助）
- **PDF生成**: Copper PDF (CTI)
- **マークアップ**: HTML5 + CSS 2.1
