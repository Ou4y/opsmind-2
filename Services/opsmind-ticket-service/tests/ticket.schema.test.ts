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
