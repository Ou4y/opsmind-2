import axios from 'axios';
import { sendInventoryApprovalNotification } from '../src/services/inventoryApprovalService';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Inventory approval notification client', () => {
  const oldEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...oldEnv,
      INVENTORY_APPROVAL_NOTIFICATION_ENABLED: 'true',
      NOTIFICATION_SERVICE_URL: 'http://notification-service:3000/api/notifications',
    };
  });

  afterAll(() => {
    process.env = oldEnv;
  });

  it('publishes approval requested event to notification-service', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { message: 'ok' } });
    const result = await sendInventoryApprovalNotification('approval_requested', {
      approvalRequestId: 'apr-1',
      requestCode: 'INV-APR-1',
      approverRole: 'SENIOR',
      buildingCode: 'MAIN',
      requester: { userId: 'junior-1' },
    });

    expect(result.ok).toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://notification-service:3000/api/notifications/events',
      expect.objectContaining({
        routingKey: 'inventory.notification.approval_requested',
        payload: expect.objectContaining({
          requestCode: 'INV-APR-1',
          approverRole: 'SENIOR',
          buildingCode: 'MAIN',
          requester: expect.objectContaining({ userId: 'junior-1' }),
        }),
      }),
      expect.objectContaining({
        timeout: 5000,
      }),
    );
  });

  it('returns warning instead of throwing when notification-service fails', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('service unavailable'));
    const result = await sendInventoryApprovalNotification('approval_rejected', {
      approvalRequestId: 'apr-2',
      requesterUserId: 'junior-1',
    });

    expect(result.ok).toBe(false);
    expect(result.warning).toContain('service unavailable');
  });
});
