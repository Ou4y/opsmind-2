import { generateOTP, getOTPExpiryDate, hashOTP, isOTPExpired, verifyOTP } from "../src/utils/otp.util";

describe("otp.util", () => {
  it("generates numeric OTP with configured length", () => {
    const otp = generateOTP();

    expect(otp).toMatch(/^\d+$/);
    expect(otp.length).toBe(6);
  });

  it("hashes and verifies OTP values", async () => {
    const otp = "123456";
    const hash = await hashOTP(otp);

    await expect(verifyOTP("123456", hash)).resolves.toBe(true);
    await expect(verifyOTP("654321", hash)).resolves.toBe(false);
  });

  it("marks past expiry as expired and future expiry as not expired", () => {
    const futureExpiry = getOTPExpiryDate();
    const pastExpiry = new Date(Date.now() - 1000);

    expect(isOTPExpired(futureExpiry)).toBe(false);
    expect(isOTPExpired(pastExpiry)).toBe(true);
  });
});
