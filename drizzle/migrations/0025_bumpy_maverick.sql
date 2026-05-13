CREATE TYPE "public"."confeccao_destino_reprovadas" AS ENUM('doacao', 'descarte', 'retrabalho');--> statement-breakpoint
CREATE TYPE "public"."confeccao_lalamove_cotacao_status" AS ENUM('valida', 'expirada', 'convertida_em_pedido', 'descartada');--> statement-breakpoint
CREATE TYPE "public"."confeccao_lalamove_origem_solicitacao" AS ENUM('manual', 'api');--> statement-breakpoint
CREATE TYPE "public"."confeccao_lalamove_status" AS ENUM('rascunho', 'cotado', 'procurando_motorista', 'motorista_designado', 'a_caminho_coleta', 'coletado', 'entregue', 'cancelado', 'rejeitado', 'expirado');--> statement-breakpoint
CREATE TYPE "public"."confeccao_lalamove_tipo" AS ENUM('principal', 'outros');--> statement-breakpoint
CREATE TYPE "public"."confeccao_lalamove_webhook_evento" AS ENUM('ORDER_STATUS_CHANGED', 'DRIVER_ASSIGNED', 'OUTROS');--> statement-breakpoint
CREATE TYPE "public"."confeccao_retirada_tipo" AS ENUM('parcial', 'final');--> statement-breakpoint
CREATE TYPE "public"."confeccao_tipo_defeito" AS ENUM('rebarba', 'costura_desalinhada', 'costura_incompleta', 'gola', 'mancha', 'tecido', 'furo', 'outros');--> statement-breakpoint
CREATE TABLE "confeccao_lalamove" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"subtask_id" text,
	"retirada_id" text,
	"tipo" "confeccao_lalamove_tipo" DEFAULT 'principal' NOT NULL,
	"origem_solicitacao" "confeccao_lalamove_origem_solicitacao" DEFAULT 'manual' NOT NULL,
	"status" "confeccao_lalamove_status" DEFAULT 'rascunho' NOT NULL,
	"origem_endereco" jsonb NOT NULL,
	"origem_lat" text,
	"origem_lng" text,
	"destino_endereco" jsonb NOT NULL,
	"destino_lat" text,
	"destino_lng" text,
	"contato_origem_nome" text,
	"contato_origem_telefone" text,
	"contato_destino_nome" text,
	"contato_destino_telefone" text,
	"remarks_destino" text,
	"valor" real,
	"moeda" text DEFAULT 'BRL' NOT NULL,
	"conteudo_descricao" text,
	"quantidade_pecas" integer,
	"service_type" text,
	"special_requests" text[],
	"schedule_at" timestamp,
	"quotation_id_api" text,
	"order_id_api" text,
	"share_link" text,
	"driver_id_api" text,
	"driver_nome" text,
	"driver_telefone" text,
	"driver_placa" text,
	"distancia_metros" integer,
	"price_breakdown" jsonb,
	"last_driver_lat" text,
	"last_driver_lng" text,
	"last_driver_location_at" timestamp,
	"data_solicitacao" timestamp DEFAULT now() NOT NULL,
	"data_coleta" timestamp,
	"data_entrega" timestamp,
	"cancelada_em" timestamp,
	"cancelada_por_id" text,
	"cancelamento_motivo" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confeccao_lalamove_cotacao" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"lalamove_id" text NOT NULL,
	"quotation_id_api" text NOT NULL,
	"status" "confeccao_lalamove_cotacao_status" DEFAULT 'valida' NOT NULL,
	"valor_cotado" real NOT NULL,
	"moeda" text DEFAULT 'BRL' NOT NULL,
	"distancia_metros" integer,
	"service_type" text NOT NULL,
	"stops_api" jsonb NOT NULL,
	"request_payload" jsonb NOT NULL,
	"response_payload" jsonb NOT NULL,
	"expira_em" timestamp NOT NULL,
	"criada_por_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "confeccao_lalamove_cotacao_quotation_id_api_unique" UNIQUE("quotation_id_api")
);
--> statement-breakpoint
CREATE TABLE "confeccao_lalamove_webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"lalamove_id" text,
	"conta_id" text,
	"evento" "confeccao_lalamove_webhook_evento" NOT NULL,
	"order_id_api" text NOT NULL,
	"payload" jsonb NOT NULL,
	"assinatura_header" text,
	"recebido_em" timestamp DEFAULT now() NOT NULL,
	"processado" boolean DEFAULT false NOT NULL,
	"processado_em" timestamp,
	"erro_processamento" text
);
--> statement-breakpoint
CREATE TABLE "confeccao_retirada" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"subtask_costura_id" text NOT NULL,
	"oficina_id" text NOT NULL,
	"numero" text NOT NULL,
	"tipo" "confeccao_retirada_tipo" NOT NULL,
	"pecas_por_tamanho_cor" jsonb NOT NULL,
	"data_retirada" timestamp NOT NULL,
	"cancelada_em" timestamp,
	"cancelada_por_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confeccao_subconferencia" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"subtask_conferencia_id" text NOT NULL,
	"retirada_id" text NOT NULL,
	"numero" text NOT NULL,
	"status" "confeccao_subtask_status" DEFAULT 'em_andamento' NOT NULL,
	"pecas_recebidas" jsonb,
	"divergencia_confirmada" boolean DEFAULT false NOT NULL,
	"oficina_responsavel_divergencia_id" text,
	"quantidade_revelada" boolean DEFAULT false NOT NULL,
	"responsavel_inspecao_id" text,
	"aprovadas" jsonb,
	"reprovadas" jsonb,
	"tipos_defeito" "confeccao_tipo_defeito"[],
	"data_inspecao" timestamp,
	"destino_reprovadas" "confeccao_destino_reprovadas",
	"localizacao_armazem" text,
	"concluida_em" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "confeccao_subconferencia_retirada_id_unique" UNIQUE("retirada_id")
);
--> statement-breakpoint
ALTER TABLE "confeccao_lalamove" ADD CONSTRAINT "confeccao_lalamove_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_lalamove" ADD CONSTRAINT "confeccao_lalamove_subtask_id_confeccao_subtask_id_fk" FOREIGN KEY ("subtask_id") REFERENCES "public"."confeccao_subtask"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_lalamove" ADD CONSTRAINT "confeccao_lalamove_retirada_id_confeccao_retirada_id_fk" FOREIGN KEY ("retirada_id") REFERENCES "public"."confeccao_retirada"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_lalamove" ADD CONSTRAINT "confeccao_lalamove_cancelada_por_id_user_id_fk" FOREIGN KEY ("cancelada_por_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_lalamove_cotacao" ADD CONSTRAINT "confeccao_lalamove_cotacao_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_lalamove_cotacao" ADD CONSTRAINT "confeccao_lalamove_cotacao_lalamove_id_confeccao_lalamove_id_fk" FOREIGN KEY ("lalamove_id") REFERENCES "public"."confeccao_lalamove"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_lalamove_cotacao" ADD CONSTRAINT "confeccao_lalamove_cotacao_criada_por_id_user_id_fk" FOREIGN KEY ("criada_por_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_lalamove_webhook_event" ADD CONSTRAINT "confeccao_lalamove_webhook_event_lalamove_id_confeccao_lalamove_id_fk" FOREIGN KEY ("lalamove_id") REFERENCES "public"."confeccao_lalamove"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_lalamove_webhook_event" ADD CONSTRAINT "confeccao_lalamove_webhook_event_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_retirada" ADD CONSTRAINT "confeccao_retirada_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_retirada" ADD CONSTRAINT "confeccao_retirada_subtask_costura_id_confeccao_subtask_id_fk" FOREIGN KEY ("subtask_costura_id") REFERENCES "public"."confeccao_subtask"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_retirada" ADD CONSTRAINT "confeccao_retirada_oficina_id_confeccao_fornecedor_id_fk" FOREIGN KEY ("oficina_id") REFERENCES "public"."confeccao_fornecedor"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_retirada" ADD CONSTRAINT "confeccao_retirada_cancelada_por_id_user_id_fk" FOREIGN KEY ("cancelada_por_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_subconferencia" ADD CONSTRAINT "confeccao_subconferencia_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_subconferencia" ADD CONSTRAINT "confeccao_subconferencia_subtask_conferencia_id_confeccao_subtask_id_fk" FOREIGN KEY ("subtask_conferencia_id") REFERENCES "public"."confeccao_subtask"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_subconferencia" ADD CONSTRAINT "confeccao_subconferencia_retirada_id_confeccao_retirada_id_fk" FOREIGN KEY ("retirada_id") REFERENCES "public"."confeccao_retirada"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_subconferencia" ADD CONSTRAINT "confeccao_subconferencia_oficina_responsavel_divergencia_id_confeccao_fornecedor_id_fk" FOREIGN KEY ("oficina_responsavel_divergencia_id") REFERENCES "public"."confeccao_fornecedor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_subconferencia" ADD CONSTRAINT "confeccao_subconferencia_responsavel_inspecao_id_user_id_fk" FOREIGN KEY ("responsavel_inspecao_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_confeccao_lalamove_subtask" ON "confeccao_lalamove" USING btree ("subtask_id");--> statement-breakpoint
CREATE INDEX "idx_confeccao_lalamove_retirada" ON "confeccao_lalamove" USING btree ("retirada_id");--> statement-breakpoint
CREATE INDEX "idx_confeccao_lalamove_status" ON "confeccao_lalamove" USING btree ("status");--> statement-breakpoint
-- Índices parciais (Drizzle gera completos; ajustados aqui pra otimizar
-- tamanho e busca em queries específicas).
DROP INDEX IF EXISTS "idx_confeccao_lalamove_order_id_api";--> statement-breakpoint
CREATE INDEX "idx_confeccao_lalamove_order_id_api" ON "confeccao_lalamove" USING btree ("order_id_api") WHERE "order_id_api" IS NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "idx_confeccao_lalamove_procura_alta";--> statement-breakpoint
CREATE INDEX "idx_confeccao_lalamove_procura_alta" ON "confeccao_lalamove" USING btree ("status","data_solicitacao") WHERE "status" = 'procurando_motorista';--> statement-breakpoint
DROP INDEX IF EXISTS "idx_confeccao_lalamove_cotacao_validas";--> statement-breakpoint
CREATE INDEX "idx_confeccao_lalamove_cotacao_validas" ON "confeccao_lalamove_cotacao" USING btree ("lalamove_id","expira_em") WHERE "status" = 'valida';--> statement-breakpoint
DROP INDEX IF EXISTS "idx_confeccao_lalamove_webhook_nao_processados";--> statement-breakpoint
CREATE INDEX "idx_confeccao_lalamove_webhook_nao_processados" ON "confeccao_lalamove_webhook_event" USING btree ("recebido_em") WHERE "processado" = false;--> statement-breakpoint
CREATE INDEX "idx_confeccao_lalamove_webhook_order" ON "confeccao_lalamove_webhook_event" USING btree ("order_id_api");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_confeccao_retirada_numero" ON "confeccao_retirada" USING btree ("numero");--> statement-breakpoint
CREATE INDEX "idx_confeccao_retirada_subtask_costura" ON "confeccao_retirada" USING btree ("subtask_costura_id");--> statement-breakpoint
CREATE INDEX "idx_confeccao_retirada_oficina" ON "confeccao_retirada" USING btree ("oficina_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_confeccao_subconferencia_numero" ON "confeccao_subconferencia" USING btree ("numero");--> statement-breakpoint
CREATE INDEX "idx_confeccao_subconferencia_subtask" ON "confeccao_subconferencia" USING btree ("subtask_conferencia_id");--> statement-breakpoint
ALTER TABLE "confeccao_anexo" ADD CONSTRAINT "confeccao_anexo_lalamove_id_confeccao_lalamove_id_fk" FOREIGN KEY ("lalamove_id") REFERENCES "public"."confeccao_lalamove"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- ============================================================
-- CHECK constraints (Drizzle não gera; adicionados manualmente)
-- ============================================================

-- confeccao_lalamove: pelo menos uma das duas FKs (subtask_id, retirada_id)
ALTER TABLE "confeccao_lalamove" ADD CONSTRAINT "confeccao_lalamove_tem_pai" CHECK ("subtask_id" IS NOT NULL OR "retirada_id" IS NOT NULL);--> statement-breakpoint

-- confeccao_lalamove: modo API exige order_id_api + service_type a partir do momento que pedido é criado
ALTER TABLE "confeccao_lalamove" ADD CONSTRAINT "confeccao_lalamove_api_completo" CHECK (
  origem_solicitacao = 'manual'
  OR status IN ('rascunho', 'cotado')
  OR (order_id_api IS NOT NULL AND service_type IS NOT NULL)
);--> statement-breakpoint

-- ============================================================
-- RLS: Row Level Security para tabelas da RITM-03
-- 4 tabelas com policy padrão + 1 variante (webhook aceita conta_id NULL,
-- mesmo padrão de eventos_webhook_tiktok).
-- ============================================================

ALTER TABLE "confeccao_lalamove" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "confeccao_lalamove" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

ALTER TABLE "confeccao_lalamove_cotacao" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "confeccao_lalamove_cotacao" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

-- Variante IS NULL: receiver insere webhook antes de resolver canal/conta.
-- Resolução acontece por role com bypass; daí o NULL "compatível" com qualquer tenant.
ALTER TABLE "confeccao_lalamove_webhook_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "confeccao_lalamove_webhook_event" USING (conta_id IS NULL OR conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id IS NULL OR conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

ALTER TABLE "confeccao_retirada" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "confeccao_retirada" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

ALTER TABLE "confeccao_subconferencia" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "confeccao_subconferencia" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));