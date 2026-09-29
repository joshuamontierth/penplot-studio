@echo off
rem Starts PenPlot Studio on http://127.0.0.1:8791 and opens your browser.
rem (You can also just double-click index.html.)
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found - opening index.html directly instead.
  start "" "%~dp0index.html"
  exit /b
)
python serve.py
