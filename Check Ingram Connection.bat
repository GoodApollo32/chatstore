@echo off
REM Checks the Ingram connection with the keys in .env and shows what came back.
cd /d "%~dp0"
docker compose build app
docker compose run --rm --no-deps app node dist/cli.js smoke
pause
