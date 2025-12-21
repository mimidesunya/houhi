@echo off
cd /d "%~dp0"

set "TARGET_FILE=%~1"

REM .venvが存在するか確認し、あれば使用する。なければグローバルなpythonを使用する
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" "src\generate_court_doc.py" "%TARGET_FILE%"
) else (
    python "src\generate_court_doc.py" "%TARGET_FILE%"
)

pause
