# 日本の裁判書面作成プロジェクト (CSS 2.1 + Copper PDF)

このプロジェクトは、日本の裁判所で使用される書面（訴状、準備書面など）を、HTMLとCSS 2.1準拠のCSSを用いて作成し、Copper PDFを使用してPDF化する試みです。

## 概要

日本の裁判書面は、A4縦書き、横書き、行数、文字数、余白などの厳格なフォーマットが求められることがあります。
本プロジェクトでは、Web技術（HTML/CSS）を用いてこれらのレイアウトを制御し、Pythonスクリプトを通じてデータを流し込み、印刷可能なPDFを生成することを目指します。

## 技術スタック

*   **言語**: Python
*   **マークアップ**: HTML5
*   **スタイル**: CSS 2.1 (Copper PDFがサポートする範囲)
*   **PDFレンダリング**: [Copper PDF](https://copper-pdf.com/) (CTI)

## セットアップ

### Copper PDF ドライバのインストール

以下のコマンドを実行して、Copper PDFのPythonドライバを自動的にダウンロード・インストールします。

```bash
python setup.py
```

このスクリプトは、ドライバをダウンロードし、現在のPython環境にインストールします。

### PDFの生成

以下のコマンドを実行して、`src/template/text.html` をPDFに変換します。

```bash
python src/generate_court_doc.py
```

生成されたPDFは `output/result.pdf` に保存されます。
なお、変換には公開サーバー `ctip://cti.li/` を使用しています。

## フォルダ構成

```
.
├── src/
│   ├── generate_court_doc.py   # 裁判文書生成スクリプト
│   └── template/         # HTML/CSSテンプレート
│       ├── text.html     # 控訴理由書サンプルHTML
│       └── style.css     # 裁判書面用CSS (CSS 2.1準拠)
├── output/               # 生成されたPDFの出力先
├── setup.py              # ドライバセットアップスクリプト
└── README.md             # 本ファイル
```

## 前提条件

1.  Python 3.x がインストールされていること。
2.  インターネット接続があること（公開サーバー `cti.li` を使用するため）。

## 今後の予定

*   基本的な書面（訴状など）のHTMLテンプレート作成
*   縦書き・横書き対応のCSS設計
*   Pythonによるデータ挿入とPDF変換スクリプトの実装
