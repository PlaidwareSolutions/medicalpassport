import { describe, expect, it, vi } from "vitest";
import {
  availableConnectors,
  canConnect,
  detectBluetooth,
  ManualConnector,
  WebBluetoothConnector,
  type BluetoothCharacteristicLike,
  type BluetoothLike,
  type CharacteristicValueEvent,
} from "./connector";
import { parseBloodPressureMeasurement, parseGlucoseMeasurement, readSfloat } from "./gatt";
import { syncDeviceReadings } from "./sync";

/**
 * Device connectors (docs_v2/06 P5-5) against a fake `navigator.bluetooth`: CI has no
 * radio, and the contract is what matters — feature detection, the chooser filter per
 * device kind, GATT parsing, and readings shaped for the batch endpoint with `deviceId`.
 */

/** Encodes an IEEE-11073 SFLOAT with exponent 0 (integers) or -1 (one decimal). */
function sfloat(value: number, exponent = 0): number {
  const mantissa = Math.round(value / Math.pow(10, exponent)) & 0x0fff;
  return ((exponent & 0x0f) << 12) | mantissa;
}

/** A glucose concentration in kg/L, as meters send it: mg/dL ÷ 100 000 with exponent −5 → mantissa = mg/dL. */
function kgPerL(mgDl: number): number {
  return sfloat(mgDl / 100_000, -5);
}

function bytes(...parts: Array<number | number[]>): DataView {
  const flat = parts.flat();
  return new DataView(Uint8Array.from(flat).buffer);
}

function u16(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}

/** 0x2A35 with timestamp + pulse: flags 0b110, 120/80 mmHg, MAP 93, 2026-09-06 08:15:00, pulse 72. */
const BP_PACKET = bytes(0x06, u16(sfloat(120)), u16(sfloat(80)), u16(sfloat(93)), u16(2026), 9, 6, 8, 15, 0, u16(sfloat(72)));

/** 0x2A18 with concentration in kg/L (flags 0b010): seq 7, 2026-09-06 07:00, 0.00110 kg/L = 110 mg/dL, capillary whole blood. */
const GLUCOSE_PACKET = bytes(0x02, u16(7), u16(2026), 9, 6, 7, 0, 0, u16(kgPerL(110)), 0x11);

class FakeCharacteristic implements BluetoothCharacteristicLike {
  value: DataView | null = null;
  private listeners: Array<(e: CharacteristicValueEvent) => void> = [];
  readonly writes: Uint8Array[] = [];
  notifying = false;
  constructor(private readonly onStart?: (self: FakeCharacteristic) => void) {}

  async startNotifications() {
    this.notifying = true;
    this.onStart?.(this);
  }
  async stopNotifications() {
    this.notifying = false;
  }
  async writeValue(v: BufferSource) {
    this.writes.push(new Uint8Array(v as ArrayBuffer));
  }
  addEventListener(_type: "characteristicvaluechanged", l: (e: CharacteristicValueEvent) => void) {
    this.listeners.push(l);
  }
  removeEventListener(_type: "characteristicvaluechanged", l: (e: CharacteristicValueEvent) => void) {
    this.listeners = this.listeners.filter((x) => x !== l);
  }
  emit(view: DataView) {
    this.value = view;
    for (const l of [...this.listeners]) l({ target: { value: view } });
  }
}

function fakeBluetooth(characteristics: Record<number, FakeCharacteristic>) {
  const requests: unknown[] = [];
  const gatt = {
    connected: false,
    async connect() {
      gatt.connected = true;
      return gatt;
    },
    disconnect() {
      gatt.connected = false;
    },
    async getPrimaryService() {
      return {
        async getCharacteristic(uuid: number) {
          const c = characteristics[uuid];
          if (!c) throw new Error(`no characteristic ${uuid.toString(16)}`);
          return c;
        },
      };
    },
  };
  const bluetooth: BluetoothLike & { requests: unknown[] } = {
    requests,
    async requestDevice(options) {
      requests.push(options);
      return { id: "browser-device-1", name: "Omron X7", gatt };
    },
  };
  return { bluetooth, gatt };
}

describe("GATT parsing", () => {
  it("decodes IEEE-11073 SFLOATs including negative exponents and NaN", () => {
    expect(readSfloat(bytes(u16(sfloat(120))), 0)).toBe(120);
    expect(readSfloat(bytes(u16(kgPerL(110))), 0)).toBeCloseTo(0.0011, 6);
    expect(readSfloat(bytes(u16(0x07ff)), 0)).toBeNaN();
  });

  it("parses a blood pressure measurement with timestamp and pulse", () => {
    const m = parseBloodPressureMeasurement(BP_PACKET);
    expect(m).toMatchObject({ systolic: 120, diastolic: 80, meanArterial: 93, unit: "mmHg", pulseBpm: 72 });
    expect(m.measuredAt?.getFullYear()).toBe(2026);
    expect(m.measuredAt?.getHours()).toBe(8);
  });

  it("parses a glucose record and converts kg/L to mg/dL without interpreting it", () => {
    const m = parseGlucoseMeasurement(GLUCOSE_PACKET);
    expect(m.sequence).toBe(7);
    expect(m.valueMgDl).toBe(110);
    expect(m.context).toBe("capillary_whole_blood");
    expect(Object.keys(m)).not.toContain("interpretation");
  });
});

describe("feature detection", () => {
  it("offers the Bluetooth connector only when navigator.bluetooth exists", () => {
    expect(detectBluetooth(undefined)).toBeUndefined();
    expect(detectBluetooth({})).toBeUndefined();
    expect(detectBluetooth({ bluetooth: { requestDevice: async () => ({ id: "x" }) } })).toBeDefined();

    const none = availableConnectors({ bluetooth: undefined });
    expect(none.map((c) => c.id)).toEqual(["manual"]);
    // Under vitest there is no navigator.bluetooth, so the default is manual-only — the CI guarantee.
    expect(new WebBluetoothConnector().supported()).toBe(false);
    expect(canConnect("bp_monitor", undefined)).toBe(false);

    const { bluetooth } = fakeBluetooth({});
    expect(availableConnectors({ bluetooth }).map((c) => c.id)).toEqual(["manual", "web-bluetooth"]);
    expect(canConnect("bp_monitor", bluetooth)).toBe(true);
    expect(canConnect("glucometer", bluetooth)).toBe(true);
    // No standard GATT service for a scale in this prototype — no Connect button.
    expect(canConnect("smart_scale", bluetooth)).toBe(false);
  });

  it("ManualConnector is always supported and never discovers or reads anything", async () => {
    const manual = new ManualConnector();
    expect(manual.supported()).toBe(true);
    expect(manual.platform).toBe("manual");
    expect(await manual.discover("bp_monitor")).toEqual([]);
    expect(await manual.readObservations(null)).toEqual([]);
  });
});

describe("WebBluetoothConnector", () => {
  it("asks the chooser for the Blood Pressure service (0x1810) for a BP monitor", async () => {
    const { bluetooth } = fakeBluetooth({});
    const connector = new WebBluetoothConnector({ bluetooth });
    const found = await connector.discover("bp_monitor");
    expect(found).toEqual([{ id: "browser-device-1", name: "Omron X7", kind: "bp_monitor" }]);
    expect(bluetooth.requests[0]).toEqual({ filters: [{ services: [0x1810] }], optionalServices: [0x1810] });
  });

  it("asks for the Glucose service (0x1808) for a glucometer and nothing for unsupported kinds", async () => {
    const { bluetooth } = fakeBluetooth({});
    const connector = new WebBluetoothConnector({ bluetooth });
    await connector.discover("glucometer");
    expect(bluetooth.requests[0]).toEqual({ filters: [{ services: [0x1808] }], optionalServices: [0x1808] });
    expect(await connector.discover("smart_scale")).toEqual([]);
    expect(bluetooth.requests).toHaveLength(1);
  });

  it("reads one BP indication as a blood_pressure observation with pulse, unit and device method", async () => {
    const bp = new FakeCharacteristic((self) => setTimeout(() => self.emit(BP_PACKET), 0));
    const { bluetooth, gatt } = fakeBluetooth({ 0x2a35: bp });
    const connector = new WebBluetoothConnector({ bluetooth, listenMs: 500 });
    await connector.discover("bp_monitor");

    const readings = await connector.readObservations(null);
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({
      concept: "blood_pressure",
      valueNumeric: 120,
      valueNumeric2: 80,
      enteredUnit: "mmHg",
      pulseBpm: 72,
      method: "bluetooth_device",
    });
    expect(readings[0]?.measuredAt).toBe(new Date(2026, 8, 6, 8, 15, 0).toISOString());
    expect(bp.notifying).toBe(false); // unsubscribed
    expect(gatt.connected).toBe(false); // disconnected after the read
  });

  it("requests all stored glucose records over RACP and stops on the RACP response", async () => {
    const glucose = new FakeCharacteristic();
    const racp = new FakeCharacteristic();
    racp.writeValue = async (v) => {
      racp.writes.push(new Uint8Array(v as ArrayBuffer));
      // The meter answers: two records, then "procedure complete" (op 0x06) on the RACP.
      setTimeout(() => {
        glucose.emit(GLUCOSE_PACKET);
        glucose.emit(bytes(0x02, u16(8), u16(2026), 9, 6, 12, 30, 0, u16(kgPerL(140)), 0x11));
        racp.emit(bytes(0x06, 0x00, 0x01, 0x01));
      }, 0);
    };
    const { bluetooth } = fakeBluetooth({ 0x2a18: glucose, 0x2a52: racp });
    const connector = new WebBluetoothConnector({ bluetooth, listenMs: 5_000 });
    await connector.discover("glucometer");

    const started = Date.now();
    const readings = await connector.readObservations(null);
    expect(Date.now() - started).toBeLessThan(1_000); // the RACP response ended it, not the timeout
    expect(Array.from(racp.writes[0]!)).toEqual([0x01, 0x01]);
    expect(readings.map((r) => r.valueNumeric)).toEqual([110, 140]);
    expect(readings.every((r) => r.concept === "blood_glucose" && r.enteredUnit === "mg/dL")).toBe(true);
  });

  it("filters readings by `since`, so a re-sync only sends what is new", async () => {
    const glucose = new FakeCharacteristic();
    const racp = new FakeCharacteristic();
    racp.writeValue = async () => {
      setTimeout(() => {
        glucose.emit(GLUCOSE_PACKET); // 07:00
        glucose.emit(bytes(0x02, u16(8), u16(2026), 9, 6, 12, 30, 0, u16(kgPerL(140)), 0x11)); // 12:30
        racp.emit(bytes(0x06, 0x00, 0x01, 0x01));
      }, 0);
    };
    const { bluetooth } = fakeBluetooth({ 0x2a18: glucose, 0x2a52: racp });
    const connector = new WebBluetoothConnector({ bluetooth, listenMs: 5_000 });
    await connector.discover("glucometer");
    const readings = await connector.readObservations(new Date(2026, 8, 6, 10, 0, 0));
    expect(readings.map((r) => r.valueNumeric)).toEqual([140]);
  });

  it("gives up after the listen window when the cuff never indicates", async () => {
    const bp = new FakeCharacteristic();
    const { bluetooth } = fakeBluetooth({ 0x2a35: bp });
    const connector = new WebBluetoothConnector({ bluetooth, listenMs: 20 });
    await connector.discover("bp_monitor");
    expect(await connector.readObservations(null)).toEqual([]);
  });
});

describe("syncDeviceReadings", () => {
  it("posts readings to the batch endpoint with the deviceId and reports the server's dedupe", async () => {
    const bp = new FakeCharacteristic((self) => setTimeout(() => self.emit(BP_PACKET), 0));
    const { bluetooth } = fakeBluetooth({ 0x2a35: bp });
    const connector = new WebBluetoothConnector({ bluetooth, listenMs: 500 });
    await connector.discover("bp_monitor");

    const post = vi.fn(async () => ({ created: 0, duplicates: 1 }));
    const result = await syncDeviceReadings(connector, "device-uuid", null, post);
    expect(post).toHaveBeenCalledWith({ deviceId: "device-uuid", items: [expect.objectContaining({ concept: "blood_pressure" })] });
    expect(result).toEqual({ read: 1, created: 0, duplicates: 1 });
  });

  it("does not call the server when there is nothing to send", async () => {
    const post = vi.fn(async () => ({ created: 0, duplicates: 0 }));
    const result = await syncDeviceReadings(new ManualConnector(), "device-uuid", null, post);
    expect(post).not.toHaveBeenCalled();
    expect(result).toEqual({ read: 0, created: 0, duplicates: 0 });
  });
});
