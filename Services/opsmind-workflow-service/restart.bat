@echo off
REM Quick restart without rebuild

echo Restarting Workflow Service...
docker-compose restart

echo.
echo Done! Check logs with: docker-compose logs -f
pause
