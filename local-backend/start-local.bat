@echo off
setlocal
cd /d "%~dp0"
title Sociale kaart Twente - lokale server
cls
echo ===============================================
echo   SOCIALE KAART TWENTE - LOKALE SERVER
echo ===============================================
echo.
echo Deze versie gebruikt standaard poort 8877.
echo Is die bezet, dan wordt automatisch een vrije poort gekozen.
echo Sluit dit venster om de lokale server te stoppen.
echo.
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 server.py
) else (
  python server.py
)
echo.
echo De server is gestopt of kon niet starten.
pause
