@echo off
chcp 65001 > nul
cd /d "%~dp0"
cd ..

set "TARGET_FILE=%*"
if defined TARGET_FILE set "TARGET_FILE=%TARGET_FILE:"=%"

echo Target File: "%TARGET_FILE%"

if "%TARGET_FILE%"=="" (
    echo -------------------------------------------------------
    echo  PDFファイルまたはフォルダをこのファイルにドロップしてください。
    echo -------------------------------------------------------
    pause
    exit /b
)

node "src\ocr_court_doc.js" "%TARGET_FILE%"

pause
