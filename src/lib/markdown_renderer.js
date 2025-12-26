const fs = require('fs');
const path = require('path');
const { convertMarkdownToCourtHtml } = require('../base/script.js');

/**
 * HTML内の全 <pre> タグを裁判文書用HTMLに変換して置換します。
 * data-src属性がある場合は、そのファイルを読み込みます。
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

        const renderedHtml = convertMarkdownToCourtHtml(markdownText);
        
        // divでラップし、元のクラスを継承
        const containerClass = (originalClass ? originalClass + " " : "") + "content-container";
        return `<div class="${containerClass}">${renderedHtml}</div>`;
    });
}

module.exports = {
    renderPreTags
};
