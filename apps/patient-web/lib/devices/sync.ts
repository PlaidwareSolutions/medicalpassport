import { api, getActiveProfileId } from "../api";
import { invalidate } from "../data-cache";
import type { ObservationInput } from "../observations";
import type { DeviceConnector } from "./connector";

export interface DeviceSyncResult {
  read: number;
  created: number;
  duplicates: number;
}

export interface BatchResponse {
  created: number;
  duplicates: number;
}

export type BatchPoster = (body: { deviceId: string; items: ObservationInput[] }) => Promise<BatchResponse>;

const BATCH_PATH = "/profiles/current/observations/batch";

async function postBatch(body: { deviceId: string; items: ObservationInput[] }): Promise<BatchResponse> {
  const res = await api.post<BatchResponse>(BATCH_PATH, body, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/observations");
  invalidate("profile", "/profiles/current/trends/observations");
  invalidate("profile", "/profiles/current/measurement-devices");
  return res;
}

/**
 * Pulls readings from a connector and sends them through the batch endpoint with the
 * patient's `deviceId` (docs_v2/05 §7): the server dedupes on `(concept, measuredAt,
 * deviceId)`, so syncing twice never doubles a reading, and every row carries which
 * device it came from. Nothing is written when the device had nothing new.
 */
export async function syncDeviceReadings(
  connector: DeviceConnector,
  deviceId: string,
  since: Date | null,
  post: BatchPoster = postBatch,
): Promise<DeviceSyncResult> {
  const items = await connector.readObservations(since);
  if (items.length === 0) return { read: 0, created: 0, duplicates: 0 };
  const res = await post({ deviceId, items });
  return { read: items.length, created: res.created, duplicates: res.duplicates };
}
