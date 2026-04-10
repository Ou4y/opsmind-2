import { v4 as uuidv4 } from 'uuid';
import { query } from '@database/connection';
import { User, UserWithRoles, Role, RoleName } from '@/types';

export class UserRepository {
  async findById(id: string): Promise<User | null> {
    const users = await query<User[]>(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );
    return users[0] || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const users = await query<User[]>(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );
    return users[0] || null;
  }

  async findByIdWithRoles(id: string): Promise<UserWithRoles | null> {
    const users = await query<User[]>(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );
    
    if (!users[0]) return null;

    const roles = await this.getUserRoles(id);
    return { ...users[0], roles };
  }

  async findByEmailWithRoles(email: string): Promise<UserWithRoles | null> {
    const users = await query<User[]>(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );
    
    if (!users[0]) return null;

    const roles = await this.getUserRoles(users[0].id);
    return { ...users[0], roles };
  }

  async create(data: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    isVerified?: boolean;
    isActive?: boolean;
  }): Promise<User> {
    const id = uuidv4();
    
    await query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, is_verified, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, data.email, data.passwordHash, data.firstName, data.lastName, data.isVerified || false, data.isActive !== undefined ? data.isActive : true]
    );

    return this.findById(id) as Promise<User>;
  }

  async updateVerificationStatus(userId: string, isVerified: boolean): Promise<void> {
    await query(
      'UPDATE users SET is_verified = ? WHERE id = ?',
      [isVerified, userId]
    );
  }

  async updateActiveStatus(userId: string, isActive: boolean): Promise<void> {
    await query(
      'UPDATE users SET is_active = ? WHERE id = ?',
      [isActive, userId]
    );
  }

  async assignRole(userId: string, roleName: RoleName): Promise<void> {
    const roles = await query<Role[]>(
      'SELECT id FROM roles WHERE name = ?',
      [roleName]
    );

    if (!roles[0]) {
      throw new Error(`Role ${roleName} not found`);
    }

    const existingAssignment = await query<any[]>(
      'SELECT id FROM user_roles WHERE user_id = ? AND role_id = ?',
      [userId, roles[0].id]
    );

    if (existingAssignment.length > 0) {
      return; // Role already assigned
    }

    await query(
      'INSERT INTO user_roles (id, user_id, role_id) VALUES (?, ?, ?)',
      [uuidv4(), userId, roles[0].id]
    );
  }

  async getUserRoles(userId: string): Promise<Role[]> {
    return query<Role[]>(
      `SELECT r.* FROM roles r
       INNER JOIN user_roles ur ON r.id = ur.role_id
       WHERE ur.user_id = ?`,
      [userId]
    );
  }

  async hasRole(userId: string, roleName: RoleName): Promise<boolean> {
    const roles = await this.getUserRoles(userId);
    return roles.some(r => r.name === roleName);
  }

  async findAll(options?: { isActive?: boolean }): Promise<UserWithRoles[]> {
    let sql = 'SELECT * FROM users';
    const params: any[] = [];

    if (options?.isActive !== undefined) {
      sql += ' WHERE is_active = ?';
      params.push(options.isActive);
    }

    sql += ' ORDER BY created_at DESC';

    const users = await query<User[]>(sql, params);
    
    return Promise.all(
      users.map(async (user) => {
        const roles = await this.getUserRoles(user.id);
        return { ...user, roles };
      })
    );
  }

  async delete(userId: string): Promise<void> {
    // Delete in order to respect foreign key constraints
    // 1. Delete OTPs
    await query('DELETE FROM email_otps WHERE user_id = ?', [userId]);
    
    // 2. Delete user roles
    await query('DELETE FROM user_roles WHERE user_id = ?', [userId]);
    
    // 3. Delete technician building assignments (if technician)
    await query(
      'DELETE FROM technician_buildings WHERE technician_id IN (SELECT id FROM technicians WHERE user_id = ?)',
      [userId]
    );
    
    // 4. Delete technician profile (if exists)
    await query('DELETE FROM technicians WHERE user_id = ?', [userId]);
    
    // 5. Finally delete the user
    await query('DELETE FROM users WHERE id = ?', [userId]);
  }
}

export const userRepository = new UserRepository();
