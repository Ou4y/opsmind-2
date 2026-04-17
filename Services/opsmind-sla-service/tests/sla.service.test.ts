import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { SlaActionType, TicketPriority, TicketSLAStatus } from "@prisma/client";
import { slaPublisher } from "../src/modules/sla/sla.publisher";
import { slaRepository } from "../src/modules/sla/sla.repository";
import { slaService } from "../src/modules/sla/sla.service";

jest.mock("../src/modules/sla/sla.repository", () => ({
  slaRepository: {
    findByTicketId: jest.fn(),
    listTicketSlas: jest.fn(),
    findPolicyByPriority: jest.fn(),
    createTicketSla: jest.fn(),
    createEventLog: jest.fn(),
    updateTicketSla: jest.fn(),
    getPolicies: jest.fn(),
    upsertPolicy: jest.fn(),
    seedDefaultPolicies: jest.fn(),
    getMonitorableTicketSlas: jest.fn(),
    parsePriority: jest.fn(),
  },
}));

jest.mock("../src/modules/sla/sla.publisher", () => ({
  slaPublisher: {
    publishStarted: jest.fn(),
    publishStatusUpdated: jest.fn(),
    publishPaused: jest.fn(),
    publishResumed: jest.fn(),
    publishResponseWarning: jest.fn(),
    publishResponseBreached: jest.fn(),
    publishResolutionWarning: jest.fn(),
    publishResolutionBreached: jest.fn(),
    publishWorkflowInterventionRequested: jest.fn(),
  },
}));

const mockedFindByTicketId = slaRepository.findByTicketId as unknown as {
  mockResolvedValue: (value: unknown) => void;
};
const mockedFindPolicyByPriority = slaRepository.findPolicyByPriority as unknown as {
  mockResolvedValue: (value: unknown) => void;
};
const mockedCreateTicketSla = slaRepository.createTicketSla as unknown as {
  mockResolvedValue: (value: unknown) => void;
};
const mockedCreateEventLog = slaRepository.createEventLog as unknown as {
  mockResolvedValue: (value: unknown) => void;
};
const mockedPublishStarted = slaPublisher.publishStarted as unknown as {
  mockResolvedValue: (value: unknown) => void;
};

describe("slaService.getByTicketId", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns SLA when ticket exists", async () => {
    const fakeSla = { ticketId: "T-100" };
    mockedFindByTicketId.mockResolvedValue(fakeSla);

    const result = await slaService.getByTicketId("T-100");

    expect(result).toEqual(fakeSla);
    expect(slaRepository.findByTicketId).toHaveBeenCalledWith("T-100");
  });

  it("throws 404 when SLA does not exist", async () => {
    mockedFindByTicketId.mockResolvedValue(null);

    await expect(slaService.getByTicketId("T-404")).rejects.toMatchObject({
      name: "AppError",
      statusCode: 404,
    });
  });
});

describe("slaService.start", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts SLA timers for a new ticket and records the start event", async () => {
    const createdAt = "2026-04-17T10:00:00.000Z";
    const responseDueAt = new Date("2026-04-17T11:00:00.000Z");
    const resolutionDueAt = new Date("2026-04-17T14:00:00.000Z");

    mockedFindByTicketId.mockResolvedValue(null);
    mockedFindPolicyByPriority.mockResolvedValue({
      id: "policy-1",
      responseMinutes: 60,
      resolutionMinutes: 240,
    });

    const createdEntity = {
      id: "sla-1",
      ticketId: "T-200",
      ticketTitle: "Printer is offline",
      priority: TicketPriority.HIGH,
      assignedTo: "tech-1",
      technicianName: "Alice",
      technicianEmail: "alice@example.com",
      supervisorId: "sup-1",
      supervisorName: "Bob",
      supervisorEmail: "bob@example.com",
      ticketStatus: "OPEN",
      building: "Main",
      floor: 2,
      room: "201",
      supportGroupId: "10",
      requesterId: "20",
      status: TicketSLAStatus.ACTIVE,
      createdAt: new Date(createdAt),
      responseDueAt,
      resolutionDueAt,
    };

    mockedCreateTicketSla.mockResolvedValue(createdEntity);
    mockedCreateEventLog.mockResolvedValue(undefined);
    mockedPublishStarted.mockResolvedValue(undefined);

    const result = await slaService.start({
      ticketId: "T-200",
      title: "  Printer is offline  ",
      priority: TicketPriority.HIGH,
      createdAt,
      assignedTo: "tech-1",
      ticketStatus: " open ",
      building: "Main",
      floor: 2,
      room: "201",
      supportGroupId: 10,
      requesterId: 20,
      technician: {
        id: "tech-1",
        name: " Alice ",
        email: "ALICE@EXAMPLE.COM ",
      },
      supervisor: {
        id: "sup-1",
        name: " Bob ",
        email: "BOB@EXAMPLE.COM ",
      },
    });

    expect(slaRepository.findByTicketId).toHaveBeenCalledWith("T-200");
    expect(slaRepository.findPolicyByPriority).toHaveBeenCalledWith(TicketPriority.HIGH);
    expect(slaRepository.createTicketSla).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "T-200",
        ticketTitle: "Printer is offline",
        priority: TicketPriority.HIGH,
        assignedTo: "tech-1",
        technicianName: "Alice",
        technicianEmail: "alice@example.com",
        supervisorId: "sup-1",
        supervisorName: "Bob",
        supervisorEmail: "bob@example.com",
        ticketStatus: "OPEN",
        building: "Main",
        floor: 2,
        room: "201",
        supportGroupId: "10",
        requesterId: "20",
        status: TicketSLAStatus.ACTIVE,
        createdAt: new Date(createdAt),
        responseDueAt,
        resolutionDueAt,
        policy: { connect: { id: "policy-1" } },
      })
    );

    expect(slaRepository.createEventLog).toHaveBeenCalledWith(
      "sla-1",
      "T-200",
      SlaActionType.SLA_STARTED,
      "SLA calculated and started",
      expect.objectContaining({
        ticketId: "T-200",
        title: "Printer is offline",
        priority: TicketPriority.HIGH,
        ticketStatus: "OPEN",
        createdAt,
        responseDueAt: "2026-04-17T11:00:00.000Z",
        resolutionDueAt: "2026-04-17T14:00:00.000Z",
      })
    );

    expect(slaPublisher.publishStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "T-200",
        title: "Printer is offline",
        priority: TicketPriority.HIGH,
        createdAt,
        responseDueAt: "2026-04-17T11:00:00.000Z",
        resolutionDueAt: "2026-04-17T14:00:00.000Z",
      })
    );

    expect(result).toEqual(createdEntity);
  });
});
