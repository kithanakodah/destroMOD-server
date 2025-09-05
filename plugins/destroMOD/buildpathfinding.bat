@echo off
echo Building 64-bit Pathfinding Service...

REM Setup Visual Studio x64 environment (adjust path to your VS installation)
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
if %ERRORLEVEL% NEQ 0 (
    echo Visual Studio x64 environment setup failed! 
    echo Make sure Visual Studio is installed with C++ support
    pause
    exit /b 1
)

REM Set paths to your Detour libraries and includes
set DETOUR_INCLUDE=M:\H1_Tool_Projects\recastnavigation-main\Detour\Include
set DETOUR_LIB=M:\H1_Tool_Projects\recastnavigation-main\build

REM Compile with Visual Studio targeting x64 - HTTP server version
cl /std:c++17 ^
   /MD ^
   /EHsc ^
   /I"%DETOUR_INCLUDE%" ^
   /I"M:\H1_Tool_Projects\recastnavigation-main\DetourCrowd\Include" ^
   /DHAVE_64BIT_POLYREF ^
   /DT_POLYREF64=1 ^
   pathfinding-service.cpp ^
   /link ^
   "%DETOUR_LIB%\Detour\Release\Detour.lib" ^
   "%DETOUR_LIB%\DetourCrowd\Release\DetourCrowd.lib" ^
   ws2_32.lib ^
   /OUT:pathfinding-service.exe

if %ERRORLEVEL% EQU 0 (
    echo Build successful! Run pathfinding-service.exe
) else (
    echo Build failed!
)

pause