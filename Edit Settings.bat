@echo off
REM Opens the settings file (.env) in Notepad, creating it from the template the first time.
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
notepad .env
