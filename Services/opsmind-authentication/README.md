# OpsMind Authentication Service

> Production-ready authentication microservice with JWT tokens, OTP verification, and role-based access control.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

---

## 🎯 Features

- ✅ **Email + Password Authentication** with OTP verification
- ✅ **JWT Token Authentication** with role-based access control
- ✅ **Role Management** (Admin, Technician, Doctor, Student)
- ✅ **Email Verification** via OTP (6-digit codes)
- ✅ **Two-Factor Login** (password + OTP)
- ✅ **Domain Restriction** (configurable email domain)
- ✅ **Password Validation** (strength requirements)
- ✅ **Rate Limiting** (prevent abuse)
- ✅ **Swagger Documentation** (interactive API docs)
- ✅ **Health Check Endpoint** (monitoring)
- ✅ **Production-Ready** (Docker, logging, error handling)

---

## 🚀 Quick Start

### Prerequisites

- Docker and Docker Compose
- MySQL database (running on `opsmind-net` network)
- Email provider account (Gmail, SendGrid, etc.)
- Node.js 20+ (for local development)

### 1. Clone and Setup

\`\`\`bash
git clone <repository-url>
cd opsmind-authentication
\`\`\`

### 2. Configure Environment

\`\`\`bash
# Copy production template
cp .env.production .env

# Edit configuration
nano .env
\`\`\`

Update these values:
- \`JWT_SECRET\` - Generate with: \`node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"\`
- \`SMTP_*\` - Your email provider credentials (see [SMTP_SETUP_GUIDE.md](./SMTP_SETUP_GUIDE.md))
- \`DB_PASSWORD\` - Secure database password

### 3. Deploy

\`\`\`bash
# Start the service
docker-compose up -d --build

# Check logs
docker logs -f opsmind-auth-service
\`\`\`

### 4. Test

**Swagger UI:** http://localhost:3002/api-docs

Or test with cURL:
\`\`\`bash
curl -X POST http://localhost:3002/auth/signup \\
  -H "Content-Type: application/json" \\
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@miuegypt.edu.eg",
    "password": "SecurePassword123!",
    "role": "STUDENT"
  }'
\`\`\`

Check your email for the OTP code!

---

## 📚 Documentation

- **[SETUP_GUIDE.md](./SETUP_GUIDE.md)** - Complete setup guide with SMTP configuration
- **[SMTP_SETUP_GUIDE.md](./SMTP_SETUP_GUIDE.md)** - Email provider comparison and setup
- **[API Documentation](http://localhost:3002/api-docs)** - Interactive Swagger UI (after deployment)

---

## 🔐 API Endpoints

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | \`/auth/signup\` | Register new user (sends OTP) |
| POST | \`/auth/login\` | Initiate login (sends OTP) |
| POST | \`/auth/verify-otp\` | Verify OTP and get JWT token |
| POST | \`/auth/resend-otp\` | Resend OTP code |
| GET | \`/health\` | Service health check |

### Protected Endpoints (Require JWT)

| Method | Endpoint | Description | Roles |
|--------|----------|-------------|-------|
| GET | \`/admin/users\` | List all users | Admin |
| GET | \`/admin/users/:id\` | Get user details | Admin |
| PATCH | \`/admin/users/:id\` | Update user | Admin |
| DELETE | \`/admin/users/:id\` | Delete user | Admin |
| POST | \`/admin/technicians\` | Create technician | Admin |
| GET | \`/admin/technicians\` | List technicians | Admin |
| GET | \`/admin/buildings\` | List buildings | Admin |
| POST | \`/admin/buildings\` | Create building | Admin |

**Full API documentation:** http://localhost:3002/api-docs

---

## 📧 Email Providers

### Recommended Options:

| Provider | Free Tier | Best For | Setup |
|----------|-----------|----------|-------|
| **Gmail** | 500/day | Testing, small scale | [Guide](./SMTP_SETUP_GUIDE.md#option-1-gmail) |
| **SendGrid** | 100/day | Production | [Guide](./SMTP_SETUP_GUIDE.md#option-2-sendgrid) |
| **AWS SES** | 62k/month* | High volume | [Guide](./SMTP_SETUP_GUIDE.md#option-3-aws-ses) |

\* When sending from EC2

See [SMTP_SETUP_GUIDE.md](./SMTP_SETUP_GUIDE.md) for detailed setup instructions.

---

## 🔧 Common Commands

\`\`\`bash
# Start service
docker-compose up -d --build

# View logs
docker logs -f opsmind-auth-service

# Stop service
docker-compose down

# Restart
docker-compose restart

# Check health
curl http://localhost:3002/health

# Generate JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
\`\`\`

---

## 🐛 Troubleshooting

### Emails not sending?
\`\`\`bash
# Check logs
docker logs opsmind-auth-service | grep -i smtp

# Verify configuration
docker exec opsmind-auth-service env | grep SMTP
\`\`\`

For Gmail: Use app-specific password  
For SendGrid: Username must be "apikey"

See [SETUP_GUIDE.md](./SETUP_GUIDE.md#troubleshooting) for detailed troubleshooting.

---

## 🔒 Security

- ✅ Strong password requirements
- ✅ JWT authentication
- ✅ Rate limiting (100 req/15min)
- ✅ OTP expiry (5 minutes)
- ✅ Input validation
- ✅ SQL injection prevention

**Important:** Always use strong JWT secret and secure SMTP credentials!

---

## 📁 Project Structure

\`\`\`
src/
├── server.ts              # Main entry
├── config/                # Configuration
├── database/              # DB layer
├── modules/               # Features (auth, admin)
├── services/              # External services
├── middlewares/           # Express middlewares
└── utils/                 # Utilities
\`\`\`

---

## 🆘 Support

- Check [SETUP_GUIDE.md](./SETUP_GUIDE.md) for detailed instructions
- Review [SMTP_SETUP_GUIDE.md](./SMTP_SETUP_GUIDE.md) for email setup
- Use Swagger UI: http://localhost:3002/api-docs

---

**Made with ❤️ for OpsMind ITSM**///
