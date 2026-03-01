@echo off
echo ========================================
echo    Smart Intercom System Launcher
echo ========================================
echo.
echo Starting Backend Server...
start cmd /k "cd backend && npm start"
timeout /t 3 /nobreak > nul
echo.
echo Starting Frontend Server...
start cmd /k "cd frontend && npm run dev"
echo.
echo Both servers are starting...
echo.
echo Backend: http://192.168.100.9:3000
echo Frontend: http://192.168.100.9:5173
echo.
echo Press any key to close this window...
pause > nul