import {
  extractEmailDomain,
  sanitizeUser,
  validateAllowedEmailDomain,
  validateEmail,
  validatePassword,
} from "../src/utils/validation.util";

describe("validation.util", () => {
  it("validates well-formed emails", () => {
    expect(validateEmail("john.doe@example.com")).toBe(true);
    expect(validateEmail("invalid-email")).toBe(false);
  });

  it("extracts normalized email domain", () => {
    expect(extractEmailDomain("user@Example.COM ")).toBe("example.com");
    expect(extractEmailDomain("missing-at-symbol")).toBe("");
  });

  it("validates email against allowed domains case-insensitively", () => {
    expect(
      validateAllowedEmailDomain("doctor@Campus.edu", ["company.com", "campus.edu"])
    ).toBe(true);
    expect(validateAllowedEmailDomain("doctor@external.org", ["campus.edu"])).toBe(false);
    expect(validateAllowedEmailDomain("doctor@campus.edu", [])).toBe(false);
  });

  it("returns password validation errors for weak password", () => {
    const result = validatePassword("short");

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Password must be at least 8 characters long");
    expect(result.errors).toContain("Password must contain at least one uppercase letter");
    expect(result.errors).toContain("Password must contain at least one number");
    expect(result.errors).toContain("Password must contain at least one special character");
  });

  it("sanitizes DB user object to API shape", () => {
    const user = {
      id: "u1",
      email: "user@example.com",
      first_name: "John",
      last_name: "Doe",
      name: "John Doe",
      is_verified: true,
      is_active: false,
      role: "ADMIN",
      roles: ["ADMIN"],
      created_at: new Date("2026-01-01T00:00:00.000Z"),
    };

    expect(sanitizeUser(user)).toEqual({
      id: "u1",
      email: "user@example.com",
      firstName: "John",
      lastName: "Doe",
      name: "John Doe",
      isVerified: true,
      isActive: false,
      role: "ADMIN",
      roles: ["ADMIN"],
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });
});
