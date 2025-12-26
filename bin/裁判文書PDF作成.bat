@echo off
cd /d "%~dp0"
cd ..

set "TARGET_FILE=%~1"

node src\convert_to_pdf.js "%TARGET_FILE%"

