const fs = require('fs');
const path = require('path');
const { convertMarkdownToCourtHtml, findWesternDatesInEvidenceTables } = require('../base/court_markdown');

/**
 * HTML内の全 <pre> タグを裁判文書用HTMLに変換して置換します。
 * data-src属性がある場合は、そのファイルを読み込みます。
 * 証拠説明書の作成年月日が西暦なら、和暦に直すよう標準エラーに警告を出します（変換は続ける）。
 */
function renderPreTags(htmlContent, baseDir = null) {
    const preRegex = /(<pre[^>]*>)([\s\S]*?)(<\/pre>)/g;
    
    return htmlContent.replace(preRegex, (match, preTag, markdownText) => {
        // data-src属性を確認
        const srcMatch = preTag.match(/data-src=["'](.*?)["']/);
        if (srcMatch && baseDir) {
            const srcPath = srcMatch[1];
            const absSrcPath = path.join(baseDir, srcPath);
            if (fs.existsSync(absSrcPath)) {
                markdownText = fs.readFileSync(absSrcPath, 'utf-8');
            } else {
                console.warn(`Warning: data-src file not found: ${absSrcPath}`);
            }
        }

        // クラス名を取得
        const classMatch = preTag.match(/class=["'](.*?)["']/);
        const originalClass = classMatch ? classMatch[1] : "";
        
        if (!markdownText.trim()) {
            return match; // 何もなければそのまま
        }

        for (const { exhibit, date } of findWesternDatesInEvidenceTables(markdownText)) {
            console.warn(`警告: 証拠説明書の作成年月日が西暦です（${exhibit}: ${date}）。和暦で書いてください。`);
        }

        const renderedHtml = convertMarkdownToCourtHtml(markdownText);
        
        // divでラップし、元のクラスを継承
        const containerClass = (originalClass ? originalClass + " " : "") + "content-container";
        return `<div class="${containerClass}">${renderedHtml}</div>`;
    });
}

module.exports = {
    renderPreTags
};
