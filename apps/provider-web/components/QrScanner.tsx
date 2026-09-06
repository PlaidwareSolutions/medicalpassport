"use client";
import { useEffect, useRef, useState } from "react";
import { Banner, Button } from "@medpass/ui-web";

/** Chrome / Android WebView expose this; Safari and Firefox do not (yet). */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect: (source: ImageBitmapSource) => Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function barcodeDetector(): BarcodeDetectorCtor | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
}

/**
 * Camera QR scanner for patient onboarding (docs_v2/06 P11-3). Uses the
 * platform BarcodeDetector where it exists; everywhere else it explains
 * itself and the parent's paste field is the way in. Frames never leave the
 * page (no upload, no canvas export); the stream stops on unmount.
 */
export function QrScanner({ onCode, active }: { onCode: (raw: string) => void; active: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"idle" | "starting" | "scanning" | "unsupported" | "denied" | "error">("idle");
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!active || !started) return;
    const Detector = barcodeDetector();
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let stopped = false;
    const detector = new Detector({ formats: ["qr_code"] });
    setState("starting");

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      } catch (err) {
        setState(err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError") ? "denied" : "error");
        return;
      }
      if (stopped || !videoRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => undefined);
      setState("scanning");
      const tick = async () => {
        if (stopped || !videoRef.current || videoRef.current.readyState < 2) return;
        try {
          const codes = await detector.detect(videoRef.current);
          const hit = codes.find((c) => c.rawValue);
          if (hit) {
            stopped = true;
            onCodeRef.current(hit.rawValue);
          }
        } catch {
          // A transient decode failure; the next tick tries again.
        }
      };
      timer = window.setInterval(() => void tick(), 300);
    })();

    return () => {
      stopped = true;
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [active, started]);

  if (!started) {
    return (
      <Button variant="secondary" fullWidth onClick={() => setStarted(true)} data-testid="start-camera">
        Scan the patient's code with the camera
      </Button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
      {state === "unsupported" ? (
        <Banner tone="info">Camera scanning is not available in this browser. Ask the patient to read out or share the code and paste it below.</Banner>
      ) : null}
      {state === "denied" ? <Banner tone="warning">Camera access was refused. Allow the camera for this site, or paste the code below.</Banner> : null}
      {state === "error" ? <Banner tone="warning">The camera could not be started. Paste the code below instead.</Banner> : null}
      {state === "starting" || state === "scanning" ? (
        <>
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label="Camera preview for scanning the patient's QR code"
            style={{ width: "100%", maxHeight: 360, borderRadius: "var(--radius)", background: "#000", objectFit: "cover" }}
          />
          <span role="status" style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            {state === "starting" ? "Starting the camera…" : "Point the camera at the code on the patient's phone."}
          </span>
        </>
      ) : null}
    </div>
  );
}
