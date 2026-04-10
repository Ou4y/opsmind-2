# UML Class Documentation
## OpsMind Authentication System - Complete Class Structure

This document provides a comprehensive overview of all classes, their attributes, and methods with access modifiers for UML diagram creation.

---

## 1. CONTROLLERS

### 1.1 AdminController
**File:** `src/modules/admin/admin.controller.ts`

**Purpose:** Handles HTTP requests for admin operations

| Method | Access | Return Type | Parameters | Description |
|--------|--------|-------------|------------|-------------|
| createUser | public | Promise<void> | req: Request, res: Response | Creates a new user with any role |
| createTechnician | public | Promise<void> | req: Request, res: Response | Creates a new technician user |
| updateUserStatus | public | Promise<void> | req: Request, res: Response | Updates user active status |
| getAllUsers | public | Promise<void> | req: Request, res: Response | Retrieves all users |
| getAllTechnicians | public | Promise<void> | req: Request, res: Response | Retrieves all technicians |
| getAllBuildings | public | Promise<void> | req: Request, res: Response | Retrieves all buildings |
| createBuilding | public | Promise<void> | req: Request, res: Response | Creates a new building |
| deleteUser | public | Promise<void> | req: Request, res: Response | Deletes a user by ID |

**Attributes:** None (Singleton pattern instance exported)

---

### 1.2 AuthController
**File:** `src/modules/auth/auth.controller.ts`

**Purpose:** Handles HTTP requests for authentication operations

| Method | Access | Return Type | Parameters | Description |
|--------|--------|-------------|------------|-------------|
| signup | public | Promise<void> | req: Request, res: Response | Registers a new user (DOCTOR/STUDENT) |
| login | public | Promise<void> | req: Request, res: Response | Authenticates user and sends OTP |
| verifyOTP | public | Promise<void> | req: Request, res: Response | Verifies OTP and completes authentication |
| resendOTP | public | Promise<void> | req: Request, res: Response | Resends OTP to user email |

**Attributes:** None (Singleton pattern instance exported)

---

## 2. SERVICES

### 2.1 AdminService
**File:** `src/modules/admin/admin.service.ts`

**Purpose:** Business logic for admin operations

| Method | Access | Return Type | Parameters | Description |
|--------|--------|-------------|------------|-------------|
| createUser | public | Promise<{success: boolean, message: string, user?: any}> | data: CreateUserDTO | Creates user with specified role |
| createTechnician | public | Promise<{success: boolean, message: string, technician?: any}> | data: CreateTechnicianDTO | Creates technician with profile |
| updateUserStatus | public | Promise<{success: boolean, message: string, user?: UserResponse}> | userId: string, isActive: boolean | Updates user active status |
| getAllUsers | public | Promise<UserResponse[]> | none | Returns all users with roles |
| getAllTechnicians | public | Promise<any[]> | none | Returns all technicians with buildings |
| getAllBuildings | public | Promise<any[]> | none | Returns all buildings |
| createBuilding | public | Promise<{success: boolean, message: string, building?: any}> | data: {name: string, code: string, address?: string} | Creates a new building |
| deleteUser | public | Promise<{success: boolean, message: string}> | userId: string | Deletes user and related data |

**Attributes:** None (Singleton pattern instance exported)

---

### 2.2 AuthService
**File:** `src/modules/auth/auth.service.ts`

**Purpose:** Business logic for authentication operations

| Method | Access | Return Type | Parameters | Description |
|--------|--------|-------------|------------|-------------|
| signup | public | Promise<AuthResponse> | data: SignupDTO | Registers new DOCTOR/STUDENT user |
| login | public | Promise<AuthResponse> | data: LoginDTO | Authenticates user credentials |
| verifyOTP | public | Promise<AuthResponse> | data: VerifyOTPDTO | Verifies OTP and generates JWT |
| resendOTP | public | Promise<AuthResponse> | email: string, purpose: 'VERIFICATION' \| 'LOGIN' | Resends OTP to email |

**Attributes:** None (Singleton pattern instance exported)

---

### 2.3 OTPService
**File:** `src/modules/otp/otp.service.ts`

**Purpose:** Handles OTP generation, verification, and management

| Method | Access | Return Type | Parameters | Description |
|--------|--------|-------------|------------|-------------|
| generateAndSendOTP | public | Promise<boolean> | userId: string, email: string, purpose: OTPPurpose | Generates OTP and sends via email |
| verifyOTP | public | Promise<{valid: boolean, userId?: string, error?: string}> | email: string, otp: string, purpose: OTPPurpose | Verifies OTP code |
| cleanupExpiredOTPs | public | Promise<void> | none | Removes expired OTP records |

**Attributes:** None (Singleton pattern instance exported)

---

### 2.4 EmailService
**File:** `src/services/email.service.ts`

**Purpose:** Handles email sending functionality

| Method | Access | Return Type | Parameters | Description |
|--------|--------|-------------|------------|-------------|
| sendEmail | public | Promise<boolean> | options: EmailOptions | Sends generic email |
| sendOTPEmail | public | Promise<boolean> | email: string, otp: string, purpose: 'VERIFICATION' \| 'LOGIN' | Sends OTP email with template |

**Attributes:**
| Attribute | Access | Type | Description |
|-----------|--------|------|-------------|
| transporter | private | nodemailer.Transporter | Email transporter instance |

---

## 3. REPOSITORIES

### 3.1 UserRepository
**File:** `src/modules/users/user.repository.ts`

**Purpose:** Database operations for user entity

| Method | Access | Return Type | Parameters | Description |
|--------|--------|-------------|------------|-------------|
| findById | public | Promise<User \| null> | id: string | Finds user by ID |
| findByEmail | public | Promise<User \| null> | email: string | Finds user by email |
| findByIdWithRoles | public | Promise<UserWithRoles \| null> | id: string | Finds user with roles by ID |
| findByEmailWithRoles | public | Promise<UserWithRoles \| null> | email: string | Finds user with roles by email |
| create | public | Promise<User> | data: {email, passwordHash, firstName, lastName, isVerified?, isActive?} | Creates new user |
| updateVerificationStatus | public | Promise<void> | userId: string, isVerified: boolean | Updates verification status |
| updateActiveStatus | public | Promise<void> | userId: string, isActive: boolean | Updates active status |
| assignRole | public | Promise<void> | userId: string, roleName: RoleName | Assigns role to user |
| getUserRoles | public | Promise<Role[]> | userId: string | Gets user's roles |
| hasRole | public | Promise<boolean> | userId: string, roleName: RoleName | Checks if user has role |
| findAll | public | Promise<UserWithRoles[]> | options?: {isActive?: boolean} | Finds all users with filters |
| delete | public | Promise<void> | userId: string | Deletes user and related data |

**Attributes:** None (Singleton pattern instance exported)

---

### 3.2 TechnicianRepository
**File:** `src/modules/admin/admin.repository.ts`

**Purpose:** Database operations for technician entity

| Method | Access | Return Type | Parameters | Description |
|--------|--------|-------------|------------|-------------|
| create | public | Promise<Technician> | data: {userId, employeeId?, department?, specialization?} | Creates technician profile |
| findById | public | Promise<Technician \| null> | id: string | Finds technician by ID |
| findByUserId | public | Promise<Technician \| null> | userId: string | Finds technician by user ID |
| findByEmployeeId | public | Promise<Technician \| null> | employeeId: string | Finds technician by employee ID |
| assignBuilding | public | Promise<void> | technicianId: string, buildingId: string, isPrimary: boolean | Assigns building to technician |
| getTechnicianBuildings | public | Promise<Building[]> | technicianId: string | Gets technician's buildings |
| findAll | public | Promise<any[]> | none | Finds all technicians with user data |

**Attributes:** None (Singleton pattern instance exported)

---

### 3.3 BuildingRepository
**File:** `src/modules/admin/admin.repository.ts`

**Purpose:** Database operations for building entity

| Method | Access | Return Type | Parameters | Description |
|--------|--------|-------------|------------|-------------|
| findById | public | Promise<Building \| null> | id: string | Finds building by ID |
| findByCode | public | Promise<Building \| null> | code: string | Finds building by code |
| findAll | public | Promise<Building[]> | none | Finds all buildings |
| create | public | Promise<Building> | data: {name, code, address?} | Creates new building |

**Attributes:** None (Singleton pattern instance exported)

---

### 3.4 OTPRepository
**File:** `src/modules/otp/otp.repository.ts`

**Purpose:** Database operations for OTP entity

| Method | Access | Return Type | Parameters | Description |
|--------|--------|-------------|------------|-------------|
| create | public | Promise<{otp: string, record: EmailOTP}> | userId: string, purpose: OTPPurpose | Creates new OTP |
| findById | public | Promise<EmailOTP \| null> | id: string | Finds OTP by ID |
| findLatestValid | public | Promise<EmailOTP \| null> | userId: string, purpose: OTPPurpose | Finds latest valid OTP |
| markAsUsed | public | Promise<void> | id: string | Marks OTP as used |
| invalidateExisting | public | Promise<void> | userId: string, purpose: OTPPurpose | Invalidates existing OTPs |
| cleanupExpired | public | Promise<number> | none | Removes expired OTPs |

**Attributes:** None (Singleton pattern instance exported)

---

## 4. UTILITY CLASSES

### 4.1 JWT Utilities
**File:** `src/utils/jwt.util.ts`

**Purpose:** JWT token operations

| Function | Access | Return Type | Parameters | Description |
|----------|--------|-------------|------------|-------------|
| generateToken | public | string | payload: AuthTokenPayload | Generates JWT token |
| verifyToken | public | AuthTokenPayload | token: string | Verifies and decodes JWT |
| decodeToken | public | AuthTokenPayload \| null | token: string | Decodes JWT without verification |

**Note:** These are standalone functions, not a class.

---

### 4.2 OTP Utilities
**File:** `src/utils/otp.util.ts`

**Purpose:** OTP generation and validation utilities

| Function | Access | Return Type | Parameters | Description |
|----------|--------|-------------|------------|-------------|
| generateOTP | public | string | none | Generates random OTP |
| hashOTP | public | Promise<string> | otp: string | Hashes OTP for storage |
| verifyOTP | public | Promise<boolean> | otp: string, hash: string | Verifies OTP against hash |
| getOTPExpiryDate | public | Date | none | Calculates OTP expiry date |
| isOTPExpired | public | boolean | expiryDate: Date | Checks if OTP is expired |

**Note:** These are standalone functions, not a class.

---

### 4.3 Validation Utilities
**File:** `src/utils/validation.util.ts`

**Purpose:** Input validation utilities

| Function | Access | Return Type | Parameters | Description |
|----------|--------|-------------|------------|-------------|
| validateEmail | public | boolean | email: string | Validates email format |
| validateOrganizationEmail | public | boolean | email: string | Validates organization domain |
| validatePassword | public | {valid: boolean, errors: string[]} | password: string | Validates password strength |
| sanitizeUser | public | object | user: any | Sanitizes user object for response |

**Note:** These are standalone functions, not a class.

---

## 5. DATA TRANSFER OBJECTS (DTOs) & INTERFACES

### 5.1 User Related

#### User
**File:** `src/types/index.ts`

| Attribute | Type | Description |
|-----------|------|-------------|
| id | string | User unique identifier (UUID) |
| email | string | User email address |
| password_hash | string | Hashed password |
| first_name | string | User's first name |
| last_name | string | User's last name |
| is_verified | boolean | Email verification status |
| is_active | boolean | Account active status |
| created_at | Date | Creation timestamp |
| updated_at | Date | Last update timestamp |

#### UserWithRoles (extends User)
| Attribute | Type | Description |
|-----------|------|-------------|
| roles | Role[] | Array of user roles |

#### UserResponse
| Attribute | Type | Description |
|-----------|------|-------------|
| id | string | User ID |
| email | string | User email |
| firstName | string | First name |
| lastName | string | Last name |
| isVerified | boolean | Verification status |
| isActive | boolean | Active status |
| roles | string[] | Role names |
| createdAt | Date | Creation date |

#### CreateUserDTO
| Attribute | Type | Description |
|-----------|------|-------------|
| email | string | User email |
| password | string | Plain text password |
| firstName | string | First name |
| lastName | string | Last name |
| role | RoleName | Role to assign |

---

### 5.2 Role Related

#### Role
**File:** `src/types/index.ts`

| Attribute | Type | Description |
|-----------|------|-------------|
| id | string | Role unique identifier |
| name | RoleName | Role name enum |
| description | string? | Role description |
| created_at | Date | Creation timestamp |
| updated_at | Date | Last update timestamp |

#### RoleName (Type)
- ADMIN
- TECHNICIAN
- DOCTOR
- STUDENT

#### UserRole
| Attribute | Type | Description |
|-----------|------|-------------|
| id | string | Assignment ID |
| user_id | string | User ID |
| role_id | string | Role ID |
| created_at | Date | Assignment date |

---

### 5.3 OTP Related

#### EmailOTP
**File:** `src/types/index.ts`

| Attribute | Type | Description |
|-----------|------|-------------|
| id | string | OTP record ID |
| user_id | string | Associated user ID |
| otp_hash | string | Hashed OTP code |
| purpose | OTPPurpose | OTP purpose (VERIFICATION/LOGIN) |
| expires_at | Date | Expiry timestamp |
| is_used | boolean | Used flag |
| created_at | Date | Creation timestamp |

#### OTPPurpose (Type)
- VERIFICATION
- LOGIN

---

### 5.4 Technician Related

#### Technician
**File:** `src/types/index.ts`

| Attribute | Type | Description |
|-----------|------|-------------|
| id | string | Technician ID |
| user_id | string | Associated user ID |
| employee_id | string? | Employee identifier |
| department | string? | Department name |
| specialization | string? | Technical specialization |
| created_at | Date | Creation timestamp |
| updated_at | Date | Last update timestamp |

#### CreateTechnicianDTO
| Attribute | Type | Description |
|-----------|------|-------------|
| email | string | User email |
| password | string | Plain text password |
| firstName | string | First name |
| lastName | string | Last name |
| employeeId | string? | Employee ID |
| department | string? | Department |
| specialization | string? | Specialization |
| buildingIds | string[]? | Building assignments |

---

### 5.5 Building Related

#### Building
**File:** `src/types/index.ts`

| Attribute | Type | Description |
|-----------|------|-------------|
| id | string | Building ID |
| name | string | Building name |
| code | string | Building code |
| address | string? | Building address |
| created_at | Date | Creation timestamp |
| updated_at | Date | Last update timestamp |

#### TechnicianBuilding
| Attribute | Type | Description |
|-----------|------|-------------|
| id | string | Assignment ID |
| technician_id | string | Technician ID |
| building_id | string | Building ID |
| is_primary | boolean | Primary building flag |
| created_at | Date | Assignment date |

---

### 5.6 Authentication Related

#### SignupDTO
**File:** `src/types/index.ts`

| Attribute | Type | Description |
|-----------|------|-------------|
| email | string | User email |
| password | string | Plain text password |
| firstName | string | First name |
| lastName | string | Last name |
| role | 'DOCTOR' \| 'STUDENT' | Self-signup role |

#### LoginDTO
| Attribute | Type | Description |
|-----------|------|-------------|
| email | string | User email |
| password | string | Plain text password |

#### VerifyOTPDTO
| Attribute | Type | Description |
|-----------|------|-------------|
| email | string | User email |
| otp | string | OTP code |
| purpose | OTPPurpose | OTP purpose |

#### AuthTokenPayload
| Attribute | Type | Description |
|-----------|------|-------------|
| userId | string | User ID |
| email | string | User email |
| roles | string[] | User roles |

#### AuthResponse
| Attribute | Type | Description |
|-----------|------|-------------|
| message | string | Response message |
| user | UserResponse? | User data |
| token | string? | JWT token |
| requiresOTP | boolean? | OTP required flag |

---

## 6. CLASS RELATIONSHIPS

### Inheritance
- `UserWithRoles` extends `User`

### Associations

#### AdminController
- Uses: `AdminService`

#### AuthController
- Uses: `AuthService`

#### AdminService
- Uses: `UserRepository`, `TechnicianRepository`, `BuildingRepository`, `OTPService`
- Returns: `UserResponse`, `CreateUserDTO`, `CreateTechnicianDTO`

#### AuthService
- Uses: `UserRepository`, `OTPService`
- Returns: `AuthResponse`, `SignupDTO`, `LoginDTO`, `VerifyOTPDTO`

#### OTPService
- Uses: `OTPRepository`, `UserRepository`, `EmailService`
- Returns: `EmailOTP`, `OTPPurpose`

#### UserRepository
- Returns: `User`, `UserWithRoles`, `Role`

#### TechnicianRepository
- Returns: `Technician`, `Building`

#### BuildingRepository
- Returns: `Building`

#### OTPRepository
- Returns: `EmailOTP`

---

## 7. MIDDLEWARE (For Completeness)

### authMiddleware
**File:** `src/middlewares/auth.middleware.ts`

**Purpose:** JWT authentication middleware

**Note:** Middleware functions are typically not represented as classes in UML but as components or modules.

### roleMiddleware
**File:** `src/middlewares/role.middleware.ts`

**Purpose:** Role-based authorization middleware

---

## 8. ACCESS MODIFIER SUMMARY

### Public Members
- All Controller methods are **public** (HTTP endpoints)
- All Service methods are **public** (business logic API)
- All Repository methods are **public** (data access API)
- All Utility functions are **public**

### Private Members
- EmailService transporter instance is **private**
- Database connection details (not exposed as class members)

### Protected Members
- None in current implementation (no inheritance hierarchy)

---

## NOTES FOR UML DIAGRAM CREATION

1. **Stereotypes to Use:**
   - `<<Controller>>` for controllers
   - `<<Service>>` for services
   - `<<Repository>>` for repositories
   - `<<DTO>>` or `<<Interface>>` for data transfer objects
   - `<<Utility>>` for utility classes/functions

2. **Package Structure:**
   - controllers
   - services
   - repositories
   - types (DTOs/Interfaces)
   - utils

3. **Cardinality:**
   - Controller -> Service: 1 to 1
   - Service -> Repository: 1 to many
   - User -> Role: many to many (through UserRole)
   - Technician -> Building: many to many (through TechnicianBuilding)
   - User -> OTP: 1 to many

4. **Method Visibility:**
   - Use `+` for public methods (all methods in this system)
   - Use `-` for private members (transporter in EmailService)

5. **Return Types:**
   - Most methods return Promise types (async operations)
   - DTOs are interfaces/types (no methods)

---

## ADDITIONAL ENTITIES (Database Tables)

For a complete data model, include these tables that map to the interfaces:

1. **users** → User interface
2. **roles** → Role interface
3. **user_roles** → UserRole interface (junction table)
4. **technicians** → Technician interface
5. **buildings** → Building interface
6. **technician_buildings** → TechnicianBuilding interface (junction table)
7. **email_otps** → EmailOTP interface

---

**Document Version:** 1.0  
**Last Updated:** February 9, 2026  
**System:** OpsMind Authentication Microservice
