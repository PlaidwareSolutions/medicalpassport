import { verifyTurnstile } from "./turnstile";

describe("verifyTurnstile", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("skips verification entirely when no secret is configured", async () => {
    global.fetch = jest.fn();
    await expect(verifyTurnstile(undefined, undefined, "1.2.3.4")).resolves.toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects when a secret is configured but no token was submitted", async () => {
    global.fetch = jest.fn();
    await expect(verifyTurnstile("secret", undefined, "1.2.3.4")).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls Cloudflare's siteverify endpoint and trusts a successful result", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ json: async () => ({ success: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(verifyTurnstile("secret", "a-real-token", "1.2.3.4")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({ method: "POST" }),
    );
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("secret")).toBe("secret");
    expect(body.get("response")).toBe("a-real-token");
    expect(body.get("remoteip")).toBe("1.2.3.4");
  });

  it("rejects when Cloudflare reports failure", async () => {
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }) });
    await expect(verifyTurnstile("secret", "bad-token", undefined)).resolves.toBe(false);
  });

  it("rejects rather than throwing if Cloudflare's response is unparseable", async () => {
    global.fetch = jest.fn().mockResolvedValue({ json: async () => Promise.reject(new Error("not json")) });
    await expect(verifyTurnstile("secret", "a-token", undefined)).resolves.toBe(false);
  });
});
