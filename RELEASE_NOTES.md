# HOUHI 0.1 alpha 1

HOUHI の初回アルファ公開版です。Windows で本人訴訟フォルダを扱うエージェント補助ツールとして、裁判文書 Markdown、Word・PDF作成、AI アーカイブ、号証スタンプ、FAX 用 PDF 化、音声反訳などをまとめています。

## 主な内容

- Windows 向け GUI と `houhi.exe` ランチャー
- 裁判所提出文書向け Markdown から PDF への変換
- 裁判文書 Markdown から編集用 Word（`.docx`）への変換（既存ファイル非上書き）
- Word文書を開いたときに不要なフィールド更新確認を表示しない安全な出力
- ChatGPT 等に渡す AI アーカイブ ZIP の作成
- 証拠番号に基づく号証スタンプ
- FAX 送信用の PDF 二値化と送信補助
- OpenAI / Gemini を使った音声反訳 Markdown 作成
- 本人訴訟フォルダ構成と AI エージェント仮想チーム構成の運用方針

## アルファ版の注意

- このリリースは `0.1.0-alpha.1` のプレリリースです。
- Windows 向けリリース ZIP は未署名のため、環境によっては起動時に警告が出ることがあります。
- OCR は別プロジェクトの `mimi-ocr` を使用します。外部 AI OCR を使う場合、資料内容が外部 AI provider に送信される可能性があります。
- FAX、メール、外部 API、外部 AI OCR は、実行前に必ずユーザーの明示承認を得る前提です。

## 配布物

- `houhi-win-x64-v0.1.0-alpha.1.zip`

ZIP を展開し、`houhi.exe` を起動してください。Electron と Node.js 実行環境を同梱しているため、通常の利用者側で Node.js / npm / .NET ランタイムを追加インストールする必要はありません。
