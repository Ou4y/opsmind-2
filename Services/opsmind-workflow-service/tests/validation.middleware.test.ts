import Joi from "joi";
import {
  claimTicketSchema,
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
