@echo off
REM Starts the product catalog and opens the search page.
cd /d "%~dp0"
if not exist .env (
  echo The settings file .env is missing. See the README, step "Enter your Ingram keys".
  pause
  exit /b 1
)
echo Starting the catalog (the first start takes a few minutes)...
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo Could not start. Is Docker Desktop running? Open it, wait for "Engine running", then try again.
  pause
  exit /b 1
)
timeout /t 5 /nobreak >nul
start "" http://localhost:8080
