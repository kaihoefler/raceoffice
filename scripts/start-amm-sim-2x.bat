@echo off
setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION

REM ------------------------------------------------------------
REM Startet eine 2-Decoder-Simulation (AMB) fuer RaceOffice.
REM
REM Wichtiger Hinweis:
REM - Zwei AMB-Simulatoren koennen NICHT beide im gleichen Windows-
REM   Netzwerk-Stack laufen (Port 5403 Konflikt).
REM - Daher:
REM   1) SIM #1 laeuft nativ unter Windows
REM   2) SIM #2 laeuft in WSL (separater Netzwerk-Namespace)
REM
REM Dieses Script startet nur die Simulatoren (keine Converter-Instanzen).
REM ------------------------------------------------------------

set "ROOT=%~dp0.."
set "SIM_WIN=%ROOT%\tools\ammc\windows64\ammc-sim.exe"
set "ROOT_WIN=%ROOT%"

if not exist "%SIM_WIN%" (
  echo [FEHLER] Windows Simulator nicht gefunden: %SIM_WIN%
  exit /b 1
)

where wsl >nul 2>nul
if errorlevel 1 (
  echo [FEHLER] WSL ist nicht verfuegbar. Zwei AMB-Simulatoren parallel sind lokal nicht moeglich.
  echo         Bitte WSL installieren oder den zweiten Simulator auf einem zweiten Rechner starten.
  exit /b 1
)

for /f "delims=" %%i in ('wsl wslpath -a "%ROOT_WIN%"') do set "ROOT_WSL=%%i"
if "%ROOT_WSL%"=="" (
  echo [FEHLER] Konnte Projektpfad nicht nach WSL konvertieren.
  exit /b 1
)
set "SIM_WSL=%ROOT_WSL%/tools/ammc/linux_x86-64/ammc-sim"

for /f "tokens=1" %%i in ('wsl -e sh -lc "hostname -I | awk '{print $1}'"') do set "WSL_IP=%%i"
if "%WSL_IP%"=="" (
  echo [FEHLER] Konnte WSL-IP nicht bestimmen.
  exit /b 1
)

echo [INFO] WSL-IP: %WSL_IP%
echo [INFO] Starte SIM #1 (Windows, 127.0.0.1:5403)
start "AMM SIM #1 (Windows)" cmd /k ""%SIM_WIN%" AMB --decoder-id AAAAA1 --transponder 10001,10002 --passing-numbers 1-999999 --passing-delay 300-900 --startup_delay_secs 1 --skip_telemetry_upload"

echo [INFO] Starte SIM #2 (WSL, %WSL_IP%:5403)
start "AMM SIM #2 (WSL)" cmd /k "wsl -e sh -lc 'chmod +x %SIM_WSL% 2>/dev/null; %SIM_WSL% AMB --decoder-id BBBBB2 --transponder 20001,20002 --passing-numbers 1-999999 --passing-delay 350-950 --startup_delay_secs 1 --skip_telemetry_upload'"

echo.
echo [FERTIG] 2x AMB-Simulation gestartet (nur Simulatoren).
echo          SIM #1: Windows (127.0.0.1:5403)
echo          SIM #2: WSL (%WSL_IP%:5403)
echo.
echo [STOP] Alle gestarteten Prozesse beenden:
echo        taskkill /IM ammc-sim.exe /F
echo        wsl -e sh -lc "pkill -f ammc-sim"

echo.
pause
