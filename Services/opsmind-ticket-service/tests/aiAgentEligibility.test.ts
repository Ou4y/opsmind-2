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

  it("returns true for SOFTWARE + MACOS when all requirements are met", () => {
    const result = evaluateAiAgentEligibility({
      title: "Unable to download Google Chrome",
      description: "macOS user cannot download approved software",
      typeOfRequest: "SERVICE_REQUEST",
      category: "SOFTWARE",
      issueScope: "MY_DEVICE",
      remoteSupportConsent: true,
      osType: "MACOS",
      affectedDeviceId: "endpoint-mac-1",
    });

    expect(result.aiAgentEligible).toBe(true);
    expect(result.aiAgentEligibilityReason).toBeNull();
  });

  it("returns unsupported category reason when category is not supported", () => {
    const result = evaluateAiAgentEligibility({
      title: "Building access card issue",
      description: "Physical access card problem",
      typeOfRequest: "INCIDENT",
      category: "ACCESS",
      issueScope: "MY_DEVICE",
      remoteSupportConsent: true,
      osType: "WINDOWS",
      affectedDeviceId: "endpoint-22",
    });

    expect(result.aiAgentEligible).toBe(false);
    expect(result.aiAgentEligibilityReason).toBe(
      "AI Agent unavailable because the ticket category is not supported.",
    );
  });

  it("returns unsupported os reason for linux endpoints", () => {
    const result = evaluateAiAgentEligibility({
      title: "Linux app issue",
      description: "Cannot launch app",
      typeOfRequest: "INCIDENT",
      category: "SOFTWARE",
      issueScope: "MY_DEVICE",
      remoteSupportConsent: true,
      osType: "LINUX",
      affectedDeviceId: "endpoint-linux-1",
    });

    expect(result.aiAgentEligible).toBe(false);
    expect(result.aiAgentEligibilityReason).toBe(
      "AI Agent unavailable because this operating system is not supported for endpoint actions in this version.",
    );
  });
});
