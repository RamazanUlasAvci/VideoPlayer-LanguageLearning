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
  echo Bagimliliklar npmjs.org uzerinden kuruluyor...
  call npm install --registry=https://registry.npmjs.org/
  if errorlevel 1 (
    echo Kurulum basarisiz oldu.
    pause
    exit /b 1
  )
)

call npm start
if errorlevel 1 pause
