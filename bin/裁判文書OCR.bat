@echo off
cd /d "%~dp0"
cd ..

node "src\ocr_court_doc.js" %*

if %errorlevel% neq 0 pause
echo.
echo すべての処理が完了しました。
pause
