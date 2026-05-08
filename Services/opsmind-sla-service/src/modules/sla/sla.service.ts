import { SlaActionType, TicketPriority, TicketSLAStatus } from "@prisma/client";
import { config } from "../../config";
import { logger } from "../../config/logger";
import { AppError } from "../../errors/AppError";
import { slaRepository } from "./sla.repository";
import { slaPublisher } from "./sla.publisher";

type ContactPayload = {
  id: string | number;
  name?: string | null;
  email?: string | null;
};

type StartPayload = {
  ticketId: string;
  title?: string | null;
  priority: TicketPriority;
  createdAt?: string;
  assignedTo?: string | null;
  ticketStatus?: string;
  building?: string | null;
  floor?: number | null;
  room?: string | null;
  supportGroupId?: string | number | null;
  requesterId?: string | number | null;
  technician?: ContactPayload | null;
  supervisor?: ContactPayload | null;
};

type StatusPayload = {
  ticketStatus?: string;
  assignedTo?: string | null;
  title?: string | null;
  resolvedAt?: string;
  closedAt?: string;
  firstResponseAt?: string;
  building?: string | null;
  floor?: number | null;
  room?: string | null;
  supportGroupId?: string | number | null;
  technician?: ContactPayload | null;
  supervisor?: ContactPayload | null;
};

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function percentageElapsed(startedAt: Date, dueAt: Date, totalPausedMinutes: number): number {
  const totalMs = dueAt.getTime() - startedAt.getTime();
  if (totalMs <= 0) return 100;
  const elapsedMs = Date.now() - startedAt.getTime() - totalPausedMinutes * 60 * 1000;
  return Math.max(0, Math.floor((elapsedMs / totalMs) * 100));
}

function minutesRemaining(dueAt: Date, paused: boolean): number {
  if (paused) return Math.max(0, Math.ceil((dueAt.getTime() - Date.now()) / 60000));
  return Math.ceil((dueAt.getTime() - Date.now()) / 60000);
}

function isBreachedRecord(record: {
  status: TicketSLAStatus;
  responseBreachSent: boolean;
  resolutionBreachSent: boolean;
}) {
  return (
    record.status === TicketSLAStatus.BREACHED ||
    record.responseBreachSent ||
    record.resolutionBreachSent
  );
}

function workflowDeadline(record: {
  firstResponseAt: Date | null;
  responseDueAt: Date;
  resolutionDueAt: Date;
}) {
  return record.firstResponseAt ? record.resolutionDueAt : record.responseDueAt;
}

function normalizeStatus(status: string): string {
  return status.trim().toUpperCase();
}

function normalizeContact(contact?: ContactPayload | null) {
  if (!contact) return null;
  return {
    id: String(contact.id),
    name: contact.name?.trim() || null,
    email: contact.email?.trim().toLowerCase() || null,
  };
}

function fallbackName(email: string | null | undefined, id: string | null | undefined, label: string): string {
  if (email) return email.split("@")[0];
  if (id) return id;
  return label;
}

function toNotificationEnvelope(record: {
  ticketId: string;
  ticketTitle: string | null;
  ticketStatus: string;
  priority: TicketPriority;
  assignedTo: string | null;
  technicianName: string | null;
  technicianEmail: string | null;
  supervisorId: string | null;
  supervisorName: string | null;
  supervisorEmail: string | null;
  building: string | null;
  floor: number | null;
  room: string | null;
  supportGroupId: string | null;
  createdAt?: Date;
  responseDueAt?: Date;
  resolutionDueAt?: Date;
}) {
  const technicianId = record.assignedTo ?? "unknown-technician";
  const supervisorId = record.supervisorId ?? "unknown-supervisor";
  const ticketTitle = record.ticketTitle ?? `Ticket ${record.ticketId}`;

  return {
    ticket: {
      id: record.ticketId,
      title: ticketTitle,
      status: record.ticketStatus,
      priority: record.priority,
      building: record.building,
      floor: record.floor,
      room: record.room,
      supportGroupId: record.supportGroupId,
      createdAt: record.createdAt?.toISOString(),
      responseDueAt: record.responseDueAt?.toISOString(),
      resolutionDueAt: record.resolutionDueAt?.toISOString(),
    },
    technician: {
      id: technicianId,
      name: record.technicianName ?? fallbackName(record.technicianEmail, technicianId, "Technician"),
      email: record.technicianEmail,
    },
    supervisor: {
      id: supervisorId,
      name: record.supervisorName ?? fallbackName(record.supervisorEmail, supervisorId, "Supervisor"),
      email: record.supervisorEmail,
    },
  };
}

function workflowPayload(record: {
  ticketId: string;
  priority: TicketPriority;
  assignedTo: string | null;
  building: string | null;
  floor: number | null;
  room: string | null;
  supportGroupId: string | null;
  ticketStatus: string;
}, breachType: "RESPONSE" | "RESOLUTION") {
  return {
    ticketId: record.ticketId,
    triggerType: "SLA",
    breachType,
    reason: `${breachType} SLA breached`,
    priority: record.priority,
    assignedTo: record.assignedTo,
    building: record.building,
    floor: record.floor,
    room: record.room,
    supportGroupId: record.supportGroupId,
    ticketStatus: record.ticketStatus,
    requestedAt: new Date().toISOString(),
  };
}

async function createLogAndPublishStatusUpdate(
  entity: any,
  message: string,
  payload: Record<string, unknown>
) {
  await slaRepository.createEventLog(entity.id, entity.ticketId, SlaActionType.STATUS_UPDATED, message, payload);
  await slaPublisher.publishStatusUpdated(payload);
}

export const slaService = {
  async start(payload: StartPayload) {
    const existing = await slaRepository.findByTicketId(payload.ticketId);
    if (existing) {
      throw new AppError(`SLA already exists for ticket ${payload.ticketId}`, 409);
    }

    const policy = await slaRepository.findPolicyByPriority(payload.priority);
    if (!policy) {
      throw new AppError(`No SLA policy configured for priority ${payload.priority}`, 404);
    }

    const createdAt = payload.createdAt ? new Date(payload.createdAt) : new Date();
    const responseDueAt = addMinutes(createdAt, policy.responseMinutes);
    const resolutionDueAt = addMinutes(createdAt, policy.resolutionMinutes);
    const technician = normalizeContact(payload.technician);
    const supervisor = normalizeContact(payload.supervisor);

    const entity = await slaRepository.createTicketSla({
      ticketId: payload.ticketId,
      priority: payload.priority,
      ticketTitle: payload.title?.trim() || null,
      assignedTo: payload.assignedTo ?? null,
      technicianName: technician?.name ?? null,
      technicianEmail: technician?.email ?? null,
      supervisorId: supervisor?.id ?? null,
      supervisorName: supervisor?.name ?? null,
      supervisorEmail: supervisor?.email ?? null,
      ticketStatus: normalizeStatus(payload.ticketStatus ?? "OPEN"),
      building: payload.building ?? null,
      floor: payload.floor ?? null,
      room: payload.room ?? null,
      supportGroupId: payload.supportGroupId != null ? String(payload.supportGroupId) : null,
      requesterId: payload.requesterId != null ? String(payload.requesterId) : null,
      status: TicketSLAStatus.ACTIVE,
      createdAt,
      responseDueAt,
      resolutionDueAt,
      policy: { connect: { id: policy.id } },
    });

    const eventPayload = {
      ...toNotificationEnvelope(entity),
      ticketId: entity.ticketId,
      title: entity.ticketTitle,
      priority: entity.priority,
      ticketStatus: entity.ticketStatus,
      assignedTo: entity.assignedTo,
      building: entity.building,
      floor: entity.floor,
      room: entity.room,
      supportGroupId: entity.supportGroupId,
      responseDueAt: entity.responseDueAt.toISOString(),
      resolutionDueAt: entity.resolutionDueAt.toISOString(),
      createdAt: entity.createdAt.toISOString(),
    };

    await slaRepository.createEventLog(
      entity.id,
      entity.ticketId,
      SlaActionType.SLA_STARTED,
      "SLA calculated and started",
      eventPayload
    );

    await slaPublisher.publishStarted(eventPayload);

    return entity;
  },

  async getByTicketId(ticketId: string) {
    const entity = await slaRepository.findByTicketId(ticketId);
    if (!entity) {
      throw new AppError(`SLA not found for ticket ${ticketId}`, 404);
    }
    return entity;
  },

  async getBulkTicketStatus(ticketIds: string[]) {
    const uniqueTicketIds = Array.from(new Set(ticketIds.map((id) => id.trim()).filter(Boolean)));
    const records = await slaRepository.findByTicketIds(uniqueTicketIds);
    const now = Date.now();
    const data: Record<string, any | null> = Object.fromEntries(
      uniqueTicketIds.map((id) => [id, null])
    );

    for (const record of records) {
      const deadline = workflowDeadline(record);
      const breached = isBreachedRecord(record);
      const breachedAt = record.events[0]?.createdAt ?? null;
      const timeRemainingMinutes = Math.max(0, Math.round((deadline.getTime() - now) / 60000));

      data[record.ticketId] = {
        ticket_id: record.ticketId,
        priority: record.priority,
        sla_deadline: deadline.toISOString(),
        sla_breached: breached,
        breached_at: breachedAt ? breachedAt.toISOString() : null,
        at_risk: !breached && timeRemainingMinutes <= 30 && timeRemainingMinutes > 0,
        time_remaining: timeRemainingMinutes,
        assigned_at: record.createdAt.toISOString(),
      };
    }

    return data;
  },

  listTickets(filters: {
    q?: string;
    status?: string;
    priority?: string;
    ticketStatus?: string;
    assignedTo?: string;
    limit?: number;
    offset?: number;
  }) {
    return slaRepository.listTicketSlas({
      q: filters.q?.trim() || undefined,
      status: filters.status ? (filters.status.toUpperCase() as TicketSLAStatus) : undefined,
      priority: filters.priority ? slaRepository.parsePriority(filters.priority) : undefined,
      ticketStatus: filters.ticketStatus ? normalizeStatus(filters.ticketStatus) : undefined,
      assignedTo: filters.assignedTo?.trim() || undefined,
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    });
  },

  getPolicies() {
    return slaRepository.getPolicies();
  },

  async upsertPolicy(body: {
    priority: TicketPriority;
    name: string;
    responseMinutes: number;
    resolutionMinutes: number;
    warning1Percent: number;
    warning2Percent: number;
    breachPercent: number;
    breachAction: string;
  }) {
    const policy = await slaRepository.upsertPolicy(body);
    return policy;
  },

  async getComplianceReport(filters?: { startDate?: string; endDate?: string }) {
    const rows = await slaRepository.findTicketSlasForCompliance(filters);
    const now = Date.now();
    const buckets = new Map<
      TicketPriority,
      {
        priority: TicketPriority;
        total: number;
        breached: number;
        on_track: number;
        at_risk: number;
        responseMinutes: number[];
      }
    >();

    for (const row of rows) {
      const bucket = buckets.get(row.priority) ?? {
        priority: row.priority,
        total: 0,
        breached: 0,
        on_track: 0,
        at_risk: 0,
        responseMinutes: [],
      };

      bucket.total += 1;

      const breached = isBreachedRecord(row);
      const deadline = workflowDeadline(row);
      const remainingMinutes = Math.round((deadline.getTime() - now) / 60000);
      const closedLike = ["RESOLVED", "CLOSED"].includes(row.ticketStatus);

      if (breached) {
        bucket.breached += 1;
      } else if (!closedLike && remainingMinutes <= 30 && remainingMinutes > 0) {
        bucket.at_risk += 1;
      } else {
        bucket.on_track += 1;
      }

      if (row.firstResponseAt) {
        bucket.responseMinutes.push(
          Math.max(0, Math.round((row.firstResponseAt.getTime() - row.createdAt.getTime()) / 60000))
        );
      }

      buckets.set(row.priority, bucket);
    }

    const byPriority = Array.from(buckets.values()).map((bucket) => ({
      priority: bucket.priority,
      total: bucket.total,
      breached: bucket.breached,
      on_track: bucket.on_track,
      at_risk: bucket.at_risk,
      avg_response_minutes:
        bucket.responseMinutes.length > 0
          ? Math.round(
              bucket.responseMinutes.reduce((sum, value) => sum + value, 0) /
                bucket.responseMinutes.length
            )
          : 0,
    }));

    const totalTracked = byPriority.reduce((sum, item) => sum + item.total, 0);
    const breached = byPriority.reduce((sum, item) => sum + item.breached, 0);

    return {
      total_tracked: totalTracked,
      breached,
      compliance_rate: totalTracked > 0 ? ((totalTracked - breached) / totalTracked) * 100 : 100,
      by_priority: byPriority,
    };
  },

  async updateStatus(ticketId: string, body: StatusPayload) {
    const entity = await slaRepository.findByTicketId(ticketId);
    if (!entity) throw new AppError(`SLA not found for ticket ${ticketId}`, 404);

    const technician = normalizeContact(body.technician);
    const supervisor = normalizeContact(body.supervisor);
    const normalized = body.ticketStatus ? normalizeStatus(body.ticketStatus) : entity.ticketStatus;
    const updates: any = {
      assignedTo: body.assignedTo ?? entity.assignedTo,
      ticketTitle: body.title !== undefined ? body.title?.trim() || null : entity.ticketTitle,
      technicianName: technician ? technician.name : entity.technicianName,
      technicianEmail: technician ? technician.email : entity.technicianEmail,
      supervisorId: supervisor ? supervisor.id : entity.supervisorId,
      supervisorName: supervisor ? supervisor.name : entity.supervisorName,
      supervisorEmail: supervisor ? supervisor.email : entity.supervisorEmail,
      building: body.building ?? entity.building,
      floor: body.floor ?? entity.floor,
      room: body.room ?? entity.room,
      supportGroupId:
        body.supportGroupId !== undefined && body.supportGroupId !== null
          ? String(body.supportGroupId)
          : entity.supportGroupId,
      lastUpdatedAt: new Date(),
    };

    if (body.ticketStatus) {
      updates.ticketStatus = normalized;
    }

    if (body.firstResponseAt && !entity.firstResponseAt) {
      updates.firstResponseAt = new Date(body.firstResponseAt);
    }

    if (body.resolvedAt || normalized === "RESOLVED") {
      updates.resolvedAt = body.resolvedAt ? new Date(body.resolvedAt) : new Date();
      updates.ticketStatus = "RESOLVED";
      updates.status = TicketSLAStatus.RESOLVED;
    }

    if (body.closedAt || normalized === "CLOSED") {
      updates.closedAt = body.closedAt ? new Date(body.closedAt) : new Date();
      updates.ticketStatus = "CLOSED";
      updates.status = TicketSLAStatus.CLOSED;
    }

    if (
      body.ticketStatus &&
      !["RESOLVED", "CLOSED"].includes(normalized) &&
      entity.status !== TicketSLAStatus.PAUSED
    ) {
      updates.status = entity.responseBreachSent || entity.resolutionBreachSent
        ? TicketSLAStatus.BREACHED
        : TicketSLAStatus.ACTIVE;
    }

    const updated = await slaRepository.updateTicketSla(ticketId, updates);

    const payload = {
      ...toNotificationEnvelope(updated),
      ticketId: updated.ticketId,
      title: updated.ticketTitle,
      ticketStatus: updated.ticketStatus,
      assignedTo: updated.assignedTo,
      building: updated.building,
      floor: updated.floor,
      room: updated.room,
      supportGroupId: updated.supportGroupId,
      firstResponseAt: updated.firstResponseAt?.toISOString(),
      resolvedAt: updated.resolvedAt?.toISOString(),
      closedAt: updated.closedAt?.toISOString(),
      status: updated.status,
      updatedAt: updated.lastUpdatedAt.toISOString(),
    };

    let message = body.ticketStatus
      ? `Ticket SLA status updated to ${normalized}`
      : "Ticket SLA metadata synchronized";
    if (updated.ticketStatus === "RESOLVED") {
      await slaRepository.createEventLog(updated.id, updated.ticketId, SlaActionType.RESOLVED, message, payload);
    } else if (updated.ticketStatus === "CLOSED") {
      await slaRepository.createEventLog(updated.id, updated.ticketId, SlaActionType.CLOSED, message, payload);
    } else {
      await createLogAndPublishStatusUpdate(updated, message, payload);
      return updated;
    }

    await slaPublisher.publishStatusUpdated(payload);
    return updated;
  },

  async pause(ticketId: string, reason = "Waiting for user") {
    const entity = await slaRepository.findByTicketId(ticketId);
    if (!entity) throw new AppError(`SLA not found for ticket ${ticketId}`, 404);
    if (entity.status === TicketSLAStatus.PAUSED) return entity;

    const updated = await slaRepository.updateTicketSla(ticketId, {
      status: TicketSLAStatus.PAUSED,
      pausedAt: new Date(),
      lastUpdatedAt: new Date(),
    });

      const payload = {
        ...toNotificationEnvelope(updated),
        ticketId: updated.ticketId,
        title: updated.ticketTitle,
        reason,
        pausedAt: updated.pausedAt?.toISOString(),
        assignedTo: updated.assignedTo,
      building: updated.building,
      floor: updated.floor,
      room: updated.room,
      supportGroupId: updated.supportGroupId,
    };

    await slaRepository.createEventLog(updated.id, updated.ticketId, SlaActionType.PAUSED, reason, payload);
    await slaPublisher.publishPaused(payload);

    return updated;
  },

  async resume(ticketId: string) {
    const entity = await slaRepository.findByTicketId(ticketId);
    if (!entity) throw new AppError(`SLA not found for ticket ${ticketId}`, 404);
    if (!entity.pausedAt) return entity;

    const pausedMinutes = Math.ceil((Date.now() - entity.pausedAt.getTime()) / 60000);

    const updated = await slaRepository.updateTicketSla(ticketId, {
      status: entity.responseBreachSent || entity.resolutionBreachSent
        ? TicketSLAStatus.BREACHED
        : TicketSLAStatus.ACTIVE,
      pausedAt: null,
      totalPausedMinutes: entity.totalPausedMinutes + pausedMinutes,
      lastUpdatedAt: new Date(),
    });

      const payload = {
        ...toNotificationEnvelope(updated),
        ticketId: updated.ticketId,
        title: updated.ticketTitle,
        pausedMinutes,
        resumedAt: updated.lastUpdatedAt.toISOString(),
        assignedTo: updated.assignedTo,
      building: updated.building,
      floor: updated.floor,
      room: updated.room,
      supportGroupId: updated.supportGroupId,
    };

    await slaRepository.createEventLog(updated.id, updated.ticketId, SlaActionType.RESUMED, "SLA resumed", payload);
    await slaPublisher.publishResumed(payload);

    return updated;
  },

  seedDefaultPolicies() {
    return slaRepository.seedDefaultPolicies();
  },

  async runMonitorCycle() {
    const records = await slaRepository.getMonitorableTicketSlas();
    const counters = {
      checked: records.length,
      responseWarnings: 0,
      responseBreaches: 0,
      resolutionWarnings: 0,
      resolutionBreaches: 0,
      workflowRequests: 0,
    };

    for (const record of records) {
      const paused = record.status === TicketSLAStatus.PAUSED;
      await slaRepository.updateTicketSla(record.ticketId, {
        lastCheckedAt: new Date(),
      });

      if (paused) continue;

      const responsePercent = record.firstResponseAt
        ? 100
        : percentageElapsed(record.createdAt, record.responseDueAt, record.totalPausedMinutes);
      const resolutionPercent = ["RESOLVED", "CLOSED"].includes(record.ticketStatus)
        ? 100
        : percentageElapsed(record.createdAt, record.resolutionDueAt, record.totalPausedMinutes);

      const responseRemaining = minutesRemaining(record.responseDueAt, paused);
      const resolutionRemaining = minutesRemaining(record.resolutionDueAt, paused);

      if (!record.firstResponseAt) {
        if (!record.responseWarning1Sent && responsePercent >= record.policy.warning1Percent) {
          const payload = {
            ...toNotificationEnvelope(record),
            ticketId: record.ticketId,
            title: record.ticketTitle,
            warningStage: 1,
            type: "RESPONSE",
            remainingMinutes: responseRemaining,
            assignedTo: record.assignedTo,
            priority: record.priority,
            building: record.building,
            floor: record.floor,
            room: record.room,
            supportGroupId: record.supportGroupId,
          };
          await slaRepository.updateTicketSla(record.ticketId, { responseWarning1Sent: true });
          await slaRepository.createEventLog(
            record.id,
            record.ticketId,
            SlaActionType.RESPONSE_WARNING_1,
            "First response SLA warning fired",
            payload
          );
          await slaPublisher.publishResponseWarning(payload);
          counters.responseWarnings += 1;
        }

        if (!record.responseWarning2Sent && responsePercent >= record.policy.warning2Percent) {
          const payload = {
            ...toNotificationEnvelope(record),
            ticketId: record.ticketId,
            title: record.ticketTitle,
            warningStage: 2,
            type: "RESPONSE",
            remainingMinutes: responseRemaining,
            assignedTo: record.assignedTo,
            priority: record.priority,
            building: record.building,
            floor: record.floor,
            room: record.room,
            supportGroupId: record.supportGroupId,
          };
          await slaRepository.updateTicketSla(record.ticketId, { responseWarning2Sent: true });
          await slaRepository.createEventLog(
            record.id,
            record.ticketId,
            SlaActionType.RESPONSE_WARNING_2,
            "Second response SLA warning fired",
            payload
          );
          await slaPublisher.publishResponseWarning(payload);
          counters.responseWarnings += 1;
        }

        if (!record.responseBreachSent && responsePercent >= record.policy.breachPercent) {
          const breachedAt = new Date();
          const updated = await slaRepository.updateTicketSla(record.ticketId, {
            responseBreachSent: true,
            status: TicketSLAStatus.BREACHED,
            lastUpdatedAt: breachedAt,
          });
          const payload = {
            ...toNotificationEnvelope(updated),
            ticketId: updated.ticketId,
            title: updated.ticketTitle,
            breachedAt: breachedAt.toISOString(),
            type: "RESPONSE",
            assignedTo: updated.assignedTo,
                  priority: updated.priority,
            building: updated.building,
            floor: updated.floor,
            room: updated.room,
            supportGroupId: updated.supportGroupId,
          };
          await slaRepository.createEventLog(
            updated.id,
            updated.ticketId,
            SlaActionType.RESPONSE_BREACHED,
            "Response SLA breached",
            payload
          );
          await slaPublisher.publishResponseBreached(payload);
          counters.responseBreaches += 1;

          if (config.sla.autoRequestWorkflowOnResponseBreach && !updated.workflowInterventionSent) {
            const intervention = workflowPayload(updated as any, "RESPONSE");
            await slaRepository.updateTicketSla(updated.ticketId, { workflowInterventionSent: true });
            await slaRepository.createEventLog(
              updated.id,
              updated.ticketId,
              SlaActionType.WORKFLOW_INTERVENTION_REQUESTED,
              "Workflow intervention requested after response SLA breach",
              intervention
            );
            await slaPublisher.publishWorkflowInterventionRequested(intervention);
            counters.workflowRequests += 1;
          }
        }
      }

      if (!["RESOLVED", "CLOSED"].includes(record.ticketStatus)) {
        if (!record.resolutionWarning1Sent && resolutionPercent >= record.policy.warning1Percent) {
          const payload = {
            ...toNotificationEnvelope(record),
            ticketId: record.ticketId,
            title: record.ticketTitle,
            warningStage: 1,
            type: "RESOLUTION",
            remainingMinutes: resolutionRemaining,
            assignedTo: record.assignedTo,
            priority: record.priority,
            building: record.building,
            floor: record.floor,
            room: record.room,
            supportGroupId: record.supportGroupId,
          };
          await slaRepository.updateTicketSla(record.ticketId, { resolutionWarning1Sent: true });
          await slaRepository.createEventLog(
            record.id,
            record.ticketId,
            SlaActionType.RESOLUTION_WARNING_1,
            "First resolution SLA warning fired",
            payload
          );
          await slaPublisher.publishResolutionWarning(payload);
          counters.resolutionWarnings += 1;
        }

        if (!record.resolutionWarning2Sent && resolutionPercent >= record.policy.warning2Percent) {
          const payload = {
            ...toNotificationEnvelope(record),
            ticketId: record.ticketId,
            title: record.ticketTitle,
            warningStage: 2,
            type: "RESOLUTION",
            remainingMinutes: resolutionRemaining,
            assignedTo: record.assignedTo,
            priority: record.priority,
            building: record.building,
            floor: record.floor,
            room: record.room,
            supportGroupId: record.supportGroupId,
          };
          await slaRepository.updateTicketSla(record.ticketId, { resolutionWarning2Sent: true });
          await slaRepository.createEventLog(
            record.id,
            record.ticketId,
            SlaActionType.RESOLUTION_WARNING_2,
            "Second resolution SLA warning fired",
            payload
          );
          await slaPublisher.publishResolutionWarning(payload);
          counters.resolutionWarnings += 1;
        }

        if (!record.resolutionBreachSent && resolutionPercent >= record.policy.breachPercent) {
          const breachedAt = new Date();
          const updated = await slaRepository.updateTicketSla(record.ticketId, {
            resolutionBreachSent: true,
            status: TicketSLAStatus.BREACHED,
            lastUpdatedAt: breachedAt,
          });
          const payload = {
            ...toNotificationEnvelope(updated),
            ticketId: updated.ticketId,
            title: updated.ticketTitle,
            breachedAt: breachedAt.toISOString(),
            type: "RESOLUTION",
            assignedTo: updated.assignedTo,
                  priority: updated.priority,
            building: updated.building,
            floor: updated.floor,
            room: updated.room,
            supportGroupId: updated.supportGroupId,
          };
          await slaRepository.createEventLog(
            updated.id,
            updated.ticketId,
            SlaActionType.RESOLUTION_BREACHED,
            "Resolution SLA breached",
            payload
          );
          await slaPublisher.publishResolutionBreached(payload);
          counters.resolutionBreaches += 1;

          if (config.sla.autoRequestWorkflowOnResolutionBreach && !updated.workflowInterventionSent) {
            const intervention = workflowPayload(updated as any, "RESOLUTION");
            await slaRepository.updateTicketSla(updated.ticketId, { workflowInterventionSent: true });
            await slaRepository.createEventLog(
              updated.id,
              updated.ticketId,
              SlaActionType.WORKFLOW_INTERVENTION_REQUESTED,
              "Workflow intervention requested after resolution SLA breach",
              intervention
            );
            await slaPublisher.publishWorkflowInterventionRequested(intervention);
            counters.workflowRequests += 1;
          }

          logger.error("SLA breached / workflow intervention requested", payload);
        }
      }
    }

    return counters;
  },
};
