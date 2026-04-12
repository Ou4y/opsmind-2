@echo off
REM Stop all OpsMind services

echo Stopping all OpsMind services...
echo.

cd opsmind-infrastructure
docker-compose down
cd ..

cd Services\opsmind-authentication
docker-compose down
cd ..\..

cd Services\opsmind-ticket-service
docker-compose down
cd ..\..

cd Services\opsmind-workflow-service
docker-compose down
cd ..\..

cd Services\notification-service
docker-compose -f docker-compose.services.yml down
cd ..\..

echo.
echo All services stopped!
pause
