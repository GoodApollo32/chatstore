@echo off
REM Checks how many of our products Icecat has specifications and photos for (needs ICECAT_USERNAME in the settings).
cd /d "%~dp0"
docker compose build app
docker compose run --rm app node dist/cli.js icecat
pause
