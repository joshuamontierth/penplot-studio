@echo off
rem Starts PenPlot Studio on http://127.0.0.1:8791 and opens your browser.
rem Uses Node.js if installed, otherwise Python, otherwise opens index.html directly.
cd /d "%~dp0"
where node >nul 2>nul
if not errorlevel 1 (
  node scripts\serve.mjs
  exit /b
)
where python >nul 2>nul
if not errorlevel 1 (
  python serve.py
  exit /b
)
echo Neither Node.js nor Python was found - opening index.html directly instead.
start "" "%~dp0index.html"
