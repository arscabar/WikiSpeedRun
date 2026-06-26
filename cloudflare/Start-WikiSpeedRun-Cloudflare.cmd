@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "APP_EXE="
for %%F in ("WikiSpeedRun-*-portable.exe") do set "APP_EXE=%%~fF"

if not defined APP_EXE (
  echo [WikiSpeedRun] portable EXE not found in this folder.
  echo Put WikiSpeedRun-*-portable.exe next to this script.
  pause
  exit /b 1
)

if not exist "%~dp0cloudflared.exe" (
  echo [Cloudflare] cloudflared.exe not found in this folder.
  echo Put cloudflared.exe next to this script.
  pause
  exit /b 1
)

echo [WikiSpeedRun] Starting app...
start "WikiSpeedRun" "%APP_EXE%"

echo [WikiSpeedRun] Waiting for local server at http://127.0.0.1:3002 ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(45); do { try { $r=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3002/api/health' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } } catch {} Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); exit 1"

if errorlevel 1 (
  echo [WikiSpeedRun] Local server did not become ready.
  echo Close any existing WikiSpeedRun process and try again.
  pause
  exit /b 1
)

echo.
echo [Cloudflare] Starting temporary public tunnel.
echo [Cloudflare] Copy the trycloudflare.com URL shown below and share it.
echo [Cloudflare] Close this window or press Ctrl+C to stop sharing.
echo.
cloudflared.exe tunnel --url http://127.0.0.1:3002

echo.
echo [Cloudflare] Tunnel stopped.
pause
