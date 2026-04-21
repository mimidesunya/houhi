@echo off
setlocal

cd /d "%~dp0"

echo [1/3] Running setup...
call npm.cmd run setup
if errorlevel 1 exit /b %errorlevel%

echo [2/3] Regenerating tool docs...
call npm.cmd run docs:tools
if errorlevel 1 exit /b %errorlevel%

echo [3/3] Running tests...
call npm.cmd test
if errorlevel 1 exit /b %errorlevel%

echo Done.
