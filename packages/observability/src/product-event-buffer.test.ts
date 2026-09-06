import { describe, expect, it } from "vitest";
import { ProductEventBuffer, type BufferedProductEvent } from "./product-event-buffer";

function manualTimer() {
  const pending: Array<() => void> = [];
  return {
    schedule: (fn: () => void) => {
      pending.push(fn);
      return {
        cancel: () => {
          const i = pending.indexOf(fn);
          if (i >= 0) pending.splice(i, 1);
        },
      };
    },
    fire: () => {
      const fns = pending.splice(0, pending.length);
      for (const fn of fns) fn();
    },
    pending,
  };
}

describe("ProductEventBuffer", () => {
  it("does not write on push; flushes as one batch on the timer", async () => {
    const batches: BufferedProductEvent[][] = [];
    const timer = manualTimer();
    const buffer = new ProductEventBuffer({ sink: async (b) => void batches.push(b), schedule: timer.schedule, flushAt: 10 });
    buffer.push({ name: "activation.medicine_added", properties: { via: "manual" } });
    buffer.push({ name: "engagement.dose_recorded", properties: { action: "taken", offline: false } });
    expect(batches).toEqual([]);
    expect(buffer.snapshot().buffered).toBe(2);
    expect(timer.pending).toHaveLength(1); // one timer for the whole batch, not one per event
    timer.fire();
    await buffer.flush();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((b) => b.event.name)).toEqual(["activation.medicine_added", "engagement.dose_recorded"]);
    expect(buffer.snapshot()).toMatchObject({ buffered: 0, flushed: 2, dropped: 0 });
  });

  it("flushes early once flushAt is reached", async () => {
    const batches: BufferedProductEvent[][] = [];
    const timer = manualTimer();
    const buffer = new ProductEventBuffer({ sink: async (b) => void batches.push(b), schedule: timer.schedule, flushAt: 2 });
    buffer.push({ name: "network.caregiver_invited" });
    buffer.push({ name: "network.caregiver_invited" });
    await buffer.flush();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it("is bounded: past maxSize the oldest events are dropped and counted", async () => {
    const batches: BufferedProductEvent[][] = [];
    const timer = manualTimer();
    const buffer = new ProductEventBuffer({ sink: async (b) => void batches.push(b), schedule: timer.schedule, maxSize: 3, flushAt: 100 });
    for (const via of ["search", "manual", "extraction", "previous"]) buffer.push({ name: "activation.medicine_added", properties: { via } });
    expect(buffer.snapshot()).toMatchObject({ buffered: 3, dropped: 1 });
    await buffer.flush();
    expect(batches[0]!.map((b) => b.event.properties?.via)).toEqual(["manual", "extraction", "previous"]);
  });

  it("swallows a failing sink and counts the batch as dropped — never throws to the caller", async () => {
    const timer = manualTimer();
    const buffer = new ProductEventBuffer({
      sink: async () => {
        throw new Error("db down");
      },
      schedule: timer.schedule,
    });
    buffer.push({ name: "abdm.abha_linked" });
    await expect(buffer.flush()).resolves.toBeUndefined();
    expect(buffer.snapshot()).toMatchObject({ buffered: 0, failedBatches: 1, dropped: 1 });
  });

  it("stamps occurredAt at emission time, not flush time", async () => {
    let t = 1000;
    const timer = manualTimer();
    const batches: BufferedProductEvent[][] = [];
    const buffer = new ProductEventBuffer({ sink: async (b) => void batches.push(b), schedule: timer.schedule, now: () => new Date(t) });
    buffer.push({ name: "abdm.abha_linked" });
    t = 5000;
    await buffer.flush();
    expect(batches[0]![0]!.occurredAt.getTime()).toBe(1000);
  });
});
