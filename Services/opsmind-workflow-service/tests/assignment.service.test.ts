import { AssignmentService, isAssignmentPendingError } from "../src/services/AssignmentService";
import { TechnicianRow, TicketCreatedEvent } from "../src/interfaces/types";

const mockGetAvailableTechnicians = jest.fn();
const mockUpsertTicket = jest.fn();
const mockIsAlreadyAssigned = jest.fn();
const mockGetWorkloadMap = jest.fn();
const mockAssignTicketLocal = jest.fn();
const mockAssignTicketExternal = jest.fn();
const mockLogAction = jest.fn();

jest.mock("../src/repositories/TechnicianRepository", () => ({
  TechnicianRepository: jest.fn().mockImplementation(() => ({
    getAvailableTechnicians: mockGetAvailableTechnicians,
    getByUserId: jest.fn(),
    getById: jest.fn(),
  })),
}));

jest.mock("../src/repositories/TicketRepository", () => ({
  TicketRepository: jest.fn().mockImplementation(() => ({
    upsertTicket: mockUpsertTicket,
    isAlreadyAssigned: mockIsAlreadyAssigned,
    getWorkloadMap: mockGetWorkloadMap,
    assignTicket: mockAssignTicketLocal,
  })),
}));

jest.mock("../src/repositories/WorkflowLogRepository", () => ({
  WorkflowLogRepository: jest.fn().mockImplementation(() => ({
    logAction: mockLogAction,
  })),
}));

jest.mock("../src/config/externalServices", () => ({
  assignTicket: (...args: any[]) => mockAssignTicketExternal(...args),
  getTicketDetails: jest.fn(),
  getUserDetails: jest.fn(),
  startSlaTracking: jest.fn(),
}));

function makeJunior(
  userId: number,
  latitude: number | null,
  longitude: number | null,
  overrides: Partial<TechnicianRow> = {},
): TechnicianRow {
  return {
    id: userId,
    user_id: userId,
    auth_user_id: null,
    name: `Junior-${userId}`,
    email: `junior${userId}@opsmind.local`,
    level: "JUNIOR",
    latitude,
    longitude,
    status: "ONLINE",
    is_active: true,
    last_location_update: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeEvent(ticketId: string, latitude: number, longitude: number): TicketCreatedEvent {
  return {
    ticket_id: ticketId,
    latitude,
    longitude,
    priority: "MEDIUM",
  };
}

describe("AssignmentService strategy behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockUpsertTicket.mockResolvedValue(undefined);
    mockIsAlreadyAssigned.mockResolvedValue(null);
    mockGetWorkloadMap.mockResolvedValue({});
    mockAssignTicketLocal.mockResolvedValue(undefined);
    mockAssignTicketExternal.mockResolvedValue({ success: true });
    mockLogAction.mockResolvedValue(undefined);

    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses distance_workload when ticket and technicians have location", async () => {
    mockGetAvailableTechnicians.mockResolvedValue([
      makeJunior(101, 30.0, 31.0),
      makeJunior(102, 35.0, 35.0),
    ]);
    mockGetWorkloadMap.mockResolvedValue({ 101: 1, 102: 1 });

    const service = new AssignmentService();
    jest.spyOn(service as any, "startSlaTracking").mockResolvedValue(undefined);
    jest.spyOn(service as any, "publishAssignmentNotification").mockResolvedValue(undefined);

    const result = await service.assignForTicket(makeEvent("T-1", 30.1, 31.1), { source: "route-ticket" });

    expect(result).not.toBeNull();
    expect(result?.assignment_strategy).toBe("distance_workload");
    expect(result?.assignment_path).toBe("route-ticket");
    expect(result?.technician_id).toBe(101);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("source=location_and_workload"));
  });

  it("uses workload_only and still assigns when juniors have no location", async () => {
    mockGetAvailableTechnicians.mockResolvedValue([
      makeJunior(201, null, null),
      makeJunior(202, null, null),
    ]);
    mockGetWorkloadMap.mockResolvedValue({ 201: 5, 202: 2 });

    const service = new AssignmentService();
    jest.spyOn(service as any, "startSlaTracking").mockResolvedValue(undefined);
    jest.spyOn(service as any, "publishAssignmentNotification").mockResolvedValue(undefined);

    const result = await service.assignForTicket(makeEvent("T-2", Number.NaN, Number.NaN), { source: "queue" });

    expect(result).not.toBeNull();
    expect(result?.assignment_strategy).toBe("workload_only");
    expect(result?.assignment_path).toBe("queue");
    expect(result?.technician_id).toBe(202);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("source=workload_fallback_no_ticket_location"));
  });

  it("keeps mixed-location juniors eligible when ticket coordinates are missing", async () => {
    mockGetAvailableTechnicians.mockResolvedValue([
      makeJunior(301, 30.0, 31.0),
      makeJunior(302, null, null),
    ]);
    mockGetWorkloadMap.mockResolvedValue({ 301: 4, 302: 1 });

    const service = new AssignmentService();
    jest.spyOn(service as any, "startSlaTracking").mockResolvedValue(undefined);
    jest.spyOn(service as any, "publishAssignmentNotification").mockResolvedValue(undefined);

    const result = await service.assignForTicket(makeEvent("T-3", Number.NaN, Number.NaN), { source: "route-ticket" });

    expect(result).not.toBeNull();
    expect(result?.assignment_strategy).toBe("workload_only");
    expect(result?.technician_id).toBe(302);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("source=workload_fallback_no_ticket_location"));
  });

  it("falls back to workload when ticket has location but no technician has valid location", async () => {
    mockGetAvailableTechnicians.mockResolvedValue([
      makeJunior(351, null, null),
      makeJunior(352, null, null),
    ]);
    mockGetWorkloadMap.mockResolvedValue({ 351: 3, 352: 1 });

    const service = new AssignmentService();
    jest.spyOn(service as any, "startSlaTracking").mockResolvedValue(undefined);
    jest.spyOn(service as any, "publishAssignmentNotification").mockResolvedValue(undefined);

    const result = await service.assignForTicket(makeEvent("T-3B", 30.11, 31.22), { source: "route-ticket" });

    expect(result).not.toBeNull();
    expect(result?.assignment_strategy).toBe("workload_only");
    expect(result?.technician_id).toBe(352);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("source=workload_fallback_no_technician_locations"),
    );
  });

  it("skips stale technician location in distance mode", async () => {
    const staleDate = new Date(Date.now() - 45 * 60 * 1000);
    mockGetAvailableTechnicians.mockResolvedValue([
      makeJunior(361, 30.0, 31.0, { last_location_update: staleDate }),
      makeJunior(362, 30.101, 31.101, { last_location_update: new Date() }),
    ]);
    mockGetWorkloadMap.mockResolvedValue({ 361: 0, 362: 1 });

    const service = new AssignmentService();
    jest.spyOn(service as any, "startSlaTracking").mockResolvedValue(undefined);
    jest.spyOn(service as any, "publishAssignmentNotification").mockResolvedValue(undefined);

    const result = await service.assignForTicket(makeEvent("T-3C", 30.1, 31.1), { source: "route-ticket" });

    expect(result).not.toBeNull();
    expect(result?.assignment_strategy).toBe("distance_workload");
    expect(result?.technician_id).toBe(362);
  });

  it("returns pending error with clear reason when no active juniors exist", async () => {
    mockGetAvailableTechnicians.mockResolvedValue([]);

    const service = new AssignmentService();

    await expect(
      service.assignForTicket(makeEvent("T-4", Number.NaN, Number.NaN), { source: "queue" }),
    ).rejects.toThrow("No active junior technicians available.");

    await service
      .assignForTicket(makeEvent("T-4b", Number.NaN, Number.NaN), { source: "queue" })
      .catch((error) => {
        expect(isAssignmentPendingError(error)).toBe(true);
      });
  });

  it("uses overload_fallback and selects least overloaded junior when all are over capacity", async () => {
    mockGetAvailableTechnicians.mockResolvedValue([
      makeJunior(401, 30.0, 31.0),
      makeJunior(402, null, null),
    ]);
    mockGetWorkloadMap.mockResolvedValue({ 401: 12, 402: 11 });

    const service = new AssignmentService();
    jest.spyOn(service as any, "startSlaTracking").mockResolvedValue(undefined);
    jest.spyOn(service as any, "publishAssignmentNotification").mockResolvedValue(undefined);

    const warnSpy = jest.spyOn(console, "warn");

    const result = await service.assignForTicket(makeEvent("T-5", 30.2, 31.2), { source: "route-ticket" });

    expect(result).not.toBeNull();
    expect(result?.assignment_strategy).toBe("overload_fallback");
    expect(result?.assignment_reason).toContain("all_active_juniors_over_capacity_threshold");
    expect(result?.technician_id).toBe(402);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Overload fallback activated"));
  });
});
