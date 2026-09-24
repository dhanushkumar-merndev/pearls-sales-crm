"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Input } from "@/components/ui/input";

const ACCEPT =
  ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/**
 * The upload target for both bulk importers: click to browse, or drop a file
 * on it.
 *
 * Drag and drop only works if dragover AND drop both call preventDefault --
 * without that the browser keeps its default behaviour of navigating away to
 * open the dropped file, which looks exactly like "drag and drop is broken".
 * dragenter/dragleave arrive for every child element too, so the highlight is
 * driven by a depth counter rather than a boolean that flickers off the moment
 * the pointer crosses the icon.
 */
export function SpreadsheetDropzone({
  onFile,
  disabled = false,
}: {
  onFile: (file?: File) => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const ready = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const depth = useRef(0);

  // A user can only choose a file after this client component is interactive.
  // Exposing that moment also lets automated tests avoid firing a synthetic
  // file event into server-rendered markup before React has attached it.

  const reset = () => {
    depth.current = 0;
    setDragging(false);
  };

  return (
    <label
      data-dragging={dragging || undefined}
      data-file-upload-ready={ready || undefined}
      className={
        "flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed p-5 text-center transition-colors " +
        (disabled
          ? "cursor-not-allowed bg-muted/20 opacity-60"
          : "cursor-pointer bg-muted/30 hover:bg-muted/60 data-[dragging]:border-primary data-[dragging]:bg-primary/10")
      }
      onDragEnter={(event) => {
        if (disabled) return;
        event.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (disabled) return;
        // Required every frame, not just once: skipping it re-enables the
        // browser's own "open this file" handling and the drop never fires.
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (disabled) return;
        event.preventDefault();
        depth.current -= 1;
        if (depth.current <= 0) reset();
      }}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        reset();
        const file = event.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
    >
      <FileSpreadsheet className="mb-2 size-7 text-primary" />
      <span className="text-sm font-medium">
        {dragging ? "Drop the file to load it" : "Drag and drop or choose a file"}
      </span>
      <span className="text-xs text-muted-foreground">.xlsx or .csv</span>
      <Input
        className="sr-only"
        type="file"
        accept={ACCEPT}
        disabled={disabled}
        onChange={(event) => {
          const input = event.target;
          onFile(input.files?.[0]);
          // Let the same file be picked again after a failed parse.
          input.value = "";
        }}
      />
    </label>
  );
}
