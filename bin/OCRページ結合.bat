@echo off
chcp 65001 > nul
cd /d "%~dp0"
cd ..

set "TARGET_FILE=%*"
if defined TARGET_FILE set "TARGET_FILE=%TARGET_FILE:"=%"

if "%TARGET_FILE%"=="" (
    echo -------------------------------------------------------
    echo  Markdownファイル（_paged.md）またはフォルダをドロップしてください。
    echo  ページ区切りを結合し、整形した .md ファイルを作成します。
    echo -------------------------------------------------------
    pause
    exit /b
)

node "src\ocr_merge_pages.js" "%TARGET_FILE%"

pause
