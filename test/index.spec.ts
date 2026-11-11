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
