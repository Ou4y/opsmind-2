import { requestIdMiddleware } from "../src/middleware/requestId.middleware";

describe("requestIdMiddleware", () => {
  it("reuses incoming x-request-id header when provided", () => {
    const req = { headers: { "x-request-id": "existing-id" } } as any;
    const next = jest.fn();

    requestIdMiddleware(req, {} as any, next);

    expect(req.requestId).toBe("existing-id");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("generates a UUID when header is missing", () => {
    const req = { headers: {} } as any;
    const next = jest.fn();

    requestIdMiddleware(req, {} as any, next);

    expect(typeof req.requestId).toBe("string");
    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
