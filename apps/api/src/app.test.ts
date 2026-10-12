import { describe, it, expect, afterEach } from "vitest";
import { buildServer } from "./app";
import type { FastifyInstance } from "fastify";

describe("buildServer()", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app.close();
  });

  it("constructs the application without starting a listener", () => {
    app = buildServer();
    expect(app).toBeDefined();
  });

  it("GET /health returns 200 with { status: 'ok' }", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("app.close() resolves without error", async () => {
    app = buildServer();
    await app.ready();
    await expect(app.close()).resolves.toBeUndefined();
    app = buildServer();
  });
});
