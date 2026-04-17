const request = require("supertest");
const PDFDocument = require("pdfkit");

//  Mocks
jest.mock("./models/ticket.model", () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  find: jest.fn(),
  findOneAndUpdate: jest.fn()
}));

jest.mock("./services/ticket.service", () => ({
  getResolvedTickets: jest.fn()
}));

jest.mock("pdfkit");

const Ticket = require("./models/ticket.model");
const ticketService = require("./services/ticket.service");
const controller = require("./controllers/report.controller");
const app = require("./app");


// =====================================================
//  API TESTS
// =====================================================
describe("Report APIs", () => {

  test("GET /analytics/sync → should sync tickets", async () => {
    const mockTickets = [{ id: "1", title: "Test Ticket" }];

    ticketService.getResolvedTickets.mockResolvedValue(mockTickets);
    Ticket.findOne.mockResolvedValue(null);
    Ticket.create.mockResolvedValue({});

    const res = await request(app).get("/analytics/sync");

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Synced successfully");
    expect(res.body.count).toBe(1);
  });

  test("GET /analytics/technician/:id → should return tickets", async () => {
    const mockData = [{ id: "1", assigned_to: "TECH-1" }];

    Ticket.find.mockResolvedValue(mockData);

    const res = await request(app).get("/analytics/technician/TECH-1");

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(1);
  });

  test("POST /analytics/solution/:id → should add solution", async () => {
    const updatedTicket = {
      id: "1",
      technician_solution: "Fixed"
    };

    Ticket.findOneAndUpdate.mockResolvedValue(updatedTicket);

    const res = await request(app)
      .post("/analytics/solution/1")
      .send({ solution: "Fixed" });

    expect(res.statusCode).toBe(200);
    expect(res.body.technician_solution).toBe("Fixed");
  });

  test("GET /analytics/sync → should handle error", async () => {
    ticketService.getResolvedTickets.mockRejectedValue(new Error("Fail"));

    const res = await request(app).get("/analytics/sync");

    expect(res.statusCode).toBe(500);
  });

  test("GET /analytics/technician/:id → empty list", async () => {
    Ticket.find.mockResolvedValue([]);

    const res = await request(app).get("/analytics/technician/EMPTY");

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(0);
  });

});


// =====================================================
//  PDF TESTS
// =====================================================
describe("generatePDF Controller", () => {

  const mockTicketData = {
    id: "TICKET-PDF-001",
    title: "Test PDF Ticket",
    description: "Test description",
    priority: "High",
    assigned_to: "TECH-1",
    created_at: new Date("2026-04-13T00:00:00Z"),
    technician_solution: "Solved"
  };

  const createMockDoc = () => ({
    pipe: jest.fn(),
    fontSize: jest.fn().mockReturnThis(),
    font: jest.fn().mockReturnThis(),
    text: jest.fn().mockReturnThis(),
    moveDown: jest.fn().mockReturnThis(),
    end: jest.fn()
  });

  const createMockRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    setHeader: jest.fn()
  });

  test("generatePDF returns PDF for existing ticket", async () => {
    Ticket.findOne.mockResolvedValue(mockTicketData);

    const mockDoc = createMockDoc();
    PDFDocument.mockImplementation(() => mockDoc);

    const req = { params: { ticketId: "TICKET-PDF-001" } };
    const res = createMockRes();

    await controller.generatePDF(req, res);

    expect(Ticket.findOne).toHaveBeenCalledWith({ id: "TICKET-PDF-001" });

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      "attachment; filename=report-TICKET-PDF-001.pdf"
    );

    expect(mockDoc.pipe).toHaveBeenCalledWith(res);
    expect(mockDoc.end).toHaveBeenCalled();
  });

  test("generatePDF returns 404 when ticket not found", async () => {
    Ticket.findOne.mockResolvedValue(null);

    const req = { params: { ticketId: "NOT_FOUND" } };
    const res = createMockRes();

    await controller.generatePDF(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: "Ticket not found" });
  });

  test("generatePDF handles missing solution", async () => {
    const ticketNoSolution = { ...mockTicketData, technician_solution: null };
    Ticket.findOne.mockResolvedValue(ticketNoSolution);

    const mockDoc = createMockDoc();
    PDFDocument.mockImplementation(() => mockDoc);

    const req = { params: { ticketId: "TICKET-PDF-001" } };
    const res = createMockRes();

    await controller.generatePDF(req, res);

    const textCalls = mockDoc.text.mock.calls.map(c => c[0]);

    expect(
      textCalls.some(
        text => typeof text === "string" && text.includes("No solution added")
      )
    ).toBe(true);
  });

  test("generatePDF handles errors", async () => {
    Ticket.findOne.mockRejectedValue(new Error("DB Error"));

    const req = { params: { ticketId: "ERR" } };
    const res = createMockRes();

    await controller.generatePDF(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      message: "Error generating PDF"
    });
  });

  test("generatePDF includes ticket data", async () => {
    Ticket.findOne.mockResolvedValue(mockTicketData);

    const mockDoc = createMockDoc();
    PDFDocument.mockImplementation(() => mockDoc);

    const req = { params: { ticketId: "TICKET-PDF-001" } };
    const res = createMockRes();

    await controller.generatePDF(req, res);

    const textCalls = mockDoc.text.mock.calls.map(c => c[0]);

    expect(textCalls.some(t => typeof t === "string" && t.includes("TICKET-PDF-001"))).toBe(true);
    expect(textCalls.some(t => typeof t === "string" && t.includes("Test PDF Ticket"))).toBe(true);
    expect(textCalls.some(t => typeof t === "string" && t.includes("High"))).toBe(true);
  });

  test("generatePDF structure", async () => {
    Ticket.findOne.mockResolvedValue(mockTicketData);

    const mockDoc = createMockDoc();
    PDFDocument.mockImplementation(() => mockDoc);

    const req = { params: { ticketId: "TICKET-PDF-001" } };
    const res = createMockRes();

    await controller.generatePDF(req, res);

    expect(mockDoc.fontSize).toHaveBeenCalled();
    expect(mockDoc.moveDown).toHaveBeenCalled();
    expect(mockDoc.end).toHaveBeenCalled();
  });

});