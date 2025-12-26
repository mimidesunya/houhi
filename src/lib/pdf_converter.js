const fs = require('fs');
const path = require('path');
const { get_session } = require('copper-cti');
const { loadConfig } = require('./gemini_client.js');

/**
 * HTMLファイルをPDFに変換します（Node.js版ドライバを使用）。
 * 
 * @param {string} htmlPath 変換するHTMLファイルのパス
 * @param {string} outputPath 出力するPDFファイルのパス
 * @param {string} resourceDir リソース（画像、CSSなど）を検索するベースディレクトリ
 * @param {string} [defaultTemplateDir] リソースが見つからない場合のフォールバックディレクトリ
 */
async function convertHtmlToPdf(htmlPath, outputPath, resourceDir, defaultTemplateDir = null) {
    const config = loadConfig();
    const copperConfig = (config && config.copper) || {};
    const serverUri = copperConfig.serverUri || 'ctip://cti.li/';
    const user = copperConfig.user || 'user';
    const password = copperConfig.password || 'kappa';

    console.log(`${serverUri} に接続中...`);
    
    const session = get_session(serverUri, {
        user: user,
        password: password
    });

    try {
        console.log("セッションを開始しました。");
        
        // 出力先ディレクトリの作成
        const outDir = path.dirname(outputPath);
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        session.setOutputAsFile(outputPath);
        console.log(`出力を設定: ${outputPath}`);

        // リソースリゾルバーの設定
        session.setResolverFunc(async (uri, resource) => {
            console.log(`リソースを解決中: ${uri}`);
            
            // URIからファイル名のみを取得（パスが含まれる場合があるため）
            const fileName = path.basename(uri);
            
            // まずresource_dirを探す
            let localPath = path.join(resourceDir, fileName);
            
            // 見つからない場合、デフォルトテンプレートディレクトリを探す
            if (!fs.existsSync(localPath) && defaultTemplateDir) {
                const fallbackPath = path.join(defaultTemplateDir, fileName);
                if (fs.existsSync(fallbackPath)) {
                    console.log(`  テンプレートディレクトリで見つかりました: ${fallbackPath}`);
                    localPath = fallbackPath;
                }
            }

            if (fs.existsSync(localPath)) {
                console.log(`  ローカルファイルを発見: ${localPath}`);
                
                // 拡張子からMIMEタイプを簡易判定
                let mimeType = 'application/octet-stream';
                const ext = path.extname(localPath).toLowerCase();
                if (ext === '.css') mimeType = 'text/css';
                else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
                else if (ext === '.png') mimeType = 'image/png';
                else if (ext === '.gif') mimeType = 'image/gif';

                const out = resource.found({ mime_type: mimeType });
                
                // ストリームのタイミング問題を避けるため、同期的に読み込んで書き込む
                try {
                    const data = fs.readFileSync(localPath);
                    out.write(data);
                } finally {
                    out.end();
                }
            } else {
                console.log(`  リソースが見つかりません: ${uri}`);
            }
        });

        session.setMessageFunc((code, msg, args) => {
            console.log(`[Copper] ${msg}`);
        });

        // 変換開始
        // resourceDir を URI 形式に変換（サーバー側での相対パス解決のため）
        let baseUri = resourceDir;
        if (!baseUri.startsWith('http') && !baseUri.startsWith('file')) {
            baseUri = 'file:///' + path.resolve(resourceDir).replace(/\\/g, '/');
            if (!baseUri.endsWith('/')) baseUri += '/';
        }

        const writer = session.transcode(baseUri);
        try {
            const htmlContent = fs.readFileSync(htmlPath);
            writer.write(htmlContent);
        } finally {
            writer.end();
        }

        // 完了待機
        await session.waitForCompletion();
        console.log(`PDFの生成が完了しました: ${outputPath}`);

    } catch (err) {
        console.error(`PDF変換エラー: ${err}`);
        throw err;
    } finally {
        session.close();
    }
}

module.exports = {
    convertHtmlToPdf
};
