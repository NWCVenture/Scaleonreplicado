"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Camera, Loader2 } from "lucide-react";
import jsQR from "jsqr";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => {
      detect: (
        source: HTMLVideoElement,
      ) => Promise<Array<{ rawValue: string }>>;
    };
  }
}

interface CameraScannerProps {
  onScan: (raw: string) => void;
  className?: string;
}

export function CameraScanner({ onScan, className }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const doneRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "scanning" | "error">(
    "loading",
  );

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startDetection = useCallback(
    (video: HTMLVideoElement) => {
      if ("BarcodeDetector" in window && window.BarcodeDetector) {
        let detector: InstanceType<NonNullable<typeof window.BarcodeDetector>>;
        try {
          detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        } catch {
          detector = undefined!;
        }
        if (detector) {
          const scan = async () => {
            if (doneRef.current) return;
            try {
              const codes = await detector.detect(video);
              if (codes.length > 0) {
                cleanup();
                onScan(codes[0].rawValue);
                return;
              }
            } catch {
              /* detection frame error, continue */
            }
            rafRef.current = requestAnimationFrame(scan);
          };
          rafRef.current = requestAnimationFrame(scan);
          return;
        }
      }

      // Fallback to jsQR
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const scan = () => {
        if (doneRef.current) return;
        if (video.readyState >= 2 && ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, {
            inversionAttempts: "dontInvert",
          });
          if (code?.data) {
            cleanup();
            onScan(code.data);
            return;
          }
        }
        rafRef.current = requestAnimationFrame(scan);
      };
      rafRef.current = requestAnimationFrame(scan);
    },
    [cleanup, onScan],
  );

  useEffect(() => {
    doneRef.current = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (doneRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.onloadedmetadata = async () => {
          await video.play().catch(() => {});
          setStatus("scanning");
          startDetection(video);
        };
      } catch {
        setStatus("error");
      }
    })();
    return () => {
      doneRef.current = true;
      cleanup();
    };
  }, [cleanup, startDetection]);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg bg-black",
        className,
      )}
    >
      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-white/30" />
          <p className="text-xs text-white/70">Iniciando câmera...</p>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <Camera className="h-10 w-10 text-red-400" />
          <p className="text-sm text-white/70">
            Erro ao acessar câmera.
            <br />
            Use o campo de texto abaixo.
          </p>
        </div>
      )}
      <video
        ref={videoRef}
        className={cn(
          "h-64 w-full object-cover",
          status === "scanning" ? "opacity-100" : "opacity-0",
        )}
        playsInline
        muted
      />
      {status === "scanning" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-44 w-44">
            <div className="absolute left-0 top-0 h-8 w-8 rounded-tl-lg border-l-4 border-t-4 border-white" />
            <div className="absolute right-0 top-0 h-8 w-8 rounded-tr-lg border-r-4 border-t-4 border-white" />
            <div className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-lg border-b-4 border-l-4 border-white" />
            <div className="absolute bottom-0 right-0 h-8 w-8 rounded-br-lg border-b-4 border-r-4 border-white" />
          </div>
          <p className="absolute bottom-4 text-xs text-white/80">
            Aponte para o QR Code
          </p>
        </div>
      )}
    </div>
  );
}
