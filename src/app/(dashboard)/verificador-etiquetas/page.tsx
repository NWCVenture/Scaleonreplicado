"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Search, Copy } from "lucide-react";
import { pdfjs } from "@/lib/pdf-worker";
import { PageHeader } from "@/components/layout/page-header";

// Heuristica simples para extrair identificadores de etiquetas (ex: UP3LTS055096):
// - Apenas letras maiusculas e numeros
// - Tamanho entre 8 e 20 caracteres
// - Pelo menos 2 letras e 2 digitos
function extractIdentifiers(text: string): Set<string> {
  const tokens = text
    .split(/[^A-Z0-9]+/i)
    .map(t => t.trim())
    .filter(Boolean);

  const ids = new Set<string>();

  tokens.forEach(token => {
    const up = token.toUpperCase();
    if (up.length < 8 || up.length > 20) return;
    const letters = (up.match(/[A-Z]/g) || []).length;
    const digits = (up.match(/\d/g) || []).length;
    if (letters >= 2 && digits >= 2) {
      ids.add(up);
    }
  });

  return ids;
}

export default function VerificadorEtiquetas() {
  const [pdfBipado, setPdfBipado] = useState<File | null>(null);
  const [pdfMisturado, setPdfMisturado] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paginasNaoBipadas, setPaginasNaoBipadas] = useState<number[]>([]);

  const handleVerificar = async () => {
    if (!pdfBipado || !pdfMisturado) {
      toast.error("Selecione os dois PDFs (BIPADO e MISTURADO).");
      return;
    }

    setIsProcessing(true);
    setPaginasNaoBipadas([]);

    try {
      const carregarPdf = async (file: File) => {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        if (bytes.length < 4) {
          throw new Error("Arquivo muito pequeno ou invalido.");
        }

        const header = String.fromCharCode(...Array.from(bytes.slice(0, 4)));
        if (header !== "%PDF") {
          throw new Error("Arquivo nao e um PDF valido.");
        }

        const pdf = await pdfjs.getDocument({
          data: bytes,
          verbosity: 0,
        }).promise;

        if (!pdf || pdf.numPages === 0) {
          throw new Error("PDF nao contem paginas validas.");
        }

        return pdf;
      };

      // 1) Carregar PDFs
      const [pdfBipadoDoc, pdfMisturadoDoc] = await Promise.all([
        carregarPdf(pdfBipado),
        carregarPdf(pdfMisturado),
      ]);

      // 2) Extrair TODOS identificadores do PDF BIPADO
      const idsBipados = new Set<string>();
      for (let pageNum = 1; pageNum <= pdfBipadoDoc.numPages; pageNum++) {
        const page = await pdfBipadoDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const text = textContent.items.map((item: any) => (item as any).str).join(" ");
        const idsPagina = extractIdentifiers(text);
        idsPagina.forEach(id => idsBipados.add(id));
      }

      // 3) No PDF MISTURADO, marcar paginas que tenham ALGUM identificador que NAO esta em idsBipados
      const paginasComNaoBipados: number[] = [];

      for (let pageNum = 1; pageNum <= pdfMisturadoDoc.numPages; pageNum++) {
        const page = await pdfMisturadoDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const text = textContent.items.map((item: any) => (item as any).str).join(" ");
        const idsPagina = extractIdentifiers(text);

        let temNaoBipado = false;
        idsPagina.forEach(id => {
          if (!idsBipados.has(id)) {
            temNaoBipado = true;
          }
        });

        if (temNaoBipado) {
          paginasComNaoBipados.push(pageNum);
        }
      }

      setPaginasNaoBipadas(paginasComNaoBipados);

      if (paginasComNaoBipados.length === 0) {
        toast.success("Nenhuma pagina com etiquetas nao bipadas foi encontrada no PDF misturado.");
      } else {
        toast.success(`Encontradas ${paginasComNaoBipados.length} pagina(s) com etiquetas NAO presentes no PDF bipado.`);
      }
    } catch (error: any) {
      console.error("Erro no verificador de etiquetas:", error);
      const msg = error?.message || "Erro desconhecido ao processar PDFs.";
      toast.error(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopyResumo = () => {
    if (!paginasNaoBipadas.length) return;
    const resumo = `Paginas do PDF MISTURADO que possuem identificadores nao presentes no PDF BIPADO: ${paginasNaoBipadas.join(", ")}`;
    navigator.clipboard.writeText(resumo);
    toast.success("Lista de paginas copiada para a area de transferencia!");
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Verificador de Etiquetas"
        description="Compare dois PDFs (BIPADO x MISTURADO) e descubra em quais paginas do PDF misturado existem etiquetas que NAO aparecem no PDF bipado (desmisturar o PDF)."
      />

      <div className="max-w-[900px]">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Upload dos PDFs</CardTitle>
            <CardDescription>
              Selecione os dois arquivos PDF para comparacao
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">PDF BIPADO</label>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setPdfBipado(file);
                  }}
                  className="block w-full text-xs text-muted-foreground file:mr-2 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                />
                {pdfBipado && (
                  <p className="text-[10px] text-muted-foreground break-all">
                    {pdfBipado.name}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">PDF MISTURADO</label>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setPdfMisturado(file);
                  }}
                  className="block w-full text-xs text-muted-foreground file:mr-2 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                />
                {pdfMisturado && (
                  <p className="text-[10px] text-muted-foreground break-all">
                    {pdfMisturado.name}
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleVerificar}
                disabled={isProcessing || !pdfBipado || !pdfMisturado}
                className="bg-[#ff6b35] hover:bg-[#e55a2b] text-white font-semibold py-2.5 px-4 rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Verificando...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" />
                    Desmisturar PDF
                  </>
                )}
              </button>

              {paginasNaoBipadas.length > 0 && (
                <button
                  onClick={handleCopyResumo}
                  className="bg-slate-800 hover:bg-slate-900 text-white font-semibold py-2.5 px-4 rounded-lg shadow-sm transition-all flex items-center justify-center gap-2"
                >
                  <Copy className="h-4 w-4" />
                  Copiar paginas
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resultado</CardTitle>
            <CardDescription>
              Paginas do PDF MISTURADO que possuem identificadores que nao aparecem em nenhuma pagina do PDF BIPADO.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {paginasNaoBipadas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma pagina encontrada ou ainda nao foi feita a analise.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm">
                  Total de paginas identificadas:{" "}
                  <span className="font-semibold">{paginasNaoBipadas.length}</span>
                </p>
                <p className="text-sm">
                  Paginas:{" "}
                  <span className="font-mono">
                    {paginasNaoBipadas.join(", ")}
                  </span>
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
