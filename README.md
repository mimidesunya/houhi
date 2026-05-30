# 法匪（HOUHI）

**「法匪（HOUHI）」は、法的文書の作成・分析プロセスをAIと連携して革新する、法律実務家のためのリーガルテックツールです。**

Markdown形式で裁判文書を起案し、チャットAIと組み合わせて証拠分析・書面起案・PDF生成までを一貫して行えます。

## 特徴

1. **Markdown特化**: 裁判所提出文書向けの書式（インデント・表・右寄せなど）をテキストで管理できます。
2. **AI連携前提**: `mimi-ocr` で作成したOCR結果や証拠資料をチャットAIへ渡し、書面起案を補助させます。
3. **実務向け自動化**: 号証スタンプ・FAX送信などの周辺作業をまとめて処理できます。

## 主な機能

| ツール名 | 機能概要 | 対応形式 |
| :--- | :--- | :--- |
| **PDF作成** | Markdown / HTML を裁判所提出用PDF（CSS組版）に変換します。既定は Chrome、必要に応じて Copper PDF へ切り替えられます。 | `.md`, `.html` |
| **起案** | ChatGPTに渡す `houhi-drafting-kit.zip` の場所を開き、書面起案の使い方を案内します。 | `.zip` |
| **AIアーカイブ** | フォルダ内の `.md` / `.txt` を `case/` に収録し、`START_HERE.md`・目録・manifest・起案指示書付きのZIPを作成します（主にChatGPT向け）。 | フォルダ |
| **号証スタンプ** | ファイル名先頭の `甲1`、`乙2-1` などから証拠番号を読み取り、PDF / 画像の右上に赤文字で追記します。複数ファイルは証拠番号順に結合できます。 | `.pdf`, `.jpg`, `.png` |
| **mfax FAX送信** | 送付書Markdownと1件以上の添付PDF、またはPDFのみをFAX用に二値化し、プレビュー確認後にメールFAXとして送信します。 | `.pdf`, `.md` |
| **FAX PDF化** | PDFを画像化・二値化して、FAX向けのPDFを作成します（CLI向け補助ツール）。 | `.pdf` |

OCR は [`mimi-ocr`](../mimi-ocr/README.md) に移管しました。OCR・ページ結合は `mimi-ocr` 側を使用してください。

各ツールの詳細は [docs/ツール詳細.md](docs/%E3%83%84%E3%83%BC%E3%83%AB%E8%A9%B3%E7%B4%B0.md) を参照してください。

## 使い方

### GUI の起動

- `bin/法匪.exe` をダブルクリック（Windows環境）
- 開発環境の場合: `npm run gui`

### 操作の流れ

1. 上部のツールカードから使いたい機能を選びます。
2. 対象ファイル（またはフォルダ）を中央のドロップゾーンへドラッグ＆ドロップします。
3. 処理ログは画面下部または別ウィンドウに表示されます。
4. 出力ファイルは、多くの場合、入力ファイルと同じ場所に生成されます。

GUI には `PDF作成`、`AIアーカイブ`、`号証スタンプ`、`FAX送信`、`起案`、`設定` のカードがあります。各カードへ直接ドロップすると、そのツールに切り替えたうえで処理を実行します。

選択中のツールに応じて、次のオプションが表示されます。

- `PDF作成`: PDFエンジン（Chrome / Copper PDF）
- `号証スタンプ`: 結合PDFに空白ページを入れない（FAX向け）
- `FAX送信`: ディザリングOFF（写真なし文書向け）

`FAX送信` で複数PDFを指定した場合は、送信前に結合順を確認できます。FAX用二値化後のプレビュー画面では、送信先FAX番号の確認・追加・削除と、ページ単位のディザリング切り替えができます。

`起案` ボタンは、`houhi-drafting-kit.zip` のあるフォルダを開き、ChatGPTへのアップロード手順と、そのまま送れる指示文を画面下部に表示します。

OCR が必要な場合は、先に `mimi-ocr` で Markdown 化してから `houhi` に渡します。

Markdown の記法については [docs/Markdown仕様書.md](docs/Markdown%E4%BB%95%E6%A7%98%E6%9B%B8.md) を参照してください。

## チャットAIとの連携

### 書面の起案

`houhi-drafting-kit.zip` には、訴状・答弁書・控訴理由書などの書面をチャットAIに起案させるための指示書が入っています。
対応する `.md` ファイル（例: `訴状.md`）をZIP内から参照させ、事件の事実関係や証拠資料を添えて依頼します。

```text
添付した houhi-drafting-kit.zip 内の 訴状.md の指示に従って、訴状の Markdown 原案を作成してください。
文体は日本の民事訴訟実務に合わせ、事実関係は下記資料に基づいて整理してください。

[事件の事実関係メモ]

[証拠の要約またはOCR結果]
```

`houhi-drafting-kit.zip` 内の `00_START_HERE.md` には、ChatGPT が具体的な要望を優先し、不足情報を聞き返してから Markdown 原案を出すための対話手順を入れています。ZIPをアップロードするときに「訴状を起案してほしい」のような要望を同じメッセージに書いて構いません。

資料の渡し方:

- 短いメモや要約はチャット欄へ直接記載
- OCR結果ファイルはそのままドロップ
- 複数の資料をまとめて渡す場合は **AIアーカイブ** ツールでZIP化してから添付（主にChatGPT向け）
- AIアーカイブZIPを添付した後、チャットAIにまず `START_HERE.md` と `CASE_INDEX.md` を読むよう指示してください
- 「訴状を起案して」「時系列を作って」のような要望を、ZIPアップロード時の指示文に続けて書いて構いません
- AIアーカイブ作成後のログには、ChatGPTへそのまま送れる指示文を表示します

### 典型的なワークフロー

```text
証拠資料（PDF / 画像）
    ↓ mimi-ocr
証拠のMarkdown化
    ↓ AIアーカイブ（大量資料をChatGPTへ渡す場合）
チャットAIにAIアーカイブZIPを添付し、START_HERE.md から読ませて起案を依頼
    ↓
書面の Markdown 原案
    ↓ PDF変換
裁判所提出用PDF
    ↓ 号証スタンプ（証拠PDFの場合）
    ↓ mfax FAX送信（FAX対応の場合）
```

## セットアップ

### 必要環境

- Node.js v20 以上推奨
- npm
- Chrome PDF 生成を使う場合は Google Chrome または Chromium
- Copper PDF 公開サーバーを使う場合はインターネット接続
- `npm run build:launcher` でランチャーを再生成する場合は .NET SDK

### インストール

```bash
npm install
npm run setup
```

`npm run setup` は TypeScript のビルド後に、`houhi-drafting-kit.zip` の生成と初期設定ファイルの確認を行います。
セットアップ、ツールドキュメント再生成、テストをまとめて行う場合は `setup.sh` または `setup.cmd` も使えます。

```bash
sh ./setup.sh
```

```powershell
.\setup.cmd
```

WSL から `wsl ./setup.sh` を実行した場合、Linux 側で `node` を直接実行できなければ、`setup.sh` が公式配布の Linux 版 Node.js を `.cache/tools/` に自動取得して使います。
Windows と WSL を行き来する場合、`canvas` などのネイティブ依存は初回実行時にその OS 向けへ自動で `npm rebuild` されます。
自動判定を使わず常に Windows 側で実行したい場合は、`HOUHI_FORCE_WINDOWS_NPM=1 wsl ./setup.sh` を使ってください。
WSL の Windows interop が無効な環境では、PowerShell で `.\setup.cmd` を直接実行してください。

### 設定ファイル

GUI のツール一覧にある設定ボタンから `config.json` を編集できます。`config.json` がない場合は、`config.template.json` から自動作成されます。手で編集する場合も同じファイルを編集します。

```json
{
    "pdf": {
        "engine": "chrome",
        "chromePath": ""
    },
    "copper": {
        "serverUri": "ctip://cti.li/",
        "user": "user",
        "password": "kappa",
        "properties": {
            "output.pdf.version": "1.4A-1"
        }
    },
    "mail": {
        "smtp": {
            "host": "YOUR_MAIL_SERVER",
            "port": 465,
            "secure": true,
            "tlsMinVersion": "TLSv1.2"
        },
        "imap": {
            "host": "YOUR_MAIL_SERVER",
            "port": 993,
            "secure": true,
            "tlsMinVersion": "TLSv1.2"
        },
        "user": "YOUR_MAIL_ADDRESS",
        "password": "YOUR_MAIL_PASSWORD"
    },
    "mfax": {
        "sendPassword": "YOUR_MFAX_SEND_PASSWORD",
        "fromAddress": "YOUR_FROM_ADDRESS",
        "selfFax": "自分のFAX番号（数字のみ。送付書への記載分を除外するために利用）"
    }
}
```

OCR 用の AI / `ndlocr-lite` 設定は `houhi` ではなく `mimi-ocr` 側の `config.json` で管理します。
FAX送信を使う場合は、`mail` と `mfax` の設定が必要です。`mfax.fromAddress` が空の場合は `mail.user` を送信元として使います。

PDF作成ツールの既定エンジンは Chrome です。CLI の `--pdf-engine=copper` または GUI の「PDFエンジン」から Copper PDF に切り替えられます。Chrome を自動検出できない場合は `pdf.chromePath` に実行ファイルのパスを設定してください。

### 開発者向けコマンド

| コマンド | 内容 |
| :--- | :--- |
| `npm run gui` | TypeScript をビルドして GUI を起動 |
| `npm run build` | TypeScript をビルド（`dist/` に出力） |
| `npm run ensure:native` | `canvas` などのネイティブ依存を現在のOS向けに確認・再構築 |
| `npm run build:launcher` | Windows 用ランチャー `bin/法匪.exe` をアイコン付きで再生成 |
| `npm run setup` | ビルド後に `houhi-drafting-kit.zip` と初期設定を生成 |
| `npm test` | ビルド後にユニットテストを実行 |
| `npm run docs:tools` | ツールコメントから `docs/ツール詳細.md` を再生成 |
| `sh ./setup.sh` / `.\setup.cmd` | セットアップ、ツールドキュメント再生成、テストをまとめて実行 |

### Windows ランチャーのアイコン

`bin/法匪.exe` のアイコンは [src/launcher/app.ico](src/launcher/app.ico) を使って埋め込んでいます。  
アイコンやランチャー本体を更新した場合は、次のコマンドで再生成してください。

```bash
npm run build:launcher
```

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
├── houhi-drafting-kit.zip      # 書面起案用の指示書一式（setupで生成）
├── houhi-drafting-kit/         # 起案キットの展開確認用ファイル
├── config.template.json        # 初期設定テンプレート
├── src/                        # TypeScript ソースコード
│   ├── base/                   # 文書書式（CSS/HTML）定義・サンプル
│   ├── gui/                    # GUI アプリケーション
│   ├── lib/                    # 共通ライブラリ（設定読込・PDF変換など）
│   ├── templates/              # 書面テンプレート
│   └── *.ts                    # 各ツールスクリプト
├── tests/                      # ユニットテスト
├── dist/                       # ビルド成果物（生成・git管理外）
├── config.json                 # 設定ファイル
├── setup.cmd                   # Windows 用セットアップ + テスト
└── setup.sh                    # POSIX/WSL 用セットアップ + テスト
```

## 技術スタック

- **言語**: Node.js / TypeScript
- **UI**: Electron
- **PDF生成**: Copper PDF (CTI) / Chrome headless
- **OCR**: `mimi-ocr` を別プロジェクトとして利用
- **マークアップ**: HTML5 + CSS 2.1
