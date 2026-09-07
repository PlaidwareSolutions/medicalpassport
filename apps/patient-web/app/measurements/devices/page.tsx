"use client";
import { useEffect, useState } from "react";
import { ApiError } from "@medpass/api-client";
import { MEASUREMENT_DEVICE_KINDS, type MeasurementDeviceKind } from "@medpass/domain";
import { Banner, Button, Card, Chip, ChoiceGrid, PillSpinner, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { EmptyState } from "../../../components/EmptyState";
import { PageHeader } from "../../../components/PageHeader";
import { canConnect, syncDeviceReadings, WebBluetoothConnector } from "../../../lib/devices";
import { useI18n } from "../../../lib/i18n";
import { createMeasurementDevice, deleteMeasurementDevice, updateMeasurementDevice, useMeasurementDevices } from "../../../lib/observations";
import { formatPatientDateTime, useActiveTimezone } from "../../../lib/patient-time";

/**
 * Measurement devices (docs_v2/04 §5.4): the patient's own BP monitor,
 * glucometer, scale, oximeter, thermometer — recorded by hand so a reading
 * can say which device it came from.
 *
 * Bluetooth (docs_v2/06 P5-5): when this browser has Web Bluetooth, a BP
 * monitor or glucometer row offers "Connect and sync", which opens the
 * browser's device chooser and pulls the device's readings through the batch
 * endpoint with this device's id (the server dedupes on concept + time +
 * device). Everywhere else — Safari, CI, every phone health app — the screen
 * keeps today's one plain sentence rather than showing a button that does
 * nothing. Detection happens after mount so the server-rendered page and the
 * first client render agree.
 */
export default function MeasurementDevicesPage() {
  const { t, tn } = useI18n();
  const timezone = useActiveTimezone();
  const { items, error, reload } = useMeasurementDevices();
  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState<MeasurementDeviceKind>("bp_monitor");
  const [label, setLabel] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const [bluetoothReady, setBluetoothReady] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | undefined>();
  const [syncingId, setSyncingId] = useState<string | undefined>();

  useEffect(() => {
    setBluetoothReady(new WebBluetoothConnector().supported());
  }, []);

  async function connect(d: { id: string; kind: MeasurementDeviceKind; lastSyncAt: string | null }) {
    setSyncingId(d.id);
    setActionError(undefined);
    setSyncMessage(undefined);
    try {
      const connector = new WebBluetoothConnector();
      const found = await connector.discover(d.kind);
      if (found.length === 0) return;
      const result = await syncDeviceReadings(connector, d.id, d.lastSyncAt ? new Date(d.lastSyncAt) : null);
      // Two counts, two sentences: one plural form can't be right for both.
      setSyncMessage(
        result.read === 0
          ? t("device.sync_none")
          : [
              tn(result.created, "device.sync_created_one", "device.sync_created", { created: result.created }),
              tn(result.duplicates, "device.sync_duplicates_one", "device.sync_duplicates", { duplicates: result.duplicates }),
            ].join(" · "),
      );
      await reload();
    } catch (err) {
      // The chooser was dismissed: nothing to report. Anything else: one plain sentence.
      if (err instanceof DOMException && err.name === "NotFoundError") return;
      setActionError(err instanceof ApiError ? err.problem.title : t("device.sync_failed"));
    } finally {
      setSyncingId(undefined);
    }
  }

  async function save() {
    setBusy(true);
    setActionError(undefined);
    try {
      await createMeasurementDevice({
        kind,
        platform: "manual",
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(manufacturer.trim() ? { manufacturer: manufacturer.trim() } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
      });
      setLabel("");
      setManufacturer("");
      setModel("");
      setShowForm(false);
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function retire(id: string, status: "active" | "retired") {
    setBusy(true);
    setActionError(undefined);
    try {
      await updateMeasurementDevice(id, { status });
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("device.delete_confirm"))) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await deleteMeasurementDevice(id);
      await reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("device.title")} readAloud={[{ audio: "screen.devices" }]} />
      <Banner tone="info">{bluetoothReady ? t("device.sync_available") : t("device.sync_later")}</Banner>
      {syncMessage ? <Banner tone="success">{syncMessage}</Banner> : null}
      {error && !items ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}
      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 && !showForm ? <EmptyState glyph="pulse" titleKey="device.empty_title" bodyKey="device.empty_body" /> : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((d) => (
            <Card key={d.id} data-testid="device-row">
              <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-sm)", flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{d.label || t(`device.kind.${d.kind}` as never)}</strong>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {[t(`device.kind.${d.kind}` as never), d.manufacturer, d.model].filter(Boolean).join(" · ")}
                  </div>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {d.lastSyncAt ? t("device.last_sync", { time: formatPatientDateTime(d.lastSyncAt, timezone) }) : t("device.manual_only")}
                  </div>
                </div>
                <Chip tone={d.status === "active" ? "success" : "default"}>{t(`device.status.${d.status}` as never)}</Chip>
              </div>
              <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
                {bluetoothReady && d.status === "active" && canConnect(d.kind) ? (
                  <Button fullWidth loading={syncingId === d.id} disabled={busy || syncingId !== undefined} onClick={() => void connect(d)} data-testid="device-connect">
                    {t("device.connect")}
                  </Button>
                ) : null}
                <Button variant="secondary" disabled={busy} onClick={() => void retire(d.id, d.status === "active" ? "retired" : "active")} style={{ flex: "1 1 45%" }}>
                  {d.status === "active" ? t("device.retire") : t("device.reactivate")}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => void remove(d.id)} style={{ flex: "1 1 45%" }}>
                  {t("device.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {showForm ? (
        <Card>
          <ChoiceGrid
            label={t("device.kind_label")}
            columns={2}
            choices={MEASUREMENT_DEVICE_KINDS.map((k) => ({ value: k, label: t(`device.kind.${k}` as never) }))}
            value={kind}
            onChange={setKind}
          />
          <TextInput label={t("device.label_label")} placeholder={t("device.label_placeholder")} value={label} onChange={(e) => setLabel(e.target.value)} />
          <TextInput label={t("device.manufacturer_label")} placeholder={t("device.manufacturer_placeholder")} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
          <TextInput label={t("device.model_label")} value={model} onChange={(e) => setModel(e.target.value)} />
          <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
            <Button fullWidth loading={busy} disabled={busy} onClick={() => void save()} style={{ flex: "1 1 60%" }}>
              {t("device.save")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setShowForm(false)} style={{ flex: "1 1 30%" }}>
              {t("common.cancel")}
            </Button>
          </div>
        </Card>
      ) : (
        <Button fullWidth onClick={() => setShowForm(true)}>
          {t("device.add")}
        </Button>
      )}
    </AppShell>
  );
}
