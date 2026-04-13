import {
  Prisma,
  SlaActionType,
  TicketPriority,
  TicketSLAStatus,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";

export const slaRepository = {
  findPolicyByPriority(priority: TicketPriority) {
    return prisma.sLAPolicy.findUnique({
      where: { priority },
    });
  },

  getPolicies() {
    return prisma.sLAPolicy.findMany({
      orderBy: { createdAt: "asc" },
    });
  },

  upsertPolicy(data: Prisma.SLAPolicyUncheckedCreateInput) {
    return prisma.sLAPolicy.upsert({
      where: { priority: data.priority },
      update: {
        name: data.name,
        responseMinutes: data.responseMinutes,
        resolutionMinutes: data.resolutionMinutes,
        warning1Percent: data.warning1Percent,
        warning2Percent: data.warning2Percent,
        breachPercent: data.breachPercent,
        breachAction: data.breachAction,
      },
      create: data,
    });
  },

  findByTicketId(ticketId: string) {
    return prisma.ticketSLA.findUnique({
      where: { ticketId },
      include: {
        policy: true,
        events: {
          orderBy: { createdAt: "desc" },
        },
      },
    });
  },

  createTicketSla(data: Prisma.TicketSLACreateInput) {
    return prisma.ticketSLA.create({
      data,
      include: { policy: true },
    });
  },

  updateTicketSla(ticketId: string, data: Prisma.TicketSLAUpdateInput) {
    return prisma.ticketSLA.update({
      where: { ticketId },
      data,
      include: { policy: true },
    });
  },

  getMonitorableTicketSlas() {
    return prisma.ticketSLA.findMany({
      where: {
        status: { in: [TicketSLAStatus.ACTIVE, TicketSLAStatus.PAUSED, TicketSLAStatus.BREACHED] },
        ticketStatus: { notIn: ["RESOLVED", "CLOSED"] },
      },
      include: { policy: true },
      orderBy: [{ resolutionDueAt: "asc" }, { responseDueAt: "asc" }],
    });
  },

  createEventLog(
    ticketSlaId: string,
    ticketId: string,
    eventType: SlaActionType,
    message: string,
    payload?: unknown
  ) {
    return prisma.sLAEventLog.create({
      data: {
        ticketSlaId,
        ticketId,
        eventType,
        message,
        payloadJson: payload ? JSON.stringify(payload) : null,
      },
    });
  },

  async seedDefaultPolicies() {
    const defaults = [
      {
        priority: TicketPriority.LOW,
        name: "Low Priority",
        responseMinutes: 480,
        resolutionMinutes: 2880,
        warning1Percent: 70,
        warning2Percent: 85,
        breachPercent: 100,
        breachAction: "NOTIFY_AND_REQUEST_WORKFLOW",
      },
      {
        priority: TicketPriority.MEDIUM,
        name: "Medium Priority",
        responseMinutes: 240,
        resolutionMinutes: 1440,
        warning1Percent: 70,
        warning2Percent: 85,
        breachPercent: 100,
        breachAction: "NOTIFY_AND_REQUEST_WORKFLOW",
      },
      {
        priority: TicketPriority.HIGH,
        name: "High Priority",
        responseMinutes: 60,
        resolutionMinutes: 720,
        warning1Percent: 70,
        warning2Percent: 85,
        breachPercent: 100,
        breachAction: "NOTIFY_AND_REQUEST_WORKFLOW",
      },
      {
        priority: TicketPriority.CRITICAL,
        name: "Critical Priority",
        responseMinutes: 15,
        resolutionMinutes: 240,
        warning1Percent: 60,
        warning2Percent: 80,
        breachPercent: 100,
        breachAction: "NOTIFY_AND_REQUEST_WORKFLOW",
      },
    ];

    for (const policy of defaults) {
      await prisma.sLAPolicy.upsert({
        where: { priority: policy.priority },
        update: {
          name: policy.name,
          responseMinutes: policy.responseMinutes,
          resolutionMinutes: policy.resolutionMinutes,
          warning1Percent: policy.warning1Percent,
          warning2Percent: policy.warning2Percent,
          breachPercent: policy.breachPercent,
          breachAction: policy.breachAction,
        },
        create: policy,
      });
    }
  },

  parsePriority(value: string): TicketPriority {
    return value.toUpperCase() as TicketPriority;
  },

};
