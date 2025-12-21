import os
from cti import get_session

SERVER_URI = 'ctip://cti.li/'

def convert_html_to_pdf(html_path, output_path, resource_dir, default_template_dir=None):
    """
    HTMLファイルをPDFに変換します。
    
    Args:
        html_path (str): 変換するHTMLファイルのパス
        output_path (str): 出力するPDFファイルのパス
        resource_dir (str): リソース（画像、CSSなど）を検索するベースディレクトリ
        default_template_dir (str, optional): リソースが見つからない場合のフォールバックディレクトリ
    """
    print(f"{SERVER_URI} に接続中...")
    
    try:
        session = get_session(SERVER_URI, {
            'user': 'user',
            'password': 'kappa'
        })
    except Exception as e:
        print(f"サーバーへの接続に失敗しました: {e}")
        return

    try:
        print("セッションを開始しました。")
        session.set_output_as_file(output_path)
        print(f"出力を設定: {output_path}")

        def resolver(uri, r):
            print(f"リソースを解決中: {uri}")
            if '..' in uri:
                pass

            # まずresource_dir (入力ファイルの場所など) を探す
            local_path = os.path.join(resource_dir, uri)
            
            # 見つからない場合、デフォルトテンプレートディレクトリを探す
            if not os.path.exists(local_path) and default_template_dir:
                fallback_path = os.path.join(default_template_dir, uri)
                if os.path.exists(fallback_path):
                    print(f"  テンプレートディレクトリで見つかりました: {fallback_path}")
                    local_path = fallback_path

            if os.path.exists(local_path):
                print(f"  ローカルファイルを発見: {local_path}")
                out = r.found()
                try:
                    with open(local_path, 'rb') as f:
                        out.write(f.read())
                except Exception as e:
                    print(f"  ファイル読み込みエラー: {e}")
                finally:
                    out.close()
            else:
                print(f"  リソースが見つかりません: {local_path}")

        session.set_resolver_func(resolver)

        print(f"変換中: {html_path}...")
        out = session.transcode()
        try:
            with open(html_path, 'rb') as f:
                # HTMLファイルの内容を読み込む
                content = f.read()
                # バイト列として書き込む
                out.write(content)
        except Exception as e:
             print(f"HTML読み込み/送信エラー: {e}")
        finally:
            out.close()
            
        print("変換が完了しました。")
        print(f"PDF生成先: {output_path}")

    except PermissionError:
        print(f"エラー: {output_path} への書き込み権限がありません。")
    except Exception as e:
        print(f"エラーが発生しました: {e}")
    finally:
        session.close()
