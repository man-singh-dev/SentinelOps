import { describe, it, expect } from "vitest";
import { ingestEventBodySchema } from "./schemas";

/** A valid baseline body matching the README curl example. */
const validBody = {
  eventId: "evt_abc123",
  eventType: "payment.failed",
  severity: "critical" as const,
  message: "Gateway timeout while charging card",
  timestamp: "2026-01-01T12:00:00Z",
  metadata: { region: "ap-south-1", gateway: "stripe" },
};

describe("ingestEventBodySchema", () => {


  it("accepts the README example body", () => {
    const result = ingestEventBodySchema.safeParse(validBody);
    expect(result.success).toBe(true);
  });

  it("accepts a minimal body (required fields only)", () => {
    const result = ingestEventBodySchema.safeParse({
      eventId: "evt_1",
      eventType: "deploy.started",
      severity: "low",
      timestamp: "2026-06-15T08:30:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("trims whitespace from eventId", () => {
    const result = ingestEventBodySchema.safeParse({
      ...validBody,
      eventId: "  evt_trimmed  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eventId).toBe("evt_trimmed");
    }
  });

  it("accepts every valid severity value", () => {
    const severities = ["critical", "high", "medium", "low"];
    for (const severity of severities) {
      const result = ingestEventBodySchema.safeParse({ ...validBody, severity });
      expect(result.success, `severity "${severity}" should be accepted`).toBe(true);
    }
  });

  it("accepts a timestamp with timezone offset", () => {
    const result = ingestEventBodySchema.safeParse({
      ...validBody,
      timestamp: "2026-06-15T14:00:00+05:30",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty metadata object", () => {
    const result = ingestEventBodySchema.safeParse({
      ...validBody,
      metadata: {},
    });
    expect(result.success).toBe(true);
  });

  

  it("rejects missing eventId", () => {
    const body = { eventType: validBody.eventType, severity: validBody.severity, message: validBody.message, timestamp: validBody.timestamp, metadata: validBody.metadata };
    const result = ingestEventBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it("rejects empty eventId (after trim)", () => {
    const result = ingestEventBodySchema.safeParse({ ...validBody, eventId: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects eventId exceeding 255 characters", () => {
    const result = ingestEventBodySchema.safeParse({
      ...validBody,
      eventId: "e".repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing eventType", () => {
    const body = { eventId: validBody.eventId, severity: validBody.severity, message: validBody.message, timestamp: validBody.timestamp, metadata: validBody.metadata };
    const result = ingestEventBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it("rejects empty eventType (after trim)", () => {
    const result = ingestEventBodySchema.safeParse({ ...validBody, eventType: "  " });
    expect(result.success).toBe(false);
  });

  it("rejects eventType exceeding 255 characters", () => {
    const result = ingestEventBodySchema.safeParse({
      ...validBody,
      eventType: "t".repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing severity", () => {
    const body = { eventId: validBody.eventId, eventType: validBody.eventType, message: validBody.message, timestamp: validBody.timestamp, metadata: validBody.metadata };
    const result = ingestEventBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it("rejects an invalid severity value", () => {
    const result = ingestEventBodySchema.safeParse({ ...validBody, severity: "urgent" });
    expect(result.success).toBe(false);
  });

  it("rejects missing timestamp", () => {
    const body = { eventId: validBody.eventId, eventType: validBody.eventType, severity: validBody.severity, message: validBody.message, metadata: validBody.metadata };
    const result = ingestEventBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it("rejects an invalid timestamp format", () => {
    const result = ingestEventBodySchema.safeParse({
      ...validBody,
      timestamp: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a timestamp without time component", () => {
    const result = ingestEventBodySchema.safeParse({
      ...validBody,
      timestamp: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects message exceeding 10 000 characters", () => {
    const result = ingestEventBodySchema.safeParse({
      ...validBody,
      message: "m".repeat(10_001),
    });
    expect(result.success).toBe(false);
  });

  it("accepts eventId at exactly 255 characters", () => {
    const result = ingestEventBodySchema.safeParse({
      ...validBody,
      eventId: "e".repeat(255),
    });
    expect(result.success).toBe(true);
  });

  it("accepts message at exactly 10 000 characters", () => {
    const result = ingestEventBodySchema.safeParse({
      ...validBody,
      message: "m".repeat(10_000),
    });
    expect(result.success).toBe(true);
  });

  it("strips unknown fields", () => {
    const result = ingestEventBodySchema.safeParse({
      ...validBody,
      unknownField: "surprise",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("unknownField" in result.data).toBe(false);
    }
  });

  it("rejects a completely empty object", () => {
    const result = ingestEventBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
