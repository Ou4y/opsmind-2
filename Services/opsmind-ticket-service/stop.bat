@echo off
REM Stop the service

echo Stopping Ticket Service...
docker-compose down

echo.
echo Service stopped!
pause
