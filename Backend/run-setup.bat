@echo off
REM Splendor AI Backend Setup - Double-click to run
cd /d "c:/Users/USER/Desktop/Splendor AI/Backend"

echo Installing dependencies...
npm install express dotenv cors helmet morgan express-rate-limit pg bcryptjs jsonwebtoken uuid winston winston-daily-rotate-file bullmq ioredis @sendgrid/mail twilio

echo.
echo Setup complete. Next:
echo 1. Install Postgres, create DB, set DATABASE_URL in .env
echo 2. Install Redis, set REDIS_URL in .env
echo 3. Fill API keys from .env.example
echo 4. Run DB schemas: psql -U user -d dbname -f schema-splendor.sql
echo                          psql -U user -d dbname -f schema-newsletter.sql
echo 5. Run: npm run dev
echo 6. Test: curl -X GET http://localhost:5000/health
pause

