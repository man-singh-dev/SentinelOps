import { describe, it, expect, afterEach } from "vitest";
import { buildServer } from "../../app";
import type { FastifyInstance } from "fastify";
const validPayload = {
  eventId: "evt_abc123",
  eventType: "payment.failed",
  severity: "critical",
  message: "Gateway timeout while charging card",
  timestamp: "2026-01-01T12:00:00Z",
  metadata: { region: "ap-south-1", gateway: "stripe" },
};

describe("POST /api/v1/events", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 400 with issues when body is empty", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ message: string; issues: unknown[] }>();
    expect(body.message).toBe("Validation failed");
    expect(body.issues).toBeDefined();
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("returns 400 when eventId is missing", async () => {
    app = buildServer();

    const noEventId = {
      eventType: validPayload.eventType,
      severity: validPayload.severity,
      message: validPayload.message,
      timestamp: validPayload.timestamp,
      metadata: validPayload.metadata,
    };
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      payload: noEventId,
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when severity is invalid", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      payload: { ...validPayload, severity: "urgent" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when timestamp is not ISO-8601", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      payload: { ...validPayload, timestamp: "yesterday" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when timestamp is date-only (no time)", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      payload: { ...validPayload, timestamp: "2026-01-01" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 501 for a valid body (not yet implemented)", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      payload: validPayload,
    });

    expect(response.statusCode).toBe(501);
    const body = response.json<{ message: string }>();
    expect(body.message).toContain("not yet implemented");
  });

  it("returns 501 for a minimal valid body", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      payload: {
        eventId: "evt_1",
        eventType: "deploy.started",
        severity: "low",
        timestamp: "2026-06-15T08:30:00Z",
      },
    });

    expect(response.statusCode).toBe(501);
  });
});
