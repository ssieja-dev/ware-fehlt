@echo off
chcp 65001 >nul

set CSV=C:\Users\Administrator\Documents\PITUPITA\lagerbestand.csv
set SERVER=http://srv1405845.hstgr.cloud:3000/api/lagerbestand/upload

if not exist "%CSV%" (
  echo [FEHLER] Datei nicht gefunden: %CSV%
  exit /b 1
)

curl -s -X POST --data-binary "@%CSV%" -H "Content-Type: text/csv; charset=utf-8" "%SERVER%" -o nul -w "%%{http_code}" > %TEMP%\upload_status.txt 2>&1
set /p STATUS=<%TEMP%\upload_status.txt

if "%STATUS%"=="200" (
  echo [OK] Lagerbestand erfolgreich hochgeladen.
) else (
  echo [FEHLER] Upload fehlgeschlagen (HTTP %STATUS%)
  exit /b 1
)
