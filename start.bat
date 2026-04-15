@echo off
REM ---- BudgetPlus launcher ----
REM Starts the local web server and opens the app in your default browser.
REM Keep this window open while using the app. Close it to stop the server.

cd /d "%~dp0app"

REM Open the app in the browser after a short delay so the server is ready
start "" cmd /c "timeout /t 2 >nul && start http://localhost:5174/"

echo ============================================
echo  BudgetPlus is starting on http://localhost:5174/
echo  Keep this window open while using the app.
echo  Close this window to stop the server.
echo ============================================
echo.

npx -p serve serve -l 5174

pause
