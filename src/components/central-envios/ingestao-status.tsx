"use client";

import { CheckCircle2, FileSpreadsheet, FileText, Loader2, X } from "lucide-react";
import type { UploadEmAndamento } from "@/types/central-envios";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Props = {
  uploads: UploadEmAndamento[];
  onLimparConcluidos: () => void;
};

const labelTipo: Record<UploadEmAndamento["tipoIngestao"], string> = {
  tiktok_csv: "TikTok CSV",
  ml_xlsx: "ML XLSX",
};

const iconeTipo: Record<UploadEmAndamento["tipoIngestao"], typeof FileText> = {
  tiktok_csv: FileText,
  ml_xlsx: FileSpreadsheet,
};

function badgeEstado(u: UploadEmAndamento) {
  switch (u.estado.status) {
    case "enviando":
      return (
        <Badge variant="outline" className="border-blue-300 text-blue-700">
          <Loader2 className="h-3 w-3 animate-spin mr-1" />
          Enviando
        </Badge>
      );
    case "processando":
      return (
        <Badge variant="outline" className="border-amber-300 text-amber-700">
          <Loader2 className="h-3 w-3 animate-spin mr-1" />
          Processando
        </Badge>
      );
    case "concluido":
      return (
        <Badge variant="outline" className="border-green-300 text-green-700">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Concluído
        </Badge>
      );
    case "erro":
      return (
        <Badge variant="destructive">
          <X className="h-3 w-3 mr-1" />
          Erro
        </Badge>
      );
  }
}

export function IngestaoStatus({ uploads, onLimparConcluidos }: Props) {
  if (uploads.length === 0) return null;
  const algumConcluido = uploads.some(
    (u) => u.estado.status === "concluido" || u.estado.status === "erro",
  );
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h3 className="text-sm font-medium">
          Arquivos em processamento ({uploads.length})
        </h3>
        {algumConcluido && (
          <Button variant="ghost" size="sm" onClick={onLimparConcluidos}>
            Limpar concluídos
          </Button>
        )}
      </div>
      <ul className="divide-y">
        {uploads.map((u) => {
          const Icon = iconeTipo[u.tipoIngestao];
          return (
            <li key={u.id} className="flex items-center gap-3 px-4 py-2">
              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{u.arquivoNome}</p>
                <p className="text-xs text-muted-foreground">
                  {labelTipo[u.tipoIngestao]}
                  {u.estado.status === "concluido" && (
                    <>
                      {" · "}
                      {u.estado.linhasValidas} válidas
                      {u.estado.linhasDescartadas > 0 &&
                        ` · ${u.estado.linhasDescartadas} descartadas`}
                    </>
                  )}
                  {u.estado.status === "erro" && (
                    <span className="ml-1 text-destructive">
                      · {u.estado.erro}
                    </span>
                  )}
                </p>
              </div>
              {badgeEstado(u)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
