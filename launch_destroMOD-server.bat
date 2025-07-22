@echo off

:: ============================================================================
:: PART 1: SELF-ELEVATE TO ADMINISTRATOR
:: ============================================================================
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Requesting administrative privileges...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)


:: ============================================================================
:: PART 2: DEFINE PORTABLE PATHS AND ENVIRONMENT
:: ============================================================================
:: Get the directory where this script is located (E:\...\destroMOD-server\)
SET "SERVER_DIR=%~dp0"

:: Set the game directory by going up two levels from the script's location.
:: This resolves to E:\SteamLibrary\steamapps\common\H1EMU\
SET "GAME_DIR=%~dp0..\.."

:: Temporarily override the APPDATA environment variable.
:: This forces the server to create a local "h1emu" save data folder.
SET "APPDATA=%SERVER_DIR%"


:: ============================================================================
:: PART 3: START THE SERVER & LAUNCH THE GAME
:: ============================================================================
:: Set the PATH to include the local Node.js
SET "PATH=%SERVER_DIR%node-v22.9.0-win-x64;%PATH%"

:: Change to the server directory and start the server in a new window
echo Starting destroMOD H1EMU Server...
echo Save data will be stored in: %APPDATA%h1emu\
cd /d "%SERVER_DIR%"
start "destroMOD Server" npm run start-2016

:: Wait for 10 seconds to give the server time to initialize
echo Waiting 10 seconds for server to initialize...
timeout /t 10 /nobreak

:: Launch the H1Z1 client, explicitly setting its working directory with /D
echo Launching H1Z1...
start "H1Z1" /D "%GAME_DIR%" "%GAME_DIR%\H1Z1.exe" sessionid={"sessionId":"0","gameVersion":2} gamecrashurl=https://h1emu.com/game-error?code=G server=localhost:1115

exit