"use client";

// <UploadAnexo /> — componente reutilizável de upload para o módulo
// Confecção. Padrão cliente → Vercel Blob direto (via handleUpload do
// backend), com progress bar real, cancelamento e validação client-side.
//
// Uso típico (dentro de uma subtask):
//   <UploadAnexo
//     subtaskId={subtask.id}
//     opNumero={op.numero}
//     subtaskNumero={subtask.numero}
//     contaId={contaId}
//     categoria="nf_compra"
//     onUploaded={(anexo) => recarregarLista()}
//   />

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  type AnexoCategoria,
} from "@/lib/confeccao/schemas/anexo";

export interface UploadedAnexo {
  id: string;
  nomeArquivo: string;
  blobUrl: string;
  categoria: string;
  tamanhoBytes: number;
  tipoMime: string;
}

export interface UploadAnexoProps {
  ordemProducaoId?: string;
  subtaskId?: string;
  lalamoveId?: string;
  opNumero: string;
  subtaskNumero?: string;
  categoria: AnexoCategoria;
  contaId: string;
  multiple?: boolean;
  accept?: string;
  onUploaded?: (anexo: UploadedAnexo) => void;
  disabled?: boolean;
  label?: string;
}

const ALLOWED_SET = new Set<string>(ALLOWED_MIME_TYPES);

export function UploadAnexo(props: UploadAnexoProps) {
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);

    for (const file of Array.from(fileList)) {
      // Defesa em profundidade — o backend valida de novo
      if (!ALLOWED_SET.has(file.type)) {
        const msg = `Tipo não permitido: ${file.type || file.name}`;
        setError(msg);
        toast.error(msg);
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        const msg = `Arquivo maior que 50MB: ${file.name}`;
        setError(msg);
        toast.error(msg);
        continue;
      }

      const pathname = props.subtaskNumero
        ? `confeccao/${props.contaId}/op-${props.opNumero}/subtask-${props.subtaskNumero}/${file.name}`
        : `confeccao/${props.contaId}/op-${props.opNumero}/op-level/${file.name}`;

      setUploading(true);
      setProgress(0);
      abortRef.current = new AbortController();

      try {
        const blob = await upload(pathname, file, {
          access: "public",
          handleUploadUrl: "/api/confeccao/uploads/token",
          clientPayload: JSON.stringify({
            ordemProducaoId: props.ordemProducaoId,
            subtaskId: props.subtaskId,
            lalamoveId: props.lalamoveId,
            categoria: props.categoria,
            opNumero: props.opNumero,
            subtaskNumero: props.subtaskNumero,
          }),
          onUploadProgress: (e) => {
            const total = e.total > 0 ? e.total : file.size;
            setProgress(Math.round((e.loaded / total) * 100));
          },
          abortSignal: abortRef.current.signal,
        });

        const res = await fetch("/api/confeccao/uploads/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ordemProducaoId: props.ordemProducaoId,
            subtaskId: props.subtaskId,
            lalamoveId: props.lalamoveId,
            categoria: props.categoria,
            nomeArquivo: file.name,
            tipoMime: file.type,
            tamanhoBytes: file.size,
            blobUrl: blob.url,
            blobPathname: blob.pathname,
          }),
        });

        if (!res.ok) {
          const { error: msg } = await res
            .json()
            .catch(() => ({ error: "Erro desconhecido ao confirmar" }));
          throw new Error(msg ?? "Falha ao confirmar upload");
        }

        const { anexo } = (await res.json()) as { anexo: UploadedAnexo };
        toast.success(`${file.name} enviado`);
        props.onUploaded?.(anexo);
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError") {
          toast.info("Upload cancelado");
        } else {
          setError(err.message);
          toast.error(`Falha no upload: ${err.message}`);
        }
      } finally {
        setUploading(false);
        setProgress(0);
        abortRef.current = null;
      }
    }

    if (inputRef.current) inputRef.current.value = "";
  }

  function cancelar() {
    abortRef.current?.abort();
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={props.accept ?? ALLOWED_MIME_TYPES.join(",")}
        multiple={props.multiple ?? false}
        onChange={(e) => void handleFiles(e.target.files)}
        disabled={props.disabled || uploading}
        className="hidden"
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={props.disabled || uploading}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {uploading
            ? `Enviando… ${progress}%`
            : (props.label ?? "Adicionar anexo")}
        </Button>
        {uploading && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={cancelar}
            aria-label="Cancelar upload"
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
      {uploading && <Progress value={progress} className="h-1" />}
      {error && !uploading && (
        <p className="text-xs text-red-500">{error}</p>
      )}
    </div>
  );
}
