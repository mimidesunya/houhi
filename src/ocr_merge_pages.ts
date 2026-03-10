/**
 * OCRで出力されたMarkdownファイルからページ区切りマーカーを処理（結合・削除）し、
 * 段落を整形して保存するプログラム。
 * Continuation マーカーの有無を見て、段落結合または空行挿入を行います。
 *
 * 入力:
 * - `_paged.md` を含む Markdown ファイル
 * - Markdown ファイルを含むディレクトリ
 *
 * 出力:
 * - `_paged.md` は `<元ファイル名>_merged.md` に変換します。
 * - それ以外の Markdown は `<元ファイル名>_merged.md` を作成します。
 *
 * 補足:
 * - 新旧両方のページ境界マーカーを処理します。
 * - 物理ページと印字ページの整合性チェック警告を表示します。
 * - ディレクトリ指定時は `_merged.md` を再処理しません。
 * 
 * 使い方:
 *   node src/ocr_merge_pages.js <Markdownファイルパス または ディレクトリパス>
 */
const fs = require('fs');
const path = require('path');

/**
 * OCRで出力されたMarkdownファイルからページ区切りマーカーを処理（結合・削除）し、
 * 整形されたファイルとして保存する。
 */
function mergeOcrPages(filePath) {
    if (!fs.existsSync(filePath)) {
        console.error(`[エラー] ファイルが見つかりません: ${filePath}`);
        return;
    }

    try {
        let content = fs.readFileSync(filePath, 'utf-8');

        // ページ番号の整合性チェック
        const beginPagePattern = /### -- Begin Page (\d+).*? --/g;
        const endPagePattern = /### -- End .*? --/g;

        // 物理ページと印字ページの対応関係を抽出
        const pageInfo = [];
        const pageBlocks = content.split(/### -- Begin Page \d+.*? --/);
        const beginMarkers = content.match(beginPagePattern) || [];
        
        // splitの結果、最初の要素は最初のBegin Pageより前の内容（通常は空）
        for (let i = 0; i < beginMarkers.length; i++) {
            const marker = beginMarkers[i];
            const pageContent = pageBlocks[i + 1] || "";
            
            const physicalMatch = marker.match(/### -- Begin Page (\d+)/);
            const physicalNum = physicalMatch ? parseInt(physicalMatch[1]) : null;
            
            let printedNum = null;
            const endMatch = pageContent.match(/### -- End .*? --/);
            if (endMatch) {
                const pm = endMatch[0].match(/\(Printed Page (\d+)\)/);
                if (pm) printedNum = parseInt(pm[1]);
            }
            
            if (physicalNum !== null) {
                pageInfo.push({ physical: physicalNum, printed: printedNum });
            }
        }

        const warnings = [];

        // Begin Page (物理連番) のチェック
        if (pageInfo.length > 0) {
            for (let i = 0; i < pageInfo.length; i++) {
                if (i > 0 && pageInfo[i].physical !== pageInfo[i - 1].physical + 1) {
                    warnings.push(`[警告] Begin Pageの連番に飛びがあります: ${pageInfo[i - 1].physical} -> ${pageInfo[i].physical}`);
                }
            }
            if (pageInfo[0].physical !== 1) {
                warnings.push(`[警告] Begin Pageが1から始まっていません (開始番号: ${pageInfo[0].physical})`);
            }
        }

        // 印字ページ（Printed Page）の整合性チェック
        const printedInfo = pageInfo.filter(p => p.printed !== null);
        if (printedInfo.length > 1) {
            for (let i = 1; i < printedInfo.length; i++) {
                const prev = printedInfo[i - 1];
                const curr = printedInfo[i];
                
                const physicalDiff = curr.physical - prev.physical;
                const printedDiff = curr.printed - prev.printed;

                if (printedDiff <= 0) {
                    warnings.push(`[警告] 印字ページ番号が逆転または重複しています: 物理${prev.physical}P(印字${prev.printed}P) -> 物理${curr.physical}P(印字${curr.printed}P)`);
                } else if (printedDiff !== physicalDiff) {
                    warnings.push(`[警告] 印字ページ番号の進みが物理ページと一致しません（ページ抜けの疑い）: 物理${prev.physical}P(印字${prev.printed}P) -> 物理${curr.physical}P(印字${curr.printed}P)`);
                }
            }
        }

        // 1. 新しいページ区切り形式の処理
        // パターン: ### -- End ... -- (改行/空白) ### -- Begin Page ... --
        const boundaryPattern = /\s*(### -- End [\s\S]*? --)\s*(### -- Begin Page [\s\S]*? --)\s*/g;
        
        content = content.replace(boundaryPattern, (match, endMarker, beginMarker) => {
            if (endMarker.includes("(Continuation)") || beginMarker.includes("(Continuation)")) {
                // Continuationがある場合は、マーカーとその前後の空白を全て削除（段落結合）
                return "";
            } else {
                // Continuationがない場合は、マーカーを削除し、空行(段落区切り)を入れる
                return "\n\n";
            }
        });

        // 2. 残った単独のマーカー（ファイルの先頭や末尾など）を削除
        content = content.replace(/### -- Begin Page [\s\S]*? --\s*/g, '');
        content = content.replace(/\s*### -- End [\s\S]*? --/g, '');

        // 3. 旧形式のマーカー処理
        content = content.replace(/\s*^=-- Page .*?\(Continuation\).*?--=\s*/gm, '');
        content = content.replace(/^=-- Page .*?--=\s*\n?/gm, '');
        
        // 3つ以上の連続する改行を2つ（1つの空行）に置換して整える
        content = content.replace(/\n{3,}/g, '\n\n');
        
        // 出力ファイル名
        let outputPath;
        const fileName = path.basename(filePath);
        const dirName = path.dirname(filePath);
        const ext = path.extname(filePath);
        const stem = path.basename(filePath, ext);

        if (fileName.endsWith("_paged.md")) {
            outputPath = path.join(dirName, fileName.replace("_paged.md", "_merged.md"));
        } else {
            outputPath = path.join(dirName, stem + "_merged" + ext);
        }
        
        fs.writeFileSync(outputPath, content, 'utf-8');
        console.log(`[成功] 作成されました: ${outputPath}`);

        // 警告のレポート
        if (warnings.length > 0) {
            console.log(`\n--- ${fileName} のページ整合性レポート ---`);
            warnings.forEach(w => console.warn(w));
            console.log("-----------------------------------------------\n");
        }

    } catch (err) {
        console.error(`[エラー] ${filePath} の処理に失敗しました: ${err}`);
    }
}

function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log("-------------------------------------------------------");
        console.log(" Markdownファイル（_paged.md）またはフォルダをドロップしてください。");
        console.log(" 使い方: node ocr_merge_pages.js <input_path...>");
        console.log("-------------------------------------------------------");
        return;
    }

    for (const arg of args) {
        const inputPath = path.resolve(arg);
        if (!fs.existsSync(inputPath)) {
            console.error(`[エラー] パスが見つかりません: ${inputPath}`);
            continue;
        }
        
        if (fs.statSync(inputPath).isDirectory()) {
            let mdFiles = fs.readdirSync(inputPath)
                .filter(f => f.endsWith("_paged.md"))
                .map(f => path.join(inputPath, f));
                
            if (mdFiles.length === 0) {
                mdFiles = fs.readdirSync(inputPath)
                    .filter(f => f.endsWith(".md"))
                    .map(f => path.join(inputPath, f));
            }
                
            console.log(`[情報] ${inputPath} 内に ${mdFiles.length} 個の Markdown ファイルが見つかりました`);
            for (const mdFile of mdFiles) {
                if (mdFile.endsWith("_merged.md")) {
                    continue;
                }
                mergeOcrPages(mdFile);
            }
        } else {
            mergeOcrPages(inputPath);
        }
    }
    console.log("\nすべての処理が完了しました。");
}

if (require.main === module) {
    main();
}

module.exports = {
    mergeOcrPages,
    main
};
