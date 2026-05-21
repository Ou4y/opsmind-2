import { evaluateAiAgentEligibility } from "../src/utils/aiAgentEligibility";

describe("evaluateAiAgentEligibility", () => {
  it("returns false with explicit missing-device reason when affectedDeviceId is missing", () => {
    const result = evaluateAiAgentEligibility({
      title: "Windows laptop VPN issue",
      description: "Cannot connect to VPN from office",
      typeOfRequest: "INCIDENT",
      category: "network",
      issueScope: "MY_DEVICE",
      remoteSupportConsent: true,
      osType: "WINDOWS",
      affectedDeviceId: null,
    });

    expect(result.aiAgentEligible).toBe(false);
    expect(result.aiAgentEligibilityReason).toBe(
      "AI plan can be generated, but automatic execution is unavailable because no registered endpoint device is linked.",
    );
  });

  it("returns true when all requirements are met", () => {
    const result = evaluateAiAgentEligibility({
      title: "Printer not working",
      description: "Endpoint has repeated spooler errors",
      typeOfRequest: "INCIDENT",
      category: "printer hardware",
      issueScope: "ROOM_DEVICE",
      remoteSupportConsent: true,
      osType: "WINDOWS",
      affectedDeviceId: "endpoint-123",
    });

    expect(result.aiAgentEligible).toBe(true);
    expect(result.aiAgentEligibilityReason).toBeNull();
  });
});
