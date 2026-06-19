const MISSING_DEVICE_REASON =
  "AI plan can be generated, but automatic execution is unavailable because no registered endpoint device is linked.";
const UNSUPPORTED_CATEGORY_REASON =
  "AI Agent unavailable because the ticket category is not supported.";
const UNSUPPORTED_OS_REASON =
  "AI Agent unavailable because this operating system is not supported for endpoint actions in this version.";

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

const SUPPORTED_CATEGORIES = new Set([
  "NETWORK",
  "PRINTER",
  "PERFORMANCE",
  "STORAGE",
  "SOFTWARE",
]);

const SUPPORTED_ENDPOINT_OS = new Set<OperatingSystemType>(["WINDOWS", "MACOS"]);

function normalizeText(input: string | null | undefined): string {
  return String(input || "").trim().toUpperCase();
}

function normalizeCategory(category: string | null | undefined): string {
  const normalized = normalizeText(category);
  if (!normalized) return "UNKNOWN";

  if (
    normalized.includes("NETWORK") ||
    normalized.includes("WIFI") ||
    normalized.includes("INTERNET") ||
    normalized.includes("DNS")
  ) {
    return "NETWORK";
  }

  if (normalized.includes("PRINTER") || normalized.includes("PRINT")) {
    return "PRINTER";
  }

  if (normalized.includes("PERFORMANCE") || normalized.includes("SLOW") || normalized.includes("LAG")) {
    return "PERFORMANCE";
  }

  if (normalized.includes("STORAGE") || normalized.includes("DISK") || normalized.includes("SPACE")) {
    return "STORAGE";
  }

  if (
    normalized.includes("SOFTWARE") ||
    normalized.includes("APPLICATION") ||
    normalized.includes("APP")
  ) {
    return "SOFTWARE";
  }

  return normalized;
}

export function evaluateAiAgentEligibility(
  input: AiAgentEligibilityInput,
): AiAgentEligibilityResult {
  const affectedDeviceId = String(input.affectedDeviceId || "").trim();
  const issueScope = input.issueScope ?? "UNKNOWN";
  const remoteSupportConsent = Boolean(input.remoteSupportConsent);
  const osType = (input.osType ?? "UNKNOWN") as OperatingSystemType;
  const normalizedCategory = normalizeCategory(input.category);

  if (!SUPPORTED_CATEGORIES.has(normalizedCategory)) {
    return {
      aiAgentEligible: false,
      aiAgentEligibilityReason: UNSUPPORTED_CATEGORY_REASON,
    };
  }

  if (!affectedDeviceId) {
    return {
      aiAgentEligible: false,
      aiAgentEligibilityReason: MISSING_DEVICE_REASON,
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

  if (!SUPPORTED_ENDPOINT_OS.has(osType)) {
    return {
      aiAgentEligible: false,
      aiAgentEligibilityReason: UNSUPPORTED_OS_REASON,
    };
  }

  return {
    aiAgentEligible: true,
    aiAgentEligibilityReason: null,
  };
}
