import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./app";
import type { FastifyInstance } from "fastify";
describe("buildServer()", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });
  it("constructs the application without starting a listener", () => {
    const start=performance.now();
    app = buildServer();
    const end=performance.now();
    console.log(`buildSercer() took ${(end-start).toFixed(2)}ms `)
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
  //graceful shutdown
  it("app.close() resolves without error", async () => {
    const testApp = buildServer();
    await testApp.ready();
    await expect(testApp.close()).resolves.toBeUndefined();
  });
});