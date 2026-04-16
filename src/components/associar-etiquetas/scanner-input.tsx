"use client";

import { forwardRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface ScannerInputProps {
  value: string;
  onChange: (value: string) => void;
  onProcess: () => void;
  disabled?: boolean;
}

export const ScannerInput = forwardRef<HTMLTextAreaElement, ScannerInputProps>(
  ({ value, onChange, onProcess, disabled }, ref) => {
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        onProcess();
      }
    };

    return (
      <div className="space-y-2">
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Cole etiquetas aqui (Tab ou Enter para processar)"
          rows={4}
          disabled={disabled}
          className="font-mono text-sm"
        />
        <div className="flex gap-2">
          <Button
            onClick={onProcess}
            disabled={!value.trim() || disabled}
            size="sm"
          >
            Processar
          </Button>
          <Button
            onClick={() => onChange("")}
            variant="outline"
            size="sm"
            disabled={!value}
          >
            Limpar
          </Button>
        </div>
      </div>
    );
  },
);
ScannerInput.displayName = "ScannerInput";
