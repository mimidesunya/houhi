const fs = require('fs');
const path = require('path');
const { convertMarkdownToCourtHtml } = require('../base/court_markdown');
const { checkCourtMarkdown, formatCourtCheckIssue } = require('../base/court_check');

/**
 * HTML内の全 <pre> タグを裁判文書用HTMLに変換して置換します。
 * data-src属性がある場合は、そのファイルを読み込みます。
 * 提出前チェック（src/base/court_check.ts。【要確認】・〇〇の残り、証拠説明書の作成年月日の西暦、号証番号の飛び・重複、
 * 当事者欄と差出人欄の名前の食い違い）で見つかった問題を、標準エラーに警告として出します（変換は続ける）。
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

        // <pre> の直後の改行は本文に含めない（行番号を .md の行に合わせる）
        for (const issue of checkCourtMarkdown(markdownText.replace(/^\r?\n/, ''))) {
            console.warn(`警告: ${formatCourtCheckIssue(issue)}`);
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
