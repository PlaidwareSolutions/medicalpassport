"use client";
import { useRef } from "react";
import { Button } from "@medpass/ui-web";

/**
 * The camera + choose-file button pair every document surface uses. Dumb by
 * design: hands the picked File(s) to the caller and nothing else — pages
 * own validation, upload, and error display. The gallery input is `multiple`
 * (a test report or prescription is routinely several pages); the camera
 * input stays single-shot because that's how phone capture works — repeated
 * taps append.
 */
export function DocumentUploadButtons({
  photoLabel,
  fileLabel,
  disabled,
  onPick,
}: {
  photoLabel: string;
  fileLabel: string;
  disabled?: boolean;
  /** `channel` says which input produced the files — camera or gallery/file picker — for callers that record a source (docs_v2/09 §3). */
  onPick: (files: File[], channel: "camera" | "gallery") => void;
}) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handle(list: FileList | null, channel: "camera" | "gallery") {
    const files = Array.from(list ?? []);
    if (files.length > 0) onPick(files, channel);
  }

  return (
    <>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          handle(e.target.files, "camera");
          e.target.value = "";
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          handle(e.target.files, "gallery");
          e.target.value = "";
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <Button variant="secondary" fullWidth disabled={disabled} onClick={() => cameraInputRef.current?.click()}>
          📷 {photoLabel}
        </Button>
        <Button variant="ghost" fullWidth disabled={disabled} onClick={() => fileInputRef.current?.click()}>
          {fileLabel}
        </Button>
      </div>
    </>
  );
}
