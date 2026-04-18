import { haversineDistanceKm } from "../src/utils/geo";

describe("haversineDistanceKm", () => {
  it("returns zero for identical points", () => {
    expect(haversineDistanceKm(24.7, 46.7, 24.7, 46.7)).toBeCloseTo(0, 6);
  });

  it("returns expected approximate distance between Riyadh and Jeddah", () => {
    const distance = haversineDistanceKm(24.7136, 46.6753, 21.4858, 39.1925);

    expect(distance).toBeGreaterThan(830);
    expect(distance).toBeLessThan(900);
  });
});
