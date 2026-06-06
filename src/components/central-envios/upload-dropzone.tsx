"use client";

import { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  onFiles: (files: FileList | File[]) => void;
  disabled?: boolean;
};

export function UploadDropzone({ onFiles, disabled }: Props) {
  const [isOver, setIsOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsOver(false);
      if (disabled) return;
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) onFiles(files);
    },
    [onFiles, disabled],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onDragEnter={(e) => {
        e.preventDefault();
        if (!disabled) setIsOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => setIsOver(false)}
      onDrop={handleDrop}
      onClick={() => {
        if (!disabled) inputRef.current?.click();
      }}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          inputRef.current?.click();
        }
      }}
      className={cn(
        "w-full rounded-lg border-2 border-dashed transition-colors px-6 py-12 text-center select-none",
        disabled && "opacity-60 cursor-not-allowed",
        !disabled && "cursor-pointer",
        isOver
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/30 hover:border-muted-foreground/60",
      )}
    >
      <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
      <p className="mt-3 text-base font-medium">
        Arraste arquivos CSV (TikTok) ou XLSX (Mercado Livre)
      </p>
      <p className="text-sm text-muted-foreground">ou clique para escolher</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="sr-only"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
