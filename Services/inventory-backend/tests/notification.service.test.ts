import axios from "axios";
import { NotificationService } from "../src/services/NotificationService";

jest.mock("axios");

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("NotificationService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("posts low-stock payload with internal auth header", async () => {
    process.env.NOTIFICATION_API_URL = "http://notification-service.local/api/notifications";
    process.env.INTERNAL_SECRET = "test-secret";
    mockedAxios.post.mockResolvedValue({ status: 200, data: { success: true } } as never);

    const service = new NotificationService();

    await service.notifyLowStock(
      "ASSET-123",
      "Printer Cartridge",
      2,
      "admin-1",
      "admin@example.com"
    );

    expect(mockedAxios.post).toHaveBeenCalledWith(
      "http://notification-service.local/api/notifications",
      {
        type: "LOW_STOCK",
        payload: {
          item: {
            id: "ASSET-123",
            name: "Printer Cartridge",
          },
          remainingQuantity: 2,
          admin: {
            id: "admin-1",
            email: "admin@example.com",
          },
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": "test-secret",
        },
      }
    );
  });

  it("does not throw when notification request fails", async () => {
    mockedAxios.post.mockRejectedValue(new Error("network down"));

    const service = new NotificationService();

    await expect(
      service.notifyLowStock("ASSET-123", "Printer Cartridge", 2)
    ).resolves.toBeUndefined();
  });
});
