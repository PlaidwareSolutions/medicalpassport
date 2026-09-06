import { describe, expect, it } from "vitest";
import { PRODUCT_EVENTS, ProductEventError, emitProductEvent, validateProductEvent } from "./product-events";

function fakeLogger() {
  const lines: unknown[] = [];
  return { lines, logger: { info: (obj: unknown) => lines.push(obj) } as never };
}

describe("product events", () => {
  it("emits a structured line with opaque ids and declared properties only", () => {
    const { lines, logger } = fakeLogger();
    emitProductEvent(logger, { name: "activation.medicine_added", profileId: "p1", properties: { via: "manual" } });
    expect(lines[0]).toMatchObject({ event: "product", productEvent: "activation.medicine_added", profileId: "p1", props: { via: "manual" } });
  });

  it("rejects unknown events and PHI-looking property names", () => {
    expect(() => validateProductEvent({ name: "nope" as never })).toThrow(ProductEventError);
    expect(() => validateProductEvent({ name: "engagement.dose_recorded", properties: { medicineName: "Metformin" } })).toThrow(/PHI-looking/);
    expect(() => validateProductEvent({ name: "engagement.dose_recorded", properties: { phone: "+91" } })).toThrow(ProductEventError);
    expect(() => validateProductEvent({ name: "network.share_opened", properties: { result: "success" } })).not.toThrow(); // declared for this event
    expect(() => validateProductEvent({ name: "engagement.dose_recorded", properties: { action: "x".repeat(65) } })).toThrow(/too long/);
  });

  it("rejects properties the catalogue does not declare for that event, even harmless-looking ones", () => {
    expect(() => validateProductEvent({ name: "engagement.dose_recorded", properties: { action: "taken", offline: true } })).not.toThrow();
    expect(() => validateProductEvent({ name: "engagement.dose_recorded", properties: { action: "taken", offline: true, extra: 1 } })).toThrow(/not declared/);
    // `result` is declared for share_opened only — on any other event it is refused as PHI-looking.
    expect(() => validateProductEvent({ name: "abdm.abha_linked", properties: { result: "ok" } })).toThrow(/PHI-looking/);
    expect(() => validateProductEvent({ name: "abdm.records_linked", properties: { count: { nested: true } as never } })).toThrow(/scalar/);
  });

  it("catalogue names are namespaced and stable", () => {
    for (const name of Object.keys(PRODUCT_EVENTS)) expect(name).toMatch(/^(acquisition|activation|engagement|network|abdm|safety|docs)\.[a-z_]+$/);
  });
});
