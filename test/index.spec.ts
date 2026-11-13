import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { withErrorHandling } from "../src/http";

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

  it("answers another website's request for a made-up address with 404, and logs nothing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await exports.default.fetch(
      new Request(`${BASE}/made-up-by-a-visitor`, { headers: { origin: "https://example.com" } }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("still refuses another website at a real address, and logs that", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await exports.default.fetch(new Request(`${BASE}/hello`, { headers: { origin: "https://example.com" } }));
    expect(response.status).toBe(403);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
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
    // Only what /hello really accepts. It used to advertise POST as well.
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
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

describe("preflight checks", () => {
  it("does not answer for an address that does not exist", async () => {
    const response = await exports.default.fetch(`${BASE}/nope`, {
      method: "OPTIONS",
      headers: { origin: "https://kyletebo.com", "access-control-request-method": "POST" },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-methods")).toBeNull();
  });

  it("answers without an Origin header, but grants no website access", async () => {
    const response = await exports.default.fetch(`${BASE}/hello`, { method: "OPTIONS" });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("HEAD /hello", () => {
  it("returns the same headers as GET, with no body", async () => {
    const response = await exports.default.fetch(`${BASE}/hello`, { method: "HEAD" });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).toBe("");
  });
});

describe("headers on every reply", () => {
  const cases: Array<[string, string, RequestInit]> = [
    ["a normal reply", "/hello", {}],
    ["an allowed website", "/hello", { headers: { origin: "https://kyletebo.com" } }],
    ["a refused website", "/hello", { headers: { origin: "https://evil.example" } }],
    ["a wrong method", "/hello", { method: "POST" }],
    ["an unknown address", "/nope", {}],
    ["a preflight", "/hello", { method: "OPTIONS", headers: { origin: "https://kyletebo.com" } }],
  ];

  it.each(cases)("%s carries the security headers", async (_name, path, init) => {
    const response = await exports.default.fetch(`${BASE}${path}`, init);

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("strict-transport-security")).toBe("max-age=15552000");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it.each(cases)("%s never allows cookies or logins to be sent", async (_name, path, init) => {
    const response = await exports.default.fetch(`${BASE}${path}`, init);

    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
  });
});

describe("the error safety net", () => {
  const SECRET_TEXT = "a visitor's private draft";
  const env = { ALLOWED_ORIGIN: "https://kyletebo.com" } as Env;

  it("turns an unexpected failure into a fixed reply that reveals nothing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = withErrorHandling(async () => {
      throw new Error(SECRET_TEXT);
    });

    const response = await failing(new Request(`${BASE}/hello`), env);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toEqual({ error: "internal_error" });
    expect(body).not.toContain(SECRET_TEXT);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    // The log gets one fixed line and nothing from the error itself.
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(JSON.stringify({ event: "unhandled_error" }));
    logged.mockRestore();
  });

  it("passes a normal reply through untouched", async () => {
    const working = withErrorHandling(async () => new Response("fine", { status: 200 }));

    const response = await working(new Request(`${BASE}/hello`), env);

    expect(await response.text()).toBe("fine");
  });
});
