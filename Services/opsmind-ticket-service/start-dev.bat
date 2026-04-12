@echo off
REM Ticket Service - Development Mode Startup Script

echo ========================================
echo Starting Ticket Service (Development)
echo ========================================
echo.

REM Copy dev environment
if not exist .env (
    echo Creating .env from .env.dev...
    copy .env.dev .env
) else (
    echo .env already exists
)

echo.
echo Starting infrastructure (MySQL + RabbitMQ)...
cd ..\..\opsmind-infrastructure
docker-compose up -d

echo.
echo Building and starting Ticket Service...
cd ..\Services\opsmind-ticket-service

REM Rebuild and start
docker-compose up --build

pause
