import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  json,
  pgEnum,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ============================================================
// 1. ENUMS
// ============================================================

export const userRoleEnum = pgEnum("user_role", ["admin", "supervisor", "funcionario", "expedicao"]);

export const tipoColetaEnum = pgEnum("tipo_coleta", [
  "FLEX",
  "COLETA",
  "DEVOLUCAO",
  "CANCELADO",
]);

export const contaOperacaoEnum = pgEnum("conta_operacao", [
  "TIKTOK_SHOP",
  "MERCADO_LIVRE",
  "SHOPEE",
]);

export const transportadoraLabelEnum = pgEnum("transportadora_label", [
  "TTK_JDLOG",
  "TTK_IMILE",
  "ML",
  "SHP",
  "DESCONHECIDA",
]);

export const tipoMovimentacaoEnum = pgEnum("tipo_movimentacao", [
  "ENTRADA",
  "SAIDA",
  "BIPAGEM_SEMANAL",
  "IMPORTACAO",
  "BALANCO",
]);

export const localizacaoAvariaEnum = pgEnum("localizacao_avaria", [
  "DEVOLUCAO",
  "ESTANTE",
  "LOTE_DE_COSTURA",
]);

export const papelContaEnum = pgEnum("papel_conta", [
  "owner",
  "admin",
  "gerente",
  "operador",
  "costureiro",
  "financeiro",
  "fiscal",
  "supervisor",
  "funcionario",
  "expedicao",
]);

export const planoEnum = pgEnum("plano", [
  "trial",
  "starter",
  "pro",
  "enterprise",
]);

export const statusContaEnum = pgEnum("status_conta", [
  "trial",
  "ativa",
  "suspensa",
  "cancelada",
]);

// ============================================================
// 2. BETTER-AUTH TABLES (managed by Better-Auth)
// ============================================================

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: userRoleEnum("role").notNull().default("funcionario"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  contaAtivaId: text("conta_ativa_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================================
// 3. DOMAIN TABLES — Reference Data
// ============================================================

export const skuCatalogo = pgTable(
  "sku_catalogo",
  {
    id: text("id").primaryKey(),
    codigo: text("codigo").notNull(),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    ativo: boolean("ativo").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_sku_catalogo_conta").on(table.contaId),
    uniqueIndex("uq_sku_catalogo_codigo_conta").on(table.codigo, table.contaId),
  ]
);

export const corCatalogo = pgTable(
  "cor_catalogo",
  {
    id: text("id").primaryKey(),
    codigo: text("codigo").notNull(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    ativo: boolean("ativo").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_cor_catalogo_conta").on(table.contaId),
    uniqueIndex("uq_cor_catalogo_codigo_conta").on(table.codigo, table.contaId),
  ]
);

export const tamanhoCatalogo = pgTable(
  "tamanho_catalogo",
  {
    id: text("id").primaryKey(),
    codigo: text("codigo").notNull(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    ativo: boolean("ativo").notNull().default(true),
    ordem: integer("ordem").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_tamanho_catalogo_conta").on(table.contaId),
    uniqueIndex("uq_tamanho_catalogo_codigo_conta").on(
      table.codigo,
      table.contaId,
    ),
  ]
);

export const skuKitRegra = pgTable(
  "sku_kit_regra",
  {
    id: text("id").primaryKey(),
    kitSku: text("kit_sku").notNull(),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("idx_sku_kit_regra_conta").on(table.contaId)]
);

export const skuKitComponente = pgTable(
  "sku_kit_componente",
  {
    id: text("id").primaryKey(),
    kitRegraId: text("kit_regra_id")
      .notNull()
      .references(() => skuKitRegra.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    quantidade: integer("quantidade").notNull().default(1),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
  },
  (table) => [index("idx_sku_kit_componente_conta").on(table.contaId)]
);

export const loteCadastrado = pgTable(
  "lote_cadastrado",
  {
    id: text("id").primaryKey(),
    nome: text("nome").notNull(),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_lote_cadastrado_conta").on(table.contaId),
    uniqueIndex("uq_lote_cadastrado_nome_conta").on(table.nome, table.contaId),
  ]
);

export const transportadoraPadrao = pgTable(
  "transportadora_padrao",
  {
    id: text("id").primaryKey(),
    transportadora: text("transportadora").notNull(),
    prefixos: json("prefixos").$type<string[]>().notNull().default([]),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
  },
  (table) => [index("idx_transportadora_padrao_conta").on(table.contaId)]
);

// ============================================================
// 4. DOMAIN TABLES — Stock / Cadastro
// ============================================================

export const stockItem = pgTable(
  "stock_item",
  {
    id: text("id").primaryKey(),
    sku: text("sku").notNull(),
    lote: text("lote").notNull(),
    quantidade: integer("quantidade").notNull(),
    codigoFardo: text("codigo_fardo").unique(),
    usuarioId: text("usuario_id").references(() => user.id, {
      onDelete: "set null",
    }),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_stock_item_sku").on(table.sku),
    index("idx_stock_item_created_at").on(table.createdAt),
    index("idx_stock_item_codigo_fardo").on(table.codigoFardo),
    index("idx_stock_item_conta").on(table.contaId),
  ]
);

// ============================================================
// 5. DOMAIN TABLES — Contagem (Counting)
// ============================================================

export const contagemBipagem = pgTable(
  "contagem_bipagem",
  {
    id: text("id").primaryKey(),
    sku: text("sku").notNull(),
    lote: text("lote").notNull(),
    quantidade: integer("quantidade").notNull(),
    raw: text("raw").notNull(),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_contagem_bipagem_sku").on(table.sku),
    index("idx_contagem_bipagem_conta").on(table.contaId),
  ]
);

export const contagemManuseavel = pgTable(
  "contagem_manuseavel",
  {
    id: text("id").primaryKey(),
    sku: text("sku").notNull(),
    quantidade: integer("quantidade").notNull().default(0),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("idx_contagem_manuseavel_conta").on(table.contaId)]
);

export const contagemEmbalado = pgTable(
  "contagem_embalado",
  {
    id: text("id").primaryKey(),
    sku: text("sku").notNull(),
    quantidade: integer("quantidade").notNull(),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("idx_contagem_embalado_conta").on(table.contaId)]
);

// ============================================================
// 6. DOMAIN TABLES — Coletas (Bipagem de Pacotes)
// ============================================================

export const coletaBipagem = pgTable(
  "coleta_bipagem",
  {
    id: text("id").primaryKey(),
    tipo: tipoColetaEnum("tipo").notNull(),
    conta: contaOperacaoEnum("conta").notNull(),
    total: integer("total").notNull(),
    revisado: boolean("revisado").notNull().default(false),
    revisadoPor: text("revisado_por").references(() => user.id, {
      onDelete: "set null",
    }),
    revisadoEm: timestamp("revisado_em"),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_coleta_bipagem_tipo").on(table.tipo),
    index("idx_coleta_bipagem_conta_op").on(table.conta),
    index("idx_coleta_bipagem_revisado").on(table.revisado),
    index("idx_coleta_bipagem_created_at").on(table.createdAt),
    index("idx_coleta_bipagem_usuario").on(table.usuarioId),
    index("idx_coleta_bipagem_conta").on(table.contaId),
  ]
);

export const coletaBipagemPacote = pgTable(
  "coleta_bipagem_pacote",
  {
    id: text("id").primaryKey(),
    bipagemId: text("bipagem_id")
      .notNull()
      .references(() => coletaBipagem.id, { onDelete: "cascade" }),
    codigo: text("codigo").notNull(),
    transportadora: transportadoraLabelEnum("transportadora"),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_coleta_pacote_bipagem").on(table.bipagemId),
    index("idx_coleta_pacote_conta").on(table.contaId),
  ]
);

export const coletaDevolucao = pgTable(
  "coleta_devolucao",
  {
    id: text("id").primaryKey(),
    pacoteId: text("pacote_id")
      .notNull()
      .references(() => coletaBipagemPacote.id, { onDelete: "cascade" }),
    operacao: contaOperacaoEnum("operacao").notNull(),
    avaria: boolean("avaria").notNull().default(false),
    observacao: text("observacao"),
    tipo: tipoColetaEnum("tipo").notNull(),
    fotoPacoteUrl: text("foto_pacote_url"),
    fotoAvariaUrl: text("foto_avaria_url"),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
  },
  (table) => [index("idx_coleta_devolucao_conta").on(table.contaId)]
);

export const coletaDevolucaoSku = pgTable(
  "coleta_devolucao_sku",
  {
    id: text("id").primaryKey(),
    devolucaoId: text("devolucao_id")
      .notNull()
      .references(() => coletaDevolucao.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    quantidade: integer("quantidade").notNull().default(1),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
  },
  (table) => [index("idx_coleta_devolucao_sku_conta").on(table.contaId)]
);

export const coletaBipagemTemporaria = pgTable(
  "coleta_bipagem_temporaria",
  {
    id: text("id").primaryKey(),
    tipo: tipoColetaEnum("tipo").notNull(),
    conta: contaOperacaoEnum("conta").notNull(),
    total: integer("total").notNull(),
    dados: json("dados")
      .$type<{
        pacotes: Array<{ codigo: string; transportadora?: string }>;
        devolucoes: Record<
          string,
          {
            skuLines: Array<{ sku: string; qtd: number }>;
            operacao: string;
            avaria: string;
            obs: string;
            tipo: string;
          }
        >;
      }>()
      .notNull(),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("idx_coleta_temp_conta").on(table.contaId)]
);

// ============================================================
// 7. DOMAIN TABLES — Alteração de Estoque (Stock Transfers)
// ============================================================

export const alteracaoEstoque = pgTable(
  "alteracao_estoque",
  {
    id: text("id").primaryKey(),
    saidas: json("saidas")
      .$type<Array<{ sku: string; quantidade: number }>>()
      .notNull(),
    entradas: json("entradas")
      .$type<Array<{ sku: string; quantidade: number }>>()
      .notNull(),
    codigoPacote: text("codigo_pacote"),
    usuarioId: text("usuario_id").references(() => user.id, {
      onDelete: "set null",
    }),
    revisado: boolean("revisado").notNull().default(false),
    revisadoPor: text("revisado_por").references(() => user.id, {
      onDelete: "set null",
    }),
    revisadoEm: timestamp("revisado_em"),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_alteracao_revisado").on(table.revisado),
    index("idx_alteracao_created_at").on(table.createdAt),
    index("idx_alteracao_conta").on(table.contaId),
  ]
);

// ============================================================
// 8. DOMAIN TABLES — Produtos Avariados (Damaged Products)
// ============================================================

export const produtoAvariado = pgTable(
  "produto_avariado",
  {
    id: text("id").primaryKey(),
    sku: text("sku").notNull(),
    avaria: text("avaria").notNull(),
    localizacao: localizacaoAvariaEnum("localizacao").notNull(),
    codigoFardo: text("codigo_fardo"),
    usuarioId: text("usuario_id").references(() => user.id, {
      onDelete: "set null",
    }),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_avariado_sku").on(table.sku),
    index("idx_avariado_localizacao").on(table.localizacao),
    index("idx_avariado_created_at").on(table.createdAt),
    index("idx_avariado_conta").on(table.contaId),
  ]
);

// ============================================================
// 9. DOMAIN TABLES — Estante Virtual (Virtual Shelves)
// ============================================================

export const estante = pgTable(
  "estante",
  {
    id: text("id").primaryKey(),
    nome: text("nome").notNull(),
    descricao: text("descricao"),
    ultimaBipagem: timestamp("ultima_bipagem"),
    ultimaBipagemPor: text("ultima_bipagem_por").references(() => user.id, {
      onDelete: "set null",
    }),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("idx_estante_conta").on(table.contaId)]
);

export const estanteFardo = pgTable(
  "estante_fardo",
  {
    id: text("id").primaryKey(),
    estanteId: text("estante_id")
      .notNull()
      .references(() => estante.id, { onDelete: "cascade" }),
    qrCode: text("qr_code").notNull(),
    sku: text("sku").notNull(),
    lote: text("lote").notNull(),
    quantidade: integer("quantidade").notNull(),
    adicionadoPor: text("adicionado_por")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_estante_fardo_estante").on(table.estanteId),
    index("idx_estante_fardo_sku").on(table.sku),
    index("idx_estante_fardo_conta").on(table.contaId),
  ]
);

export const estanteMovimentacao = pgTable(
  "estante_movimentacao",
  {
    id: text("id").primaryKey(),
    estanteId: text("estante_id")
      .notNull()
      .references(() => estante.id, { onDelete: "cascade" }),
    estanteNome: text("estante_nome").notNull(),
    tipo: tipoMovimentacaoEnum("tipo").notNull(),
    fardoSku: text("fardo_sku"),
    fardoLote: text("fardo_lote"),
    fardoQuantidade: integer("fardo_quantidade"),
    totalAntes: integer("total_antes").notNull(),
    totalDepois: integer("total_depois").notNull(),
    totalPecas: integer("total_pecas"),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_estante_mov_estante").on(table.estanteId),
    index("idx_estante_mov_tipo").on(table.tipo),
    index("idx_estante_mov_created_at").on(table.createdAt),
    index("idx_estante_mov_conta").on(table.contaId),
  ]
);

// ============================================================
// 10. DOMAIN TABLES — Etiquetas (Label Associations)
// ============================================================

export const etiquetaAssociacao = pgTable(
  "etiqueta_associacao",
  {
    id: text("id").primaryKey(),
    etiqueta: text("etiqueta").notNull(),
    sku: text("sku").notNull(),
    quantidade: integer("quantidade").notNull(),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_etiqueta_etiqueta").on(table.etiqueta),
    index("idx_etiqueta_conta").on(table.contaId),
  ]
);

// ============================================================
// 11. DOMAIN TABLES — Gestão de Custos Têxteis
// ============================================================

export const textilLote = pgTable(
  "textil_lote",
  {
    id: text("id").primaryKey(),
    nomeLote: text("nome_lote").notNull(),
    pesoRoloKg: real("peso_rolo_kg").notNull(),
    metragemRoloMetros: real("metragem_rolo_metros").notNull(),
    custoTotalRolo: real("custo_total_rolo").notNull(),
    areaRiscoM2: real("area_risco_m2").notNull(),
    aproveitamentoRiscoPercentual: real(
      "aproveitamento_risco_percentual"
    ).notNull(),
    pecasGeradasRisco: integer("pecas_geradas_risco").notNull(),
    custoTotalCorte: real("custo_total_corte").notNull(),
    quantidadePecasCortadas: integer("quantidade_pecas_cortadas").notNull(),
    custoTotalCostura: real("custo_total_costura").notNull(),
    quantidadePecasBoasCostura: integer(
      "quantidade_pecas_boas_costura"
    ).notNull(),
    custoTotalAviamentos: real("custo_total_aviamentos").notNull(),
    margemLucroPercentual: real("margem_lucro_percentual").notNull(),
    resultados: json("resultados")
      .$type<{
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
      }>()
      .notNull(),
    usuarioId: text("usuario_id").references(() => user.id, {
      onDelete: "set null",
    }),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_textil_created_at").on(table.createdAt),
    index("idx_textil_conta").on(table.contaId),
  ]
);

// ============================================================
// 12. TENANCY (Multi-tenant SaaS — Onda 1)
// ============================================================

export const conta = pgTable(
  "conta",
  {
    id: text("id").primaryKey(),
    nome: text("nome").notNull(),
    emailPrincipal: text("email_principal").notNull(),
    telefone: text("telefone"),
    cpfResponsavel: text("cpf_responsavel"),
    plano: planoEnum("plano").notNull().default("trial"),
    status: statusContaEnum("status").notNull().default("trial"),
    trialExpiraEm: timestamp("trial_expira_em"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_conta_status").on(table.status),
    index("idx_conta_plano").on(table.plano),
  ]
);

export const usuarioConta = pgTable(
  "usuario_conta",
  {
    id: text("id").primaryKey(),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    papel: papelContaEnum("papel").notNull().default("operador"),
    convidadoPorId: text("convidado_por_id").references(() => user.id, {
      onDelete: "set null",
    }),
    aceitoEm: timestamp("aceito_em"),
    ativo: boolean("ativo").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uniq_usuario_conta").on(table.usuarioId, table.contaId),
    index("idx_usuario_conta_conta").on(table.contaId),
    index("idx_usuario_conta_usuario").on(table.usuarioId),
  ]
);

export const convite = pgTable(
  "convite",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .default("nwc-root")
      .references(() => conta.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    papel: papelContaEnum("papel").notNull().default("operador"),
    tokenUnico: text("token_unico").notNull().unique(),
    convidadoPorId: text("convidado_por_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiraEm: timestamp("expira_em").notNull(),
    aceitoEm: timestamp("aceito_em"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_convite_conta").on(table.contaId),
    index("idx_convite_email").on(table.email),
    index("idx_convite_expira").on(table.expiraEm),
  ]
);

export const contaRelations = relations(conta, ({ many }) => ({
  membros: many(usuarioConta),
  convites: many(convite),
}));

export const usuarioContaRelations = relations(usuarioConta, ({ one }) => ({
  usuario: one(user, {
    fields: [usuarioConta.usuarioId],
    references: [user.id],
    relationName: "usuarioContaUsuario",
  }),
  conta: one(conta, {
    fields: [usuarioConta.contaId],
    references: [conta.id],
  }),
  convidadoPor: one(user, {
    fields: [usuarioConta.convidadoPorId],
    references: [user.id],
    relationName: "usuarioContaConvidadoPor",
  }),
}));

export const conviteRelations = relations(convite, ({ one }) => ({
  conta: one(conta, {
    fields: [convite.contaId],
    references: [conta.id],
  }),
  convidadoPor: one(user, {
    fields: [convite.convidadoPorId],
    references: [user.id],
  }),
}));

export const emailChangeRequest = pgTable(
  "email_change_request",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    emailAtual: text("email_atual").notNull(),
    emailNovo: text("email_novo").notNull(),
    tokenAtual: text("token_atual").notNull().unique(),
    tokenNovo: text("token_novo").notNull().unique(),
    confirmadoAtualEm: timestamp("confirmado_atual_em"),
    confirmadoNovoEm: timestamp("confirmado_novo_em"),
    aplicadoEm: timestamp("aplicado_em"),
    canceladoEm: timestamp("cancelado_em"),
    expiraEm: timestamp("expira_em").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_email_change_conta").on(table.contaId),
    index("idx_email_change_owner").on(table.ownerUserId),
    index("idx_email_change_expira").on(table.expiraEm),
  ]
);

export const emailChangeRequestRelations = relations(
  emailChangeRequest,
  ({ one }) => ({
    conta: one(conta, {
      fields: [emailChangeRequest.contaId],
      references: [conta.id],
    }),
    owner: one(user, {
      fields: [emailChangeRequest.ownerUserId],
      references: [user.id],
    }),
  })
);

// ============================================================
// 13. RELATIONS
// ============================================================

export const userRelations = relations(user, ({ many }) => ({
  coletaBipagens: many(coletaBipagem),
  alteracoes: many(alteracaoEstoque, { relationName: "alteracaoUsuario" }),
  estantes: many(estante),
  produtosAvariados: many(produtoAvariado),
}));

export const skuKitRegraRelations = relations(skuKitRegra, ({ many }) => ({
  componentes: many(skuKitComponente),
}));

export const skuKitComponenteRelations = relations(
  skuKitComponente,
  ({ one }) => ({
    kitRegra: one(skuKitRegra, {
      fields: [skuKitComponente.kitRegraId],
      references: [skuKitRegra.id],
    }),
  })
);

export const coletaBipagemRelations = relations(
  coletaBipagem,
  ({ one, many }) => ({
    usuario: one(user, {
      fields: [coletaBipagem.usuarioId],
      references: [user.id],
    }),
    pacotes: many(coletaBipagemPacote),
  })
);

export const coletaBipagemPacoteRelations = relations(
  coletaBipagemPacote,
  ({ one }) => ({
    bipagem: one(coletaBipagem, {
      fields: [coletaBipagemPacote.bipagemId],
      references: [coletaBipagem.id],
    }),
    devolucao: one(coletaDevolucao),
  })
);

export const coletaDevolucaoRelations = relations(
  coletaDevolucao,
  ({ one, many }) => ({
    pacote: one(coletaBipagemPacote, {
      fields: [coletaDevolucao.pacoteId],
      references: [coletaBipagemPacote.id],
    }),
    skuLines: many(coletaDevolucaoSku),
  })
);

export const coletaDevolucaoSkuRelations = relations(
  coletaDevolucaoSku,
  ({ one }) => ({
    devolucao: one(coletaDevolucao, {
      fields: [coletaDevolucaoSku.devolucaoId],
      references: [coletaDevolucao.id],
    }),
  })
);

export const estanteRelations = relations(estante, ({ one, many }) => ({
  usuario: one(user, {
    fields: [estante.usuarioId],
    references: [user.id],
  }),
  fardos: many(estanteFardo),
  movimentacoes: many(estanteMovimentacao),
}));

export const estanteFardoRelations = relations(estanteFardo, ({ one }) => ({
  estante: one(estante, {
    fields: [estanteFardo.estanteId],
    references: [estante.id],
  }),
}));

export const estanteMovimentacaoRelations = relations(
  estanteMovimentacao,
  ({ one }) => ({
    estante: one(estante, {
      fields: [estanteMovimentacao.estanteId],
      references: [estante.id],
    }),
    usuario: one(user, {
      fields: [estanteMovimentacao.usuarioId],
      references: [user.id],
    }),
  })
);

export const alteracaoEstoqueRelations = relations(
  alteracaoEstoque,
  ({ one }) => ({
    usuario: one(user, {
      fields: [alteracaoEstoque.usuarioId],
      references: [user.id],
      relationName: "alteracaoUsuario",
    }),
  })
);

export const produtoAvariadoRelations = relations(
  produtoAvariado,
  ({ one }) => ({
    usuario: one(user, {
      fields: [produtoAvariado.usuarioId],
      references: [user.id],
    }),
  })
);

// ============================================================
// 14. TYPE EXPORTS
// ============================================================

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;

export type Conta = typeof conta.$inferSelect;
export type NewConta = typeof conta.$inferInsert;
export type UsuarioConta = typeof usuarioConta.$inferSelect;
export type NewUsuarioConta = typeof usuarioConta.$inferInsert;
export type Convite = typeof convite.$inferSelect;
export type NewConvite = typeof convite.$inferInsert;

export type PapelConta =
  | "owner"
  | "admin"
  | "gerente"
  | "operador"
  | "costureiro"
  | "financeiro"
  | "fiscal"
  | "supervisor"
  | "funcionario"
  | "expedicao";
export type Plano = "trial" | "starter" | "pro" | "enterprise";
export type StatusConta = "trial" | "ativa" | "suspensa" | "cancelada";

export type SkuCatalogo = typeof skuCatalogo.$inferSelect;
export type SkuKitRegra = typeof skuKitRegra.$inferSelect;
export type SkuKitComponente = typeof skuKitComponente.$inferSelect;
export type LoteCadastrado = typeof loteCadastrado.$inferSelect;
export type StockItem = typeof stockItem.$inferSelect;
export type ContagemBipagem = typeof contagemBipagem.$inferSelect;
export type ContagemManuseavel = typeof contagemManuseavel.$inferSelect;
export type ContagemEmbalado = typeof contagemEmbalado.$inferSelect;
export type ColetaBipagem = typeof coletaBipagem.$inferSelect;
export type ColetaBipagemPacote = typeof coletaBipagemPacote.$inferSelect;
export type ColetaDevolucao = typeof coletaDevolucao.$inferSelect;
export type ColetaDevolucaoSku = typeof coletaDevolucaoSku.$inferSelect;
export type ColetaBipagemTemporaria =
  typeof coletaBipagemTemporaria.$inferSelect;
export type TransportadoraPadrao = typeof transportadoraPadrao.$inferSelect;
export type AlteracaoEstoque = typeof alteracaoEstoque.$inferSelect;
export type ProdutoAvariado = typeof produtoAvariado.$inferSelect;
export type Estante = typeof estante.$inferSelect;
export type EstanteFardo = typeof estanteFardo.$inferSelect;
export type EstanteMovimentacao = typeof estanteMovimentacao.$inferSelect;
export type EtiquetaAssociacao = typeof etiquetaAssociacao.$inferSelect;
export type TextilLote = typeof textilLote.$inferSelect;

// Union types for enums (frontend usage)
export type TipoColeta = "FLEX" | "COLETA" | "DEVOLUCAO" | "CANCELADO";
export type ContaOperacao = "TIKTOK_SHOP" | "MERCADO_LIVRE" | "SHOPEE";
export type TransportadoraLabel =
  | "TTK_JDLOG"
  | "TTK_IMILE"
  | "ML"
  | "SHP"
  | "DESCONHECIDA";
export type TipoMovimentacao =
  | "ENTRADA"
  | "SAIDA"
  | "BIPAGEM_SEMANAL"
  | "IMPORTACAO"
  | "BALANCO";
export type LocalizacaoAvaria =
  | "DEVOLUCAO"
  | "ESTANTE"
  | "LOTE_DE_COSTURA";
export type UserRole = "admin" | "funcionario";
