import Joi from "joi";
import {
  claimTicketSchema,
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
