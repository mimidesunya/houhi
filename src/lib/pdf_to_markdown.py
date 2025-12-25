import time
import base64
import re
from pathlib import Path
import fitz  # PyMuPDF: PDFの操作と画像化に使用
from google.genai import types

try:
    from . import gemini_client
except ImportError:
    import gemini_client

# 1. Gemini APIクライアントの初期化
client = gemini_client.get_gemini_client()

# 使用するGeminiモデルのID (Batch API対応モデル)
# 明示的に gemini-3-flash-preview を指定
MODEL_ID = "gemini-3-flash-preview"

# エラー時のリトライ設定
MAX_RETRIES = gemini_client.MAX_RETRIES
INITIAL_RETRY_DELAY = gemini_client.INITIAL_RETRY_DELAY

def get_ocr_prompt(num_pages: int, context_instruction: str = "") -> str:
    """
    OCR用のプロンプトを生成する。
    """
    return f"""
# ROLE
High-precision OCR engine converting Japanese PDF pages to clean Markdown.

{context_instruction}

# INPUT
{num_pages} pages of a Japanese document.

# OUTPUT RULES
1. **Markdown Only**: No conversational text.
2. **No Skipping**: Even if the first page starts mid-sentence or mid-paragraph (continuation from a previous unprovided page), transcribe it completely from the very first character.
3. **Page Markers**:
   - **Start**: At the start of content, output `=-- Begin Page N {{StartStatus}} --=`.
     - N: Batch page index (1-{num_pages}).
     - {{StartStatus}}: "(Continuation)" if the text at the very top of the page is a direct continuation of a paragraph from the previous page (cut off mid-sentence without a line break), else empty.
   - **End**: At the end of content, output `=-- End Printed Page X {{EndStatus}} --=`.
     - X: Printed page number. **CONVERT** Kanji (一, 二) or Roman (I, II) to Arabic (1, 2). If not found, use "N/A".
     - {{EndStatus}}: "(Continuation)" if the paragraph is cut off mid-sentence and continues to the next page without an explicit line break, else empty.
4. **Transcription Rules**:
   - **No Indentation**: Standard Markdown paragraphs.
   - **Numbers**: Convert ALL full-width numbers to half-width (e.g., "１" -> "1"). 
   - **Corrections**: Fix obvious OCR errors (0 vs O). Keep original typos with `［ママ］`.
   - **Exclusions**: Omit printed page numbers from body.
   - **Margins**:
     - Headings in margins: Format as `【#Text】`.
     - Annotations/Notes in margins: Format as `【*Text】`.
"""

def run_batch_api_ocr(batch_tasks: list, generation_config: types.GenerateContentConfig, context_instruction: str = "") -> list[tuple[list[int], str]]:
    """
    Gemini Batch APIを使用して複数のリクエストを一括処理する。
    20MBの制限を考慮し、必要に応じて複数のバッチジョブに分割して実行する。
    バリデーションとリトライ機能付き。
    
    Args:
        batch_tasks: (page_mapping, pdf_bytes) のタプルのリスト。
                     page_mapping は元のページ番号（1始まり）のリスト。
        generation_config: Gemini生成設定。
        context_instruction: 文書のコンテキストやスタイルに関する追加指示。
    Returns:
        (page_mapping, markdown_text) のタプルのリスト。
    """
    all_results = []
    
    # (ページマッピング, PDFバイト列, リトライ回数)
    pending_tasks = [(t[0], t[1], 0) for t in batch_tasks]
    
    while pending_tasks:
        # 1. 保留中のタスクからジョブを作成
        current_batch_requests = []
        current_batch_tasks = [] 
        current_batch_size = 0
        MAX_INLINE_SIZE = 18 * 1024 * 1024 # 安全のため18MBに設定
        
        jobs_to_submit = [] # (リクエストリスト, ジョブ内タスクリスト) のリスト
        
        tasks_to_process = pending_tasks
        pending_tasks = [] # 次のイテレーションのためにクリア
        
        for page_mapping, b_bytes, retry_count in tasks_to_process:
            # AIには常に1ページ目からの相対的な番号で処理させる
            num_pages = len(page_mapping)
            prompt = get_ocr_prompt(num_pages, context_instruction)
            
            # PDFデータをBase64エンコード
            b64_data = base64.b64encode(b_bytes).decode('utf-8')
            
            pdf_part = {
                "role": "user",
                "parts": [
                    {"inline_data": {"data": b64_data, "mime_type": "application/pdf"}},
                    {"text": prompt}
                ]
            }
            
            # おおよそのサイズ計算（Base64エンコード後のサイズ）
            req_size = len(b64_data) + len(prompt)
            
            if current_batch_size + req_size > MAX_INLINE_SIZE and current_batch_requests:
                jobs_to_submit.append((current_batch_requests, current_batch_tasks))
                current_batch_requests = []
                current_batch_tasks = []
                current_batch_size = 0
                
            current_batch_requests.append({
                "contents": [pdf_part],
                "config": generation_config
            })
            current_batch_tasks.append((page_mapping, b_bytes, retry_count))
            current_batch_size += req_size
            
        if current_batch_requests:
            jobs_to_submit.append((current_batch_requests, current_batch_tasks))
            
        print(f"[INFO] {len(jobs_to_submit)} 件のバッチAPIジョブを送信中 (合計 {len(tasks_to_process)} リクエスト)...")
        
        active_jobs = []
        for i, (job_requests, tasks) in enumerate(jobs_to_submit):
            print(f"[INFO] バッチジョブ {i+1}/{len(jobs_to_submit)} を作成中 ({len(job_requests)} リクエスト)...")
            try:
                batch_job = client.batches.create(
                    model=MODEL_ID,
                    src=job_requests,
                    config=types.CreateBatchJobConfig(display_name=f"ocr_batch_{i}_{int(time.time())}")
                )
                active_jobs.append((batch_job, tasks))
            except Exception as e:
                print(f"[ERROR] バッチジョブの作成に失敗しました: {e}")
                # ジョブ作成失敗、このジョブの全タスクをリトライ
                for t in tasks:
                    if t[2] < MAX_RETRIES:
                        pending_tasks.append((t[0], t[1], t[2] + 1))
                    else:
                        print(f"[ERROR] タスクの最大リトライ回数に達しました (ページ: {t[0]})")
        
        # 2. ポーリング（完了待ち）
        if not active_jobs:
            if pending_tasks:
                 time.sleep(INITIAL_RETRY_DELAY)
            continue

        print(f"[INFO] {len(active_jobs)} 件のジョブの完了を待機中...")
        completed_jobs = [False] * len(active_jobs)
        start_time = time.time()
        
        while not all(completed_jobs):
            elapsed = time.time() - start_time
            for i, (job, tasks) in enumerate(active_jobs):
                if completed_jobs[i]:
                    continue
                    
                try:
                    updated_job = client.batches.get(name=job.name)
                except Exception as e:
                    print(f"[WARN] ジョブステータスの取得に失敗しました: {e}")
                    time.sleep(5)
                    continue

                if updated_job.done:
                    job_elapsed = time.time() - start_time
                    print(f"[OK] ジョブ {i+1} が完了しました。状態: {updated_job.state} (経過時間: {job_elapsed:.1f}秒)")
                    
                    if updated_job.state == 'JOB_STATE_SUCCEEDED':
                        # 結果の回収
                        if updated_job.dest and updated_job.dest.inlined_responses:
                            responses = updated_job.dest.inlined_responses
                            
                            for res_idx, res in enumerate(responses):
                                task = tasks[res_idx]
                                page_mapping, b_bytes, retry_count = task
                                success = False
                                
                                if res.response and res.response.text:
                                    # Markdownテキストをそのまま取得
                                    text_content = res.response.text
                                    
                                    # バリデーション: ページマーカーの数を確認
                                    # AIが指示を無視してマーカーを出力しない、または一部のページが欠落している場合があるためチェックする
                                    expected_count = len(page_mapping)
                                    start_count = text_content.count("=-- Begin Page")
                                    end_count = text_content.count("=-- End Printed Page")
                                    
                                    if start_count == expected_count and end_count == expected_count:
                                        all_results.append((page_mapping, text_content))
                                        success = True
                                    else:
                                        print(f"[WARN] ページマーカーの数が期待値と一致しません (期待: {expected_count}, 開始: {start_count}, 終了: {end_count})。再試行します。(ページ: {page_mapping})")
                                        # success は False のまま -> リトライへ
                                else:
                                    print(f"[WARN] 空のレスポンスが返されました (ページ: {page_mapping})")

                                if not success:
                                    if retry_count < MAX_RETRIES:
                                        print(f"[INFO] リトライします (ページ: {page_mapping}, 試行回数: {retry_count + 2}/{MAX_RETRIES + 1})")
                                        pending_tasks.append((page_mapping, b_bytes, retry_count + 1))
                                    else:
                                        print(f"[ERROR] 最大リトライ回数に達しました (ページ: {page_mapping})")

                        elif updated_job.dest and updated_job.dest.file_name:
                            # JSONLファイルとして出力された場合
                            print(f"[INFO] 結果がファイルに保存されました: {updated_job.dest.file_name}. ダウンロード中...")
                            # ここでは簡易化のため、ファイルダウンロード処理は省略（必要に応じて実装）
                            # 実際には client.files.download を使用
                            pass
                    else:
                        print(f"[ERROR] ジョブ {i+1} が失敗しました: {updated_job.error}")
                        # 全タスクをリトライ
                        for t in tasks:
                            if t[2] < MAX_RETRIES:
                                pending_tasks.append((t[0], t[1], t[2] + 1))
                            else:
                                print(f"[ERROR] タスクの最大リトライ回数に達しました (ページ: {t[0]})")
                    
                    completed_jobs[i] = True
            
            if not all(completed_jobs):
                elapsed_sec = time.time() - start_time
                print(f"[INFO] 処理中... {elapsed_sec:.0f}秒経過")
                time.sleep(10) # ポーリング間隔
            
        if pending_tasks:
            print(f"[INFO] {len(pending_tasks)} 件のタスクがリトライ待ちです。{INITIAL_RETRY_DELAY}秒待機します...")
            time.sleep(INITIAL_RETRY_DELAY)
            
    return all_results

def pdf_to_text(pdf_path: Path, batch_size: int = 5, start_page: int = 1, end_page: int | None = None, context_instruction: str = "") -> None:
    """
    PDFファイルを読み込み、各ページを抽出してGemini Batch APIでOCRを実行し、結果をMarkdownファイルに保存する。
    
    Args:
        pdf_path (Path): 処理対象のPDFファイルパス
        batch_size (int): 一度に処理するページ数
        start_page (int): 開始ページ番号（1開始）
        end_page (int | None): 終了ページ番号（1開始）。Noneの場合は最終ページまで。
        context_instruction (str): 文書のコンテキストやスタイルに関する追加指示。
    """
    if not pdf_path.exists():
        # 拡張子が省略されている場合や、誤って削除された場合のフォールバック
        if pdf_path.with_suffix(".pdf").exists():
            pdf_path = pdf_path.with_suffix(".pdf")
            print(f"[INFO] .pdf 拡張子のファイルが見つかりました: {pdf_path}")
        else:
            print(f"[ERROR] PDFファイルが見つかりません: {pdf_path}")
            return

    # 出力先はPDFと同じ場所で拡張子を _paged.md に変更
    output_md_path = pdf_path.with_name(pdf_path.stem + "_paged.md")
    
    print(f"[INFO] PDFを開いています: {pdf_path}")
    script_start_time = time.time()
    
    try:
        # PDFファイルをオープン
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(f"[ERROR] PDFを開けませんでした: {e}")
        return

    try:
        total_pages = len(doc)
        # 1-basedから0-basedのインデックスに変換
        s_idx = max(0, start_page - 1)
        e_idx = min(total_pages - 1, (end_page - 1) if end_page is not None else total_pages - 1)

        if s_idx > e_idx:
            print(f"[ERROR] 無効なページ範囲です: {start_page} から {end_page} (総ページ数: {total_pages})")
            return

        # 処理対象のページ番号（1-based）のリストを作成
        target_pages = list(range(s_idx + 1, e_idx + 2))
        print(f"[INFO] 処理対象ページ: {target_pages}")

        # 1. 事前に全バッチのデータを準備（PDFの切り出し）
        batch_tasks = []
        
        # target_pagesをbatch_sizeごとに分割
        for i in range(0, len(target_pages), batch_size):
            chunk = target_pages[i : i + batch_size]
            
            # 指定範囲のページを含む新しいPDFを作成
            new_doc = fitz.open()
            for p_num in chunk:
                # p_num is 1-based, fitz uses 0-based
                new_doc.insert_pdf(doc, from_page=p_num-1, to_page=p_num-1)
            
            page_bytes = new_doc.tobytes()
            new_doc.close()
            
            # (page_mapping, page_bytes)
            batch_tasks.append((chunk, page_bytes))

        print(f"[INFO] 処理対象バッチ数: {len(batch_tasks)}")

        # 2. Batch APIを使用して一括処理
        generation_config = types.GenerateContentConfig(
            temperature=0.1,
            response_mime_type="text/plain",
        )
        
        results = run_batch_api_ocr(batch_tasks, generation_config, context_instruction)

        # 結果の保存
        if results:
            # ページ番号順にソート (batchの最初のページ番号でソート)
            results.sort(key=lambda x: x[0][0])
            
            full_markdown = ""
            for mapping, text in results:
                # 相対ページ番号を絶対ページ番号に置換
                def replace_page_num(match):
                    try:
                        rel_num = int(match.group(1))
                        suffix = match.group(2) # (Continuation) など
                        if 1 <= rel_num <= len(mapping):
                            return f"=-- Begin Page {mapping[rel_num-1]}{suffix} --="
                    except ValueError:
                        pass
                    return match.group(0)
                
                fixed_text = re.sub(r"=-- Begin Page (\d+)(.*?) --=", replace_page_num, text)
                full_markdown += fixed_text + "\n\n"
            
            # Markdown保存
            with open(output_md_path, "w", encoding="utf-8") as f:
                f.write(full_markdown)
            
            total_script_time = time.time() - script_start_time
            print(f"[SUCCESS] Markdownを保存しました: {output_md_path}")
            print(f"[INFO] このPDFの合計処理時間: {total_script_time:.1f}秒")
        else:
            print("[ERROR] PDFからデータを抽出できませんでした。")

    except Exception as e:
        print(f"[ERROR] 処理に失敗しました: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # ドキュメントをクローズ
        doc.close()
