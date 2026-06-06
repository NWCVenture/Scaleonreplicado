"use client";

import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { PedidoEnriquecido } from "@/types/central-envios";

const LABEL_CANAL: Record<string, string> = {
  tiktok_shop: "TikTok",
  mercado_livre: "ML",
  shopee: "Shopee",
};

const LABEL_MOTIVO: Record<string, string> = {
  input_vazio: "SKU vazio",
  modelo_desconhecido: "Modelo desconhecido",
  cor_desconhecida: "Cor desconhecida",
  tamanho_desconhecido: "Tamanho desconhecido",
  kit_sem_n: "KIT sem N",
  kit_inconsistente: "KIT inconsistente",
  cor_ausente: "Cor ausente",
  tamanho_ausente: "Tamanho ausente",
  tokens_extras: "Tokens extras",
  mix_invalido: "MIX inválido",
};

type Props = {
  dados: PedidoEnriquecido[];
};

export function AmbiguosTab({ dados }: Props) {
  const ambiguos = dados.filter((p) => p.parsed.kind === "AMBIGUO");

  if (ambiguos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-12 px-4 text-center text-muted-foreground">
        <CheckCircle2 className="mx-auto h-10 w-10 opacity-40" />
        <p className="mt-3 text-sm">
          Nenhum SKU ambíguo. Todos os pedidos foram normalizados.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {ambiguos.length.toLocaleString("pt-BR")} pedido(s) com SKU que o parser
        não conseguiu interpretar.
      </p>
      <Card>
        <CardContent className="py-2 divide-y">
          {ambiguos.map((p, i) => {
            const amb = p.parsed.kind === "AMBIGUO" ? p.parsed : null;
            const motivoLabel =
              (amb && LABEL_MOTIVO[amb.motivo]) ?? amb?.motivo ?? "—";
            return (
              <div
                key={`${p.canal}-${p.orderId}-${i}`}
                className="py-3 flex flex-col md:flex-row md:items-start md:gap-4"
              >
                <div className="md:flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-mono font-medium">{p.skuRaw}</span>
                    <Badge
                      variant="outline"
                      className="border-amber-300 text-amber-700 bg-amber-50 text-xs"
                    >
                      {motivoLabel}
                    </Badge>
                  </div>
                  {amb && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {amb.detalhes}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {LABEL_CANAL[p.canal] ?? p.canal} ·{" "}
                    <span className="font-mono">{p.orderId}</span>
                    {p.trackingId && (
                      <>
                        {" · tracking "}
                        <span className="font-mono">{p.trackingId}</span>
                      </>
                    )}
                  </p>
                </div>
                <div className="mt-2 md:mt-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      toast.info("Edição manual disponível em V2", {
                        description:
                          "Por enquanto, cadastre o kit via /coletas/configuracoes/kit-rules ou ajuste alias de cor/tamanho.",
                      })
                    }
                  >
                    Cadastrar como kit
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
