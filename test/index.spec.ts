import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const BASE = "https://api.kyletebo.com";

describe("GET /hello", () => {
  it("returns the canned reply as JSON", async () => {
    const response = await exports.default.fetch(`${BASE}/hello`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      ok: true,
      message: "Hello from the Workbench. The plumbing works.",
      phase: 0,
    });
  });

  it("refuses anything other than GET", async () => {
    const response = await exports.default.fetch(`${BASE}/hello`, { method: "POST" });

    expect(response.status).toBe(405);
  });
});

describe("unknown paths", () => {
  it("returns 404", async () => {
    const response = await exports.default.fetch(`${BASE}/nope`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });
});

describe("CORS: which websites may call the Worker from a browser", () => {
  const SITE = "https://kyletebo.com";

  it("lets kyletebo.com read the reply", async () => {
    const response = await exports.default.fetch(`${BASE}/hello`, {
      headers: { origin: SITE },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it.each([
    "https://evil.example",
    "http://kyletebo.com",
    "https://www.kyletebo.com",
    "https://kyletebo.com.evil.example",
    "https://notkyletebo.com",
    "null",
  ])("refuses %s", async (origin) => {
    const response = await exports.default.fetch(`${BASE}/hello`, {
      headers: { origin },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_not_allowed" });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers a preflight from kyletebo.com", async () => {
    const response = await exports.default.fetch(`${BASE}/hello`, {
      method: "OPTIONS",
      headers: { origin: SITE, "access-control-request-method": "POST" },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toBe("content-type");
  });

  it("refuses a preflight from another website", async () => {
    const response = await exports.default.fetch(`${BASE}/hello`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never sends a wildcard, with or without an Origin header", async () => {
    const response = await exports.default.fetch(`${BASE}/hello`);

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
