import { Request, Response } from 'express';
import { domainRepository } from './domain.repository';
import { logger } from '@config/logger';

export const domainController = {
  async addDomain(req: Request, res: Response): Promise<void> {
    try {
      const { domain } = req.body;
      if (!domain) {
        res.status(400).json({ success: false, message: 'Domain is required' });
        return;
      }
      
      const cleanDomain = domain.trim().toLowerCase();
      // Basic domain check
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleanDomain)) {
        res.status(400).json({ success: false, message: 'Invalid domain format' });
        return;
      }

      await domainRepository.addDomain(cleanDomain);
      res.status(201).json({ success: true, message: 'Domain added successfully', domain: cleanDomain });
    } catch (error: any) {
      if (error.code === 'ER_DUP_ENTRY') {
        res.status(400).json({ success: false, message: 'Domain already exists' });
        return;
      }
      logger.error('Error adding domain', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  async removeDomain(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      await domainRepository.removeDomain(id);
      res.status(200).json({ success: true, message: 'Domain removed successfully' });
    } catch (error) {
      logger.error('Error removing domain', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  },

  async getDomains(req: Request, res: Response): Promise<void> {
    try {
      const domains = await domainRepository.getDomains();
      res.status(200).json({ success: true, data: domains });
    } catch (error) {
      logger.error('Error getting domains', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
};
