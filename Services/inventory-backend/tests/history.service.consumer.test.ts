jest.mock("../src/services/EventBus", () => ({
  EventBus: {
    subscribe: jest.fn(),
  },
}));

jest.mock("../src/models/History", () => ({
  __esModule: true,
  default: {
    createHistory: jest.fn(),
  },
}));

import { TOPICS } from "../src/events/assetEvents";
import { EventBus } from "../src/services/EventBus";
import HistoryService from "../src/models/History";
import startHistoryService from "../src/services/history-service/index";

describe("history-service event consumers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("subscribes to created/transferred/updated/deleted topics", async () => {
    const subscribeMock = EventBus.subscribe as jest.Mock;
    await startHistoryService();

    const subscribedTopics = subscribeMock.mock.calls.map((call) => call[0]);
    expect(subscribedTopics).toEqual(
      expect.arrayContaining([
        TOPICS.ASSET_CREATED,
        TOPICS.ASSET_TRANSFERRED,
        TOPICS.ASSET_UPDATED,
        TOPICS.ASSET_DELETED,
      ])
    );
  });

  it("writes history entries for transfer and update payloads", async () => {
    const subscribeMock = EventBus.subscribe as jest.Mock;
    const createHistoryMock = HistoryService.createHistory as jest.Mock;
    await startHistoryService();

    const handlers = new Map<string, (data: any) => Promise<void>>();
    for (const [topic, cb] of subscribeMock.mock.calls) {
      handlers.set(topic as string, cb as (data: any) => Promise<void>);
    }

    const transferHandler = handlers.get(TOPICS.ASSET_TRANSFERRED);
    const updateHandler = handlers.get(TOPICS.ASSET_UPDATED);

    expect(transferHandler).toBeDefined();
    expect(updateHandler).toBeDefined();

    await transferHandler!({
      customId: "ASSET-100",
      quantityMoved: 2,
      destination: "Main Building",
    });
    await updateHandler!({
      customId: "ASSET-100",
      fields: ["status", "specifications.workingHours"],
    });

    expect(createHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "ASSET-100",
        action: "TRANSFERRED",
      })
    );
    expect(createHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "ASSET-100",
        action: "UPDATED",
      })
    );
  });
});
