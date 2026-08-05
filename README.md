# 法匪（HOUHI）

**「法匪（HOUHI）」は、法的文書の作成・分析プロセスをAIと連携して革新する、法律実務家のためのリーガルテックツールです。**

Markdown形式で裁判文書を起案し、チャットAIと組み合わせて証拠分析・書面起案・Word編集用文書・提出用PDFの生成までを一貫して行えます。

## 特徴

1. **Markdown特化**: 裁判所提出文書向けの書式（インデント・表・右寄せなど）をテキストで管理できます。
2. **AI連携前提**: `mimi-ocr` で作成したOCR結果や証拠資料をチャットAIへ渡し、書面起案を補助させます。
3. **実務向け自動化**: 号証スタンプ・FAX送信などの周辺作業をまとめて処理できます。

## 主な機能

| ツール名 | 機能概要 | 対応形式 |
| :--- | :--- | :--- |
| **PDF作成** | Markdown / HTML を裁判所提出用PDF（CSS組版）に変換します。既定は Chrome、必要に応じて Copper PDF へ切り替えられます。 | `.md`, `.html` |
| **Word作成** | Markdownを、あとから編集できるWord文書へ変換します。同名ファイルは上書きせず、A4・裁判文書用余白・見出し・表・画像などを `.docx` に反映します。 | `.md` |
| **起案** | ChatGPTに渡す `houhi-drafting-kit.zip` の場所を開き、書面起案の使い方を案内します。 | `.zip` |
| **AIアーカイブ** | フォルダ内の `.md` / `.txt` を `case/` に収録し、`START_HERE.md`・目録・manifest・起案指示書付きのZIPを作成します（主にChatGPT向け）。 | フォルダ |
| **号証スタンプ** | `甲1_契約書.pdf`、`乙2_メール.pdf` のようなファイル名先頭から証拠番号を読み取り、PDF / 画像の右上に赤文字で追記します。複数ファイルは証拠番号順に結合できます。 | `.pdf`, `.jpg`, `.png` |
| **音声認識** | 音声ファイルをOpenAIまたはGeminiで文字起こしし、一般Markdownまたは `houhi-drafting-kit/反訳書.md` の形式に沿った法匪向け反訳書Markdownを作成します。 | `.mp3`, `.wav`, `.m4a`, `.webm` など |
| **mfax FAX送信** | 送付書Markdownと1件以上の添付PDF、またはPDFのみをFAX用に二値化し、プレビュー確認後にメールFAXとして送信します。 | `.pdf`, `.md` |
| **FAX PDF化** | PDFを画像化・二値化して、FAX向けのPDFを作成します（CLI向け補助ツール）。 | `.pdf` |

OCR、文書ごとの分割・結合は [`mimi-ocr`](https://github.com/mimidesunya/mimi-ocr) 側を使用してください。Word・PDF作成、号証スタンプ、証拠PDFの結合、FAX向けPDF化は [`HOUHI`](https://github.com/mimidesunya/houhi) 側で扱います。利用環境に HOUHI がない場合は、先に HOUHI のセットアップをしてください。

各ツールの詳細は [docs/ツール詳細.md](docs/%E3%83%84%E3%83%BC%E3%83%AB%E8%A9%B3%E7%B4%B0.md) を参照してください。

HOUHI リポジトリを開発・保守するときの仮想開発チーム構成は [docs/仮想開発チーム構成.md](docs/%E4%BB%AE%E6%83%B3%E9%96%8B%E7%99%BA%E3%83%81%E3%83%BC%E3%83%A0%E6%A7%8B%E6%88%90.md) を参照してください。

## 使い方

### 公開サイト

ブラウザ版は次の公開サイトから利用できます。

```text
https://mimidesunya.github.io/houhi/
```

### GUI の起動

- 配布版: `release/houhi-win-x64/houhi.exe` をダブルクリック（Windows環境）
- 開発環境の場合: `npm run gui`

### Windowsリリースパッケージの作成

何も入っていないWindowsでも起動できる配布物を作る場合は、開発環境で次を実行します。

```bash
npm run release:win
```

出力先:

```text
release/houhi-win-x64/houhi.exe
release/houhi-win-x64-YYYYMMDD-HHMMSS.zip
```

配布時は `release/houhi-win-x64/` フォルダごと渡します。利用者は `houhi.exe` を起動します。  
このリリースパッケージは Electron と Node.js 実行環境を同梱するため、利用者側で Node.js / npm / .NET ランタイムをインストールする必要はありません。

GitHub Release へ添付する ZIP を作る場合は、リリースタグ名を指定して実行します。

```powershell
$env:HOUHI_RELEASE_LABEL = "v0.1.0-alpha.1"
npm run release:win
```

この場合、ZIP 名は `release/houhi-win-x64-v0.1.0-alpha.1.zip` になります。タグ `v0.1.0-alpha.1` を push すると、GitHub Actions が Windows リリース ZIP を生成し、プレリリースとして GitHub Release に添付します。

```text
houhi-win-x64/
├── houhi.exe
├── README-START.txt
├── app/
└── runtime/
```

### ローカルWeb版の起動

公開サイトと同じWeb版を手元で確認する場合は、依存関係をインストールしてからローカルサーバーを起動します。

```bash
npm install
npm run serve:web
```

起動すると、次のローカルアドレスで開けます。

```text
http://127.0.0.1:4173/
```

`127.0.0.1` は自分のPC自身を指すローカル専用アドレスです。インターネット上に公開されるURLではなく、通常は起動したPCのブラウザからだけアクセスします。`4173` は既定のポート番号です。

別のポートで起動したい場合は、ポート番号を指定します。

```bash
npm run serve:web -- 8080
```

この場合のアドレスは `http://127.0.0.1:8080/` になります。

### 操作の流れ

1. 上部のツールカードから使いたい機能を選びます。
2. 対象ファイル（またはフォルダ）を中央のドロップゾーンへドラッグ＆ドロップします。
3. 処理ログは画面下部または別ウィンドウに表示されます。
4. 出力ファイルは、多くの場合、入力ファイルと同じ場所に生成されます。

GUI には `PDF作成`、`Word作成`、`AIアーカイブ`、`号証スタンプ`、`FAX送信`、`起案`、`設定` などのカードがあります。各カードへ直接ドロップすると、そのツールに切り替えたうえで処理を実行します。

選択中のツールに応じて、次のオプションが表示されます。

- `PDF作成`: PDFエンジン（Chrome / Copper PDF）
- `号証スタンプ`: 結合PDFに空白ページを入れない（FAX向け）
- `FAX送信`: ディザリングOFF（写真なし文書向け）

`Word作成` には `.md` ファイルをドロップします。入力と同じ場所へ同じ基礎名の `.docx` を作り、既存の同名Wordファイルがある場合は `_2`、`_3` と連番を付けて原本を保護します。Wordを開いたときのフィールド更新は要求しないため、目次を更新する場合は `Ctrl+A`、`F9` を押してください。Wordは編集用です。PDFとは改ページ、表幅、目次のページ番号が異なる場合があるため、提出・印刷にはWordで最終確認したうえで `PDF作成` を使用してください。

`音声認識` は、音声ファイルをドロップすると同じフォルダにMarkdownを生成します。画面のオプションで `一般` と `法匪（反訳書）`、および OpenAI `gpt-4o-transcribe-diarize` / Gemini `gemini-3.5-flash` を選択できます。法匪では `YYYY-MM-DD_反訳書_表題.md`、一般では `YYYY-MM-DD_音声認識_表題.md` になります。日付は反訳結果から推定し、取れない場合は音声ファイルの更新日を使います。

`FAX送信` で複数PDFを指定した場合は、送信前に結合順を確認できます。FAX用二値化後のプレビュー画面では、送信先FAX番号の確認・追加・削除と、ページ単位のディザリング切り替えができます。

`起案` ボタンは、`houhi-drafting-kit.zip` のあるフォルダを開き、ChatGPTへのアップロード手順と、そのまま送れる指示文を画面下部に表示します。

OCR や文書ごとの分割・結合が必要な場合は、先に [`mimi-ocr`](https://github.com/mimidesunya/mimi-ocr) で Markdown 化・分割してから `houhi` に渡します。`mimi-ocr` が未セットアップの場合は、先に `mimi-ocr` をセットアップしてください。

Markdown の記法については [docs/Markdown仕様書.md](docs/Markdown%E4%BB%95%E6%A7%98%E6%9B%B8.md) を参照してください。

## チャットAIとの連携

### 本人訴訟フォルダの前提

HOUHI は、本人訴訟の利用者が、期日・提出主体・証拠種別ごとに事件資料をフォルダ整理している前提で補助します。典型的には `2026-03-02-地方裁判所-損害賠償請求事件/` のような事件フォルダの下に、エージェント作業用の `00-訴訟管理/` と、裁判所提出物・人間が読む書面を置く `2026-03-02-訴状/`、`2026-05-26-第1回口頭弁論/被告/乙号証/`、`2026-07-07-第2回口頭弁論/原告/` などの日付フォルダが並びます。

この構成では、フォルダ名・ファイル名から日付、期日、提出主体、証拠番号の候補を読み取れます。ただし、これらはあくまで候補であり、HOUHI やエージェントは OCR Markdown、提出書面、証拠説明書などの本文で確認し、不確かな点は `【要確認】` として扱います。OCR、文書分割・結合は `mimi-ocr`、PDF 作成や号証スタンプは HOUHI を使います。フォルダ構成の前提は [docs/訴訟フォルダ構成.md](docs/%E8%A8%B4%E8%A8%9F%E3%83%95%E3%82%A9%E3%83%AB%E3%83%80%E6%A7%8B%E6%88%90.md)、AI エージェント仮想チームの構成指示は [docs/仮想チーム構成.md](docs/%E4%BB%AE%E6%83%B3%E3%83%81%E3%83%BC%E3%83%A0%E6%A7%8B%E6%88%90.md) を参照してください。

### 書面の起案

`houhi-drafting-kit.zip` には、訴状・答弁書・控訴理由書などの書面をチャットAIに起案させるための指示書が入っています。
対応する `.md` ファイル（例: `訴訟.訴状.md`）をZIP内から参照させ、事件の事実関係や証拠資料を添えて依頼します。

```text
添付した houhi-drafting-kit.zip 内の 訴訟.訴状.md の指示に従って、訴状の Markdown 原案を作成してください。
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
    ↓ HOUHIでPDF変換
裁判所提出用PDF
    ↓ HOUHIで号証スタンプ（証拠PDFの場合）
    ↓ mfax FAX送信（FAX対応の場合）
```

Chat AI が作成するのは Markdown 原案、整理表、レビュー結果、次アクションの提示までです。提出用 PDF の作成、号証スタンプ、PDF 結合、FAX 向け PDF 化は、Chat AI の外で HOUHI を使って行います。

## セットアップ

### 必要環境

- Node.js v20 以上推奨
- npm
- Chrome PDF 生成を使う場合は Google Chrome または Chromium
- Copper PDF 公開サーバーを使う場合はインターネット接続
- `npm run build:launcher` でランチャーを再生成する場合は .NET SDK（Native AOT 対応）

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
    },
    "transcription": {
        "provider": "openai",
        "language": "ja",
        "model": "",
        "openaiApiKey": "",
        "geminiApiKey": "",
        "openaiModel": "gpt-4o-transcribe-diarize",
        "geminiModel": "gemini-3.5-flash"
    }
}
```

OCR 用の AI / `ndlocr-lite` 設定は `houhi` ではなく [`mimi-ocr`](https://github.com/mimidesunya/mimi-ocr) 側の `config.json` で管理します。
音声反訳を使う場合は、`transcription.openaiApiKey` または環境変数 `OPENAI_API_KEY`、Geminiの場合は `transcription.geminiApiKey` または `GEMINI_API_KEY` を設定してください。
FAX送信を使う場合は、`mail` と `mfax` の設定が必要です。`mfax.fromAddress` が空の場合は `mail.user` を送信元として使います。

PDF作成ツールの既定エンジンは Chrome です。CLI の `--pdf-engine=copper` または GUI の「PDFエンジン」から Copper PDF に切り替えられます。Chrome を自動検出できない場合は `pdf.chromePath` に実行ファイルのパスを設定してください。

Word作成はGUIの `Word作成` へ `.md` をドロップするか、ビルド後に `node dist/src/convert_to_word.js --no-open <書面.md>` で実行できます。WordやLibreOfficeがインストールされていないPCでも `.docx` 自体は生成できます。

### 開発者向けコマンド

| コマンド | 内容 |
| :--- | :--- |
| `npm run gui` | TypeScript をビルドして GUI を起動 |
| `npm run build` | TypeScript をビルド（`dist/` に出力） |
| `npm run ensure:native` | `@napi-rs/canvas` のネイティブ描画を現在のOS向けに確認・再構築 |
| `npm run build:launcher` | Windows 用開発ランチャー `bin/houhi.exe` を Native AOT で再生成 |
| `npm run setup` | ビルド後に `houhi-drafting-kit.zip` と初期設定を生成 |
| `npm test` | ビルド後にユニットテストを実行 |
| `npm run docs:tools` | ツールコメントから `docs/ツール詳細.md` を再生成 |
| `sh ./setup.sh` / `.\setup.cmd` | セットアップ、ツールドキュメント再生成、テストをまとめて実行 |

### Windows ランチャーのアイコン

`bin/houhi.exe` は Native AOT で小さく生成しています。アイコンは [platforms/windows/launcher/app.ico](platforms/windows/launcher/app.ico) を使って埋め込んでいます。  
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

- 訴訟物の価格：160万円
- 貼用印紙額：1万3000円

本文の一部に++下線++や｜投稿《とうこう》を付けられ、行内では `<br>` または `<br/>` で改行できます。
```

## フォルダ構成

```text
.
├── bin/houhi.exe               # 開発用起動ランチャー
├── copper_drivers/             # Copper PDF用ドライバ
├── docs/                       # 補足ドキュメント
│   ├── ツール詳細.md            # 各ツールの詳細説明（自動生成）
│   ├── Markdown仕様書.md       # Markdown拡張書式の仕様
│   ├── 訴訟フォルダ構成.md      # 本人訴訟フォルダの前提
│   ├── 仮想チーム構成.md        # 訴訟フォルダ内のAIエージェント仮想チーム
│   └── 仮想開発チーム構成.md    # HOUHI開発用の仮想チーム構成
├── houhi-drafting-kit.zip      # 書面起案用の指示書一式（setupで生成）
├── houhi-drafting-kit/         # 起案キットの展開確認用ファイル
├── config.template.json        # 初期設定テンプレート
├── platforms/
│   └── windows/                # Windows バイナリ生成用ファイル
│       ├── houhi.sln           # Windows ランチャー用 Visual Studio ソリューション
│       └── launcher/           # Windows 用ランチャー（C#）
├── src/                        # TypeScript ソースコード
│   ├── base/                   # 文書書式（CSS/HTML）定義・サンプル
│   ├── gui/                    # GUI アプリケーション
│   ├── lib/                    # 共通ライブラリ（設定読込・PDF/Word変換など）
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
- **Word生成**: docx（WordprocessingML）
- **OCR**: `mimi-ocr` を別プロジェクトとして利用
- **マークアップ**: HTML5 + CSS 2.1
