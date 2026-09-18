@echo off
cd /d "%~dp0"

echo Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Python was not found on this PC.
    echo Install it from https://www.python.org/downloads/ ^(check "Add Python to PATH" during setup^),
    echo then double-click this file again.
    echo.
    pause
    exit /b 1
)

echo Checking Flask...
python -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo Flask is not installed yet - installing it now, this only happens once...
    python -m pip install -r requirements.txt
)

echo Starting InstaRX server...
echo (a second window will open showing the address to share with colleagues)
start "InstaRX Server" cmd /k python server\app.py
timeout /t 2 /nobreak >nul
start "" http://localhost:5000
