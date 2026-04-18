import { TOPICS } from "../src/events/assetEvents";

describe("TOPICS", () => {
  it("exposes the expected asset event routing keys", () => {
    expect(TOPICS).toEqual({
      ASSET_CREATED: "asset.created",
      ASSET_UPDATED: "asset.updated",
      ASSET_DELETED: "asset.deleted",
      ASSET_TRANSFERRED: "asset.transferred",
      ASSET_LOW_STOCK: "asset.low_stock",
    });
  });
});
