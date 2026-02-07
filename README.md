# 法匪（HOUHI）

日本の裁判所向け書面を、Markdown形式で作成し、美しいPDF文書に変換するシステムです。
HTMLとCSS 2.1を用いたレイアウトエンジンにより、裁判文書特有の書式（階層構造、右寄せ配置、表形式など）を自動生成します。

## 主な機能

### 📝 文書生成
- **Markdown → PDF変換**: 裁判文書用の拡張Markdown記法をPDFに変換
- **AI起案**: Gemini APIを使用した文書の自動生成
- **テンプレート**: 訴状、控訴状、上告状、準備書面などの雛形を用意

### 📄 OCR機能
- **裁判文書OCR**: 書式を維持した高精度OCR
- **一般文書OCR**: テキスト抽出最適化
- **ページ結合**: OCR結果のMarkdownファイルを整形・結合

### 📊 証拠管理
- **証拠説明書生成**: 証拠ファイルから証拠説明書（表形式）を自動生成
- **Markdown番号振り直し**: 階層構造の番号を自動で再採番

### 🖥️ ユーザーインターフェース
- **GUIアプリケーション**: Electronベースの直感的なインターフェース
- **ランチャー**: `bin/法匪.exe`からの素早い起動

## セットアップ

### 必要環境
- Node.js (v16以上推奨)
- インターネット接続（Copper PDF公開サーバーを使用）

### インストール

```bash
npm install
node setup.js
```

**setup.jsの役割**:
- AI指示書の生成（`src/templates`と`src/base/court_doc_rules.md`を結合し、`instructions/`に出力）
- 初期設定ファイルの確認

## 使い方

### 1. GUIモード（推奨）

```bash
npm run gui
```

または `bin/法匪.exe` を実行

GUIから以下の機能にアクセスできます：
- PDF変換
- AI文書生成
- OCR処理
- 証拠説明書作成

### 2. コマンドラインモード

各機能はNode.jsスクリプトとして個別に実行できます：

#### PDF変換
```bash
node src/convert_to_pdf.js input.md
```

#### AI文書生成
```bash
node src/ai_generate_markdown.js
```
クリップボードの内容からMarkdownを生成し、PDFに変換します。

#### OCR（裁判文書）
```bash
node src/ocr_court_doc.js document.pdf
```

#### OCR（一般文書）
```bash
node src/ocr_general_doc.js document.pdf
```

#### OCRページ結合
```bash
node src/ocr_merge_pages.js page1.md page2.md
```

#### 証拠説明書生成
```bash
node src/archive_for_ai.js evidence_folder
```

#### Markdown番号振り直し
```bash
node src/renumber_markdown.js document.md
```

## 設定

AI機能やカスタムPDFサーバーを使用する場合は、`config.template.json`を`config.json`にコピーして編集してください：

```json
{
    "gemini": {
        "apiKey": "YOUR_GEMINI_API_KEY",
        "textModel": "gemini-2.0-flash-exp"
    },
    "copper": {
        "serverUri": "ctip://cti.li/",
        "user": "user",
        "password": "kappa"
    }
}
```

## Markdown仕様

詳細な記法は [`Markdown仕様書.md`](Markdown仕様書.md) を参照してください。

### 基本的な記法

**階層構造**:
```markdown
## 第1　請求の趣旨
## 1　被告は、原告に対し...
## (1) 損害の内訳
```

**配置ブロック**:
```markdown
### --右
令和〇年〇月〇日
### --

### --左
〇〇地方裁判所　御中
### --
```

**表形式**:
```markdown
- 訴訟物の価格:1,600,000円
- 貼用印紙額:13,000円
```

## 技術スタック

- **言語**: Node.js, JavaScript
- **UI**: Electron
- **AI**: Google Gemini API
- **PDF生成**: Copper PDF (CTI)
- **マークアップ**: HTML5 + CSS 2.1

## フォルダ構成

```
.
├── bin/
│   └── 法匪.exe                # ランチャー
├── src/
│   ├── base/                   # 基本テンプレートとスタイル
│   │   ├── base.html
│   │   ├── style.css
│   │   ├── script.js
│   │   └── court_doc_rules.md  # AI指示書のベース
│   ├── templates/              # 各種書面テンプレート
│   ├── gui/                    # GUIアプリケーション
│   ├── lib/                    # 共通ライブラリ
│   ├── launcher/               # ランチャーソースコード
│   ├── convert_to_pdf.js
│   ├── ai_generate_markdown.js
│   ├── ocr_court_doc.js
│   ├── ocr_general_doc.js
│   ├── ocr_merge_pages.js
│   ├── archive_for_ai.js
│   ├── renumber_markdown.js
│   └── preview_template.js
├── instructions/               # AI指示書（setup.jsで生成）
├── output/                     # PDF出力先
├── config.json                 # 設定ファイル
├── config.template.json        # 設定テンプレート
├── setup.js                    # セットアップスクリプト
├── Markdown仕様書.md           # Markdown記法の詳細
└── README.md                   # 本ファイル
```

## ライセンス

詳細は各ソースファイルを参照してください。
