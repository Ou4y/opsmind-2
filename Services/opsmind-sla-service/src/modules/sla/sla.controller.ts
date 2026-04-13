import { NextFunction, Request, Response } from "express";
import { slaRepository } from "./sla.repository";
import { slaService } from "./sla.service";

function getSingleParam(value: string | string[] | undefined, name: string): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  throw new Error(`Missing required route param: ${name}`);
}

export const slaController = {
  health(_req: Request, res: Response) {
    res.status(200).json({
      success: true,
      message: "SLA service is running",
      timestamp: new Date().toISOString(),
    });
  },

  async start(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await slaService.start({
        ticketId: req.body.ticketId,
        priority: slaRepository.parsePriority(req.body.priority),
        createdAt: req.body.createdAt,
        assignedTo: req.body.assignedTo,
        ticketStatus: req.body.ticketStatus,
        building: req.body.building,
        floor: req.body.floor,
        room: req.body.room,
        supportGroupId: req.body.supportGroupId,
        requesterId: req.body.requesterId,
      });

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async getByTicketId(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await slaService.getByTicketId(getSingleParam(req.params.ticketId, "ticketId"));
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async getPolicies(_req: Request, res: Response, next: NextFunction) {
    try {
      const result = await slaService.getPolicies();
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async upsertPolicy(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await slaService.upsertPolicy({
        ...req.body,
        priority: slaRepository.parsePriority(req.body.priority),
      });
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await slaService.updateStatus(getSingleParam(req.params.ticketId, "ticketId"), {
        ticketStatus: req.body.ticketStatus,
        assignedTo: req.body.assignedTo,
        resolvedAt: req.body.resolvedAt,
        closedAt: req.body.closedAt,
        firstResponseAt: req.body.firstResponseAt,
        building: req.body.building,
        floor: req.body.floor,
        room: req.body.room,
        supportGroupId: req.body.supportGroupId,
      });

      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async pause(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await slaService.pause(getSingleParam(req.params.ticketId, "ticketId"), req.body?.reason);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async resume(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await slaService.resume(getSingleParam(req.params.ticketId, "ticketId"));
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async runMonitorNow(_req: Request, res: Response, next: NextFunction) {
    try {
      const result = await slaService.runMonitorCycle();
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
};
