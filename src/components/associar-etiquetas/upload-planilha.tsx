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
import { FileSpreadsheet, CheckCircle2, XCircle } from "lucide-react";

interface UploadPlanilhaProps {
  isProcessing: boolean;
  fileName: string | null;
  planilhaSize: number;
  onFileSelected: (file: File) => void;
  onRemove: () => void;
}

export function UploadPlanilha({
  isProcessing,
  fileName,
  planilhaSize,
  onFileSelected,
  onRemove,
}: UploadPlanilhaProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  const handleRemove = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onRemove();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Planilha de Referencia
        </CardTitle>
        <CardDescription>
          Faca upload de uma planilha Excel ou CSV. A coluna A contem o ID do
          Pedido, coluna AD o SKU e coluna AH a Quantidade.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Spinner className="mr-2" />
                  Processando...
                </>
              ) : (
                <>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  {fileName ?? "Selecionar Planilha"}
                </>
              )}
            </Button>

            {fileName && planilhaSize > 0 && (
              <div className="flex items-center gap-2 text-sm text-green-500">
                <CheckCircle2 className="h-4 w-4" />
                <span>{planilhaSize} associacoes carregadas</span>
              </div>
            )}

            {fileName && (
              <Button variant="outline" size="sm" onClick={handleRemove}>
                <XCircle className="mr-2 h-4 w-4" />
                Remover
              </Button>
            )}
          </div>

          {planilhaSize === 0 && !isProcessing && (
            <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-4">
              <p className="text-sm text-amber-400">
                Nenhuma planilha carregada. Faca upload de uma planilha Excel
                para comecar.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
