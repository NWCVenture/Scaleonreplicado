"use client";

import { useRef } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FileText, CheckCircle2, XCircle, Printer } from "lucide-react";

interface UploadZplProps {
  zplFileName: string | null;
  hasZpl: boolean;
  hasPlanilha: boolean;
  isGerandoPdf: boolean;
  onFileSelected: (file: File) => void;
  onRemove: () => void;
  onGerarPdfExemplo: () => void;
}

export function UploadZpl({
  zplFileName,
  hasZpl,
  hasPlanilha,
  isGerandoPdf,
  onFileSelected,
  onRemove,
  onGerarPdfExemplo,
}: UploadZplProps) {
  const zplInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  const handleRemove = () => {
    if (zplInputRef.current) {
      zplInputRef.current.value = "";
    }
    onRemove();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Printer className="h-5 w-5" />
          Template ZPL da Etiqueta
        </CardTitle>
        <CardDescription>
          Faca upload do arquivo ZPL que sera usado como template para gerar os
          PDFs das etiquetas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <input
              ref={zplInputRef}
              type="file"
              accept=".zpl,.txt"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              onClick={() => zplInputRef.current?.click()}
              variant="outline"
            >
              {zplFileName ? (
                <>
                  <FileText className="mr-2 h-4 w-4" />
                  {zplFileName}
                </>
              ) : (
                <>
                  <FileText className="mr-2 h-4 w-4" />
                  Selecionar Template ZPL
                </>
              )}
            </Button>

            {zplFileName && (
              <div className="flex items-center gap-2 text-sm text-green-500">
                <CheckCircle2 className="h-4 w-4" />
                <span>ZPL carregado</span>
              </div>
            )}

            {zplFileName && (
              <Button variant="outline" size="sm" onClick={handleRemove}>
                <XCircle className="mr-2 h-4 w-4" />
                Remover
              </Button>
            )}
          </div>

          {hasZpl && hasPlanilha && (
            <div className="mt-4">
              <Button
                onClick={onGerarPdfExemplo}
                disabled={isGerandoPdf}
                className="w-full"
              >
                {isGerandoPdf ? (
                  <>
                    <Spinner className="mr-2" />
                    Gerando PDF de Exemplo...
                  </>
                ) : (
                  <>
                    <Printer className="mr-2 h-4 w-4" />
                    Gerar PDF de Exemplo (Teste)
                  </>
                )}
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Gera um PDF de teste com o primeiro item da planilha para
                visualizar o resultado
              </p>
            </div>
          )}

          {!hasZpl && (
            <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-4">
              <p className="text-sm text-amber-400">
                Nenhum arquivo ZPL carregado. Faca upload do template ZPL para
                gerar PDFs.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
