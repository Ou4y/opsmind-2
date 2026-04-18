# OpsMind Unit Testing Guide

This document describes all unit tests that were added or updated across the backend services.

## Test Infrastructure Added

### Services with new Jest setup
- Services/inventory-backend
- Services/opsmind-authentication
- Services/opsmind-ticket-service
- Services/opsmind-workflow-service (fixed broken test config reference)

### Service with existing Jest setup extended
- Services/opsmind-sla-service

## How to Run Tests

Run from repository root:

```bash
cd Services/inventory-backend && npm test
cd ../opsmind-authentication && npm test
cd ../opsmind-ticket-service && npm test
cd ../opsmind-workflow-service && npm test
cd ../opsmind-sla-service && npm test
```

## Test Catalog (Every Test Explained)

## 1) Inventory Backend

### File: Services/inventory-backend/tests/assetEvents.test.ts

1. exposes the expected asset event routing keys
- Verifies the TOPICS constant contains all expected event keys and values.
- Protects against accidental renaming or deletion of routing keys that break event consumers.

### File: Services/inventory-backend/tests/eventBus.service.test.ts

1. connects to RabbitMQ and asserts topic exchange
- Mocks amqplib connection and channel creation.
- Verifies the service connects using RABBITMQ_URI and asserts the opsmind_events topic exchange.

2. publishes serialized payload when channel exists
- Injects a mocked channel and calls publish.
- Verifies payload is serialized and sent to the expected exchange/topic.

3. subscribes to topic and forwards parsed messages
- Mocks queue binding and consumption.
- Verifies consumed message body is parsed from JSON and passed to subscriber callback.

### File: Services/inventory-backend/tests/notification.service.test.ts

1. posts low-stock payload with internal auth header
- Mocks axios.post and calls notifyLowStock.
- Verifies URL, payload shape, and x-internal-secret header are correct.

2. does not throw when notification request fails
- Mocks axios.post rejection.
- Verifies notifyLowStock resolves without throwing (non-blocking notification behavior).

## 2) Authentication Service

### File: Services/opsmind-authentication/tests/jwt.util.test.ts

1. generates and verifies a token round-trip
- Creates token from payload and verifies it.
- Confirms userId, email, and roles are preserved after verification.

2. decodes token without verification
- Uses decodeToken on a valid token.
- Confirms the payload can be read without signature verification logic.

3. returns null for malformed token decode
- Passes malformed token string.
- Confirms decodeToken safely returns null.

### File: Services/opsmind-authentication/tests/otp.util.test.ts

1. generates numeric OTP with configured length
- Verifies generateOTP output is numeric and has configured length.

2. hashes and verifies OTP values
- Verifies hashOTP creates verifiable hash.
- Confirms verifyOTP succeeds for the correct OTP and fails for wrong OTP.

3. marks past expiry as expired and future expiry as not expired
- Verifies isOTPExpired works for future and past timestamps.

### File: Services/opsmind-authentication/tests/validation.util.test.ts

1. validates well-formed emails
- Confirms valid email format passes and invalid format fails.

2. extracts normalized email domain
- Confirms extractEmailDomain lowercases and trims domain.
- Confirms invalid input returns empty domain.

3. validates email against allowed domains case-insensitively
- Verifies allow-list check with case-insensitive domain comparison.
- Verifies false for missing or non-matching allowed domains.

4. returns password validation errors for weak password
- Verifies weak password produces expected rule-specific errors.

5. sanitizes DB user object to API shape
- Verifies sanitizeUser maps snake_case DB fields to API response shape.

## 3) Ticket Service

### File: Services/opsmind-ticket-service/tests/requestId.middleware.test.ts

1. reuses incoming x-request-id header when provided
- Confirms middleware keeps caller-provided correlation ID.

2. generates a UUID when header is missing
- Confirms middleware generates a valid UUID requestId and calls next.

### File: Services/opsmind-ticket-service/tests/ticket.schema.test.ts

1. accepts valid create payload
- Confirms createTicketSchema accepts a fully valid ticket request.

2. rejects create payload with invalid coordinates
- Confirms schema enforces latitude and longitude bounds.

3. accepts partial update payload
- Confirms updateTicketSchema supports partial updates for mutable fields.

4. requires escalation reason
- Confirms escalateTicketSchema enforces non-empty reason field.

### File: Services/opsmind-ticket-service/tests/ticketEnrichment.test.ts

1. returns null assigned_to_name when ticket is unassigned
- Confirms unassigned ticket does not call user lookup and returns assigned_to_name null.

2. enriches single ticket using fetched technician name
- Mocks fetchTechnicianName and confirms returned name is attached to ticket.

3. batch enriches tickets and maps known names
- Mocks fetchTechnicianNames map and confirms each ticket gets correct assigned_to_name.
- Confirms unknown or null assignments map to null.

4. returns empty array for empty batch
- Confirms empty input short-circuits without external lookup calls.

## 4) Workflow Service

### File: Services/opsmind-workflow-service/tests/geo.test.ts

1. returns zero for identical points
- Confirms haversine formula baseline behavior for same coordinates.

2. returns expected approximate distance between Riyadh and Jeddah
- Confirms practical distance range for a real-world city pair.
- Protects against formula/regression errors in route scoring logic.

### File: Services/opsmind-workflow-service/tests/validation.middleware.test.ts

1. calls next for valid request body
- Confirms middleware passes through valid Joi-validated payload.

2. returns 400 with joined Joi messages for invalid body
- Confirms middleware formats and returns validation errors with HTTP 400.

3. accepts body with at least one identity key
- Confirms claimTicketSchema accepts payload when userId is provided.

4. rejects body when both technician_id and userId are missing
- Confirms claimTicketSchema enforces at-least-one identity rule.

## 5) SLA Service

### File: Services/opsmind-sla-service/tests/sla.service.test.ts

1. returns SLA when ticket exists
- Mocks repository lookup success and confirms service returns SLA entity.

2. throws 404 when SLA does not exist
- Mocks repository miss and confirms service throws AppError with 404.

3. starts SLA timers for a new ticket and records the start event
- Mocks policy lookup, SLA creation, event logging, and publisher call.
- Verifies normalization/mapping of input fields.
- Verifies response/resolution due times and startup event publication.

### File: Services/opsmind-sla-service/tests/error.middleware.test.ts

1. returns AppError details and status code
- Confirms AppError is translated to structured JSON with original status and details.

2. returns generic 500 shape for unknown errors
- Confirms unknown errors are converted to safe 500 response payload.

### File: Services/opsmind-sla-service/tests/validate.middleware.test.ts

1. calls next when schema parsing succeeds
- Confirms request passes through when Zod schema validation succeeds.

2. forwards AppError with flatten details on Zod validation errors
- Confirms Zod errors are converted to AppError(400) with flattened details for consumers.

## Total Coverage Added

- Inventory Backend: 6 tests
- Authentication Service: 11 tests
- Ticket Service: 10 tests
- Workflow Service: 6 tests
- SLA Service: 7 tests
- Total: 40 unit tests
