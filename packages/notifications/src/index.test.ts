import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelnyxSmsSender } from "./index.js";

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("TelnyxSmsSender", () => {
  const sender = new TelnyxSmsSender({ apiKey: "test-key", fromNumber: "+18005551234" });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the OTP code in English by default, never logging or omitting it", async () => {
    const fetchMock = mockFetchOnce(200, { data: { id: "msg-1" } });
    await sender.sendOtp("+919000000001", "123456", "en");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telnyx.com/v2/messages",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ authorization: "Bearer test-key" }) }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.from).toBe("+18005551234");
    expect(body.to).toBe("+919000000001");
    expect(body.text).toContain("123456");
  });

  it("sends a Hindi-localized OTP message when locale is hi", async () => {
    const fetchMock = mockFetchOnce(200, { data: { id: "msg-2" } });
    await sender.sendOtp("+919000000001", "654321", "hi");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain("654321");
    expect(body.text).not.toMatch(/your medpass code/i);
  });

  it("throws with the real Telnyx error code/detail on a failed OTP send", async () => {
    mockFetchOnce(422, { errors: [{ code: "40329", detail: "Tollfree number is not verified" }] });
    await expect(sender.sendOtp("+919000000001", "123456", "en")).rejects.toThrow(/telnyx_40329/);
  });

  it("builds privacy-safe generic wording for each reminder kind when no medication name is given", async () => {
    const fetchMock = mockFetchOnce(200, { data: { id: "msg-3" } });
    await sender.sendTemplate("+12817451997", "dose_reminder", { medicationName: "" });
    let body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toMatch(/medicine reminder/i);
    expect(body.text).not.toMatch(/paracetamol|amoxicillin/i);

    mockFetchOnce(200, { data: { id: "msg-4" } });
    await sender.sendTemplate("+12817451997", "refill", { medicationName: "" });
    body = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.text).toMatch(/running low/i);
  });

  it("includes the medication name only when explicitly passed (full_name opt-in)", async () => {
    const fetchMock = mockFetchOnce(200, { data: { id: "msg-5" } });
    await sender.sendTemplate("+12817451997", "completion", { medicationName: "Amoxicillin" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain("Amoxicillin");
  });

  it("rejects an unknown template key rather than sending something unvalidated", async () => {
    await expect(sender.sendTemplate("+12817451997", "not_a_real_template", {})).rejects.toThrow(/unknown sms template/i);
  });

  it("throws a clear error when Telnyx's response has no message id and no parseable error body", async () => {
    mockFetchOnce(500, null);
    await expect(sender.sendOtp("+919000000001", "123456", "en")).rejects.toThrow(/telnyx_http_500/);
  });
});
