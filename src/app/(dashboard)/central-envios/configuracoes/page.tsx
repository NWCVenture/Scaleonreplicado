"use client";

// Shell de Configurações da Central de Envios (RITM-10).
//
// Renderiza os 5 cards CRUD em sequência. Cards lidam com loading/erro
// próprios — a page só compõe e adiciona breadcrumb + atalho pra outros
// cadastros relacionados.

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AliasCorCard } from "@/components/central-envios/configuracoes/alias-cor-card";
import { AliasTamanhoCard } from "@/components/central-envios/configuracoes/alias-tamanho-card";
import { CategoriaSkuCard } from "@/components/central-envios/configuracoes/categoria-sku-card";
import { FeriadoCard } from "@/components/central-envios/configuracoes/feriado-card";
import { RegrasPrazoCard } from "@/components/central-envios/configuracoes/regras-prazo-card";
import { useCentralEnviosConfiguracoes } from "@/hooks/use-central-envios-configuracoes";

export default function CentralEnviosConfiguracoesPage() {
  const {
    papel,
    podeEditar,
    regrasPrazo,
    aliasTamanho,
    aliasCor,
    feriado,
    categoria,
    recarregar,
    mutar,
    syncFeriadosNacionais,
  } = useCentralEnviosConfiguracoes();

  const [anoFeriado, setAnoFeriado] = useState<number>(
    new Date().getFullYear(),
  );

  async function trocarAno(ano: number) {
    setAnoFeriado(ano);
    await recarregar("feriado", { ano });
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link
            href="/central-envios"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Central de Envios
          </Link>
          <span>/</span>
          <span>Configurações</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Regras de prazo, aliases, feriados e categorias do extrator. Tudo
          cadastro-driven — sem hardcode de SKU ou plataforma.
        </p>
      </header>

      {!podeEditar && papel && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Você está em modo leitura. Apenas <strong>admins</strong> e{" "}
            <strong>owners</strong> podem editar configurações.
          </AlertDescription>
        </Alert>
      )}

      <RegrasPrazoCard
        regras={regrasPrazo.itens}
        canaisDisponiveis={regrasPrazo.canaisDisponiveis}
        loading={regrasPrazo.loading}
        erro={regrasPrazo.erro}
        podeEditar={podeEditar}
        onSalvar={async (payload) => {
          const { id, ...resto } = payload;
          if (id) {
            return mutar("regrasPrazo", "PATCH", { id, ...resto }, "Regra atualizada");
          }
          return mutar("regrasPrazo", "POST", resto, "Regra criada");
        }}
        onExcluir={(id) =>
          mutar("regrasPrazo", "DELETE", { id }, "Regra excluída")
        }
      />

      <AliasTamanhoCard
        aliases={aliasTamanho.itens}
        modelosDisponiveis={aliasTamanho.modelosDisponiveis}
        loading={aliasTamanho.loading}
        erro={aliasTamanho.erro}
        podeEditar={podeEditar}
        onSalvar={async (payload) => {
          if ("id" in payload && payload.id) {
            return mutar("aliasTamanho", "PATCH", payload, "Alias atualizado");
          }
          return mutar("aliasTamanho", "POST", payload, "Alias criado");
        }}
        onExcluir={(id) =>
          mutar("aliasTamanho", "DELETE", { id }, "Alias excluído")
        }
      />

      <AliasCorCard
        aliases={aliasCor.itens}
        modelosDisponiveis={aliasCor.modelosDisponiveis}
        loading={aliasCor.loading}
        erro={aliasCor.erro}
        podeEditar={podeEditar}
        onSalvar={async (payload) => {
          if ("id" in payload && payload.id) {
            return mutar("aliasCor", "PATCH", payload, "Alias atualizado");
          }
          return mutar("aliasCor", "POST", payload, "Alias criado");
        }}
        onExcluir={(id) => mutar("aliasCor", "DELETE", { id }, "Alias excluído")}
      />

      <FeriadoCard
        feriados={feriado.itens}
        loading={feriado.loading}
        erro={feriado.erro}
        podeEditar={podeEditar}
        anoAtual={anoFeriado}
        onAnoChange={trocarAno}
        onSalvar={async (payload) => {
          if ("id" in payload) {
            return mutar(
              "feriado",
              "PATCH",
              { id: payload.id, descricao: payload.descricao },
              "Feriado atualizado",
            );
          }
          return mutar(
            "feriado",
            "POST",
            { data: payload.data, descricao: payload.descricao },
            "Feriado criado",
          );
        }}
        onExcluir={(id) => mutar("feriado", "DELETE", { id }, "Feriado excluído")}
        onSyncNacionais={() => syncFeriadosNacionais()}
      />

      <CategoriaSkuCard
        categorias={categoria.itens}
        modelosDisponiveis={categoria.modelosDisponiveis}
        loading={categoria.loading}
        erro={categoria.erro}
        podeEditar={podeEditar}
        onSalvar={async (payload) => {
          if (payload.id) {
            return mutar("categoria", "PATCH", payload, "Categoria atualizada");
          }
          const { nome, ordem, ativo, regras } = payload;
          return mutar(
            "categoria",
            "POST",
            { nome, ordem, ativo, regras },
            "Categoria criada",
          );
        }}
        onExcluir={(id) =>
          mutar("categoria", "DELETE", { id }, "Categoria excluída")
        }
      />

      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground space-y-1">
        <p>
          <strong>Cadastros relacionados em outras telas:</strong>
        </p>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>
            Modelos, cores e tamanhos (incluindo{" "}
            <code>corPadrao</code>, <code>exigeTamanho</code> e{" "}
            <code>corMixDefault</code>) ficam em{" "}
            <Link
              href="/confeccao/cadastros/produtos"
              className="underline hover:text-foreground"
            >
              /confeccao/cadastros/produtos
            </Link>
            .
          </li>
          <li>
            Regras de kit (<code>sku_kit_regra</code>) ficam em{" "}
            <Link
              href="/coletas"
              className="underline hover:text-foreground"
            >
              /coletas
            </Link>{" "}
            (Configurações).
          </li>
        </ul>
      </div>

      <div className="pt-2">
        <Button variant="outline" size="sm" asChild>
          <Link href="/central-envios">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar para Central de Envios
          </Link>
        </Button>
      </div>
    </div>
  );
}
