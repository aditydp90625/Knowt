import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./client";

describe("API request headers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not label bodyless DELETE requests as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.deleteNode("node-id");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  });
});
