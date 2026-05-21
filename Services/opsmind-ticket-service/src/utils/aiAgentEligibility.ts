const MISSING_DEVICE_REASON =
  "AI plan can be generated, but automatic execution is unavailable because no registered endpoint device is linked.";

type RequestType = "INCIDENT" | "SERVICE_REQUEST" | "MAINTENANCE";
type OperatingSystemType = "WINDOWS" | "MACOS" | "LINUX" | "UNKNOWN";
type IssueScope =
  | "MY_DEVICE"
  | "ROOM_DEVICE"
  | "MULTIPLE_DEVICES"
  | "BUILDING_WIDE"
  | "UNKNOWN";

export interface AiAgentEligibilityInput {
  title: string;
  description: string;
  typeOfRequest: RequestType;
  category?: string | null;
  issueScope?: IssueScope | null;
  remoteSupportConsent?: boolean | null;
  osType?: OperatingSystemType | null;
  affectedDeviceId?: string | null;
}

export interface AiAgentEligibilityResult {
  aiAgentEligible: boolean;
  aiAgentEligibilityReason: string | null;
}

const TECHNICAL_KEYWORDS = [
  "device",
  "endpoint",
  "printer",
  "laptop",
  "desktop",
  "computer",
  "pc",
  "hardware",
  "software",
  "application",
  "app",
  "windows",
  "mac",
  "linux",
  "os",
  "network",
  "wifi",
  "vpn",
  "internet",
  "email",
  "outlook",
  "teams",
  "login",
  "password",
  "server",
  "database",
  "monitor",
  "keyboard",
  "mouse",
  "camera",
  "microphone",
  "bluetooth",
  "error",
  "failed",
  "not working",
  "crash",
  "slow",
  "performance",
  "connectivity",
  "technical",
  "it",
];

function normalizeText(input: string | null | undefined): string {
  return String(input || "").toLowerCase();
}

function hasTechnicalSignal(text: string): boolean {
  return TECHNICAL_KEYWORDS.some((keyword) => text.includes(keyword));
}

function isSupportedTechnicalIssue(input: AiAgentEligibilityInput): boolean {
  const normalizedCategory = normalizeText(input.category);
  const typeSuggestsTechnical =
    input.typeOfRequest === "INCIDENT" || input.typeOfRequest === "SERVICE_REQUEST";

  if (normalizedCategory) {
    return hasTechnicalSignal(normalizedCategory) || typeSuggestsTechnical;
  }

  const narrative = normalizeText(`${input.title} ${input.description}`);
  return hasTechnicalSignal(narrative);
}

export function evaluateAiAgentEligibility(
  input: AiAgentEligibilityInput,
): AiAgentEligibilityResult {
  const affectedDeviceId = String(input.affectedDeviceId || "").trim();
  const issueScope = input.issueScope ?? "UNKNOWN";
  const remoteSupportConsent = Boolean(input.remoteSupportConsent);
  const osType = input.osType ?? "UNKNOWN";

  if (!affectedDeviceId) {
    return {
      aiAgentEligible: false,
      aiAgentEligibilityReason: MISSING_DEVICE_REASON,
    };
  }

  if (!isSupportedTechnicalIssue(input)) {
    return {
      aiAgentEligible: false,
      aiAgentEligibilityReason:
        "Issue is not classified as a supported technical problem for automatic AI execution.",
    };
  }

  if (issueScope !== "MY_DEVICE" && issueScope !== "ROOM_DEVICE") {
    return {
      aiAgentEligible: false,
      aiAgentEligibilityReason:
        "Automatic AI execution currently supports only MY_DEVICE or ROOM_DEVICE scope.",
    };
  }

  if (!remoteSupportConsent) {
    return {
      aiAgentEligible: false,
      aiAgentEligibilityReason:
        "Automatic AI execution requires remote support consent.",
    };
  }

  if (osType !== "WINDOWS") {
    return {
      aiAgentEligible: false,
      aiAgentEligibilityReason:
        "Automatic AI execution is currently supported only for WINDOWS endpoints.",
    };
  }

  return {
    aiAgentEligible: true,
    aiAgentEligibilityReason: null,
  };
}
