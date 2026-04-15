"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Input, Label } from "@/components/ui/form-elements";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Calculator, DollarSign, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/page-header";

// Tipos
type DadosLote = {
  nome_lote: string;
  peso_rolo_kg: number;
  metragem_rolo_metros: number;
  custo_total_rolo: number;
  area_risco_m2: number;
  aproveitamento_risco_percentual: number;
  pecas_geradas_risco: number;
  custo_total_corte: number;
  quantidade_pecas_cortadas: number;
  custo_total_costura: number;
  quantidade_pecas_boas_costura: number;
  custo_total_aviamentos: number;
  margem_lucro_percentual: number;
};

// Form state uses strings for number inputs (HTML inputs return strings)
type DadosLoteForm = {
  [K in keyof DadosLote]: string;
};

type ResultadosCalculados = {
  peso_por_metro: number;
  area_util_risco: number;
  area_por_peca: number;
  consumo_kg_por_peca: number;
  custo_tecido_por_peca: number;
  custo_corte_por_peca: number;
  custo_costura_por_peca: number;
  custo_aviamentos_por_peca: number;
  rendimento: number;
  custo_total_producao: number;
  custo_real_por_peca: number;
  preco_venda: number;
};

type LoteRegistrado = {
  id: string;
  dados: DadosLote;
  resultados: ResultadosCalculados;
  timestamp: number;
};

// Funções de Cálculo
function calcularCustos(dados: DadosLote): ResultadosCalculados {
  const peso_por_metro = dados.peso_rolo_kg / dados.metragem_rolo_metros;
  const area_util_risco = dados.area_risco_m2 * (dados.aproveitamento_risco_percentual / 100);
  const area_por_peca = area_util_risco / dados.pecas_geradas_risco;
  const consumo_kg_por_peca = (dados.peso_rolo_kg / dados.area_risco_m2) * area_por_peca;
  const custo_tecido_por_peca = (dados.custo_total_rolo / dados.peso_rolo_kg) * consumo_kg_por_peca;
  const custo_corte_por_peca = dados.custo_total_corte / dados.quantidade_pecas_cortadas;
  const custo_costura_por_peca = dados.custo_total_costura / dados.quantidade_pecas_boas_costura;
  const rendimento = dados.quantidade_pecas_boas_costura / dados.quantidade_pecas_cortadas;
  const custo_aviamentos_por_peca = dados.custo_total_aviamentos / dados.quantidade_pecas_boas_costura;
  const custo_total_producao = custo_tecido_por_peca + custo_corte_por_peca + custo_costura_por_peca + custo_aviamentos_por_peca;
  const custo_real_por_peca = custo_total_producao / rendimento;
  const preco_venda = custo_real_por_peca / (1 - (dados.margem_lucro_percentual / 100));

  return {
    peso_por_metro,
    area_util_risco,
    area_por_peca,
    consumo_kg_por_peca,
    custo_tecido_por_peca,
    custo_corte_por_peca,
    custo_costura_por_peca,
    custo_aviamentos_por_peca,
    rendimento,
    custo_total_producao,
    custo_real_por_peca,
    preco_venda,
  };
}

// Validação de dados
function validarDados(dados: Partial<DadosLote>): { valido: boolean; erro?: string } {
  const campos: Array<keyof DadosLote> = [
    'nome_lote',
    'peso_rolo_kg',
    'metragem_rolo_metros',
    'custo_total_rolo',
    'area_risco_m2',
    'aproveitamento_risco_percentual',
    'pecas_geradas_risco',
    'custo_total_corte',
    'quantidade_pecas_cortadas',
    'custo_total_costura',
    'quantidade_pecas_boas_costura',
    'custo_total_aviamentos',
    'margem_lucro_percentual',
  ];

  for (const campo of campos) {
    if (!dados[campo] || dados[campo] === '') {
      return { valido: false, erro: `Campo "${campo.replace(/_/g, ' ')}" é obrigatório!` };
    }
  }

  const camposNumericos = campos.slice(1);
  for (const campo of camposNumericos) {
    const valor = Number(dados[campo]);
    if (isNaN(valor) || valor <= 0) {
      return { valido: false, erro: `Campo "${campo.replace(/_/g, ' ')}" deve ser um número positivo!` };
    }
  }

  if (dados.aproveitamento_risco_percentual! > 100 || dados.aproveitamento_risco_percentual! < 0) {
    return { valido: false, erro: 'Aproveitamento do risco deve estar entre 0 e 100%!' };
  }

  if (dados.margem_lucro_percentual! >= 100) {
    return { valido: false, erro: 'Margem de lucro deve ser menor que 100%!' };
  }

  if (dados.quantidade_pecas_boas_costura! > dados.quantidade_pecas_cortadas!) {
    return { valido: false, erro: 'Quantidade de peças boas não pode ser maior que a quantidade cortada!' };
  }

  return { valido: true };
}

function formatarNumero(num: number): string {
  return num.toFixed(2).replace('.', ',');
}

function formatarPercentual(num: number): string {
  return (num * 100).toFixed(2).replace('.', ',') + '%';
}

export default function GestaoCustosTextil() {
  const [lotes, setLotes] = useState<LoteRegistrado[]>(() => {
    try {
      const saved = localStorage.getItem("textil_lotes");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [dadosFormulario, setDadosFormulario] = useState<DadosLoteForm>({
    nome_lote: '',
    peso_rolo_kg: '',
    metragem_rolo_metros: '',
    custo_total_rolo: '',
    area_risco_m2: '',
    aproveitamento_risco_percentual: '',
    pecas_geradas_risco: '',
    custo_total_corte: '',
    quantidade_pecas_cortadas: '',
    custo_total_costura: '',
    quantidade_pecas_boas_costura: '',
    custo_total_aviamentos: '',
    margem_lucro_percentual: '',
  });

  const [resultadosAtuais, setResultadosAtuais] = useState<ResultadosCalculados | null>(null);
  const [visualizandoLote, setVisualizandoLote] = useState<LoteRegistrado | null>(null);

  // Persistir lotes
  useEffect(() => {
    localStorage.setItem("textil_lotes", JSON.stringify(lotes));
  }, [lotes]);

  const handleSetField = (campo: keyof DadosLoteForm, valor: string) => {
    setDadosFormulario((prev) => ({
      ...prev,
      [campo]: valor,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const dadosCompletos: DadosLote = {
      nome_lote: dadosFormulario.nome_lote || '',
      peso_rolo_kg: Number(dadosFormulario.peso_rolo_kg),
      metragem_rolo_metros: Number(dadosFormulario.metragem_rolo_metros),
      custo_total_rolo: Number(dadosFormulario.custo_total_rolo),
      area_risco_m2: Number(dadosFormulario.area_risco_m2),
      aproveitamento_risco_percentual: Number(dadosFormulario.aproveitamento_risco_percentual),
      pecas_geradas_risco: Number(dadosFormulario.pecas_geradas_risco),
      custo_total_corte: Number(dadosFormulario.custo_total_corte),
      quantidade_pecas_cortadas: Number(dadosFormulario.quantidade_pecas_cortadas),
      custo_total_costura: Number(dadosFormulario.custo_total_costura),
      quantidade_pecas_boas_costura: Number(dadosFormulario.quantidade_pecas_boas_costura),
      custo_total_aviamentos: Number(dadosFormulario.custo_total_aviamentos),
      margem_lucro_percentual: Number(dadosFormulario.margem_lucro_percentual),
    };

    const validacao = validarDados(dadosCompletos);
    if (!validacao.valido) {
      toast.error(validacao.erro || "Erro na validação");
      return;
    }

    try {
      const resultados = calcularCustos(dadosCompletos);
      setResultadosAtuais(resultados);

      const novoLote: LoteRegistrado = {
        id: crypto.randomUUID(),
        dados: dadosCompletos,
        resultados,
        timestamp: Date.now(),
      };

      setLotes((prev) => [novoLote, ...prev]);
      toast.success("Lote calculado e registrado com sucesso!");

      setDadosFormulario({
        nome_lote: '',
        peso_rolo_kg: '',
        metragem_rolo_metros: '',
        custo_total_rolo: '',
        area_risco_m2: '',
        aproveitamento_risco_percentual: '',
        pecas_geradas_risco: '',
        custo_total_corte: '',
        quantidade_pecas_cortadas: '',
        custo_total_costura: '',
        quantidade_pecas_boas_costura: '',
        custo_total_aviamentos: '',
        margem_lucro_percentual: '',
      });
    } catch (error) {
      console.error('Erro ao calcular:', error);
      toast.error("Erro ao calcular os custos. Verifique os dados inseridos.");
    }
  };

  const handleVisualizarLote = (id: string) => {
    const lote = lotes.find((l) => l.id === id);
    if (lote) {
      setVisualizandoLote(lote);
      setResultadosAtuais(lote.resultados);
    }
  };

  const handleRemoverLote = (id: string) => {
    if (confirm("Tem certeza que deseja remover este lote?")) {
      setLotes((prev) => prev.filter((l) => l.id !== id));
      if (visualizandoLote && visualizandoLote.id === id) {
        setVisualizandoLote(null);
        setResultadosAtuais(null);
      }
      toast.info("Lote removido.");
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Sistema de Gestão de Custos Têxteis"
        description="Calcule o custo real por peça e o preço de venda para lotes de produção."
        icon={<Calculator className="h-8 w-8" />}
      />

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Formulário de Entrada */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Novo Lote de Produção
            </CardTitle>
            <CardDescription>Preencha os dados para calcular os custos</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Identificação do Lote */}
              <div className="space-y-2">
                <Label>Nome do Lote</Label>
                <Input
                  type="text"
                  value={dadosFormulario.nome_lote || ''}
                  onChange={(e) => handleSetField('nome_lote', e.target.value)}
                  placeholder="Ex: LOTE 1 – Camiseta Manga Longa"
                  required
                />
              </div>

              {/* Dados do Rolo de Tecido */}
              <div className="border-t border-slate-700 pt-4 space-y-4">
                <h3 className="text-lg font-semibold text-white">Dados do Rolo de Tecido</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Peso do Rolo (kg)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={dadosFormulario.peso_rolo_kg || ''}
                      onChange={(e) => handleSetField('peso_rolo_kg', e.target.value)}
                      placeholder="Ex: 25.20"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Metragem (metros)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={dadosFormulario.metragem_rolo_metros || ''}
                      onChange={(e) => handleSetField('metragem_rolo_metros', e.target.value)}
                      placeholder="Ex: 50.0"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Custo Total do Rolo (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={dadosFormulario.custo_total_rolo || ''}
                    onChange={(e) => handleSetField('custo_total_rolo', e.target.value)}
                    placeholder="Ex: 500.00"
                    required
                  />
                </div>
              </div>

              {/* Dados do Risco */}
              <div className="border-t border-slate-700 pt-4 space-y-4">
                <h3 className="text-lg font-semibold text-white">Dados do Risco</h3>
                <div className="space-y-2">
                  <Label>Área do Risco (m²)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={dadosFormulario.area_risco_m2 || ''}
                    onChange={(e) => handleSetField('area_risco_m2', e.target.value)}
                    placeholder="Ex: 100.0"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Aproveitamento do Risco (%)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={dadosFormulario.aproveitamento_risco_percentual || ''}
                      onChange={(e) => handleSetField('aproveitamento_risco_percentual', e.target.value)}
                      placeholder="Ex: 84.42"
                      min="0"
                      max="100"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Peças Geradas pelo Risco</Label>
                    <Input
                      type="number"
                      value={dadosFormulario.pecas_geradas_risco || ''}
                      onChange={(e) => handleSetField('pecas_geradas_risco', e.target.value)}
                      placeholder="Ex: 10"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Dados de Corte */}
              <div className="border-t border-slate-700 pt-4 space-y-4">
                <h3 className="text-lg font-semibold text-white">Dados de Corte</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Custo Total do Corte (R$)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={dadosFormulario.custo_total_corte || ''}
                      onChange={(e) => handleSetField('custo_total_corte', e.target.value)}
                      placeholder="Ex: 200.00"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Quantidade de Peças Cortadas</Label>
                    <Input
                      type="number"
                      value={dadosFormulario.quantidade_pecas_cortadas || ''}
                      onChange={(e) => handleSetField('quantidade_pecas_cortadas', e.target.value)}
                      placeholder="Ex: 100"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Dados de Costura */}
              <div className="border-t border-slate-700 pt-4 space-y-4">
                <h3 className="text-lg font-semibold text-white">Dados de Costura</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Custo Total da Costura (R$)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={dadosFormulario.custo_total_costura || ''}
                      onChange={(e) => handleSetField('custo_total_costura', e.target.value)}
                      placeholder="Ex: 300.00"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Quantidade de Peças Boas (Costura)</Label>
                    <Input
                      type="number"
                      value={dadosFormulario.quantidade_pecas_boas_costura || ''}
                      onChange={(e) => handleSetField('quantidade_pecas_boas_costura', e.target.value)}
                      placeholder="Ex: 95"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Dados de Aviamentos */}
              <div className="border-t border-slate-700 pt-4 space-y-4">
                <h3 className="text-lg font-semibold text-white">Aviamentos</h3>
                <div className="space-y-2">
                  <Label>Custo Total dos Aviamentos (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={dadosFormulario.custo_total_aviamentos || ''}
                    onChange={(e) => handleSetField('custo_total_aviamentos', e.target.value)}
                    placeholder="Ex: 150.00"
                    required
                  />
                </div>
              </div>

              {/* Margem de Lucro */}
              <div className="border-t border-slate-700 pt-4 space-y-4">
                <h3 className="text-lg font-semibold text-white">Margem de Lucro</h3>
                <div className="space-y-2">
                  <Label>Margem de Lucro Desejada (%)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={dadosFormulario.margem_lucro_percentual || ''}
                    onChange={(e) => handleSetField('margem_lucro_percentual', e.target.value)}
                    placeholder="Ex: 60"
                    min="0"
                    max="99.99"
                    required
                  />
                </div>
              </div>

              <Button type="submit" className="w-full h-12 text-lg font-bold">
                <Calculator className="mr-2 h-5 w-5" />
                Calcular e Registrar
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Área de Resultados */}
        <div className="space-y-4">
          {resultadosAtuais ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Resultados Calculados
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-slate-800 rounded-md">
                    <p className="text-xs text-slate-400 mb-1">Peso por Metro</p>
                    <p className="text-lg font-bold text-white">{formatarNumero(resultadosAtuais.peso_por_metro)} kg/m</p>
                  </div>
                  <div className="p-3 bg-slate-800 rounded-md">
                    <p className="text-xs text-slate-400 mb-1">Área Útil do Risco</p>
                    <p className="text-lg font-bold text-white">{formatarNumero(resultadosAtuais.area_util_risco)} m²</p>
                  </div>
                  <div className="p-3 bg-slate-800 rounded-md">
                    <p className="text-xs text-slate-400 mb-1">Área por Peça</p>
                    <p className="text-lg font-bold text-white">{formatarNumero(resultadosAtuais.area_por_peca)} m²</p>
                  </div>
                  <div className="p-3 bg-slate-800 rounded-md">
                    <p className="text-xs text-slate-400 mb-1">Consumo kg por Peça</p>
                    <p className="text-lg font-bold text-white">{formatarNumero(resultadosAtuais.consumo_kg_por_peca)} kg</p>
                  </div>
                </div>

                <div className="border-t border-slate-700 pt-4">
                  <h3 className="text-lg font-semibold mb-3 text-white">Custos por Peça</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between p-2 bg-blue-950/40 rounded">
                      <span className="text-sm text-slate-300">Tecido:</span>
                      <span className="font-semibold text-white">R$ {formatarNumero(resultadosAtuais.custo_tecido_por_peca)}</span>
                    </div>
                    <div className="flex justify-between p-2 bg-blue-950/40 rounded">
                      <span className="text-sm text-slate-300">Corte:</span>
                      <span className="font-semibold text-white">R$ {formatarNumero(resultadosAtuais.custo_corte_por_peca)}</span>
                    </div>
                    <div className="flex justify-between p-2 bg-blue-950/40 rounded">
                      <span className="text-sm text-slate-300">Costura:</span>
                      <span className="font-semibold text-white">R$ {formatarNumero(resultadosAtuais.custo_costura_por_peca)}</span>
                    </div>
                    <div className="flex justify-between p-2 bg-blue-950/40 rounded">
                      <span className="text-sm text-slate-300">Aviamentos:</span>
                      <span className="font-semibold text-white">R$ {formatarNumero(resultadosAtuais.custo_aviamentos_por_peca)}</span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-700 pt-4 space-y-2">
                  <div className="p-4 bg-green-950/40 rounded-md">
                    <p className="text-xs text-slate-400 mb-1">Rendimento</p>
                    <p className="text-2xl font-bold text-green-400">{formatarPercentual(resultadosAtuais.rendimento)}</p>
                  </div>
                  <div className="p-4 bg-yellow-950/40 rounded-md">
                    <p className="text-xs text-slate-400 mb-1">Custo Total de Produção</p>
                    <p className="text-2xl font-bold text-yellow-400">R$ {formatarNumero(resultadosAtuais.custo_total_producao)}</p>
                  </div>
                  <div className="p-4 bg-orange-950/40 rounded-md">
                    <p className="text-xs text-slate-400 mb-1">Custo Real por Peça</p>
                    <p className="text-2xl font-bold text-orange-400">R$ {formatarNumero(resultadosAtuais.custo_real_por_peca)}</p>
                  </div>
                  <div className="p-4 bg-purple-950/40 rounded-md">
                    <p className="text-xs text-slate-400 mb-1">Preço de Venda</p>
                    <p className="text-3xl font-bold text-purple-400">R$ {formatarNumero(resultadosAtuais.preco_venda)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center h-full min-h-[400px]">
                <Calculator className="h-16 w-16 text-slate-600 mb-4" />
                <p className="text-lg text-slate-400 text-center">
                  Preencha o formulário e clique em &quot;Calcular e Registrar&quot; para ver os resultados aqui.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Lista de Lotes Registrados */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Lotes Registrados</CardTitle>
                <span className="text-sm bg-blue-950/40 text-blue-400 px-2 py-1 rounded-md">
                  {lotes.length} lote(s)
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {lotes.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <Calculator className="h-12 w-12 mx-auto mb-2 text-slate-600" />
                  <p>Nenhum lote registrado ainda.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {lotes.map((lote) => (
                    <div
                      key={lote.id}
                      className="border border-slate-700 rounded-md p-4 hover:bg-slate-800 cursor-pointer transition-colors"
                      onClick={() => handleVisualizarLote(lote.id)}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg text-white">{lote.dados.nome_lote}</h3>
                          <p className="text-sm text-slate-400 mt-1">
                            Registrado em {new Date(lote.timestamp).toLocaleString('pt-BR')}
                          </p>
                          <div className="mt-2 flex gap-4 text-sm">
                            <span className="text-slate-400">
                              Custo Real: <strong className="text-white">R$ {formatarNumero(lote.resultados.custo_real_por_peca)}</strong>
                            </span>
                            <span className="text-slate-400">
                              Preço Venda: <strong className="text-purple-400">R$ {formatarNumero(lote.resultados.preco_venda)}</strong>
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoverLote(lote.id);
                          }}
                          className="text-red-500 hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Modal de Visualização de Lote */}
      <Dialog open={!!visualizandoLote} onOpenChange={(open) => !open && setVisualizandoLote(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{visualizandoLote?.dados.nome_lote}</DialogTitle>
          </DialogHeader>
          {visualizandoLote && (
            <div className="grid grid-cols-2 gap-6 mt-4">
              <div>
                <h3 className="text-lg font-semibold mb-3 text-white">Dados de Entrada</h3>
                <div className="space-y-2 text-sm text-slate-300">
                  <div><strong className="text-white">Peso do Rolo:</strong> {formatarNumero(visualizandoLote.dados.peso_rolo_kg)} kg</div>
                  <div><strong className="text-white">Metragem:</strong> {formatarNumero(visualizandoLote.dados.metragem_rolo_metros)} m</div>
                  <div><strong className="text-white">Custo Total do Rolo:</strong> R$ {formatarNumero(visualizandoLote.dados.custo_total_rolo)}</div>
                  <div><strong className="text-white">Área do Risco:</strong> {formatarNumero(visualizandoLote.dados.area_risco_m2)} m²</div>
                  <div><strong className="text-white">Aproveitamento:</strong> {formatarNumero(visualizandoLote.dados.aproveitamento_risco_percentual)}%</div>
                  <div><strong className="text-white">Peças Geradas:</strong> {visualizandoLote.dados.pecas_geradas_risco}</div>
                  <div><strong className="text-white">Custo Corte:</strong> R$ {formatarNumero(visualizandoLote.dados.custo_total_corte)}</div>
                  <div><strong className="text-white">Peças Cortadas:</strong> {visualizandoLote.dados.quantidade_pecas_cortadas}</div>
                  <div><strong className="text-white">Custo Costura:</strong> R$ {formatarNumero(visualizandoLote.dados.custo_total_costura)}</div>
                  <div><strong className="text-white">Peças Boas:</strong> {visualizandoLote.dados.quantidade_pecas_boas_costura}</div>
                  <div><strong className="text-white">Custo Aviamentos:</strong> R$ {formatarNumero(visualizandoLote.dados.custo_total_aviamentos)}</div>
                  <div><strong className="text-white">Margem de Lucro:</strong> {formatarNumero(visualizandoLote.dados.margem_lucro_percentual)}%</div>
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-3 text-white">Resultados Calculados</h3>
                <div className="space-y-2 text-sm text-slate-300">
                  <div><strong className="text-white">Peso por Metro:</strong> {formatarNumero(visualizandoLote.resultados.peso_por_metro)} kg/m</div>
                  <div><strong className="text-white">Área Útil do Risco:</strong> {formatarNumero(visualizandoLote.resultados.area_util_risco)} m²</div>
                  <div><strong className="text-white">Área por Peça:</strong> {formatarNumero(visualizandoLote.resultados.area_por_peca)} m²</div>
                  <div><strong className="text-white">Consumo kg por Peça:</strong> {formatarNumero(visualizandoLote.resultados.consumo_kg_por_peca)} kg</div>
                  <div className="border-t border-slate-700 pt-2 mt-2"><strong className="text-white">Custo Tecido:</strong> R$ {formatarNumero(visualizandoLote.resultados.custo_tecido_por_peca)}</div>
                  <div><strong className="text-white">Custo Corte:</strong> R$ {formatarNumero(visualizandoLote.resultados.custo_corte_por_peca)}</div>
                  <div><strong className="text-white">Custo Costura:</strong> R$ {formatarNumero(visualizandoLote.resultados.custo_costura_por_peca)}</div>
                  <div><strong className="text-white">Custo Aviamentos:</strong> R$ {formatarNumero(visualizandoLote.resultados.custo_aviamentos_por_peca)}</div>
                  <div className="border-t border-slate-700 pt-2 mt-2"><strong className="text-white">Rendimento:</strong> {formatarPercentual(visualizandoLote.resultados.rendimento)}</div>
                  <div><strong className="text-white">Custo Total Produção:</strong> R$ {formatarNumero(visualizandoLote.resultados.custo_total_producao)}</div>
                  <div className="border-t border-slate-700 pt-2 mt-2 font-bold text-lg"><strong className="text-white">Custo Real por Peça:</strong> R$ {formatarNumero(visualizandoLote.resultados.custo_real_por_peca)}</div>
                  <div className="font-bold text-xl text-purple-400"><strong>Preço de Venda:</strong> R$ {formatarNumero(visualizandoLote.resultados.preco_venda)}</div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
