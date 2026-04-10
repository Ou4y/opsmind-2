# OpsMind Authentication Service - Production Setup Guide

## 🚀 Quick Setup (5 Minutes)

### Prerequisites
- Docker and Docker Compose installed
- MySQL running on `opsmind-net` network
- Email provider account (Gmail, SendGrid, etc.)

---

## 📧 Step 1: Choose Your Email Provider

### Option A: Gmail (Fastest - Recommended for Testing)

**Setup Time:** 5 minutes  
**Free Tier:** 500 emails/day

#### Steps:
1. **Enable 2-Factor Authentication**
   - Go to: https://myaccount.google.com/security
   - Enable 2-Step Verification

2. **Generate App Password**
   - Go to: https://myaccount.google.com/apppasswords
   - Select "Mail" and "Other (Custom name)"
   - Name it "OpsMind Auth Service"
   - Copy the 16-character password

3. **Use these settings:**
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=youremail@gmail.com
   SMTP_PASS=xxxx xxxx xxxx xxxx  # Your app password
   SMTP_FROM=youremail@gmail.com
   ```

---

### Option B: SendGrid (Recommended for Production)

**Setup Time:** 10 minutes  
**Free Tier:** 100 emails/day forever

#### Steps:
1. **Sign Up**
   - Go to: https://sendgrid.com
   - Create free account

2. **Verify Sender**
   - Settings → Sender Authentication
   - Choose "Single Sender Verification"
   - Verify your email address

3. **Create API Key**
   - Settings → API Keys → Create API Key
   - Name: "OpsMind Auth Service"
   - Permissions: "Restricted Access" → Enable "Mail Send" only
   - Copy the API key (starts with `SG.`)

4. **Use these settings:**
   ```env
   SMTP_HOST=smtp.sendgrid.net
   SMTP_PORT=587
   SMTP_USER=apikey
   SMTP_PASS=SG.your-actual-api-key-here
   SMTP_FROM=noreply@yourdomain.com  # Must be verified
   ```

   **Important:** The username is literally the word `apikey` (not your SendGrid username)

---

### Option C: AWS SES (Best for High Volume)

**Setup Time:** 30 minutes  
**Cost:** $0.10 per 1,000 emails (62,000 free/month from EC2)

See detailed setup in the [AWS SES Documentation](https://docs.aws.amazon.com/ses/)

---

## 🔐 Step 2: Generate JWT Secret

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copy the output - you'll need it in the next step.

---

## ⚙️ Step 3: Configure Environment

1. **Copy the production template:**
   ```bash
   cp .env.production .env
   ```

2. **Edit the configuration:**
   ```bash
   nano .env  # or use your preferred editor
   ```

3. **Update these critical values:**

   ```env
   # Server
   NODE_ENV=production
   
   # Database (if different from defaults)
   DB_HOST=mysql
   DB_PASSWORD=your-secure-password
   
   # JWT Secret (from Step 2)
   JWT_SECRET=your-generated-64-char-secret
   
   # SMTP Settings (from Step 1)
   SMTP_HOST=smtp.gmail.com  # or smtp.sendgrid.net
   SMTP_PORT=587
   SMTP_USER=your-email-or-apikey
   SMTP_PASS=your-app-password-or-api-key
   SMTP_FROM=your-verified-email
   ```

4. **Save and close**

---

## 🚀 Step 4: Deploy

```bash
# Build and start the service
docker-compose up -d --build

# Verify it's running
docker ps | grep opsmind-auth

# Check logs
docker logs -f opsmind-auth-service
```

---

## ✅ Step 5: Test Your Setup

### Test 1: Health Check
```bash
curl http://localhost:3002/health
```

Expected response:
```json
{"status":"ok","timestamp":"..."}
```

### Test 2: Swagger UI
Open in browser: http://localhost:3002/api-docs

### Test 3: User Signup (Test Email Delivery!)
```bash
curl -X POST http://localhost:3002/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Test",
    "lastName": "User",
    "email": "your-real-email@example.com",
    "password": "Password123!",
    "role": "STUDENT"
  }'
```

**Expected:**
- API returns success response
- You receive an OTP email within seconds
- Email contains 6-digit code

### Test 4: Verify OTP
```bash
curl -X POST http://localhost:3002/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-real-email@example.com",
    "otp": "123456",
    "purpose": "VERIFICATION"
  }'
```

---

## 🔍 Verification Checklist

After deployment, verify:

- [ ] Service is running: `docker ps | grep opsmind-auth`
- [ ] Health endpoint works: `curl http://localhost:3002/health`
- [ ] Swagger UI loads: http://localhost:3002/api-docs
- [ ] Signup endpoint works
- [ ] Email is received (check inbox AND spam folder)
- [ ] OTP verification works
- [ ] No errors in logs: `docker logs opsmind-auth-service | grep -i error`

---

## 🐛 Troubleshooting

### Issue: "Authentication failed" (SMTP)

**Causes:**
- Wrong username or password
- Gmail: Using regular password instead of app password
- SendGrid: Not using "apikey" as username

**Solution:**
```bash
# Check your SMTP configuration
docker exec opsmind-auth-service env | grep SMTP

# For Gmail:
# - Use app-specific password from https://myaccount.google.com/apppasswords
# - Make sure 2FA is enabled

# For SendGrid:
# - Username must be literally "apikey"
# - Password is your API key starting with "SG."
```

### Issue: Emails not arriving

**Check these:**
1. **Logs for errors:**
   ```bash
   docker logs opsmind-auth-service | grep -i "email\|smtp"
   ```

2. **Spam folder** - First emails often go to spam

3. **Sender verification** (SendGrid):
   - Make sure SMTP_FROM email is verified in SendGrid

4. **Rate limits:**
   - Gmail: 500 emails/day max
   - SendGrid free: 100 emails/day

### Issue: "getaddrinfo ENOTFOUND"

**Cause:** Wrong SMTP host or DNS issue

**Solution:**
```bash
# Test DNS resolution
nslookup smtp.gmail.com

# Check SMTP_HOST in config
docker exec opsmind-auth-service env | grep SMTP_HOST

# Verify spelling in .env file
cat .env | grep SMTP_HOST
```

### Issue: Connection timeout

**Cause:** Firewall blocking port 587

**Solution:**
```bash
# Test SMTP connection
telnet smtp.gmail.com 587
# Should connect successfully

# Try alternative ports:
# - Port 465 (SSL/TLS)
# - Port 2525 (alternative)

# Update in .env:
SMTP_PORT=465  # or 2525
```

### Issue: Service not starting

**Check logs:**
```bash
docker logs opsmind-auth-service

# Common issues:
# - Database connection failed
# - Missing environment variables
# - Invalid JWT secret
```

---

## 📊 Common Commands

```bash
# View logs (real-time)
docker logs -f opsmind-auth-service

# View last 50 lines
docker logs --tail 50 opsmind-auth-service

# Restart service
docker-compose restart

# Stop service
docker-compose down

# Rebuild after changes
docker-compose up -d --build

# Check environment variables
docker exec opsmind-auth-service env

# Access MySQL database
docker exec -it mysql mysql -u opsmind -popsmind authentication

# Check service status
docker ps | grep opsmind
```

---

## 🔒 Security Best Practices

### Production Checklist:

- [x] Strong JWT secret (64+ characters, randomly generated)
- [x] Secure database password (not default)
- [x] SMTP credentials configured correctly
- [x] `.env` file in `.gitignore` (already done)
- [ ] Enable HTTPS if publicly accessible
- [ ] Set up monitoring and alerting
- [ ] Configure rate limiting (already implemented)
- [ ] Regular backup strategy
- [ ] Log rotation configured (already done)

### Important Security Notes:

1. **Never commit `.env` file to git**
   - Already in `.gitignore` ✅
   - Contains sensitive credentials

2. **Rotate secrets regularly**
   - JWT secret every 90 days
   - SMTP passwords when team members leave

3. **Monitor for suspicious activity**
   - Failed login attempts
   - Unusual email sending patterns

4. **Keep dependencies updated**
   ```bash
   npm audit
   npm update
   ```

---

## 📈 Monitoring

### Check Service Health:
```bash
# Health endpoint
curl http://localhost:3002/health

# Container stats
docker stats opsmind-auth-service

# Recent logs
docker logs --tail 100 opsmind-auth-service
```

### Email Provider Dashboards:
- **Gmail:** Check sent mail folder
- **SendGrid:** https://app.sendgrid.com/stats
- **AWS SES:** CloudWatch metrics

### Key Metrics to Monitor:
- Email delivery rate
- Failed authentication attempts
- API response times
- Error rates
- Resource usage (CPU, memory)

---

## 📚 API Documentation

Once deployed, full API documentation is available at:

**Swagger UI:** http://localhost:3002/api-docs

### Available Endpoints:

#### Authentication (Public)
- `POST /auth/signup` - Register new user
- `POST /auth/login` - Initiate login (sends OTP)
- `POST /auth/verify-otp` - Verify OTP and get JWT token
- `POST /auth/resend-otp` - Resend OTP code

#### Admin (Requires JWT Token)
- `GET /admin/users` - List all users
- `GET /admin/users/:id` - Get user details
- `PATCH /admin/users/:id` - Update user
- `DELETE /admin/users/:id` - Delete user
- `POST /admin/technicians` - Create technician
- `GET /admin/technicians` - List technicians
- `GET /admin/buildings` - List buildings
- `POST /admin/buildings` - Create building

#### Health
- `GET /health` - Service health check

---

## 🆘 Getting Help

### If you're stuck:

1. **Check logs first:**
   ```bash
   docker logs opsmind-auth-service | grep -i error
   ```

2. **Verify configuration:**
   ```bash
   docker exec opsmind-auth-service env | grep -E "NODE_ENV|SMTP"
   ```

3. **Test email manually:**
   - Use an email testing tool
   - Send test email from your provider's dashboard

4. **Common issues:**
   - Wrong SMTP credentials → Double-check `.env` file
   - Port blocked → Try alternative ports (465, 2525)
   - Emails in spam → Normal for first sends, add SPF/DKIM records
   - Rate limited → Check provider dashboard

---

## 🎯 What's Next?

After successful deployment:

1. **Set up domain email** (optional but recommended)
   - Configure SPF, DKIM, DMARC records
   - Improves email deliverability
   - Reduces spam folder placement

2. **Enable HTTPS** (if publicly accessible)
   - Use Let's Encrypt certificates
   - Configure reverse proxy (nginx/traefik)

3. **Set up monitoring**
   - Application monitoring (Datadog, New Relic)
   - Error tracking (Sentry)
   - Uptime monitoring (UptimeRobot)

4. **Configure backups**
   - Database backups
   - Environment configuration backups

5. **Load testing**
   - Test with expected load
   - Verify rate limiting works
   - Check resource usage

---

## 📞 Support

For issues or questions:
- Check the troubleshooting section above
- Review logs: `docker logs opsmind-auth-service`
- Test with Swagger UI: http://localhost:3002/api-docs

---

## ✨ You're All Set!

Your OpsMind Authentication Service is now running in production with:
- ✅ Real email delivery
- ✅ Secure JWT authentication
- ✅ Role-based access control
- ✅ Comprehensive API documentation
- ✅ Production-grade logging and monitoring

**Happy coding!** 🚀
