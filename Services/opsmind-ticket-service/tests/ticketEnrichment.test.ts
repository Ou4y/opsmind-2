jest.mock("../src/utils/userServiceClient", () => ({
  fetchTechnicianName: jest.fn(),
  fetchTechnicianNames: jest.fn(),
}));

import {
  enrichTicketWithTechnicianName,
  enrichTicketsWithTechnicianNames,
} from "../src/utils/ticketEnrichment";
import {
  fetchTechnicianName,
  fetchTechnicianNames,
} from "../src/utils/userServiceClient";

describe("ticketEnrichment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null assigned_to_name when ticket is unassigned", async () => {
    const ticket = { id: "t1", assigned_to: null } as any;

    const result = await enrichTicketWithTechnicianName(ticket);

    expect(result.assigned_to_name).toBeNull();
    expect(fetchTechnicianName).not.toHaveBeenCalled();
  });

  it("enriches single ticket using fetched technician name", async () => {
    (fetchTechnicianName as jest.Mock).mockResolvedValue("Alice");
    const ticket = { id: "t2", assigned_to: "tech-1" } as any;

    const result = await enrichTicketWithTechnicianName(ticket);

    expect(fetchTechnicianName).toHaveBeenCalledWith("tech-1");
    expect(result.assigned_to_name).toBe("Alice");
  });

  it("batch enriches tickets and maps known names", async () => {
    (fetchTechnicianNames as jest.Mock).mockResolvedValue(
      new Map<string, string>([
        ["tech-1", "Alice"],
        ["tech-2", "Bob"],
      ])
    );

    const result = await enrichTicketsWithTechnicianNames([
      { id: "t1", assigned_to: "tech-1" } as any,
      { id: "t2", assigned_to: "tech-2" } as any,
      { id: "t3", assigned_to: null } as any,
      { id: "t4", assigned_to: "tech-unknown" } as any,
    ]);

    expect(fetchTechnicianNames).toHaveBeenCalledWith([
      "tech-1",
      "tech-2",
      "tech-unknown",
    ]);
    expect(result.map((t) => t.assigned_to_name)).toEqual([
      "Alice",
      "Bob",
      null,
      null,
    ]);
  });

  it("returns empty array for empty batch", async () => {
    const result = await enrichTicketsWithTechnicianNames([]);

    expect(result).toEqual([]);
    expect(fetchTechnicianNames).not.toHaveBeenCalled();
  });
});
