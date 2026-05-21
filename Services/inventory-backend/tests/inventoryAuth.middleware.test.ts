import jwt from 'jsonwebtoken';
import { NextFunction, Request, Response } from 'express';
import {
  buildInventoryAccessContext,
  canManageInventory,
  canReadInventory,
  requireInventoryAdminAccess,
  requireInventoryReadAccess,
} from '../src/middlewares/inventoryAuth';

const JWT_SECRET = 'opsmind-secret-key';

function mockResponse(): Response {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function signToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, JWT_SECRET);
}

describe('inventoryAuth access context', () => {
  it('allows ADMIN for read + admin actions', () => {
    const context = buildInventoryAccessContext({
      roles: ['ADMIN'],
      technicianLevel: 'ADMIN',
    });

    expect(canReadInventory(context)).toBe(true);
    expect(canManageInventory(context)).toBe(true);
  });

  it('allows technician levels for read-only access', () => {
    const levels = ['JUNIOR', 'SENIOR', 'SUPERVISOR'];

    levels.forEach((level) => {
      const context = buildInventoryAccessContext({
        roles: ['TECHNICIAN'],
        technicianLevel: level,
      });

      expect(canReadInventory(context)).toBe(true);
      expect(canManageInventory(context)).toBe(false);
    });
  });

  it('denies requester roles', () => {
    ['STUDENT', 'DOCTOR', 'REQUESTER'].forEach((role) => {
      const context = buildInventoryAccessContext({ roles: [role] });
      expect(canReadInventory(context)).toBe(false);
      expect(canManageInventory(context)).toBe(false);
    });
  });
});

describe('inventoryAuth middleware', () => {
  it('returns 401 when auth header is missing', () => {
    const req = { headers: {} } as Request;
    const res = mockResponse();
    const next = jest.fn() as NextFunction;

    requireInventoryReadAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid token', () => {
    const req = { headers: { authorization: 'Bearer invalid-token' } } as unknown as Request;
    const res = mockResponse();
    const next = jest.fn() as NextFunction;

    requireInventoryReadAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 for unauthorized requester roles (student/doctor/requester)', () => {
    ['STUDENT', 'DOCTOR', 'REQUESTER'].forEach((blockedRole) => {
      const token = signToken({
        userId: `user-${blockedRole.toLowerCase()}`,
        email: `${blockedRole.toLowerCase()}@example.com`,
        roles: [blockedRole],
      });
      const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
      const res = mockResponse();
      const next = jest.fn() as NextFunction;

      requireInventoryReadAccess(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  it('allows admin and attaches auth user to request', () => {
    const token = signToken({
      userId: 'admin-1',
      email: 'admin@example.com',
      roles: ['ADMIN'],
    });
    const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
    const res = mockResponse();
    const next = jest.fn() as NextFunction;

    requireInventoryReadAccess(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user?.roles).toContain('ADMIN');
  });

  it('allows technician JWT role with JUNIOR level to read inventory', () => {
    const token = signToken({
      userId: 'tech-junior-1',
      email: 'junior@example.com',
      roles: ['TECHNICIAN'],
      technicianLevel: 'JUNIOR',
    });
    const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
    const res = mockResponse();
    const next = jest.fn() as NextFunction;

    requireInventoryReadAccess(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user?.technicianLevel).toBe('JUNIOR');
  });

  it('allows technician JWT role with SUPERVISOR level to read inventory', () => {
    const token = signToken({
      userId: 'tech-supervisor-1',
      email: 'supervisor@example.com',
      roles: ['TECHNICIAN'],
      technicianLevel: 'SUPERVISOR',
    });
    const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
    const res = mockResponse();
    const next = jest.fn() as NextFunction;

    requireInventoryReadAccess(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user?.technicianLevel).toBe('SUPERVISOR');
  });

  it('blocks non-admin create/delete operations', () => {
    const token = signToken({
      userId: 'tech-1',
      email: 'senior@example.com',
      roles: ['TECHNICIAN'],
      technicianLevel: 'SENIOR',
    });
    const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
    const res = mockResponse();
    const next = jest.fn() as NextFunction;

    requireInventoryAdminAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
