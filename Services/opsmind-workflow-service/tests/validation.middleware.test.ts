import Joi from "joi";
import {
  claimTicketSchema,
  createRelationshipSchema,
  escalateTicketSchema,
  patchTechnicianLocationSchema,
  routeTicketSchema,
  syncTechnicianFromAuthSchema,
  validateBody,
} from "../src/middlewares/validation";

describe("validateBody middleware", () => {
  it("calls next for valid request body", () => {
    const schema = Joi.object({ id: Joi.number().required() });
    const middleware = validateBody(schema);
    const req = { body: { id: 1 } } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 400 with joined Joi messages for invalid body", () => {
    const schema = Joi.object({
      id: Joi.number().required(),
      name: Joi.string().required(),
    });
    const middleware = validateBody(schema);
    const req = { body: {} } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const next = jest.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining("Validation failed:"),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe("claimTicketSchema", () => {
  it("accepts body with at least one identity key", () => {
    const result = claimTicketSchema.validate({ userId: 10 });

    expect(result.error).toBeUndefined();
  });

  it("rejects body when both technician_id and userId are missing", () => {
    const result = claimTicketSchema.validate({});

    expect(result.error).toBeDefined();
  });
});

describe("syncTechnicianFromAuthSchema", () => {
  it("accepts TECHNICIAN role with workflow-compatible technician level", () => {
    const result = syncTechnicianFromAuthSchema.validate({
      authUserId: "550e8400-e29b-41d4-a716-446655440000",
      firstName: "Jane",
      lastName: "Doe",
      email: "jane.doe@example.com",
      authRole: "TECHNICIAN",
      technicianLevel: "SENIOR",
    });

    expect(result.error).toBeUndefined();
  });

  it("rejects TECHNICIAN role when technicianLevel is missing", () => {
    const result = syncTechnicianFromAuthSchema.validate({
      authUserId: "550e8400-e29b-41d4-a716-446655440000",
      firstName: "Jane",
      lastName: "Doe",
      email: "jane.doe@example.com",
      authRole: "TECHNICIAN",
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain("technicianLevel is required");
  });

  it("rejects role-level conflict for ADMIN with non-ADMIN technicianLevel", () => {
    const result = syncTechnicianFromAuthSchema.validate({
      authUserId: "550e8400-e29b-41d4-a716-446655440000",
      firstName: "Alice",
      lastName: "Admin",
      email: "alice.admin@example.com",
      authRole: "ADMIN",
      technicianLevel: "SENIOR",
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain("ADMIN role can only use ADMIN technicianLevel");
  });
});

describe("routeTicketSchema", () => {
  it("accepts ticketId without coordinates", () => {
    const result = routeTicketSchema.validate({ ticketId: "T-100" });

    expect(result.error).toBeUndefined();
  });

  it("accepts ticketId with valid coordinates", () => {
    const result = routeTicketSchema.validate({
      ticketId: "T-101",
      latitude: 30.1,
      longitude: 31.2,
      priority: "HIGH",
    });

    expect(result.error).toBeUndefined();
  });

  it("rejects invalid latitude when provided", () => {
    const result = routeTicketSchema.validate({
      ticketId: "T-102",
      latitude: 120,
    });

    expect(result.error).toBeDefined();
  });
});

describe("patchTechnicianLocationSchema", () => {
  it("accepts valid latitude and longitude", () => {
    const result = patchTechnicianLocationSchema.validate({
      latitude: 30.12345,
      longitude: 31.54321,
    });

    expect(result.error).toBeUndefined();
  });

  it("rejects missing latitude or longitude", () => {
    const result = patchTechnicianLocationSchema.validate({
      latitude: 30.12345,
    });

    expect(result.error).toBeDefined();
  });

  it("rejects out-of-range latitude", () => {
    const result = patchTechnicianLocationSchema.validate({
      latitude: 100,
      longitude: 31.5,
    });

    expect(result.error).toBeDefined();
  });

  it("rejects out-of-range longitude", () => {
    const result = patchTechnicianLocationSchema.validate({
      latitude: 30.1,
      longitude: 200,
    });

    expect(result.error).toBeDefined();
  });
});

describe("createRelationshipSchema", () => {
  it("accepts valid hierarchy relationship payload", () => {
    const result = createRelationshipSchema.validate({
      childUserId: 100010,
      parentUserId: 100011,
      relationshipType: "JUNIOR_TO_SENIOR",
    });

    expect(result.error).toBeUndefined();
  });

  it("rejects payload with invalid relationship type", () => {
    const result = createRelationshipSchema.validate({
      childUserId: 100011,
      parentUserId: 100012,
      relationshipType: "JUNIOR_TO_SUPERVISOR",
    });

    expect(result.error).toBeDefined();
  });

  it("rejects payload missing child or parent user id", () => {
    const result = createRelationshipSchema.validate({
      parentUserId: 100012,
      relationshipType: "SENIOR_TO_SUPERVISOR",
    });

    expect(result.error).toBeDefined();
  });
});

describe("escalateTicketSchema", () => {
  it("requires reason for manual escalation", () => {
    const result = escalateTicketSchema.validate({
      triggerType: "MANUAL",
      escalated_by: 100011,
      userRole: "JUNIOR",
    });

    expect(result.error).toBeDefined();
  });

  it("allows SLA escalation without reason", () => {
    const result = escalateTicketSchema.validate({
      triggerType: "SLA",
    });

    expect(result.error).toBeUndefined();
  });

  it("accepts manual escalation with reason and role", () => {
    const result = escalateTicketSchema.validate({
      reason: "Need senior assistance",
      escalated_by: 100010,
      userRole: "JUNIOR",
    });

    expect(result.error).toBeUndefined();
  });
});
