@echo off
REM Stops the product catalog. Your data is kept.
cd /d "%~dp0"
docker compose stop
echo Catalog stopped. Your data is kept for next time.
pause
