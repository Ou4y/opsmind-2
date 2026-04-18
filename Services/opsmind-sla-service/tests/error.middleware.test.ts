import { errorMiddleware } from "../src/middleware/error.middleware";
import { AppError } from "../src/errors/AppError";

describe("errorMiddleware", () => {
  it("returns AppError details and status code", () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    errorMiddleware(new AppError("Validation failed", 422, { field: "ticketId" }), {} as any, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Validation failed",
      details: { field: "ticketId" },
    });
  });

  it("returns generic 500 shape for unknown errors", () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    errorMiddleware(new Error("boom"), {} as any, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Internal server error",
    });
  });
});
