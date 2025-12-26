@echo off
chcp 65001 > nul
cd /d "%~dp0"
cd ..

echo テンプレートプレビューを実行します...

node src/preview_template.js
