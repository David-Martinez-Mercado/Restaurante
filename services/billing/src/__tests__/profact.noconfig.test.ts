import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";
process.env.PROFACT_TOKEN = "";

const { profactClient } = await import("../clients/profact.client.js");

describe("sin PROFACT_TOKEN", () => {
  it("el PAC figura como no configurado y NO se hace ninguna llamada de red", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(profactClient.configured).toBe(false);
    await expect(profactClient.timbrar("<x/>", "i")).rejects.toMatchObject({ statusCode: 503 });
    await expect(profactClient.cancelar({ rfcEmisor: "R", uuid: "u", reason: "02" })).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
