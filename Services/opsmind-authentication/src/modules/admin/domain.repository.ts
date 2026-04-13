import { query } from '@database/connection';

export interface AllowedDomain {
  id: string;
  domain: string;
  is_active: boolean;
  created_at: Date;
}

export const domainRepository = {
  async addDomain(domain: string): Promise<void> {
    await query(
      'INSERT INTO allowed_domains (id, domain, is_active) VALUES (UUID(), ?, TRUE)',
      [domain]
    );
  },

  async removeDomain(id: string): Promise<void> {
    await query('DELETE FROM allowed_domains WHERE id = ?', [id]);
  },

  async getDomains(): Promise<AllowedDomain[]> {
    return query<AllowedDomain[]>('SELECT * FROM allowed_domains ORDER BY domain ASC');
  },

  async getActiveDomains(): Promise<string[]> {
    const rows = await query<AllowedDomain[]>('SELECT domain FROM allowed_domains WHERE is_active = TRUE');
    return rows.map((r) => r.domain);
  }
};
