import type { MeasurementDeviceKind, MeasurementDevicePlatform } from "@medpass/domain";
import type { ObservationInput } from "../observations";
import {
  BLOOD_PRESSURE_MEASUREMENT,
  BLOOD_PRESSURE_SERVICE,
  GLUCOSE_MEASUREMENT,
  GLUCOSE_SERVICE,
  parseBloodPressureMeasurement,
  parseGlucoseMeasurement,
  RECORD_ACCESS_CONTROL_POINT,
} from "./gatt";

/**
 * Device connector architecture (docs_v2/06 P5-5, docs_v2/04 §5.4).
 *
 * A connector knows how to find a device and pull readings off it; it never writes to the
 * record itself. Readings are plain `ObservationInput`s that go through the existing batch
 * endpoint (`POST profiles/current/observations/batch`) with the patient's `deviceId`, where
 * the server dedupes on `(concept, measuredAt, deviceId)` — so pulling the same cuff twice
 * cannot create two rows, and every synced reading carries device provenance.
 *
 * Two connectors exist: `ManualConnector` (what every device has today — readings typed by
 * hand) and `WebBluetoothConnector`, a prototype for the two standard GATT health services.
 * Apple Health / Health Connect are native-phase work and have no connector here.
 */
export interface DiscoveredDevice {
  /** Browser-assigned, stable for this origin; not a MAC address. */
  id: string;
  name: string | null;
  kind: MeasurementDeviceKind;
}

export interface DeviceConnector {
  readonly id: "manual" | "web-bluetooth";
  readonly platform: MeasurementDevicePlatform;
  /** True when this connector can work in the current browser; feature-detected, never assumed. */
  supported(): boolean;
  /** Finds devices of the given kind (a chooser for Bluetooth; nothing for manual). */
  discover(kind: MeasurementDeviceKind): Promise<DiscoveredDevice[]>;
  /** Readings taken after `since` (all available when null), as observation inputs. */
  readObservations(since: Date | null): Promise<ObservationInput[]>;
}

/** Device kinds the Bluetooth prototype can read, by GATT service. */
export const BLUETOOTH_KINDS: Partial<Record<MeasurementDeviceKind, number>> = {
  bp_monitor: BLOOD_PRESSURE_SERVICE,
  glucometer: GLUCOSE_SERVICE,
};

// ---------------------------------------------------------------------------
// Manual
// ---------------------------------------------------------------------------

/** Today's path for every device: the patient types the number. Nothing to discover or read. */
export class ManualConnector implements DeviceConnector {
  readonly id = "manual" as const;
  readonly platform = "manual" as const;

  supported(): boolean {
    return true;
  }

  async discover(_kind: MeasurementDeviceKind): Promise<DiscoveredDevice[]> {
    return [];
  }

  async readObservations(_since: Date | null): Promise<ObservationInput[]> {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Web Bluetooth (prototype)
// ---------------------------------------------------------------------------

/**
 * The slice of the Web Bluetooth API this connector uses, as structural types: TypeScript's
 * DOM lib does not ship them, and the unit tests hand in a fake that satisfies exactly this.
 */
export interface BluetoothLike {
  requestDevice(options: { filters: Array<{ services: number[] }>; optionalServices?: number[] }): Promise<BluetoothDeviceLike>;
}

export interface BluetoothDeviceLike {
  id: string;
  name?: string | null;
  gatt?: BluetoothGattLike;
}

export interface BluetoothGattLike {
  connected: boolean;
  connect(): Promise<BluetoothGattLike>;
  disconnect(): void;
  getPrimaryService(uuid: number): Promise<BluetoothServiceLike>;
}

export interface BluetoothServiceLike {
  getCharacteristic(uuid: number): Promise<BluetoothCharacteristicLike>;
}

export interface CharacteristicValueEvent {
  target: { value?: DataView | null } | null;
}

export interface BluetoothCharacteristicLike {
  value?: DataView | null;
  startNotifications(): Promise<unknown>;
  stopNotifications(): Promise<unknown>;
  writeValue(value: BufferSource): Promise<void>;
  addEventListener(type: "characteristicvaluechanged", listener: (event: CharacteristicValueEvent) => void): void;
  removeEventListener(type: "characteristicvaluechanged", listener: (event: CharacteristicValueEvent) => void): void;
}

/** `navigator.bluetooth` when the browser has it — Chromium on desktop/Android; not Safari, not CI. */
export function detectBluetooth(nav: unknown = typeof navigator === "undefined" ? undefined : navigator): BluetoothLike | undefined {
  const candidate = (nav as { bluetooth?: unknown } | undefined)?.bluetooth;
  if (!candidate || typeof (candidate as BluetoothLike).requestDevice !== "function") return undefined;
  return candidate as BluetoothLike;
}

export interface WebBluetoothOptions {
  bluetooth?: BluetoothLike;
  /** How long to listen for a cuff's indication before giving up (a reading takes ~30 s). */
  listenMs?: number;
  now?: () => Date;
}

export class WebBluetoothConnector implements DeviceConnector {
  readonly id = "web-bluetooth" as const;
  readonly platform = "bluetooth" as const;
  private readonly bluetooth: BluetoothLike | undefined;
  private readonly listenMs: number;
  private readonly now: () => Date;
  private device: BluetoothDeviceLike | undefined;
  private kind: MeasurementDeviceKind | undefined;

  constructor(options: WebBluetoothOptions = {}) {
    this.bluetooth = options.bluetooth ?? detectBluetooth();
    this.listenMs = options.listenMs ?? 45_000;
    this.now = options.now ?? (() => new Date());
  }

  supported(): boolean {
    return this.bluetooth !== undefined;
  }

  /** The browser's chooser: the patient picks one device advertising the service for `kind`. */
  async discover(kind: MeasurementDeviceKind): Promise<DiscoveredDevice[]> {
    const service = BLUETOOTH_KINDS[kind];
    if (!this.bluetooth || service === undefined) return [];
    const device = await this.bluetooth.requestDevice({ filters: [{ services: [service] }], optionalServices: [service] });
    this.device = device;
    this.kind = kind;
    return [{ id: device.id, name: device.name ?? null, kind }];
  }

  /** Readings from the device chosen in `discover`, newer than `since`. */
  async readObservations(since: Date | null): Promise<ObservationInput[]> {
    const device = this.device;
    const kind = this.kind;
    if (!device?.gatt || !kind) return [];
    const serviceUuid = BLUETOOTH_KINDS[kind];
    if (serviceUuid === undefined) return [];

    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    try {
      const service = await server.getPrimaryService(serviceUuid);
      const readings = kind === "bp_monitor" ? await this.readBloodPressure(service) : await this.readGlucose(service);
      return readings.filter((r) => since === null || new Date(r.measuredAt).getTime() > since.getTime());
    } finally {
      server.disconnect();
    }
  }

  private async readBloodPressure(service: BluetoothServiceLike): Promise<ObservationInput[]> {
    const characteristic = await service.getCharacteristic(BLOOD_PRESSURE_MEASUREMENT);
    const values = await collectNotifications(characteristic, this.listenMs, { stopAfter: 1 });
    const out: ObservationInput[] = [];
    for (const view of values) {
      const m = parseBloodPressureMeasurement(view);
      if (!Number.isFinite(m.systolic) || !Number.isFinite(m.diastolic)) continue;
      // The server converts kPa → mmHg from `enteredUnit`; we send exactly what the cuff said.
      out.push({
        concept: "blood_pressure",
        measuredAt: (m.measuredAt ?? this.now()).toISOString(),
        valueNumeric: round1(m.systolic),
        valueNumeric2: round1(m.diastolic),
        enteredUnit: m.unit,
        method: "bluetooth_device",
        ...(m.pulseBpm !== undefined ? { pulseBpm: Math.round(m.pulseBpm) } : {}),
      });
    }
    return out;
  }

  private async readGlucose(service: BluetoothServiceLike): Promise<ObservationInput[]> {
    const measurement = await service.getCharacteristic(GLUCOSE_MEASUREMENT);
    const racp = await service.getCharacteristic(RECORD_ACCESS_CONTROL_POINT);
    // Record Access Control Point: op 0x01 "report stored records", operator 0x01 "all records".
    const values = await collectNotifications(measurement, this.listenMs, {
      kickoff: () => racp.writeValue(new Uint8Array([0x01, 0x01])),
      racp,
    });
    const out: ObservationInput[] = [];
    for (const view of values) {
      const m = parseGlucoseMeasurement(view);
      if (m.valueMgDl === undefined || Number.isNaN(m.measuredAt.getTime())) continue;
      out.push({
        concept: "blood_glucose",
        measuredAt: m.measuredAt.toISOString(),
        valueNumeric: round1(m.valueMgDl),
        enteredUnit: "mg/dL",
        method: "bluetooth_device",
        ...(m.context ? { bodySite: m.context } : {}),
      });
    }
    return out;
  }
}

interface CollectOptions {
  /** Resolve as soon as this many values arrived (a cuff sends exactly one per reading). */
  stopAfter?: number;
  /** Sent after notifications are on (the glucose RACP request). */
  kickoff?: () => Promise<void>;
  /** When given, the RACP response (op 0x06) ends the collection. */
  racp?: BluetoothCharacteristicLike;
}

/** Subscribes, collects `characteristicvaluechanged` values, unsubscribes — bounded by time. */
export async function collectNotifications(
  characteristic: BluetoothCharacteristicLike,
  listenMs: number,
  options: CollectOptions = {},
): Promise<DataView[]> {
  const values: DataView[] = [];
  return new Promise<DataView[]>((resolve, reject) => {
    let done = false;
    const finish = async (err?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      characteristic.removeEventListener("characteristicvaluechanged", onValue);
      if (options.racp) options.racp.removeEventListener("characteristicvaluechanged", onRacp);
      try {
        await characteristic.stopNotifications();
        if (options.racp) await options.racp.stopNotifications();
      } catch {
        // Disconnecting mid-stop is fine; the values are already ours.
      }
      if (err) reject(err);
      else resolve(values);
    };
    const onValue = (event: CharacteristicValueEvent) => {
      const value = event.target?.value;
      if (!value) return;
      // Copy: the browser reuses the DataView's buffer for the next notification.
      values.push(new DataView(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)));
      if (options.stopAfter !== undefined && values.length >= options.stopAfter) void finish();
    };
    const onRacp = (event: CharacteristicValueEvent) => {
      const value = event.target?.value;
      if (value && value.byteLength >= 1 && value.getUint8(0) === 0x06) void finish();
    };
    const timer = setTimeout(() => void finish(), listenMs);

    characteristic.addEventListener("characteristicvaluechanged", onValue);
    if (options.racp) options.racp.addEventListener("characteristicvaluechanged", onRacp);
    Promise.resolve()
      .then(() => characteristic.startNotifications())
      .then(() => options.racp?.startNotifications())
      .then(() => options.kickoff?.())
      .catch((err: unknown) => void finish(err));
  });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Every connector this build knows, in the order the UI offers them; `supported()` decides visibility. */
export function allConnectors(options: WebBluetoothOptions = {}): DeviceConnector[] {
  return [new ManualConnector(), new WebBluetoothConnector(options)];
}

export function availableConnectors(options: WebBluetoothOptions = {}): DeviceConnector[] {
  return allConnectors(options).filter((c) => c.supported());
}

/** True when a "Connect" affordance makes sense for this device kind in this browser. */
export function canConnect(kind: MeasurementDeviceKind, bluetooth: BluetoothLike | undefined = detectBluetooth()): boolean {
  return bluetooth !== undefined && BLUETOOTH_KINDS[kind] !== undefined;
}
