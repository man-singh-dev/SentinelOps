import { describe, it, expect, afterEach } from "vitest";
import { buildServer } from "../../app";
import type { FastifyInstance } from "fastify";

describe("POST /api/v1/services", () => {
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
      url: "/api/v1/services",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ message: string; issues: unknown[] }>();
    expect(body.message).toBe("Validation failed");
    expect(body.issues).toBeDefined();
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("returns 400 when name is missing", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/services",
      payload: { description: "No name supplied" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when name exceeds 255 characters", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/services",
      payload: { name: "x".repeat(256) },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when status is invalid", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/services",
      payload: { name: "svc", status: "exploded" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 501 for a valid body (not yet implemented)", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/services",
      payload: { name: "payment-service" },
    });

    expect(response.statusCode).toBe(501);
    const body = response.json<{ message: string }>();
    expect(body.message).toContain("not yet implemented");
  });

  it("returns 501 for a full valid body with all optional fields", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/services",
      payload: {
        name: "auth-service",
        description: "Handles auth",
        status: "operational",
        ownerTeamId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      },
    });

    expect(response.statusCode).toBe(501);
  });
});
