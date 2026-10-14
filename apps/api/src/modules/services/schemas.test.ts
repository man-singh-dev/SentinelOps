import { describe, it, expect } from "vitest";
import { createServiceBodySchema } from "./schemas";

describe("createServiceBodySchema", () => {
  it("accepts a minimal valid body (name only)", () => {
    const result = createServiceBodySchema.safeParse({ name: "payment-service" });
    expect(result.success).toBe(true);
  });
  it("accepts a full valid body with all optional fields", () => {
    const result = createServiceBodySchema.safeParse({
      name: "payment-service",
      description: "Handles payments",
      status: "degraded",
      ownerTeamId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    expect(result.success).toBe(true);
  });

  it("trims whitespace from name", () => {
    const result = createServiceBodySchema.safeParse({ name: "  auth-service  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("auth-service");
    }
  });

  it("accepts every valid status value", () => {
    const statuses = ["operational", "degraded", "partial_outage", "major_outage", "maintenance"];
    for (const status of statuses) {
      const result = createServiceBodySchema.safeParse({ name: "svc", status });
      expect(result.success, `status "${status}" should be accepted`).toBe(true);
    }
  });

  it("rejects missing name", () => {
    const result = createServiceBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });
  it("rejects empty string name (after trim)", () => {
    const result = createServiceBodySchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects name exceeding 255 characters", () => {
    const result = createServiceBodySchema.safeParse({ name: "a".repeat(256) });
    expect(result.success).toBe(false);
  });

  it("rejects description exceeding 2000 characters", () => {
    const result = createServiceBodySchema.safeParse({
      name: "svc",
      description: "x".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid status value", () => {
    const result = createServiceBodySchema.safeParse({ name: "svc", status: "broken" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-UUID ownerTeamId", () => {
    const result = createServiceBodySchema.safeParse({
      name: "svc",
      ownerTeamId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects numeric name (type mismatch)", () => {
    const result = createServiceBodySchema.safeParse({ name: 42 });
    expect(result.success).toBe(false);
  });

  it("accepts name at exactly 255 characters", () => {
    const result = createServiceBodySchema.safeParse({ name: "a".repeat(255) });
    expect(result.success).toBe(true);
  });

  it("accepts description at exactly 2000 characters", () => {
    const result = createServiceBodySchema.safeParse({
      name: "svc",
      description: "x".repeat(2000),
    });
    expect(result.success).toBe(true);
  });

  it("strips unknown fields", () => {
    const result = createServiceBodySchema.safeParse({
      name: "svc",
      extraField: "should-not-appear",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("extraField" in result.data).toBe(false);
    }
  });
});
