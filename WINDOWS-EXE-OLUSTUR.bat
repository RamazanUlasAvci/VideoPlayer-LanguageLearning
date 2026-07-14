@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi. Once https://nodejs.org adresinden Node.js LTS kur.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Bagimliliklar kuruluyor...
  call npm install
  if errorlevel 1 (
    echo Kurulum basarisiz oldu.
    pause
    exit /b 1
  )
)

call npm run dist:win
if errorlevel 1 (
  echo EXE olusturma basarisiz oldu.
  pause
  exit /b 1
)

echo Tamamlandi. Ciktilar dist klasorunde.
pause
