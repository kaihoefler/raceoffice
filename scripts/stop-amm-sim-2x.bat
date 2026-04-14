 @echo off
setlocal ENABLEEXTENSIONS

REM ------------------------------------------------------------
REM Stoppt Prozesse aus der 2x AMB-Simulation.
REM
REM Standard:
REM   - stoppt nur Simulatoren
REM Optional:
REM   - mit --with-converters werden zusaetzlich ammc-amb Prozesse beendet
REM ------------------------------------------------------------

set "STOP_CONVERTERS=0"
if /I "%~1"=="--with-converters" set "STOP_CONVERTERS=1"
if /I "%~1"=="/with-converters" set "STOP_CONVERTERS=1"

echo [INFO] Stoppe Windows-Simulator-Prozesse (ammc-sim.exe) ...
taskkill /IM ammc-sim.exe /F >nul 2>nul

if "%STOP_CONVERTERS%"=="1" (
  echo [INFO] Stoppe zusaetzlich Converter-Prozesse (ammc-amb.exe) ...
  taskkill /IM ammc-amb.exe /F >nul 2>nul
)

echo [INFO] Stoppe WSL-Simulator-Prozesse (ammc-sim) ...
where wsl >nul 2>nul
if errorlevel 1 (
  echo [WARN] WSL nicht gefunden - ueberspringe WSL Stop.
) else (
  wsl -e sh -lc "pkill -f ammc-sim || true" >nul 2>nul
)

echo [FERTIG] Prozesse gestoppt.
if "%STOP_CONVERTERS%"=="1" (
  echo [INFO] Modus: inkl. Converter
) else (
  echo [INFO] Modus: nur Simulatoren
)
echo.
echo Beispiele:
echo   stop-amm-sim-2x.bat
echo   stop-amm-sim-2x.bat --with-converters
echo.
pause

