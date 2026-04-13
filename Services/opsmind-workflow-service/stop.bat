@echo off
REM Stop the service

echo Stopping Workflow Service...
docker-compose down

echo.
echo Service stopped!
pause
