# External API Reference - OpsMind Authentication Service

This document provides comprehensive information for documenting the Authentication Service endpoints in the External APIs table.

## Base Configuration

- **Service Name:** OpsMind Authentication Service
- **Base URL (Production):** `http://localhost:3002` (Update with actual production URL)
- **Base URL (Development):** `http://localhost:3002`
- **Authentication:** JWT Bearer Token (except public authentication endpoints)
- **API Documentation:** `http://localhost:3002/api-docs` (Swagger UI)

---

## 📋 External APIs Table Information

### 1. User Signup (Registration)

| Field | Value |
|-------|-------|
| **API Name** | User Registration |
| **Endpoint** | `/auth/signup` |
| **Method** | POST |
| **Description** | Register a new user account (Doctor or Student roles). Sends OTP verification email. |
| **Request Format** | JSON |
| **Response Format** | JSON |
| **Authentication** | None (Public endpoint) |
| **Rate Limit** | 5 requests per 15 minutes |
| **Request Body** | `{ "email": "string", "password": "string", "firstName": "string", "lastName": "string", "role": "DOCTOR\|STUDENT" }` |
| **Success Response** | `{ "success": true, "message": "User registered successfully. Please verify your email with the OTP sent.", "data": { "userId": "uuid" } }` |
| **Error Codes** | 400 (Validation error/User exists), 429 (Too many requests) |
| **Notes** | Email must be from allowed domain (@miuegypt.edu.eg). Password must contain uppercase, lowercase, number, and special character. |

---

### 2. User Login

| Field | Value |
|-------|-------|
| **API Name** | User Login |
| **Endpoint** | `/auth/login` |
| **Method** | POST |
| **Description** | Authenticate user with email and password. Sends OTP to email for 2FA verification. |
| **Request Format** | JSON |
| **Response Format** | JSON |
| **Authentication** | None (Public endpoint) |
| **Rate Limit** | 10 requests per 15 minutes |
| **Request Body** | `{ "email": "string", "password": "string" }` |
| **Success Response** | `{ "success": true, "message": "OTP sent to your email", "data": { "userId": "uuid" } }` |
| **Error Codes** | 401 (Invalid credentials), 403 (Account not verified/inactive), 429 (Too many requests) |
| **Notes** | Requires account to be verified and active. OTP expires in 10 minutes. |

---

### 3. Verify OTP

| Field | Value |
|-------|-------|
| **API Name** | OTP Verification |
| **Endpoint** | `/auth/verify-otp` |
| **Method** | POST |
| **Description** | Verify OTP for email verification or login completion. Returns JWT token for login. |
| **Request Format** | JSON |
| **Response Format** | JSON |
| **Authentication** | None (Public endpoint) |
| **Rate Limit** | 10 requests per 15 minutes |
| **Request Body** | `{ "email": "string", "otp": "string", "purpose": "VERIFICATION\|LOGIN" }` |
| **Success Response (LOGIN)** | `{ "success": true, "message": "OTP verified successfully", "data": { "token": "jwt-string", "user": { user-object } } }` |
| **Success Response (VERIFICATION)** | `{ "success": true, "message": "Email verified successfully", "data": { "user": { user-object } } }` |
| **Error Codes** | 400 (Invalid/Expired OTP), 401 (Verification failed) |
| **Notes** | For LOGIN purpose, returns JWT token in Authorization header format: `Bearer {token}`. User object includes id, email, firstName, lastName, roles array. |

---

### 4. Resend OTP

| Field | Value |
|-------|-------|
| **API Name** | Resend OTP |
| **Endpoint** | `/auth/resend-otp` |
| **Method** | POST |
| **Description** | Resend OTP code to user's email for verification or login. |
| **Request Format** | JSON |
| **Response Format** | JSON |
| **Authentication** | None (Public endpoint) |
| **Rate Limit** | 3 requests per 15 minutes |
| **Request Body** | `{ "email": "string", "purpose": "VERIFICATION\|LOGIN" }` |
| **Success Response** | `{ "success": true, "message": "OTP resent successfully" }` |
| **Error Codes** | 400 (Validation failed), 429 (Too many OTP requests) |
| **Notes** | Strict rate limiting to prevent OTP abuse. Previous OTP is invalidated when new one is sent. |

---

### 5. Get All Users (Admin)

| Field | Value |
|-------|-------|
| **API Name** | List All Users |
| **Endpoint** | `/admin/users` |
| **Method** | GET |
| **Description** | Retrieve list of all registered users in the system. |
| **Request Format** | None |
| **Response Format** | JSON |
| **Authentication** | JWT Bearer Token (ADMIN role required) |
| **Rate Limit** | None |
| **Request Body** | None |
| **Success Response** | `{ "success": true, "data": [ { user-object } ] }` |
| **Error Codes** | 401 (Unauthorized - Invalid/Missing token), 403 (Forbidden - ADMIN role required) |
| **Notes** | Requires valid JWT token with ADMIN role. Returns array of user objects with roles populated. |

---

### 6. Create User (Admin)

| Field | Value |
|-------|-------|
| **API Name** | Create User (Admin) |
| **Endpoint** | `/admin/users` |
| **Method** | POST |
| **Description** | Admin endpoint to create user with any role. Bypasses OTP verification. |
| **Request Format** | JSON |
| **Response Format** | JSON |
| **Authentication** | JWT Bearer Token (ADMIN role required) |
| **Rate Limit** | None |
| **Request Body** | `{ "email": "string", "password": "string", "firstName": "string", "lastName": "string", "role": "ADMIN\|TECHNICIAN\|DOCTOR\|STUDENT", "isVerified": boolean, "isActive": boolean }` |
| **Success Response** | `{ "success": true, "message": "User created successfully", "data": { "id": "uuid", "email": "string", "firstName": "string", "lastName": "string", "isVerified": boolean, "isActive": boolean, "roles": ["string"], "createdAt": "datetime" } }` |
| **Error Codes** | 400 (Validation error/User exists), 401 (Unauthorized), 403 (Forbidden - ADMIN required) |
| **Notes** | isVerified and isActive default to true. Password automatically hashed. Can create users with any role including ADMIN. |

---

### 7. Get All Technicians (Admin)

| Field | Value |
|-------|-------|
| **API Name** | List All Technicians |
| **Endpoint** | `/admin/technicians` |
| **Method** | GET |
| **Description** | Retrieve list of all technician users with their assignments. |
| **Request Format** | None |
| **Response Format** | JSON |
| **Authentication** | JWT Bearer Token (ADMIN role required) |
| **Rate Limit** | None |
| **Request Body** | None |
| **Success Response** | `{ "success": true, "data": [ { technician-object-with-buildings } ] }` |
| **Error Codes** | 401 (Unauthorized), 403 (Forbidden - ADMIN required) |
| **Notes** | Returns technician-specific data including employeeId, department, specialization, and assigned buildings. |

---

### 8. Create Technician (Admin)

| Field | Value |
|-------|-------|
| **API Name** | Create Technician |
| **Endpoint** | `/admin/technicians` |
| **Method** | POST |
| **Description** | Create new technician user with additional technician-specific fields. |
| **Request Format** | JSON |
| **Response Format** | JSON |
| **Authentication** | JWT Bearer Token (ADMIN role required) |
| **Rate Limit** | None |
| **Request Body** | `{ "email": "string", "password": "string", "firstName": "string", "lastName": "string", "employeeId": "string" (optional), "department": "string" (optional), "specialization": "string" (optional), "buildingIds": ["uuid"] (optional) }` |
| **Success Response** | `{ "success": true, "message": "Technician created successfully", "technician": { technician-object } }` |
| **Error Codes** | 400 (Validation error/Duplicate employeeId), 401 (Unauthorized), 403 (Forbidden - ADMIN required) |
| **Notes** | Creates user with TECHNICIAN role. Can assign multiple buildings; first building becomes primary. Email automatically verified. |

---

### 9. Update User Status (Admin)

| Field | Value |
|-------|-------|
| **API Name** | Update User Status |
| **Endpoint** | `/admin/users/{id}/status` |
| **Method** | PATCH |
| **Description** | Activate or deactivate user account. |
| **Request Format** | JSON |
| **Response Format** | JSON |
| **Authentication** | JWT Bearer Token (ADMIN role required) |
| **Rate Limit** | None |
| **Request Body** | `{ "isActive": boolean }` |
| **Success Response** | `{ "success": true, "message": "User status updated successfully", "user": { user-object } }` |
| **Error Codes** | 400 (Validation error/Cannot deactivate admin), 401 (Unauthorized), 403 (Forbidden), 404 (User not found) |
| **Notes** | Cannot deactivate ADMIN users. Deactivated users cannot login. URL parameter {id} must be valid UUID. |

---

### 10. Delete User (Admin)

| Field | Value |
|-------|-------|
| **API Name** | Delete User |
| **Endpoint** | `/admin/users/{id}` |
| **Method** | DELETE |
| **Description** | Permanently delete a user and all associated data from the system. |
| **Request Format** | None |
| **Response Format** | JSON |
| **Authentication** | JWT Bearer Token (ADMIN role required) |
| **Rate Limit** | None |
| **Request Body** | None |
| **Success Response** | `{ "success": true, "message": "User deleted successfully" }` |
| **Error Codes** | 400 (Cannot delete admin users), 401 (Unauthorized), 403 (Forbidden - ADMIN required), 404 (User not found) |
| **Notes** | Permanently deletes user and cascades to delete OTPs, roles, technician profile, and building assignments. Cannot delete ADMIN users for safety. URL parameter {id} must be valid UUID. |

---

### 11. Get All Buildings (Admin)

| Field | Value |
|-------|-------|
| **API Name** | List All Buildings |
| **Endpoint** | `/admin/buildings` |
| **Method** | GET |
| **Description** | Retrieve list of all campus buildings. |
| **Request Format** | None |
| **Response Format** | JSON |
| **Authentication** | JWT Bearer Token (ADMIN role required) |
| **Rate Limit** | None |
| **Request Body** | None |
| **Success Response** | `{ "success": true, "data": [ { "id": "uuid", "name": "string", "code": "string", "address": "string", "createdAt": "datetime", "updatedAt": "datetime" } ] }` |
| **Error Codes** | 401 (Unauthorized), 403 (Forbidden - ADMIN required) |
| **Notes** | Used for technician assignment and location tracking. |

---

### 12. Create Building (Admin)

| Field | Value |
|-------|-------|
| **API Name** | Create Building |
| **Endpoint** | `/admin/buildings` |
| **Method** | POST |
| **Description** | Create new campus building in the system. |
| **Request Format** | JSON |
| **Response Format** | JSON |
| **Authentication** | JWT Bearer Token (ADMIN role required) |
| **Rate Limit** | None |
| **Request Body** | `{ "name": "string", "code": "string", "address": "string" (optional) }` |
| **Success Response** | `{ "success": true, "message": "Building created successfully", "data": { building-object } }` |
| **Error Codes** | 400 (Validation error/Duplicate code), 401 (Unauthorized), 403 (Forbidden - ADMIN required) |
| **Notes** | Building code must be unique. Code length: 1-20 characters. Name is required. |

---

## 🔐 Authentication Details

### Public Endpoints (No Authentication Required)
- `POST /auth/signup`
- `POST /auth/login`
- `POST /auth/verify-otp`
- `POST /auth/resend-otp`

### Protected Endpoints (JWT Required)
All `/admin/*` endpoints require:
1. Valid JWT token in Authorization header: `Bearer {token}`
2. ADMIN role assigned to the user
3. Active account status (is_active = true)

### JWT Token Details
- **Header Format:** `Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
- **Expiration:** 24 hours (configurable via JWT_EXPIRES_IN env variable)
- **Claims Include:** userId, email, roles
- **Algorithm:** HS256 (HMAC with SHA-256)

---

## 📊 Common Response Formats

### Success Response Structure
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { /* response data */ }
}
```

### Error Response Structure
```json
{
  "success": false,
  "message": "Error description",
  "errors": [ /* optional validation errors array */ ]
}
```

### User Object Structure
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@miuegypt.edu.eg",
  "firstName": "John",
  "lastName": "Doe",
  "isVerified": true,
  "isActive": true,
  "roles": ["STUDENT"],
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

---

## 🔒 Security Features

1. **Rate Limiting:** All endpoints have rate limiting to prevent abuse
2. **OTP Expiration:** OTPs expire after 10 minutes
3. **Password Requirements:** Minimum 8 characters with uppercase, lowercase, number, and special character
4. **Domain Restriction:** Only emails from allowed domain (@miuegypt.edu.eg) can register
5. **JWT Expiration:** Tokens automatically expire after 24 hours
6. **Role-Based Access Control:** Admin endpoints protected by role middleware
7. **Password Hashing:** All passwords hashed using bcrypt with 10 salt rounds

---

## 📝 Environment Variables

Required configuration for production:
```
PORT=3002
NODE_ENV=production
DATABASE_URL=postgresql://username:password@host:5432/database
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=24h
ALLOWED_EMAIL_DOMAIN=miuegypt.edu.eg
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
EMAIL_FROM=your-email@gmail.com
```

---

## 🧪 Testing Examples

### Example 1: Complete User Registration Flow
```bash
# Step 1: Signup
curl -X POST http://localhost:3002/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "student@miuegypt.edu.eg",
    "password": "Student123!",
    "firstName": "Ahmed",
    "lastName": "Hassan",
    "role": "STUDENT"
  }'

# Step 2: Verify Email (check email for OTP)
curl -X POST http://localhost:3002/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "student@miuegypt.edu.eg",
    "otp": "123456",
    "purpose": "VERIFICATION"
  }'

# Step 3: Login
curl -X POST http://localhost:3002/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "student@miuegypt.edu.eg",
    "password": "Student123!"
  }'

# Step 4: Verify Login OTP
curl -X POST http://localhost:3002/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "student@miuegypt.edu.eg",
    "otp": "654321",
    "purpose": "LOGIN"
  }'
```

### Example 2: Admin Creates User
```bash
# Create user with DOCTOR role
curl -X POST http://localhost:3002/admin/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -d '{
    "email": "doctor@miuegypt.edu.eg",
    "password": "Doctor123!",
    "firstName": "Sara",
    "lastName": "Ali",
    "role": "DOCTOR",
    "isVerified": true,
    "isActive": true
  }'
```

### Example 3: Admin Creates Technician with Building Assignment
```bash
curl -X POST http://localhost:3002/admin/technicians \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN" \
  -d '{
    "email": "tech@miuegypt.edu.eg",
    "password": "Tech123!",
    "firstName": "Mohamed",
    "lastName": "Ashraf",
    "employeeId": "EMP001",
    "department": "IT Support",
    "specialization": "Network Infrastructure",
    "buildingIds": ["550e8400-e29b-41d4-a716-446655440000"]
  }'
```

### Example 4: Admin Deletes User
```bash
# Delete user by ID
curl -X DELETE http://localhost:3002/admin/users/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer YOUR_ADMIN_JWT_TOKEN"

# Response:
# {
#   "success": true,
#   "message": "User deleted successfully"
# }
```

---

## 📈 API Status Codes Summary

| Status Code | Meaning | Usage |
|-------------|---------|-------|
| 200 | OK | Successful GET, PATCH requests |
| 201 | Created | Successful POST requests (resource created) |
| 400 | Bad Request | Validation errors, duplicate entries |
| 401 | Unauthorized | Missing or invalid JWT token |
| 403 | Forbidden | Insufficient permissions (role required) |
| 404 | Not Found | Resource doesn't exist |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server-side errors |

---

## 🔄 API Versioning

Current Version: **v1.0.0**
- All endpoints are currently unversioned
- Future versions will use URL versioning: `/api/v2/...`

---

## 📞 Support Information

- **API Documentation:** http://localhost:3002/api-docs
- **Contact:** mohamedashrafahmed102@gmail.com
- **Repository:** OpsMind Authentication Service
- **Issues:** Report via project management system

---

## 🚀 Quick Integration Guide

### 1. For Frontend Developers
```javascript
// Base API configuration
const API_BASE_URL = 'http://localhost:3002';
const headers = {
  'Content-Type': 'application/json'
};

// Example: User login flow
async function loginUser(email, password) {
  // Step 1: Login to get OTP
  const loginResponse = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password })
  });
  
  // Step 2: User enters OTP from email
  const otp = prompt('Enter OTP from email:');
  
  // Step 3: Verify OTP to get JWT token
  const verifyResponse = await fetch(`${API_BASE_URL}/auth/verify-otp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, otp, purpose: 'LOGIN' })
  });
  
  const { data } = await verifyResponse.json();
  
  // Store JWT token
  localStorage.setItem('authToken', data.token);
  
  return data.user;
}

// Example: Authenticated request
async function getUsers() {
  const token = localStorage.getItem('authToken');
  
  const response = await fetch(`${API_BASE_URL}/admin/users`, {
    headers: {
      ...headers,
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
}
```

### 2. For Mobile App Developers
- Store JWT token securely (e.g., Keychain/Keystore)
- Implement automatic token refresh before expiration
- Handle 401 responses by redirecting to login
- Implement OTP input with 6-digit verification code format

### 3. For Third-Party Integrations
- Contact admin to receive API credentials
- ADMIN accounts can create users programmatically
- Use POST /admin/users for automated user provisioning
- Implement proper error handling for all endpoints

---

## 📅 Last Updated
**Date:** January 2024
**Version:** 1.0.0
**Maintained By:** OpsMind Development Team
