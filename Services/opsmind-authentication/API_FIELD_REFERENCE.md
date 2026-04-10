# 📋 API Field Reference Guide

This document clarifies the correct field names for all API endpoints in the OpsMind Authentication Service.

**Important:** All request/response bodies use **camelCase** field naming convention.

---

## 🔐 Authentication Endpoints

### POST /auth/signup

**Request Body (camelCase):**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@miuegypt.edu.eg",
  "password": "SecurePass123!",
  "role": "STUDENT"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Registration successful. Please check your email for verification OTP.",
  "data": {
    "user": {
      "id": "uuid",
      "email": "john.doe@miuegypt.edu.eg",
      "firstName": "John",
      "lastName": "Doe",
      "isVerified": false,
      "isActive": true,
      "roles": ["STUDENT"],
      "createdAt": "2026-02-08T19:00:00.000Z"
    },
    "requiresOTP": true
  }
}
```

---

### POST /auth/login

**Request Body (camelCase):**
```json
{
  "email": "john.doe@miuegypt.edu.eg",
  "password": "SecurePass123!"
}
```

---

### POST /auth/verify-otp

**Request Body (camelCase):**
```json
{
  "email": "john.doe@miuegypt.edu.eg",
  "otp": "123456",
  "purpose": "LOGIN"
}
```

**Response (LOGIN purpose):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "uuid",
      "email": "john.doe@miuegypt.edu.eg",
      "firstName": "John",
      "lastName": "Doe",
      "isVerified": true,
      "isActive": true,
      "roles": ["STUDENT"]
    }
  }
}
```

---

### POST /auth/resend-otp

**Request Body (camelCase):**
```json
{
  "email": "john.doe@miuegypt.edu.eg",
  "purpose": "VERIFICATION"
}
```

---

## 👨‍💼 Admin Endpoints (Require ADMIN role + JWT token)

### POST /admin/users (NEW!)

**Purpose:** Create a user with any role (ADMIN, TECHNICIAN, DOCTOR, STUDENT)

**Request Body (camelCase):**
```json
{
  "firstName": "Ahmed",
  "lastName": "Hassan",
  "email": "ahmed.hassan@miuegypt.edu.eg",
  "password": "SecurePass123!",
  "role": "DOCTOR",
  "isVerified": true,
  "isActive": true
}
```

**Field Details:**
- `firstName` (required): 2-100 characters
- `lastName` (required): 2-100 characters
- `email` (required): Valid email format
- `password` (required): Min 8 chars, must contain uppercase, lowercase, number, special char
- `role` (required): One of: `ADMIN`, `TECHNICIAN`, `DOCTOR`, `STUDENT`
- `isVerified` (optional): Boolean, defaults to `true` (admin-created users are pre-verified)
- `isActive` (optional): Boolean, defaults to `true`

**Response:**
```json
{
  "success": true,
  "message": "User created successfully",
  "data": {
    "id": "uuid",
    "email": "ahmed.hassan@miuegypt.edu.eg",
    "firstName": "Ahmed",
    "lastName": "Hassan",
    "isVerified": true,
    "isActive": true,
    "roles": ["DOCTOR"],
    "createdAt": "2026-02-08T23:58:00.000Z"
  }
}
```

---

### POST /admin/technicians

**Purpose:** Create a technician with additional profile info and building assignments

**Request Body (camelCase):**
```json
{
  "firstName": "Mohamed",
  "lastName": "Ali",
  "email": "tech@miuegypt.edu.eg",
  "password": "TechPass123!",
  "employeeId": "EMP001",
  "department": "IT Support",
  "specialization": "Network Infrastructure",
  "buildingIds": ["550e8400-e29b-41d4-a716-446655440000"]
}
```

**Field Details:**
- `firstName` (required): 2-100 characters
- `lastName` (required): 2-100 characters
- `email` (required): Valid email format
- `password` (required): Min 8 chars with complexity requirements
- `employeeId` (optional): Max 50 characters
- `department` (optional): Max 100 characters
- `specialization` (optional): Max 255 characters
- `buildingIds` (optional): Array of building UUIDs (first one becomes primary)

**Response:**
```json
{
  "success": true,
  "message": "Technician created successfully",
  "data": {
    "id": "uuid",
    "userId": "uuid",
    "email": "tech@miuegypt.edu.eg",
    "firstName": "Mohamed",
    "lastName": "Ali",
    "employeeId": "EMP001",
    "department": "IT Support",
    "specialization": "Network Infrastructure",
    "buildings": [
      {
        "id": "uuid",
        "name": "Main Building",
        "code": "MAIN",
        "isPrimary": true
      }
    ],
    "isActive": true,
    "createdAt": "2026-02-08T23:58:00.000Z"
  }
}
```

---

### GET /admin/users

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "email": "user@miuegypt.edu.eg",
      "firstName": "John",
      "lastName": "Doe",
      "isVerified": true,
      "isActive": true,
      "roles": ["STUDENT"],
      "createdAt": "2026-02-08T19:00:00.000Z"
    }
  ]
}
```

---

### GET /admin/technicians

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "userId": "uuid",
      "email": "tech@miuegypt.edu.eg",
      "firstName": "Mohamed",
      "lastName": "Ali",
      "employeeId": "EMP001",
      "department": "IT Support",
      "specialization": "Network Infrastructure",
      "buildings": [...],
      "isActive": true,
      "createdAt": "2026-02-08T23:58:00.000Z"
    }
  ]
}
```

---

### PATCH /admin/users/:id/status

**Request Body (camelCase):**
```json
{
  "isActive": false
}
```

**Response:**
```json
{
  "success": true,
  "message": "User status updated successfully",
  "data": {
    "id": "uuid",
    "email": "user@miuegypt.edu.eg",
    "firstName": "John",
    "lastName": "Doe",
    "isVerified": true,
    "isActive": false,
    "roles": ["STUDENT"]
  }
}
```

---

### POST /admin/buildings

**Request Body (camelCase):**
```json
{
  "name": "Medical Building",
  "code": "MED",
  "address": "South Wing"
}
```

---

### GET /admin/buildings

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Main Building",
      "code": "MAIN",
      "address": "Central Campus",
      "createdAt": "2026-02-08T19:00:00.000Z"
    }
  ]
}
```

---

## 📊 Database Schema vs API Mapping

### Users Table
| Database Column | API Field (Request) | API Field (Response) |
|----------------|-------------------|---------------------|
| `id` | N/A (auto-generated) | `id` |
| `email` | `email` | `email` |
| `password_hash` | `password` | N/A (never returned) |
| `first_name` | `firstName` | `firstName` |
| `last_name` | `lastName` | `lastName` |
| `is_verified` | `isVerified` | `isVerified` |
| `is_active` | `isActive` | `isActive` |
| `created_at` | N/A | `createdAt` |
| `updated_at` | N/A | `updatedAt` |

### Technicians Table
| Database Column | API Field (Request) | API Field (Response) |
|----------------|-------------------|---------------------|
| `id` | N/A (auto-generated) | `id` |
| `user_id` | N/A (auto-linked) | `userId` |
| `employee_id` | `employeeId` | `employeeId` |
| `department` | `department` | `department` |
| `specialization` | `specialization` | `specialization` |
| `created_at` | N/A | `createdAt` |
| `updated_at` | N/A | `updatedAt` |

---

## 🔑 Key Conventions

1. **All API fields use camelCase**: `firstName`, `lastName`, `isActive`, `employeeId`
2. **All database columns use snake_case**: `first_name`, `last_name`, `is_active`, `employee_id`
3. **Password fields**: 
   - Request: `password` (plain text)
   - Database: `password_hash` (bcrypt hashed)
   - Response: Never included
4. **Timestamps**:
   - Database: `created_at`, `updated_at` (snake_case)
   - API: `createdAt`, `updatedAt` (camelCase)
5. **Boolean fields**:
   - Database: `0` or `1` (TINYINT)
   - API: `true` or `false` (boolean)

---

## 🎯 Quick Examples

### Create an Admin User
```bash
curl -X POST http://localhost:3002/admin/users \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Super",
    "lastName": "Admin",
    "email": "admin@miuegypt.edu.eg",
    "password": "AdminPass123!",
    "role": "ADMIN",
    "isVerified": true,
    "isActive": true
  }'
```

### Create a Doctor
```bash
curl -X POST http://localhost:3002/admin/users \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Dr. Sarah",
    "lastName": "Ahmed",
    "email": "sarah.ahmed@miuegypt.edu.eg",
    "password": "DoctorPass123!",
    "role": "DOCTOR",
    "isVerified": true
  }'
```

### Create a Technician (with buildings)
```bash
curl -X POST http://localhost:3002/admin/technicians \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Tech",
    "lastName": "Support",
    "email": "tech@miuegypt.edu.eg",
    "password": "TechPass123!",
    "employeeId": "EMP001",
    "department": "IT",
    "buildingIds": ["building-uuid-1", "building-uuid-2"]
  }'
```

---

## 🆘 Common Mistakes

❌ **Wrong:** Using snake_case in API requests
```json
{
  "first_name": "John",  // WRONG!
  "last_name": "Doe"     // WRONG!
}
```

✅ **Correct:** Use camelCase
```json
{
  "firstName": "John",   // CORRECT!
  "lastName": "Doe"      // CORRECT!
}
```

❌ **Wrong:** Using `userId` in create user request
```json
{
  "userId": "123",       // WRONG! Auto-generated
  "email": "user@example.com"
}
```

✅ **Correct:** Don't include `id` or `userId` in creation requests
```json
{
  "email": "user@example.com",  // CORRECT!
  "firstName": "John"
}
```

---

## 📖 Additional Resources

- **Swagger UI**: http://localhost:3002/api-docs
- **Setup Guide**: [SETUP_GUIDE.md](./SETUP_GUIDE.md)
- **README**: [README.md](./README.md)

---

**Last Updated:** February 8, 2026
