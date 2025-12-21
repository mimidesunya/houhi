import os
import sys
import json
import time
import re
import warnings
# google.generativeaiのFutureWarningを抑制
warnings.filterwarnings("ignore", category=FutureWarning, module="google.generativeai")
import google.generativeai as genai
import pyperclip
from lib.pdf_converter import convert_html_to_pdf

# 設定
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
CONFIG_PATH = os.path.join(PROJECT_ROOT, 'ai_config.json')
INSTRUCTION_PATH = os.path.join(BASE_DIR, 'instructions', 'ai_instruction.md')

# デフォルト値
DEFAULT_TEMPLATE_DIR = os.path.join(BASE_DIR, 'template')
DEFAULT_OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'output')
DEFAULT_MAIN_HTML = 'text.html'

def load_config():
    if not os.path.exists(CONFIG_PATH):
        print(f"警告: 設定ファイル {CONFIG_PATH} が見つかりません。")
        return None
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"設定ファイルの読み込みエラー: {e}")
        return None

def load_instruction():
    if not os.path.exists(INSTRUCTION_PATH):
        print(f"警告: 指示書 {INSTRUCTION_PATH} が見つかりません。")
        return ""
    try:
        with open(INSTRUCTION_PATH, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        print(f"指示書の読み込みエラー: {e}")
        return ""

def generate_html_with_gemini(text, config):
    if not config or 'gemini' not in config:
        print("Geminiの設定が見つかりません。")
        return None

    gemini_config = config['gemini']
    api_key = gemini_config.get('apiKey')
    model_name = gemini_config.get('textModel', 'gemini-pro')

    if not api_key:
        print("Gemini APIキーが設定されていません。")
        return None

    genai.configure(api_key=api_key)
    
    instruction = load_instruction()
    if not instruction:
        print("指示書が空です。")
        return None

    try:
        print("Geminiに問い合わせ中...")
        model = genai.GenerativeModel(model_name)
        
        # 指示と入力を組み合わせる
        prompt = f"{instruction}\n\n---\n\nUser Input:\n{text}"
        
        response = model.generate_content(prompt)
        
        # レスポンスからHTMLを抽出（Markdownのコードブロックを除去）
        content = response.text
        if "```html" in content:
            content = content.split("```html")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()
            
        return content
    except Exception as e:
        print(f"Gemini APIエラー: {e}")
        return None

def main():
    input_text = ""
    input_source = ""
    is_html_input = False
    input_path = ""

    # 1. 入力ソースの決定
    # 引数が存在し、かつ空文字でない場合のみファイル処理を行う
    if len(sys.argv) > 1 and sys.argv[1].strip():
        input_path = os.path.abspath(sys.argv[1])
        
        # ディレクトリが指定された場合はエラーにする（または無視してインタラクティブモードにするならelseへ）
        if os.path.isdir(input_path):
             print(f"エラー: ディレクトリが指定されています。ファイルを指定してください: {input_path}")
             return

        if not os.path.exists(input_path):
            print(f"エラー: 入力ファイル {input_path} が見つかりません。")
            return
        
        ext = os.path.splitext(input_path)[1].lower()
        if ext == '.html':
            is_html_input = True
            print(f"HTMLファイルを検出: {input_path} (直接変換モード)")
        else:
            try:
                with open(input_path, 'r', encoding='utf-8') as f:
                    input_text = f.read()
                input_source = "file"
                print(f"テキストファイルを読み込みました: {input_path}")
            except Exception as e:
                print(f"ファイル読み込みエラー: {e}")
                return
    else:
        # 引数がない場合、インタラクティブモード
        print("-------------------------------------------------------")
        print(" ファイルが指定されていません。")
        print(" クリップボードモードで実行します。")
        print("-------------------------------------------------------")
        print("")
        print(" 1. 変換したいテキスト（またはHTML）をコピーしてください。")
        print(" 2. 準備ができたら Enter キーを押してください。")
        print("")
        input()

        try:
            clipboard_content = pyperclip.paste()
            if clipboard_content:
                # HTMLかどうかの簡易判定
                if clipboard_content.strip().lower().startswith("<!doctype html") or "<html" in clipboard_content.lower():
                    print("クリップボードからHTMLを検出しました。直接変換モードで実行します。")
                    # 一時ファイルに保存
                    if not os.path.exists(DEFAULT_OUTPUT_DIR):
                        os.makedirs(DEFAULT_OUTPUT_DIR)
                    temp_html_path = os.path.join(DEFAULT_OUTPUT_DIR, "temp_clipboard_input.html")
                    with open(temp_html_path, 'w', encoding='utf-8') as f:
                        f.write(clipboard_content)
                    input_path = temp_html_path
                    is_html_input = True
                else:
                    input_text = clipboard_content
                    input_source = "clipboard"
                    print("クリップボードからテキストを取得しました。AIによる生成を開始します。")
            else:
                # クリップボードも空ならデフォルトHTMLを使用
                input_path = os.path.join(DEFAULT_TEMPLATE_DIR, DEFAULT_MAIN_HTML)
                is_html_input = True
                print("入力がなく、クリップボードも空です。デフォルトテンプレートを使用します。")
        except Exception as e:
            print(f"クリップボード取得エラー: {e}")
            input_path = os.path.join(DEFAULT_TEMPLATE_DIR, DEFAULT_MAIN_HTML)
            is_html_input = True

    # 出力ディレクトリの準備
    if not os.path.exists(DEFAULT_OUTPUT_DIR):
        os.makedirs(DEFAULT_OUTPUT_DIR)

    # 2. HTMLの準備 (AI生成 or 既存ファイル)
    html_to_convert = ""
    resource_dir = DEFAULT_TEMPLATE_DIR # デフォルトのリソース検索先

    if is_html_input:
        html_to_convert = input_path
        resource_dir = os.path.dirname(input_path)
        base_name = os.path.splitext(os.path.basename(input_path))[0]
        output_pdf_path = os.path.join(DEFAULT_OUTPUT_DIR, f"{base_name}.pdf")
    else:
        # AIによる生成
        config = load_config()
        if not config:
            return

        html_content = generate_html_with_gemini(input_text, config)
        if not html_content:
            print("HTML生成に失敗しました。")
            return

        # 生成されたHTMLを一時ファイルとして保存
        timestamp = time.strftime("%Y%m%d-%H%M%S")
        
        # タイトルを抽出してファイル名に使用
        title_match = re.search(r'<h1 class="doc-title">(.*?)</h1>', html_content)
        if title_match:
            title = title_match.group(1).strip()
            # ファイル名に使えない文字を除去
            title = re.sub(r'[\\/*?:"<>|]', "", title)
            date_str = time.strftime("%Y-%m-%d")
            base_filename = f"{date_str}-{title}"
        else:
            base_filename = f"generated_{timestamp}"

        html_filename = f"{base_filename}.html"
        html_to_convert = os.path.join(DEFAULT_OUTPUT_DIR, html_filename)
        
        with open(html_to_convert, 'w', encoding='utf-8') as f:
            f.write(html_content)
        print(f"生成されたHTMLを保存しました: {html_to_convert}")
        
        output_pdf_path = os.path.join(DEFAULT_OUTPUT_DIR, f"{base_filename}.pdf")
        # リソースはテンプレートディレクトリを使用
        resource_dir = DEFAULT_TEMPLATE_DIR

    # 3. PDF変換
    convert_html_to_pdf(html_to_convert, output_pdf_path, resource_dir, default_template_dir=DEFAULT_TEMPLATE_DIR)

if __name__ == '__main__':
    main()
