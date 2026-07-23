import { generateKeyPairSync, sign as signEd25519 } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelnyxSmsSender, parseTelnyxDeliveryOutcome, verifyTelnyxWebhookSignature } from "./index.js";

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

  it("builds privacy-safe wording for caregiver_escalation, generic and full_name", async () => {
    const fetchMock = mockFetchOnce(200, { data: { id: "msg-6" } });
    await sender.sendTemplate("+12817451997", "caregiver_escalation", { medicationName: "" });
    let body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toMatch(/missed dose/i);
    expect(body.text).not.toMatch(/paracetamol|amoxicillin/i);

    mockFetchOnce(200, { data: { id: "msg-7" } });
    await sender.sendTemplate("+12817451997", "caregiver_escalation", { medicationName: "Amoxicillin" });
    body = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
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

describe("verifyTelnyxWebhookSignature", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");

  function sign(timestamp: string, body: string): string {
    const signedData = Buffer.concat([Buffer.from(timestamp, "utf8"), Buffer.from("|", "utf8"), Buffer.from(body, "utf8")]);
    return signEd25519(null, signedData, privateKey).toString("base64");
  }

  it("accepts a genuinely valid signature over timestamp|body", () => {
    const timestamp = "1732000000";
    const body = JSON.stringify({ data: { event_type: "message.finalized" } });
    const signature = sign(timestamp, body);
    expect(verifyTelnyxWebhookSignature(Buffer.from(body), signature, timestamp, rawPublicKeyBase64)).toBe(true);
  });

  it("rejects a signature when the body was tampered with after signing", () => {
    const timestamp = "1732000000";
    const signature = sign(timestamp, JSON.stringify({ data: { event_type: "message.finalized" } }));
    const tampered = JSON.stringify({ data: { event_type: "message.sent" } });
    expect(verifyTelnyxWebhookSignature(Buffer.from(tampered), signature, timestamp, rawPublicKeyBase64)).toBe(false);
  });

  it("rejects a signature made with a different key than the configured public key", () => {
    const timestamp = "1732000000";
    const body = JSON.stringify({ data: { event_type: "message.finalized" } });
    const signature = sign(timestamp, body);
    const otherKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
    expect(verifyTelnyxWebhookSignature(Buffer.from(body), signature, timestamp, otherKey)).toBe(false);
  });

  it("never throws on malformed input — treats it as an invalid signature", () => {
    expect(verifyTelnyxWebhookSignature(Buffer.from("{}"), "not-valid-base64!!", "123", "also-not-valid!!")).toBe(false);
  });
});

describe("parseTelnyxDeliveryOutcome", () => {
  it("extracts a delivered outcome from a message.finalized event", () => {
    const outcome = parseTelnyxDeliveryOutcome({
      data: { event_type: "message.finalized", payload: { id: "msg-1", to: [{ status: "delivered" }] } },
    });
    expect(outcome).toEqual({ messageId: "msg-1", outcome: "delivered" });
  });

  it("extracts a failed outcome with the real error digest", () => {
    const outcome = parseTelnyxDeliveryOutcome({
      data: {
        event_type: "message.finalized",
        payload: {
          id: "msg-2",
          to: [{ status: "delivery_failed" }],
          errors: [{ code: "40329", detail: "Tollfree number is not verified" }],
        },
      },
    });
    // 40329 is an account/sender-configuration problem (our own toll-free
    // number isn't verified), not proof this specific destination is dead —
    // must NOT be flagged as a permanent destination failure, or every
    // recipient's channel would be wrongly revoked on the very first send.
    expect(outcome).toEqual({
      messageId: "msg-2",
      outcome: "failed",
      errorDigest: "telnyx_40329: Tollfree number is not verified",
      permanentDestinationFailure: false,
    });
  });

  it("flags a confirmed permanent destination failure (recipient sent STOP)", () => {
    const outcome = parseTelnyxDeliveryOutcome({
      data: {
        event_type: "message.finalized",
        payload: {
          id: "msg-5",
          to: [{ status: "delivery_failed" }],
          errors: [{ code: "40300", detail: "Destination has sent a stop message" }],
        },
      },
    });
    expect(outcome?.permanentDestinationFailure).toBe(true);
  });

  it("does not flag a sending-number-level spam block as a destination failure", () => {
    const outcome = parseTelnyxDeliveryOutcome({
      data: {
        event_type: "message.finalized",
        payload: {
          id: "msg-6",
          to: [{ status: "delivery_failed" }],
          errors: [{ code: "40003", detail: "Blocked as spam, permanently blocking the originating number" }],
        },
      },
    });
    expect(outcome?.permanentDestinationFailure).toBe(false);
  });

  it("ignores message.sent — already captured synchronously at send time", () => {
    expect(parseTelnyxDeliveryOutcome({ data: { event_type: "message.sent", payload: { id: "msg-3", to: [{ status: "sent" }] } } })).toBeNull();
  });

  it("ignores an inconclusive delivery_unconfirmed status", () => {
    expect(
      parseTelnyxDeliveryOutcome({
        data: { event_type: "message.finalized", payload: { id: "msg-4", to: [{ status: "delivery_unconfirmed" }] } },
      }),
    ).toBeNull();
  });

  it("returns null when the payload is missing expected fields", () => {
    expect(parseTelnyxDeliveryOutcome({ data: { event_type: "message.finalized", payload: {} } })).toBeNull();
    expect(parseTelnyxDeliveryOutcome({})).toBeNull();
  });
});
