import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  json,
  jsonb,
  pgEnum,
  real,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql, type InferSelectModel } from "drizzle-orm";

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

// ============================================================
// 13. CANAIS DE VENDA (Integração Marketplaces — Onda 0)
// ============================================================

export const plataformaCanalEnum = pgEnum("plataforma_canal", [
  "tiktok_shop",
  "shopee",
  "mercado_livre",
]);

export const emissorNotaEnum = pgEnum("emissor_nota", [
  "proprio",
  "bling",
  "manual",
]);

export const statusRenovacaoOauthEnum = pgEnum("status_renovacao_oauth", [
  "ativo",
  "falha_reauth",
  "expirado",
]);

export const canaisVenda = pgTable(
  "canais_venda",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    cnpjId: text("cnpj_id"),
    plataforma: plataformaCanalEnum("plataforma").notNull(),
    identificadorLoja: text("identificador_loja").notNull(),
    nomeExibicao: text("nome_exibicao").notNull(),
    emissorNota: emissorNotaEnum("emissor_nota").notNull().default("proprio"),
    ativo: boolean("ativo").notNull().default(true),
    ultimaSyncEm: timestamp("ultima_sync_em"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_canais_conta_plataforma").on(table.contaId, table.plataforma),
    uniqueIndex("unq_canal_cnpj_loja").on(
      table.cnpjId,
      table.plataforma,
      table.identificadorLoja,
    ),
    uniqueIndex("unq_canal_conta_plataforma_loja").on(
      table.contaId,
      table.plataforma,
      table.identificadorLoja,
    ),
  ],
);

export const credenciaisOauthTiktok = pgTable(
  "credenciais_oauth_tiktok",
  {
    id: text("id").primaryKey(),
    canalVendaId: text("canal_venda_id")
      .notNull()
      .unique()
      .references(() => canaisVenda.id, { onDelete: "cascade" }),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    shopId: text("shop_id").notNull(),
    shopCipher: text("shop_cipher").notNull(),
    accessTokenCriptografado: text("access_token_criptografado").notNull(),
    accessTokenExpiraEm: timestamp("access_token_expira_em").notNull(),
    refreshTokenCriptografado: text("refresh_token_criptografado").notNull(),
    refreshTokenExpiraEm: timestamp("refresh_token_expira_em").notNull(),
    escoposAutorizados: jsonb("escopos_autorizados")
      .$type<string[]>()
      .notNull(),
    sellerName: text("seller_name"),
    ultimaRenovacaoEm: timestamp("ultima_renovacao_em"),
    statusRenovacao: statusRenovacaoOauthEnum("status_renovacao")
      .notNull()
      .default("ativo"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_tiktok_oauth_expiracao").on(table.accessTokenExpiraEm),
    index("idx_tiktok_oauth_conta").on(table.contaId),
  ],
);

export const eventosWebhookTiktok = pgTable(
  "eventos_webhook_tiktok",
  {
    id: text("id").primaryKey(),
    canalVendaId: text("canal_venda_id").references(() => canaisVenda.id, {
      onDelete: "set null",
    }),
    contaId: text("conta_id").references(() => conta.id, {
      onDelete: "set null",
    }),
    tipoEvento: text("tipo_evento").notNull(),
    shopIdExterno: text("shop_id_externo"),
    payloadJson: jsonb("payload_json").notNull(),
    headersJson: jsonb("headers_json").notNull(),
    assinaturaValida: boolean("assinatura_valida").notNull(),
    processadoEm: timestamp("processado_em"),
    erroProcessamento: text("erro_processamento"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_webhook_tipo_data").on(table.tipoEvento, table.createdAt),
    index("idx_webhook_shop").on(table.shopIdExterno),
  ],
);

export const logSincronizacaoCanal = pgTable(
  "log_sincronizacao_canal",
  {
    id: text("id").primaryKey(),
    canalVendaId: text("canal_venda_id")
      .notNull()
      .references(() => canaisVenda.id, { onDelete: "cascade" }),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    tipo: text("tipo").notNull(),
    operacao: text("operacao").notNull(),
    payloadEnviado: jsonb("payload_enviado"),
    respostaRecebida: jsonb("resposta_recebida"),
    statusHttp: integer("status_http"),
    sucesso: boolean("sucesso").notNull(),
    erroMensagem: text("erro_mensagem"),
    duracaoMs: integer("duracao_ms"),
    tentativa: integer("tentativa").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_log_canal_data").on(table.canalVendaId, table.createdAt),
    index("idx_log_sucesso").on(table.sucesso, table.createdAt),
  ],
);

export const skuCanal = pgTable(
  "sku_canal",
  {
    id: text("id").primaryKey(),
    canalVendaId: text("canal_venda_id")
      .notNull()
      .references(() => canaisVenda.id, { onDelete: "cascade" }),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    produtoId: text("produto_id"),
    skuInterno: text("sku_interno").notNull(),
    skuExterno: text("sku_externo").notNull(),
    productIdExterno: text("product_id_externo"),
    skuIdExterno: text("sku_id_externo"),
    bufferSeguranca: integer("buffer_seguranca").notNull().default(0),
    ultimaQtdPublicada: integer("ultima_qtd_publicada"),
    ultimaSyncEm: timestamp("ultima_sync_em"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_sku_canal_produto").on(table.canalVendaId, table.produtoId),
    uniqueIndex("unq_sku_canal_externo").on(
      table.canalVendaId,
      table.skuExterno,
    ),
  ],
);

export const canaisVendaRelations = relations(canaisVenda, ({ one, many }) => ({
  conta: one(conta, {
    fields: [canaisVenda.contaId],
    references: [conta.id],
  }),
  credenciaisTiktok: one(credenciaisOauthTiktok, {
    fields: [canaisVenda.id],
    references: [credenciaisOauthTiktok.canalVendaId],
  }),
  eventosWebhook: many(eventosWebhookTiktok),
  logs: many(logSincronizacaoCanal),
  skus: many(skuCanal),
}));

export const credenciaisOauthTiktokRelations = relations(
  credenciaisOauthTiktok,
  ({ one }) => ({
    canal: one(canaisVenda, {
      fields: [credenciaisOauthTiktok.canalVendaId],
      references: [canaisVenda.id],
    }),
  }),
);

// ============================================================
// MODELO PRINCIPAL (SKU Principal) — variações por modelo
// ============================================================
// Cada modelo (LUA, NBA, ...) tem autonomia nas suas próprias
// cores e tamanhos. Separado dos catálogos globais
// (cor_catalogo / tamanho_catalogo) que permanecem para SKUs
// combinados livremente.

export const modeloPrincipal = pgTable(
  "modelo_principal",
  {
    id: text("id").primaryKey(),
    codigo: text("codigo").notNull(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    ativo: boolean("ativo").notNull().default(true),
    etiquetaImagemUrl: text("etiqueta_imagem_url"),
    etiquetaImagemAtualizadaEm: timestamp("etiqueta_imagem_atualizada_em"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_modelo_principal_conta").on(t.contaId),
    uniqueIndex("uq_modelo_principal_codigo_conta").on(t.codigo, t.contaId),
  ],
);

export const modeloCor = pgTable(
  "modelo_cor",
  {
    id: text("id").primaryKey(),
    modeloId: text("modelo_id")
      .notNull()
      .references(() => modeloPrincipal.id, { onDelete: "cascade" }),
    codigo: text("codigo").notNull(),
    ativo: boolean("ativo").notNull().default(true),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_modelo_cor_conta").on(t.contaId),
    index("idx_modelo_cor_modelo").on(t.modeloId),
    uniqueIndex("uq_modelo_cor_codigo_modelo").on(t.modeloId, t.codigo),
  ],
);

export const modeloTamanho = pgTable(
  "modelo_tamanho",
  {
    id: text("id").primaryKey(),
    modeloId: text("modelo_id")
      .notNull()
      .references(() => modeloPrincipal.id, { onDelete: "cascade" }),
    codigo: text("codigo").notNull(),
    ativo: boolean("ativo").notNull().default(true),
    ordem: integer("ordem").notNull().default(0),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_modelo_tamanho_conta").on(t.contaId),
    index("idx_modelo_tamanho_modelo").on(t.modeloId),
    uniqueIndex("uq_modelo_tamanho_codigo_modelo").on(t.modeloId, t.codigo),
  ],
);

export type ModeloPrincipal = InferSelectModel<typeof modeloPrincipal>;
export type ModeloCor = InferSelectModel<typeof modeloCor>;
export type ModeloTamanho = InferSelectModel<typeof modeloTamanho>;

// ============================================================
// SESSÃO DE EXPEDIÇÃO (Expedição Diária)
// ============================================================
// Cada usuário tem no máximo uma sessão ativa por vez (status=ativa).
// Ao encerrar, gera relatório e envia por email.

export const sessaoExpedicaoStatusEnum = pgEnum("sessao_expedicao_status", [
  "ativa",
  "encerrada",
]);

export const sessaoExpedicao = pgTable(
  "sessao_expedicao",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: sessaoExpedicaoStatusEnum("status").notNull().default("ativa"),
    iniciouEm: timestamp("iniciou_em").notNull().defaultNow(),
    encerrouEm: timestamp("encerrou_em"),
    totalEtiquetas: integer("total_etiquetas").notNull().default(0),
    skusContagem: jsonb("skus_contagem")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    relatorioEnviado: boolean("relatorio_enviado").notNull().default(false),
  },
  (table) => [
    index("idx_sessao_expedicao_conta").on(table.contaId),
    index("idx_sessao_expedicao_usuario").on(table.usuarioId),
    uniqueIndex("uq_sessao_expedicao_ativa_por_usuario")
      .on(table.usuarioId)
      .where(sql`status = 'ativa'`),
  ],
);

export type SessaoExpedicao = InferSelectModel<typeof sessaoExpedicao>;

// ============================================================
// SESSÃO DE COLETAS
// ============================================================
// Persistência server-side da bipagem em andamento — o usuário pode
// trocar de módulo/browser sem perder o progresso. TTL implícito de 8h:
// se `ultima_atividade_em` < now() - 8h, a sessão é considerada expirada
// e o GET retorna null (após marcar encerrada). Único índice por
// (usuario_id + status='ativa'), igual expedição.

export const sessaoColetasStatusEnum = pgEnum("sessao_coletas_status", [
  "ativa",
  "encerrada",
]);

export const sessaoColetas = pgTable(
  "sessao_coletas",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: sessaoColetasStatusEnum("status").notNull().default("ativa"),
    tipo: tipoColetaEnum("tipo").notNull().default("COLETA"),
    conta: contaOperacaoEnum("conta").notNull().default("TIKTOK_SHOP"),
    pacotes: jsonb("pacotes").$type<string[]>().notNull().default([]),
    devolucoesData: jsonb("devolucoes_data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    totalPacotes: integer("total_pacotes").notNull().default(0),
    iniciouEm: timestamp("iniciou_em").notNull().defaultNow(),
    ultimaAtividadeEm: timestamp("ultima_atividade_em").notNull().defaultNow(),
    encerrouEm: timestamp("encerrou_em"),
    encerradaMotivo: text("encerrada_motivo"), // 'finalizada' | 'forcada' | 'expirada'
  },
  (table) => [
    index("idx_sessao_coletas_conta").on(table.contaId),
    index("idx_sessao_coletas_usuario").on(table.usuarioId),
    uniqueIndex("uq_sessao_coletas_ativa_por_usuario")
      .on(table.usuarioId)
      .where(sql`status = 'ativa'`),
  ],
);

export type SessaoColetas = InferSelectModel<typeof sessaoColetas>;

// ============================================================
// HISTÓRICO DE IMPRESSÃO DE ETIQUETAS (Expedição Diária)
// ============================================================
// Retenção: 10 dias (blob PDF) — janela de dedup real é 30 dias via tabela
// `tracking_id_impresso`. Esta tabela mantém o PDF baixável e o snapshot de
// metadados. sessao_id é nullable — impressões fora de sessão ainda são
// permitidas (comportamento legado).

export const historicoImpressaoEtiquetas = pgTable(
  "historico_impressao_etiquetas",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessaoId: text("sessao_id").references(() => sessaoExpedicao.id, {
      onDelete: "set null",
    }),
    blobUrl: text("blob_url").notNull(),
    fileName: text("file_name").notNull(),
    groupLabel: text("group_label").notNull(),
    subgroupIds: text("subgroup_ids").array().notNull().default([]),
    // Tracking IDs (Código de Rastreamento) das etiquetas exportadas neste
    // PDF. Snapshot legado — a dedup real vive na tabela normalizada
    // `tracking_id_impresso` (janela de 30 dias). Mantido pra debug e pra
    // facilitar remoção numa segunda PR sem mexer em código de leitura.
    trackingIds: text("tracking_ids").array().notNull().default([]),
    // Contagem por SKU exportada neste PDF. Permite agregar relatórios
    // por período sem depender da sessao_expedicao.
    skusCount: jsonb("skus_count")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    pageCount: integer("page_count").notNull().default(0),
    cleanedUp: boolean("cleaned_up").notNull().default(false),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_hist_impressao_conta").on(table.contaId),
    index("idx_hist_impressao_expires").on(table.expiresAt),
    index("idx_hist_impressao_sessao").on(table.sessaoId),
  ],
);

export type HistoricoImpressaoEtiquetas = InferSelectModel<
  typeof historicoImpressaoEtiquetas
>;

// Tabela normalizada de tracking IDs impressos. Uma linha por (tracking ×
// evento de impressão) — múltiplas linhas pro mesmo tracking quando houver
// reimpressão autorizada. Lookup batch via B-tree composto em (conta, tracking)
// O(k log n). Janela de 30 dias controlada por `expira_em`, independente do
// blob retention de 10 dias do histórico (FK cascade serve só pra integridade
// caso DBA delete histórico — cleanup natural é por expira_em < now()).
export const trackingIdImpresso = pgTable(
  "tracking_id_impresso",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    trackingId: text("tracking_id").notNull(),
    historicoId: text("historico_id")
      .notNull()
      .references(() => historicoImpressaoEtiquetas.id, { onDelete: "cascade" }),
    usuarioId: text("usuario_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    groupLabel: text("group_label").notNull().default(""),
    reimpressao: boolean("reimpressao").notNull().default(false),
    impressoEm: timestamp("impresso_em").notNull().defaultNow(),
    expiraEm: timestamp("expira_em").notNull(),
  },
  (table) => [
    // Lookup batch: WHERE conta_id = ? AND tracking_id = ANY($2) AND expira_em > now()
    index("idx_tracking_lookup").on(table.contaId, table.trackingId),
    // Cleanup oportunístico
    index("idx_tracking_expira").on(table.expiraEm),
    // Audit por usuário (relatórios futuros)
    index("idx_tracking_usuario").on(table.usuarioId, table.impressoEm),
  ],
);

export type TrackingIdImpresso = InferSelectModel<typeof trackingIdImpresso>;

// Inferred types
export type CanalVenda = InferSelectModel<typeof canaisVenda>;
export type CredenciaisOauthTiktok = InferSelectModel<
  typeof credenciaisOauthTiktok
>;
export type EventoWebhookTiktok = InferSelectModel<typeof eventosWebhookTiktok>;
export type LogSincronizacaoCanal = InferSelectModel<
  typeof logSincronizacaoCanal
>;
export type SkuCanal = InferSelectModel<typeof skuCanal>;
export type PlataformaCanal = (typeof plataformaCanalEnum.enumValues)[number];
export type EmissorNota = (typeof emissorNotaEnum.enumValues)[number];
export type StatusRenovacaoOauth =
  (typeof statusRenovacaoOauthEnum.enumValues)[number];

// ============================================================
// 14. CONFECÇÃO (Módulo de Confecção — RITM-01: Cadastros)
// ============================================================
// Domínio isolado do módulo de canais (TikTok). Tabelas prefixadas
// `confeccao_*` para deixar claro o escopo. `confeccao_produto` é o
// produto produzido pela confecção — separado de `sku_catalogo` (SKU
// comercial); vínculo entre os dois é roadmap futuro. `confeccao_cor`
// também é separada de `cor_catalogo` por mesma razão (semântica
// diferente — cores do tecido em produção vs cores do SKU comercial).

export const confeccaoFornecedorCategoriaEnum = pgEnum(
  "confeccao_fornecedor_categoria",
  ["risco", "tecido", "corte", "costura", "vies"],
);

export const confeccaoProduto = pgTable(
  "confeccao_produto",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    descricao: text("descricao"),
    ativo: boolean("ativo").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_confeccao_produto_conta").on(table.contaId),
    uniqueIndex("uq_confeccao_produto_nome_conta").on(table.contaId, table.nome),
  ],
);

export const confeccaoFornecedor = pgTable(
  "confeccao_fornecedor",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    // Array de enum — multi-categoria (ex: ["tecido", "corte"])
    categorias: confeccaoFornecedorCategoriaEnum("categorias")
      .array()
      .notNull(),
    // Formato livre (BR human-readable), usado em links wa.me/{numero}
    whatsapp: text("whatsapp").notNull(),
    // Formato E.164 (+5511999999999) — obrigatório quando usar API Lalamove
    telefoneE164: text("telefone_e164"),
    enderecoRua: text("endereco_rua").notNull(),
    enderecoNumero: text("endereco_numero").notNull(),
    enderecoComplemento: text("endereco_complemento"),
    enderecoBairro: text("endereco_bairro").notNull(),
    enderecoCep: text("endereco_cep").notNull(),
    enderecoCidade: text("endereco_cidade").notNull(),
    enderecoEstado: text("endereco_estado").notNull(),
    // Preenchidos por geocoding background (RITM-05). text por consistência
    // com o resto do projeto (primeira tabela com geo).
    latitude: text("latitude"),
    longitude: text("longitude"),
    contatoNome: text("contato_nome"),
    observacoes: text("observacoes"),
    ativo: boolean("ativo").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_confeccao_fornecedor_conta").on(table.contaId),
    // GIN index para filtro por categoria via operadores de array (@>, &&).
    // Drizzle gera "USING gin" via .using("gin", ...). Validar SQL gerado;
    // se necessário, ajustar manualmente.
    index("idx_confeccao_fornecedor_categorias")
      .using("gin", table.categorias),
  ],
);

export const confeccaoTipoTecido = pgTable(
  "confeccao_tipo_tecido",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    ativo: boolean("ativo").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_confeccao_tipo_tecido_conta").on(table.contaId),
    uniqueIndex("uq_confeccao_tipo_tecido_nome_conta").on(
      table.contaId,
      table.nome,
    ),
  ],
);

export const confeccaoCor = pgTable(
  "confeccao_cor",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    ativo: boolean("ativo").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_confeccao_cor_conta").on(table.contaId),
    uniqueIndex("uq_confeccao_cor_nome_conta").on(table.contaId, table.nome),
  ],
);

// Preço sugerido por (fornecedor × tipo de tecido). Read-only nas
// subtasks da Compra (campo "preço sugerido").
export const confeccaoFornecedorTecidoPreco = pgTable(
  "confeccao_fornecedor_tecido_preco",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    fornecedorId: text("fornecedor_id")
      .notNull()
      .references(() => confeccaoFornecedor.id, { onDelete: "cascade" }),
    tipoTecidoId: text("tipo_tecido_id")
      .notNull()
      .references(() => confeccaoTipoTecido.id, { onDelete: "cascade" }),
    precoKgSugerido: real("preco_kg_sugerido").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_confeccao_fornecedor_tecido_preco").on(
      table.fornecedorId,
      table.tipoTecidoId,
    ),
    index("idx_confeccao_fornecedor_tecido_preco_conta").on(table.contaId),
  ],
);

export const confeccaoFornecedorRelations = relations(
  confeccaoFornecedor,
  ({ many }) => ({
    precos: many(confeccaoFornecedorTecidoPreco),
  }),
);

export const confeccaoTipoTecidoRelations = relations(
  confeccaoTipoTecido,
  ({ many }) => ({
    precos: many(confeccaoFornecedorTecidoPreco),
  }),
);

export const confeccaoFornecedorTecidoPrecoRelations = relations(
  confeccaoFornecedorTecidoPreco,
  ({ one }) => ({
    fornecedor: one(confeccaoFornecedor, {
      fields: [confeccaoFornecedorTecidoPreco.fornecedorId],
      references: [confeccaoFornecedor.id],
    }),
    tipoTecido: one(confeccaoTipoTecido, {
      fields: [confeccaoFornecedorTecidoPreco.tipoTecidoId],
      references: [confeccaoTipoTecido.id],
    }),
  }),
);

export type ConfeccaoProduto = InferSelectModel<typeof confeccaoProduto>;
export type ConfeccaoFornecedor = InferSelectModel<typeof confeccaoFornecedor>;
export type ConfeccaoTipoTecido = InferSelectModel<typeof confeccaoTipoTecido>;
export type ConfeccaoCor = InferSelectModel<typeof confeccaoCor>;
export type ConfeccaoFornecedorTecidoPreco = InferSelectModel<
  typeof confeccaoFornecedorTecidoPreco
>;
export type ConfeccaoFornecedorCategoria =
  (typeof confeccaoFornecedorCategoriaEnum.enumValues)[number];

// ============================================================
// 15. CONFECÇÃO — RITM-02: OP, subtasks, notas, anexos
// ============================================================
// Espinha dorsal do módulo: cada Ordem de Produção (OP) gera 5 ou 6
// subtasks (Compra → Risco → Corte → [Viés condicional] → Costura →
// Conferência). Notas são criadas manualmente ou automaticamente por
// auditoria. Anexos são URLs do Vercel Blob (helper na RITM-04).
//
// Sequencial da OP é GLOBAL (não por conta). Implementado via sequence
// `confeccao_op_sequencial` (criada manualmente na migration porque
// Drizzle não tem suporte nativo a sequences). Helper de numeração em
// src/lib/confeccao/numeracao.ts.

export const confeccaoOpStatusEnum = pgEnum("confeccao_op_status", [
  "em_andamento",
  "concluida",
  "cancelada",
]);

export const confeccaoSubtaskStatusEnum = pgEnum("confeccao_subtask_status", [
  "bloqueada",
  "pendente",
  "em_andamento",
  "concluida",
  "cancelada",
]);

export const confeccaoSubtaskPrefixoEnum = pgEnum(
  "confeccao_subtask_prefixo",
  [
    "OPBUY", // Compra de Tecido
    "OPRIS", // Risco
    "OPCOR", // Corte
    "OPVIE", // Viés (condicional)
    "OPSEW", // Costura
    "OPCONF", // Conferência
  ],
);

export const confeccaoOrdemProducao = pgTable(
  "confeccao_ordem_producao",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    // Número visível no formato OPMMAANNNN (ex: OP05260001).
    // Único globalmente (não por conta) — decisão atual; reavaliar
    // quando houver múltiplas contas produtivas com numerações próprias.
    numero: text("numero").notNull(),
    // Sequencial contínuo (0-9999), reseta após 9999 via CYCLE da sequence.
    sequencialGlobal: integer("sequencial_global").notNull(),
    produtoId: text("produto_id")
      .notNull()
      .references(() => confeccaoProduto.id),
    temVies: boolean("tem_vies").notNull().default(false),
    status: confeccaoOpStatusEnum("status").notNull().default("em_andamento"),
    criadaPorId: text("criada_por_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    atribuidoAId: text("atribuido_a_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    observacoes: text("observacoes"),
    canceladaEm: timestamp("cancelada_em"),
    canceladaPorId: text("cancelada_por_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // Só preenchido se OP já estava fechada quando foi cancelada (dupla
    // autorização — outro admin precisa autorizar).
    cancelamentoAutorizadoPorId: text(
      "cancelamento_autorizado_por_id",
    ).references(() => user.id, { onDelete: "set null" }),
    cancelamentoJustificativa: text("cancelamento_justificativa"),
    concluidaEm: timestamp("concluida_em"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_confeccao_op_numero").on(table.numero),
    index("idx_confeccao_op_conta_status").on(table.contaId, table.status),
    index("idx_confeccao_op_atribuido").on(table.atribuidoAId),
    index("idx_confeccao_op_produto").on(table.produtoId),
  ],
);

export const confeccaoSubtask = pgTable(
  "confeccao_subtask",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    ordemProducaoId: text("ordem_producao_id")
      .notNull()
      .references(() => confeccaoOrdemProducao.id, { onDelete: "cascade" }),
    // Número visível na UI: [PREFIXO]NNNN (ex: OPBUY0001)
    numero: text("numero").notNull(),
    // ID interno único globalmente: [PREFIXO]-MMAA-NNNN (ex: OPBUY-0526-0001)
    idInterno: text("id_interno").notNull(),
    prefixo: confeccaoSubtaskPrefixoEnum("prefixo").notNull(),
    // 1..6, define ordem visual no stepper
    ordemSequencial: integer("ordem_sequencial").notNull(),
    status: confeccaoSubtaskStatusEnum("status")
      .notNull()
      .default("bloqueada"),
    atribuidoAId: text("atribuido_a_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // Payload JSONB com campos específicos por tipo de subtask.
    // Validação via Zod no app layer (RITMs 08-13 definem schemas).
    // NÃO confiar que o conteúdo é válido só porque está no banco.
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    // Valor do serviço da subtask. Conferência não tem custo → null.
    valorServico: real("valor_servico"),
    iniciadaEm: timestamp("iniciada_em"),
    concluidaEm: timestamp("concluida_em"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_confeccao_subtask_id_interno").on(table.idInterno),
    // Só uma subtask de cada prefixo por OP
    uniqueIndex("uq_confeccao_subtask_op_prefixo").on(
      table.ordemProducaoId,
      table.prefixo,
    ),
    index("idx_confeccao_subtask_status").on(table.status),
    index("idx_confeccao_subtask_atribuido").on(table.atribuidoAId),
  ],
);

export const confeccaoNota = pgTable(
  "confeccao_nota",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    ordemProducaoId: text("ordem_producao_id").references(
      () => confeccaoOrdemProducao.id,
      { onDelete: "cascade" },
    ),
    subtaskId: text("subtask_id").references(() => confeccaoSubtask.id, {
      onDelete: "cascade",
    }),
    // NULL quando auditoria automática do sistema (sem autor humano)
    autorId: text("autor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    conteudo: text("conteudo").notNull(),
    isAuditoria: boolean("is_auditoria").notNull().default(false),
    // Preparação para notas públicas (V2). Por ora todas são internas.
    isInterna: boolean("is_interna").notNull().default(true),
    // Auditoria estruturada: {campoAlterado, valorAntigo, valorNovo, ...}
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_confeccao_nota_op_data").on(
      table.ordemProducaoId,
      table.createdAt,
    ),
    index("idx_confeccao_nota_subtask_data").on(
      table.subtaskId,
      table.createdAt,
    ),
    index("idx_confeccao_nota_auditoria").on(
      table.isAuditoria,
      table.createdAt,
    ),
  ],
);

// Anexo no Vercel Blob (URL + pathname). Fluxo de upload na RITM-04.
// `lalamoveId` é text sem FK porque a tabela `confeccao_lalamove` é
// criada na RITM-03 — a FK é adicionada lá via ALTER TABLE.
export const confeccaoAnexo = pgTable(
  "confeccao_anexo",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    subtaskId: text("subtask_id").references(() => confeccaoSubtask.id, {
      onDelete: "cascade",
    }),
    ordemProducaoId: text("ordem_producao_id").references(
      () => confeccaoOrdemProducao.id,
      { onDelete: "cascade" },
    ),
    // FK adicionada na RITM-03 via Drizzle (forward ref para confeccaoLalamove).
    // Drizzle gera ALTER TABLE ADD CONSTRAINT na migration nova.
    lalamoveId: text("lalamove_id").references(
      (): AnyPgColumn => confeccaoLalamove.id,
      { onDelete: "cascade" },
    ),
    // 'nf_compra' | 'risco_digital' | 'foto_papagaio' | 'foto_defeito'
    // | 'comprovante_lalamove' | 'outros'
    categoria: text("categoria").notNull(),
    nomeArquivo: text("nome_arquivo").notNull(),
    tipoMime: text("tipo_mime").notNull(),
    // 50 MB max — CHECK adicionado manualmente no SQL gerado
    tamanhoBytes: integer("tamanho_bytes").notNull(),
    // URL completa do Vercel Blob; unique → impede dupla confirmação silenciosa
    blobUrl: text("blob_url").notNull().unique(),
    // Pathname relativo no Blob, usado em del()
    blobPathname: text("blob_pathname").notNull(),
    enviadoPorId: text("enviado_por_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_confeccao_anexo_subtask").on(table.subtaskId),
    index("idx_confeccao_anexo_op").on(table.ordemProducaoId),
    index("idx_confeccao_anexo_lalamove").on(table.lalamoveId),
    index("idx_confeccao_anexo_categoria").on(table.categoria),
  ],
);

export const confeccaoOrdemProducaoRelations = relations(
  confeccaoOrdemProducao,
  ({ one, many }) => ({
    conta: one(conta, {
      fields: [confeccaoOrdemProducao.contaId],
      references: [conta.id],
    }),
    produto: one(confeccaoProduto, {
      fields: [confeccaoOrdemProducao.produtoId],
      references: [confeccaoProduto.id],
    }),
    criadaPor: one(user, {
      fields: [confeccaoOrdemProducao.criadaPorId],
      references: [user.id],
      relationName: "opCriadaPor",
    }),
    atribuidoA: one(user, {
      fields: [confeccaoOrdemProducao.atribuidoAId],
      references: [user.id],
      relationName: "opAtribuidoA",
    }),
    subtasks: many(confeccaoSubtask),
    notas: many(confeccaoNota),
    anexos: many(confeccaoAnexo),
  }),
);

export const confeccaoSubtaskRelations = relations(
  confeccaoSubtask,
  ({ one, many }) => ({
    ordemProducao: one(confeccaoOrdemProducao, {
      fields: [confeccaoSubtask.ordemProducaoId],
      references: [confeccaoOrdemProducao.id],
    }),
    atribuidoA: one(user, {
      fields: [confeccaoSubtask.atribuidoAId],
      references: [user.id],
    }),
    notas: many(confeccaoNota),
    anexos: many(confeccaoAnexo),
  }),
);

export const confeccaoNotaRelations = relations(confeccaoNota, ({ one }) => ({
  ordemProducao: one(confeccaoOrdemProducao, {
    fields: [confeccaoNota.ordemProducaoId],
    references: [confeccaoOrdemProducao.id],
  }),
  subtask: one(confeccaoSubtask, {
    fields: [confeccaoNota.subtaskId],
    references: [confeccaoSubtask.id],
  }),
  autor: one(user, {
    fields: [confeccaoNota.autorId],
    references: [user.id],
  }),
}));

export const confeccaoAnexoRelations = relations(
  confeccaoAnexo,
  ({ one }) => ({
    ordemProducao: one(confeccaoOrdemProducao, {
      fields: [confeccaoAnexo.ordemProducaoId],
      references: [confeccaoOrdemProducao.id],
    }),
    subtask: one(confeccaoSubtask, {
      fields: [confeccaoAnexo.subtaskId],
      references: [confeccaoSubtask.id],
    }),
    enviadoPor: one(user, {
      fields: [confeccaoAnexo.enviadoPorId],
      references: [user.id],
    }),
  }),
);

export type ConfeccaoOrdemProducao = InferSelectModel<
  typeof confeccaoOrdemProducao
>;
export type ConfeccaoSubtask = InferSelectModel<typeof confeccaoSubtask>;
export type ConfeccaoNota = InferSelectModel<typeof confeccaoNota>;
export type ConfeccaoAnexo = InferSelectModel<typeof confeccaoAnexo>;
export type ConfeccaoOpStatus =
  (typeof confeccaoOpStatusEnum.enumValues)[number];
export type ConfeccaoSubtaskStatus =
  (typeof confeccaoSubtaskStatusEnum.enumValues)[number];
export type ConfeccaoSubtaskPrefixo =
  (typeof confeccaoSubtaskPrefixoEnum.enumValues)[number];

// ============================================================
// 16. CONFECÇÃO — RITM-03: Lalamove, retiradas, subconferências
// ============================================================
// Logística (Lalamove) + fluxo de retiradas da Costura e subconferências.
//
// Modelagem dual-mode (manual e API) desde o MVP. Modo manual ativo em
// V1.0; modo API ativado por feature flag em V1.3 (RITMs 25-28). Campos
// da API ficam NULL no modo manual e vice-versa.
//
// ⚠️ Detalhes críticos:
//   - order_id_api é SEMPRE text (Lalamove estendeu pra 19 dígitos em set/2025)
//   - cotação Lalamove dura 5 minutos — validar expira_em antes de criar order
//   - webhook_event aceita conta_id NULL (resolução posterior por role com bypass)
//   - schedule_at sempre em UTC; converter de/para Brasília na UI
//   - cancelamento da OP em cascata cancela orders ativos (RITM-18)

export const confeccaoLalamoveStatusEnum = pgEnum(
  "confeccao_lalamove_status",
  [
    "rascunho",
    "cotado",
    "procurando_motorista",
    "motorista_designado",
    "a_caminho_coleta",
    "coletado",
    "entregue",
    "cancelado",
    "rejeitado",
    "expirado",
  ],
);

export const confeccaoLalamoveTipoEnum = pgEnum("confeccao_lalamove_tipo", [
  "principal", // Lalamove de fluxo (compra→corte, corte→costura, ...)
  "outros", // Ex: envio de etiquetas — não compõe custo principal
]);

export const confeccaoLalamoveOrigemSolicitacaoEnum = pgEnum(
  "confeccao_lalamove_origem_solicitacao",
  ["manual", "api"],
);

export const confeccaoLalamoveCotacaoStatusEnum = pgEnum(
  "confeccao_lalamove_cotacao_status",
  ["valida", "expirada", "convertida_em_pedido", "descartada"],
);

export const confeccaoLalamoveWebhookEventoEnum = pgEnum(
  "confeccao_lalamove_webhook_evento",
  ["ORDER_STATUS_CHANGED", "DRIVER_ASSIGNED", "OUTROS"],
);

export const confeccaoRetiradaTipoEnum = pgEnum(
  "confeccao_retirada_tipo",
  ["parcial", "final"],
);

export const confeccaoTipoDefeitoEnum = pgEnum("confeccao_tipo_defeito", [
  "rebarba",
  "costura_desalinhada",
  "costura_incompleta",
  "gola",
  "mancha",
  "tecido",
  "furo",
  "outros",
]);

export const confeccaoDestinoReprovadasEnum = pgEnum(
  "confeccao_destino_reprovadas",
  ["doacao", "descarte", "retrabalho"],
);

// ------------------------------------------------------------
// Retirada — tem que vir antes de Lalamove no schema porque
// confeccaoLalamove.retirada_id referencia confeccao_retirada.
// (Drizzle aceita forward ref via callback, mas declarar antes
// quando não há dependência circular fica mais limpo.)
// ------------------------------------------------------------
export const confeccaoRetirada = pgTable(
  "confeccao_retirada",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    subtaskCosturaId: text("subtask_costura_id")
      .notNull()
      .references(() => confeccaoSubtask.id, { onDelete: "cascade" }),
    oficinaId: text("oficina_id")
      .notNull()
      .references(() => confeccaoFornecedor.id, { onDelete: "restrict" }),
    // Numero: OPXXXXXXXX-RET-NN; sequencial por (subtask × oficina).
    // Implementação da geração na RITM-12 (Costura).
    numero: text("numero").notNull(),
    tipo: confeccaoRetiradaTipoEnum("tipo").notNull(),
    // Estrutura: {"M": {"preto": 100, "branco": 50}, "G": {...}}
    pecasPorTamanhoCor: jsonb("pecas_por_tamanho_cor")
      .$type<Record<string, Record<string, number>>>()
      .notNull(),
    dataRetirada: timestamp("data_retirada").notNull(),
    canceladaEm: timestamp("cancelada_em"),
    canceladaPorId: text("cancelada_por_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_confeccao_retirada_numero").on(table.numero),
    index("idx_confeccao_retirada_subtask_costura").on(table.subtaskCosturaId),
    index("idx_confeccao_retirada_oficina").on(table.oficinaId),
  ],
);

export const confeccaoLalamove = pgTable(
  "confeccao_lalamove",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    // Pelo menos uma das duas FKs precisa estar preenchida (CHECK adicionado
    // manualmente no SQL da migration).
    subtaskId: text("subtask_id").references(() => confeccaoSubtask.id, {
      onDelete: "cascade",
    }),
    retiradaId: text("retirada_id").references(() => confeccaoRetirada.id, {
      onDelete: "cascade",
    }),
    tipo: confeccaoLalamoveTipoEnum("tipo").notNull().default("principal"),
    origemSolicitacao: confeccaoLalamoveOrigemSolicitacaoEnum(
      "origem_solicitacao",
    )
      .notNull()
      .default("manual"),
    status: confeccaoLalamoveStatusEnum("status")
      .notNull()
      .default("rascunho"),
    // Endereços (snapshot — não muda se fornecedor for editado depois)
    origemEndereco: jsonb("origem_endereco")
      .$type<Record<string, string | null>>()
      .notNull(),
    origemLat: text("origem_lat"),
    origemLng: text("origem_lng"),
    destinoEndereco: jsonb("destino_endereco")
      .$type<Record<string, string | null>>()
      .notNull(),
    destinoLat: text("destino_lat"),
    destinoLng: text("destino_lng"),
    // Contatos (obrigatórios para API a partir do `cotado`; opcionais manual)
    contatoOrigemNome: text("contato_origem_nome"),
    contatoOrigemTelefone: text("contato_origem_telefone"), // E.164 quando API
    contatoDestinoNome: text("contato_destino_nome"),
    contatoDestinoTelefone: text("contato_destino_telefone"),
    remarksDestino: text("remarks_destino"),
    // Operacional
    valor: real("valor"),
    moeda: text("moeda").notNull().default("BRL"),
    conteudoDescricao: text("conteudo_descricao"),
    quantidadePecas: integer("quantidade_pecas"),
    // API (NULL no modo manual)
    serviceType: text("service_type"),
    specialRequests: text("special_requests").array(),
    scheduleAt: timestamp("schedule_at"), // sempre UTC
    quotationIdApi: text("quotation_id_api"),
    // ⚠️ SEMPRE text — Lalamove estendeu pra 19 dígitos em set/2025
    orderIdApi: text("order_id_api"),
    shareLink: text("share_link"),
    driverIdApi: text("driver_id_api"),
    driverNome: text("driver_nome"),
    driverTelefone: text("driver_telefone"),
    driverPlaca: text("driver_placa"),
    distanciaMetros: integer("distancia_metros"),
    priceBreakdown: jsonb("price_breakdown").$type<Record<string, unknown>>(),
    lastDriverLat: text("last_driver_lat"),
    lastDriverLng: text("last_driver_lng"),
    lastDriverLocationAt: timestamp("last_driver_location_at"),
    // Timestamps
    dataSolicitacao: timestamp("data_solicitacao").notNull().defaultNow(),
    dataColeta: timestamp("data_coleta"),
    dataEntrega: timestamp("data_entrega"),
    canceladaEm: timestamp("cancelada_em"),
    canceladaPorId: text("cancelada_por_id").references(() => user.id, {
      onDelete: "set null",
    }),
    cancelamentoMotivo: text("cancelamento_motivo"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_confeccao_lalamove_subtask").on(table.subtaskId),
    index("idx_confeccao_lalamove_retirada").on(table.retiradaId),
    index("idx_confeccao_lalamove_status").on(table.status),
    // Índices parciais: ajustados manualmente no SQL gerado se Drizzle não suportar
    index("idx_confeccao_lalamove_order_id_api").on(table.orderIdApi),
    index("idx_confeccao_lalamove_procura_alta").on(
      table.status,
      table.dataSolicitacao,
    ),
  ],
);

export const confeccaoLalamoveCotacao = pgTable(
  "confeccao_lalamove_cotacao",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    lalamoveId: text("lalamove_id")
      .notNull()
      .references(() => confeccaoLalamove.id, { onDelete: "cascade" }),
    // ID retornado por POST /v3/quotations — único
    quotationIdApi: text("quotation_id_api").notNull().unique(),
    status: confeccaoLalamoveCotacaoStatusEnum("status")
      .notNull()
      .default("valida"),
    valorCotado: real("valor_cotado").notNull(),
    moeda: text("moeda").notNull().default("BRL"),
    distanciaMetros: integer("distancia_metros"),
    serviceType: text("service_type").notNull(),
    // Array com {stopId, address, coordinates} — os stopIds precisam ser
    // repassados ao criar o order via POST /v3/orders
    stopsApi: jsonb("stops_api")
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    requestPayload: jsonb("request_payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    responsePayload: jsonb("response_payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    // = criada_em + 5 minutos (regra da Lalamove)
    expiraEm: timestamp("expira_em").notNull(),
    criadaPorId: text("criada_por_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // Índice parcial — ajustado manualmente no SQL pra ficar WHERE status='valida'
    index("idx_confeccao_lalamove_cotacao_validas").on(
      table.lalamoveId,
      table.expiraEm,
    ),
  ],
);

// Log cru de webhooks da Lalamove — append-only, idempotência.
// Aceita conta_id NULL: receiver insere antes de resolver canal/conta;
// resolução acontece em job assíncrono que usa role com bypass RLS.
export const confeccaoLalamoveWebhookEvent = pgTable(
  "confeccao_lalamove_webhook_event",
  {
    id: text("id").primaryKey(),
    lalamoveId: text("lalamove_id").references(() => confeccaoLalamove.id, {
      onDelete: "set null",
    }),
    contaId: text("conta_id").references(() => conta.id, {
      onDelete: "set null",
    }),
    evento: confeccaoLalamoveWebhookEventoEnum("evento").notNull(),
    // Vem no payload, usado para correlacionar com lalamoves.order_id_api
    orderIdApi: text("order_id_api").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    assinaturaHeader: text("assinatura_header"),
    recebidoEm: timestamp("recebido_em").notNull().defaultNow(),
    processado: boolean("processado").notNull().default(false),
    processadoEm: timestamp("processado_em"),
    erroProcessamento: text("erro_processamento"),
  },
  (table) => [
    // Índices parciais ajustados manualmente
    index("idx_confeccao_lalamove_webhook_nao_processados").on(
      table.recebidoEm,
    ),
    index("idx_confeccao_lalamove_webhook_order").on(table.orderIdApi),
  ],
);

// Subconferência — vinculada 1:1 a uma retirada da Costura.
// É a unidade de trabalho dentro da subtask Conferência (OPCONF).
export const confeccaoSubconferencia = pgTable(
  "confeccao_subconferencia",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    subtaskConferenciaId: text("subtask_conferencia_id")
      .notNull()
      .references(() => confeccaoSubtask.id, { onDelete: "cascade" }),
    retiradaId: text("retirada_id")
      .notNull()
      .unique()
      .references(() => confeccaoRetirada.id, { onDelete: "cascade" }),
    // Herda da retirada: OPXXXXXXXX-CONF-RETNN
    numero: text("numero").notNull(),
    status: confeccaoSubtaskStatusEnum("status")
      .notNull()
      .default("em_andamento"),
    // Bloco 1 — quantitativa (sistema só revela esperado após confirmação)
    pecasRecebidas: jsonb("pecas_recebidas").$type<
      Record<string, Record<string, number>>
    >(),
    divergenciaConfirmada: boolean("divergencia_confirmada")
      .notNull()
      .default(false),
    oficinaResponsavelDivergenciaId: text(
      "oficina_responsavel_divergencia_id",
    ).references(() => confeccaoFornecedor.id, { onDelete: "set null" }),
    quantidadeRevelada: boolean("quantidade_revelada")
      .notNull()
      .default(false),
    // Bloco 2 — inspeção visual
    responsavelInspecaoId: text("responsavel_inspecao_id").references(
      () => user.id,
      { onDelete: "set null" },
    ),
    aprovadas: jsonb("aprovadas").$type<
      Record<string, Record<string, number>>
    >(),
    reprovadas: jsonb("reprovadas").$type<
      Record<string, Record<string, number>>
    >(),
    tiposDefeito: confeccaoTipoDefeitoEnum("tipos_defeito").array(),
    dataInspecao: timestamp("data_inspecao"),
    // Bloco 3 — destinação
    destinoReprovadas: confeccaoDestinoReprovadasEnum("destino_reprovadas"),
    localizacaoArmazem: text("localizacao_armazem"),
    concluidaEm: timestamp("concluida_em"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_confeccao_subconferencia_numero").on(table.numero),
    index("idx_confeccao_subconferencia_subtask").on(
      table.subtaskConferenciaId,
    ),
  ],
);

export const confeccaoLalamoveRelations = relations(
  confeccaoLalamove,
  ({ one, many }) => ({
    subtask: one(confeccaoSubtask, {
      fields: [confeccaoLalamove.subtaskId],
      references: [confeccaoSubtask.id],
    }),
    retirada: one(confeccaoRetirada, {
      fields: [confeccaoLalamove.retiradaId],
      references: [confeccaoRetirada.id],
    }),
    cotacoes: many(confeccaoLalamoveCotacao),
    webhookEvents: many(confeccaoLalamoveWebhookEvent),
  }),
);

export const confeccaoLalamoveCotacaoRelations = relations(
  confeccaoLalamoveCotacao,
  ({ one }) => ({
    lalamove: one(confeccaoLalamove, {
      fields: [confeccaoLalamoveCotacao.lalamoveId],
      references: [confeccaoLalamove.id],
    }),
  }),
);

export const confeccaoLalamoveWebhookEventRelations = relations(
  confeccaoLalamoveWebhookEvent,
  ({ one }) => ({
    lalamove: one(confeccaoLalamove, {
      fields: [confeccaoLalamoveWebhookEvent.lalamoveId],
      references: [confeccaoLalamove.id],
    }),
  }),
);

export const confeccaoRetiradaRelations = relations(
  confeccaoRetirada,
  ({ one, many }) => ({
    subtaskCostura: one(confeccaoSubtask, {
      fields: [confeccaoRetirada.subtaskCosturaId],
      references: [confeccaoSubtask.id],
    }),
    oficina: one(confeccaoFornecedor, {
      fields: [confeccaoRetirada.oficinaId],
      references: [confeccaoFornecedor.id],
    }),
    lalamoves: many(confeccaoLalamove),
    subconferencia: one(confeccaoSubconferencia, {
      fields: [confeccaoRetirada.id],
      references: [confeccaoSubconferencia.retiradaId],
    }),
  }),
);

export const confeccaoSubconferenciaRelations = relations(
  confeccaoSubconferencia,
  ({ one }) => ({
    subtaskConferencia: one(confeccaoSubtask, {
      fields: [confeccaoSubconferencia.subtaskConferenciaId],
      references: [confeccaoSubtask.id],
    }),
    retirada: one(confeccaoRetirada, {
      fields: [confeccaoSubconferencia.retiradaId],
      references: [confeccaoRetirada.id],
    }),
    responsavelInspecao: one(user, {
      fields: [confeccaoSubconferencia.responsavelInspecaoId],
      references: [user.id],
    }),
    oficinaResponsavelDivergencia: one(confeccaoFornecedor, {
      fields: [confeccaoSubconferencia.oficinaResponsavelDivergenciaId],
      references: [confeccaoFornecedor.id],
    }),
  }),
);

export type ConfeccaoLalamove = InferSelectModel<typeof confeccaoLalamove>;
export type ConfeccaoLalamoveCotacao = InferSelectModel<
  typeof confeccaoLalamoveCotacao
>;
export type ConfeccaoLalamoveWebhookEvent = InferSelectModel<
  typeof confeccaoLalamoveWebhookEvent
>;
export type ConfeccaoRetirada = InferSelectModel<typeof confeccaoRetirada>;
export type ConfeccaoSubconferencia = InferSelectModel<
  typeof confeccaoSubconferencia
>;
export type ConfeccaoLalamoveStatus =
  (typeof confeccaoLalamoveStatusEnum.enumValues)[number];
export type ConfeccaoLalamoveTipo =
  (typeof confeccaoLalamoveTipoEnum.enumValues)[number];
export type ConfeccaoLalamoveOrigemSolicitacao =
  (typeof confeccaoLalamoveOrigemSolicitacaoEnum.enumValues)[number];
export type ConfeccaoLalamoveCotacaoStatus =
  (typeof confeccaoLalamoveCotacaoStatusEnum.enumValues)[number];
export type ConfeccaoLalamoveWebhookEvento =
  (typeof confeccaoLalamoveWebhookEventoEnum.enumValues)[number];
export type ConfeccaoRetiradaTipo =
  (typeof confeccaoRetiradaTipoEnum.enumValues)[number];
export type ConfeccaoTipoDefeito =
  (typeof confeccaoTipoDefeitoEnum.enumValues)[number];
export type ConfeccaoDestinoReprovadas =
  (typeof confeccaoDestinoReprovadasEnum.enumValues)[number];

// ============================================================
// 17. CONFECÇÃO — RITM-16: Templates WhatsApp
// ============================================================
// Templates de mensagem WhatsApp por categoria de fornecedor. Corpo com
// placeholders (ex: {op_numero}, {produto}, {tipo_tecido}) resolvidos
// pelo helper src/lib/confeccao/resolver-placeholders.ts no momento do
// envio. Multi-tenant — cada conta tem seus templates.

export const confeccaoTemplateWhatsapp = pgTable(
  "confeccao_template_whatsapp",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    categoria: confeccaoFornecedorCategoriaEnum("categoria").notNull(),
    corpo: text("corpo").notNull(),
    ativo: boolean("ativo").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_confeccao_template_whatsapp_categoria").on(
      table.contaId,
      table.categoria,
    ),
    uniqueIndex("uq_confeccao_template_whatsapp_nome_conta").on(
      table.contaId,
      table.nome,
    ),
  ],
);

export type ConfeccaoTemplateWhatsapp = InferSelectModel<
  typeof confeccaoTemplateWhatsapp
>;

// ============================================================
// 18. CONFECÇÃO — RITM-22: Alertas de atraso
// ============================================================
// Log de envios de alerta de prazo. Garante idempotência (UNIQUE por
// subtask × oficina × tipo × data_referencia) — se o cron rodar 2× no
// mesmo dia, o segundo insert vira no-op via ON CONFLICT.

export const confeccaoAlertaAtrasoTipoEnum = pgEnum(
  "confeccao_alerta_atraso_tipo",
  ["vencendo_24h", "vencido"],
);

export const confeccaoAlertaAtrasoLog = pgTable(
  "confeccao_alerta_atraso_log",
  {
    id: text("id").primaryKey(),
    contaId: text("conta_id")
      .notNull()
      .references(() => conta.id, { onDelete: "cascade" }),
    ordemProducaoId: text("ordem_producao_id")
      .notNull()
      .references(() => confeccaoOrdemProducao.id, { onDelete: "cascade" }),
    subtaskId: text("subtask_id")
      .notNull()
      .references(() => confeccaoSubtask.id, { onDelete: "cascade" }),
    oficinaId: text("oficina_id")
      .notNull()
      .references(() => confeccaoFornecedor.id, { onDelete: "restrict" }),
    tipoAlerta: confeccaoAlertaAtrasoTipoEnum("tipo_alerta").notNull(),
    // Truncado em UTC pra 00:00:00Z do dia. Junto com tipo_alerta+subtask+oficina,
    // forma a chave de dedup por dia.
    dataReferencia: timestamp("data_referencia").notNull(),
    enviadosCount: integer("enviados_count").notNull().default(0),
    destinatariosCount: integer("destinatarios_count").notNull().default(0),
    enviadoEm: timestamp("enviado_em").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_confeccao_alerta_atraso").on(
      table.contaId,
      table.subtaskId,
      table.oficinaId,
      table.tipoAlerta,
      table.dataReferencia,
    ),
    index("idx_confeccao_alerta_atraso_op").on(table.ordemProducaoId),
  ],
);

export type ConfeccaoAlertaAtrasoTipo =
  (typeof confeccaoAlertaAtrasoTipoEnum.enumValues)[number];
export type ConfeccaoAlertaAtrasoLog = InferSelectModel<
  typeof confeccaoAlertaAtrasoLog
>;
