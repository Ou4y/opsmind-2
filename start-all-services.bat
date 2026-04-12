@echo off
REM Start all OpsMind services in development mode

echo ================================================
echo Starting OpsMind Platform (Development Mode)
echo ================================================
echo.

echo Step 1: Starting Infrastructure...
cd opsmind-infrastructure
docker-compose up -d
cd ..

echo.
echo Step 2: Starting Authentication Service...
cd Services\opsmind-authentication
if not exist .env (copy .env.example .env)
docker-compose up -d --build
cd ..\..

echo.
echo Step 3: Starting Ticket Service...
cd Services\opsmind-ticket-service
if not exist .env (copy .env.dev .env)
docker-compose up -d --build
cd ..\..

echo.
echo Step 4: Starting Workflow Service...
cd Services\opsmind-workflow-service
if not exist .env (copy .env.dev .env)
docker-compose up -d --build
cd ..\..

echo.
echo Step 5: Starting Notification Service...
cd Services\notification-service
docker-compose -f docker-compose.services.yml up -d --build
cd ..\..

echo.
echo ================================================
echo All Services Started!
echo ================================================
echo.
echo Service URLs:
echo - Auth Service:         http://localhost:3002
echo - Ticket Service:       http://localhost:3001
echo - Workflow Service:     http://localhost:3003
echo - Infrastructure:
echo   - MySQL:              localhost:3306
echo   - RabbitMQ:           localhost:5672
echo   - RabbitMQ Admin:     http://localhost:15672
echo   - phpMyAdmin:         http://localhost:8080
echo.
echo View all logs: docker ps
echo Stop all:      docker-compose down (in each folder)
echo.
pause
