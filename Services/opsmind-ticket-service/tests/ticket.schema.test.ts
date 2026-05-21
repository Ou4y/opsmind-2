import {
  createTicketSchema,
  escalateTicketSchema,
  updateTicketSchema,
} from "../src/validation/ticket.schema";

describe("ticket.schema", () => {
  it("accepts valid create payload", () => {
    const parsed = createTicketSchema.parse({
      title: "Printer broken",
      description: "Printer on floor 2 is not printing",
      type_of_request: "INCIDENT",
      requester_id: "123e4567-e89b-12d3-a456-426614174000",
      latitude: 24.7136,
      longitude: 46.6753,
    });

    expect(parsed.title).toBe("Printer broken");
  });

  it("rejects create payload with invalid coordinates", () => {
    expect(() =>
      createTicketSchema.parse({
        title: "Printer broken",
        description: "Printer on floor 2 is not printing",
        type_of_request: "INCIDENT",
        requester_id: "123e4567-e89b-12d3-a456-426614174000",
        latitude: 99,
        longitude: 46.6753,
      })
    ).toThrow();
  });

  it("accepts partial update payload", () => {
    const parsed = updateTicketSchema.parse({
      status: "IN_PROGRESS",
      assigned_to_level: "L2",
    });

    expect(parsed.status).toBe("IN_PROGRESS");
    expect(parsed.assigned_to_level).toBe("L2");
  });

  it("accepts optional agentic-ai creation fields", () => {
    const parsed = createTicketSchema.parse({
      title: "Laptop cannot connect to VPN",
      description: "Windows laptop keeps dropping VPN connection",
      type_of_request: "INCIDENT",
      requester_id: "123e4567-e89b-12d3-a456-426614174000",
      latitude: 24.7136,
      longitude: 46.6753,
      affectedDeviceId: null,
      affectedDeviceName: "HQ-LAPTOP-44",
      osType: "WINDOWS",
      issueScope: "MY_DEVICE",
      remoteSupportConsent: true,
    });

    expect(parsed.osType).toBe("WINDOWS");
    expect(parsed.issueScope).toBe("MY_DEVICE");
    expect(parsed.remoteSupportConsent).toBe(true);
  });

  it("rejects invalid osType value", () => {
    expect(() =>
      createTicketSchema.parse({
        title: "VPN issue",
        description: "Need help with VPN",
        type_of_request: "INCIDENT",
        requester_id: "123e4567-e89b-12d3-a456-426614174000",
        latitude: 24.7136,
        longitude: 46.6753,
        osType: "ANDROID",
      })
    ).toThrow();
  });

  it("requires escalation reason", () => {
    expect(() =>
      escalateTicketSchema.parse({
        from_level: "L1",
        to_level: "L2",
        reason: "",
      })
    ).toThrow("Reason is required");
  });
});
