import { z } from "zod";
import { validate } from "../src/middleware/validate.middleware";
import { AppError } from "../src/errors/AppError";

describe("validate middleware", () => {
  it("calls next when schema parsing succeeds", () => {
    const schema = z.object({
      body: z.object({ name: z.string() }),
      params: z.object({}),
      query: z.object({}),
    });

    const middleware = validate(schema);
    const next = jest.fn();

    middleware({ body: { name: "Alice" }, params: {}, query: {} } as any, {} as any, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("forwards AppError with flatten details on Zod validation errors", () => {
    const schema = z.object({
      body: z.object({ name: z.string().min(3) }),
      params: z.object({}),
      query: z.object({}),
    });

    const middleware = validate(schema);
    const next = jest.fn();

    middleware({ body: { name: "A" }, params: {}, query: {} } as any, {} as any, next);

    const errorArg = next.mock.calls[0][0] as AppError;
    expect(errorArg).toBeInstanceOf(AppError);
    expect(errorArg.statusCode).toBe(400);
    expect(errorArg.message).toBe("Validation failed");
    expect(errorArg.details).toBeDefined();
  });
});
