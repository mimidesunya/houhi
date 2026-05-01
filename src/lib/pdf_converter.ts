const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { get_session } = require('copper-cti');
const { loadConfig } = require('./config_loader');

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
    const properties = copperConfig.properties || {};

    console.log(`${serverUri} に接続中...`);
    
    const session = get_session(serverUri, {
        user: user,
        password: password
    });

    try {
        console.log("セッションを開始しました。");

        const htmlContent = fs.readFileSync(htmlPath);
        const needsPageReferences = htmlContent.includes('cssj:make-toc');
        
        // 出力先ディレクトリの作成
        const outDir = path.dirname(outputPath);
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        session.setOutputAsFile(outputPath);
        console.log(`出力を設定: ${outputPath}`);

        // PDFバージョンは固定
        console.log('プロパティを設定: output.pdf.version = 1.4A-1');
        session.setProperty('output.pdf.version', '1.4A-1');

        // 汎用プロパティの設定
        for (const [name, value] of Object.entries(properties)) {
            if (name === 'output.pdf.version') {
                console.log('  output.pdf.version は固定値 1.4A-1 を使用します');
                continue;
            }
            console.log(`プロパティを設定: ${name} = ${value}`);
            session.setProperty(name, value);
        }

        if (needsPageReferences) {
            const configuredPassCount = Number(properties['processing.pass-count'] || 0);
            const passCount = configuredPassCount > 1 ? configuredPassCount : 2;
            console.log('目次生成のためページ参照収集を有効化します。');
            console.log('プロパティを設定: processing.page-references = true');
            session.setProperty('processing.page-references', 'true');
            console.log(`プロパティを設定: processing.pass-count = ${passCount}`);
            session.setProperty('processing.pass-count', String(passCount));
        }

        // リソースリゾルバーの設定
        session.setResolverFunc(async (uri, resource) => {
            console.log(`リソースを解決中: ${uri}`);
            
            const candidates = [];

            if (uri.startsWith('file:')) {
                try {
                    candidates.push(fileURLToPath(uri));
                } catch (_e) {
                    // URIとして解釈できない場合は、下のフォールバック候補で探す
                }
            }

            // URIからファイル名のみを取得（テンプレートCSS等のフォールバック用）
            const fileName = path.basename(uri);
            candidates.push(path.join(resourceDir, fileName));
            if (defaultTemplateDir) {
                candidates.push(path.join(defaultTemplateDir, fileName));
            }

            let localPath = null;
            for (const candidate of candidates) {
                if (candidate && fs.existsSync(candidate)) {
                    localPath = candidate;
                    break;
                }
            }

            if (localPath) {
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
