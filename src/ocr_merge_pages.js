/**
 * OCRで出力されたMarkdownファイルからページ区切りマーカーを処理（結合・削除）し、
 * 段落を整形して保存するプログラム。
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
        console.error(`[ERROR] File not found: ${filePath}`);
        return;
    }

    try {
        let content = fs.readFileSync(filePath, 'utf-8');

        // 1. 新しいページ区切り形式の処理
        // パターン: =-- End Printed Page ... --= (改行/空白) =-- Begin Page ... --=
        const boundaryPattern = /\s*(=-- End Printed Page [\s\S]*? --=)\s*(=-- Begin Page [\s\S]*? --=)\s*/g;
        
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
        content = content.replace(/=-- Begin Page [\s\S]*? --=\s*/g, '');
        content = content.replace(/\s*=-- End Printed Page [\s\S]*? --=/g, '');

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
            outputPath = path.join(dirName, fileName.replace("_paged.md", ".md"));
        } else {
            outputPath = path.join(dirName, stem + "_merged" + ext);
        }
        
        fs.writeFileSync(outputPath, content, 'utf-8');
        console.log(`[SUCCESS] Created: ${outputPath}`);

    } catch (err) {
        console.error(`[ERROR] Failed to process ${filePath}: ${err}`);
    }
}

function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error("Usage: node ocr_merge_pages.js <input_path>");
        return;
    }

    const inputPath = path.resolve(args[0]);
    
    if (fs.statSync(inputPath).isDirectory()) {
        let mdFiles = fs.readdirSync(inputPath)
            .filter(f => f.endsWith("_paged.md"))
            .map(f => path.join(inputPath, f));
            
        if (mdFiles.length === 0) {
            mdFiles = fs.readdirSync(inputPath)
                .filter(f => f.endsWith(".md"))
                .map(f => path.join(inputPath, f));
        }
            
        console.log(`[INFO] Found ${mdFiles.length} Markdown files in ${inputPath}`);
        for (const mdFile of mdFiles) {
            if (mdFile.endsWith("_merged.md") || mdFile.endsWith("_clean.md")) {
                continue;
            }
            mergeOcrPages(mdFile);
        }
    } else {
        mergeOcrPages(inputPath);
    }
}

if (require.main === module) {
    main();
}
