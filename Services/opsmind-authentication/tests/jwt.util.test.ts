import { decodeToken, generateToken, verifyToken } from "../src/utils/jwt.util";

describe("jwt.util", () => {
  it("generates and verifies a token round-trip", () => {
    const payload = {
      userId: "u-1",
      email: "user@example.com",
      roles: ["ADMIN"],
    };

    const token = generateToken(payload);
    const decoded = verifyToken(token);

    expect(decoded.userId).toBe("u-1");
    expect(decoded.email).toBe("user@example.com");
    expect(decoded.roles).toEqual(["ADMIN"]);
  });

  it("decodes token without verification", () => {
    const token = generateToken({
      userId: "u-2",
      email: "tech@example.com",
      roles: ["TECHNICIAN"],
    });

    const decoded = decodeToken(token);

    expect(decoded).not.toBeNull();
    expect(decoded?.email).toBe("tech@example.com");
  });

  it("returns null for malformed token decode", () => {
    expect(decodeToken("not-a-token")).toBeNull();
  });
});
