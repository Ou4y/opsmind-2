import { v4 as uuidv4 } from 'uuid';
import { query } from '@database/connection';
import { Technician, Building, TechnicianBuilding } from '@/types';

export class TechnicianRepository {
  async create(data: {
    userId: string;
    employeeId?: string;
    department?: string;
    specialization?: string;
  }): Promise<Technician> {
    const id = uuidv4();
    
    await query(
      `INSERT INTO technicians (id, user_id, employee_id, department, specialization)
       VALUES (?, ?, ?, ?, ?)`,
      [id, data.userId, data.employeeId || null, data.department || null, data.specialization || null]
    );

    return this.findById(id) as Promise<Technician>;
  }

  async findById(id: string): Promise<Technician | null> {
    const technicians = await query<Technician[]>(
      'SELECT * FROM technicians WHERE id = ?',
      [id]
    );
    return technicians[0] || null;
  }

  async findByUserId(userId: string): Promise<Technician | null> {
    const technicians = await query<Technician[]>(
      'SELECT * FROM technicians WHERE user_id = ?',
      [userId]
    );
    return technicians[0] || null;
  }

  async findByEmployeeId(employeeId: string): Promise<Technician | null> {
    const technicians = await query<Technician[]>(
      'SELECT * FROM technicians WHERE employee_id = ?',
      [employeeId]
    );
    return technicians[0] || null;
  }

  async assignBuilding(technicianId: string, buildingId: string, isPrimary: boolean = false): Promise<void> {
    const existing = await query<TechnicianBuilding[]>(
      'SELECT id FROM technician_buildings WHERE technician_id = ? AND building_id = ?',
      [technicianId, buildingId]
    );

    if (existing.length > 0) {
      return; // Already assigned
    }

    // If setting as primary, unset other primaries first
    if (isPrimary) {
      await query(
        'UPDATE technician_buildings SET is_primary = FALSE WHERE technician_id = ?',
        [technicianId]
      );
    }

    await query(
      `INSERT INTO technician_buildings (id, technician_id, building_id, is_primary)
       VALUES (?, ?, ?, ?)`,
      [uuidv4(), technicianId, buildingId, isPrimary]
    );
  }

  async getTechnicianBuildings(technicianId: string): Promise<Building[]> {
    return query<Building[]>(
      `SELECT b.* FROM buildings b
       INNER JOIN technician_buildings tb ON b.id = tb.building_id
       WHERE tb.technician_id = ?`,
      [technicianId]
    );
  }

  async findAll(): Promise<any[]> {
    return query(
      `SELECT t.*, u.email, u.first_name, u.last_name, u.is_active
       FROM technicians t
       INNER JOIN users u ON t.user_id = u.id
       ORDER BY t.created_at DESC`
    );
  }
}

export class BuildingRepository {
  async findById(id: string): Promise<Building | null> {
    const buildings = await query<Building[]>(
      'SELECT * FROM buildings WHERE id = ?',
      [id]
    );
    return buildings[0] || null;
  }

  async findByCode(code: string): Promise<Building | null> {
    const buildings = await query<Building[]>(
      'SELECT * FROM buildings WHERE code = ?',
      [code]
    );
    return buildings[0] || null;
  }

  async findAll(): Promise<Building[]> {
    return query<Building[]>('SELECT * FROM buildings ORDER BY name ASC');
  }

  async create(data: { name: string; code: string; address?: string }): Promise<Building> {
    const id = uuidv4();
    
    await query(
      `INSERT INTO buildings (id, name, code, address) VALUES (?, ?, ?, ?)`,
      [id, data.name, data.code, data.address || null]
    );

    return this.findById(id) as Promise<Building>;
  }
}

export const technicianRepository = new TechnicianRepository();
export const buildingRepository = new BuildingRepository();
