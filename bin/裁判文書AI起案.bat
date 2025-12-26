@echo off
chcp 65001 > nul
cd /d "%~dp0"
cd ..

set "TARGET_FILE=%~1"

echo AIによる裁判文書の起案を開始します...

node src\ai_generate_markdown.js "%TARGET_FILE%"

pause
