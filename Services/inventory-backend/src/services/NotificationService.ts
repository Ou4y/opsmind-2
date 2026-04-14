import axios from 'axios';

export class NotificationService {
  private notificationApiUrl = process.env.NOTIFICATION_API_URL || 'http://localhost:3000/api/notifications';
  private internalSecret = process.env.INTERNAL_SECRET || 'supersecret';

  /**
   * Send low stock notification to admin
   * @param assetId - custom asset ID (e.g. "ASSET-123")
   * @param assetName - asset name (e.g. "Printer Cartridge")
   * @param remainingQuantity - current quantity in stock
   * @param adminId - admin user ID
   * @param adminEmail - admin email address
   */
  async notifyLowStock(
    assetId: string,
    assetName: string,
    remainingQuantity: number,
    adminId: string = 'admin1',
    adminEmail: string = 'admin@email.com'
  ): Promise<void> {
    try {
      const payload = {
        type: 'LOW_STOCK',
        payload: {
          item: {
            id: assetId,
            name: assetName
          },
          remainingQuantity,
          admin: {
            id: adminId,
            email: adminEmail
          }
        }
      };

      const response = await axios.post(this.notificationApiUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': this.internalSecret
        }
      });

      console.log(`[NOTIFICATION] ✅ Low stock alert sent for ${assetName} (${assetId})`);
      console.log(`[NOTIFICATION] Response:`, response.status, response.data);
    } catch (error: any) {
      console.error(`[NOTIFICATION] ❌ Failed to send low stock notification for ${assetName}:`, error.message);
      // Don't throw — log and continue so that transfer still succeeds even if notification fails
    }
  }
}

export const notificationService = new NotificationService();
