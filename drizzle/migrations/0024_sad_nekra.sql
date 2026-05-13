CREATE TYPE "public"."confeccao_op_status" AS ENUM('em_andamento', 'concluida', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."confeccao_subtask_prefixo" AS ENUM('OPBUY', 'OPRIS', 'OPCOR', 'OPVIE', 'OPSEW', 'OPCONF');--> statement-breakpoint
CREATE TYPE "public"."confeccao_subtask_status" AS ENUM('bloqueada', 'pendente', 'em_andamento', 'concluida', 'cancelada');--> statement-breakpoint
CREATE TABLE "confeccao_anexo" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"subtask_id" text,
	"ordem_producao_id" text,
	"lalamove_id" text,
	"categoria" text NOT NULL,
	"nome_arquivo" text NOT NULL,
	"tipo_mime" text NOT NULL,
	"tamanho_bytes" integer NOT NULL,
	"blob_url" text NOT NULL,
	"blob_pathname" text NOT NULL,
	"enviado_por_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "confeccao_anexo_blob_url_unique" UNIQUE("blob_url")
);
--> statement-breakpoint
CREATE TABLE "confeccao_nota" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"ordem_producao_id" text,
	"subtask_id" text,
	"autor_id" text,
	"conteudo" text NOT NULL,
	"is_auditoria" boolean DEFAULT false NOT NULL,
	"is_interna" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confeccao_ordem_producao" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"numero" text NOT NULL,
	"sequencial_global" integer NOT NULL,
	"produto_id" text NOT NULL,
	"tem_vies" boolean DEFAULT false NOT NULL,
	"status" "confeccao_op_status" DEFAULT 'em_andamento' NOT NULL,
	"criada_por_id" text NOT NULL,
	"atribuido_a_id" text NOT NULL,
	"observacoes" text,
	"cancelada_em" timestamp,
	"cancelada_por_id" text,
	"cancelamento_autorizado_por_id" text,
	"cancelamento_justificativa" text,
	"concluida_em" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confeccao_subtask" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"ordem_producao_id" text NOT NULL,
	"numero" text NOT NULL,
	"id_interno" text NOT NULL,
	"prefixo" "confeccao_subtask_prefixo" NOT NULL,
	"ordem_sequencial" integer NOT NULL,
	"status" "confeccao_subtask_status" DEFAULT 'bloqueada' NOT NULL,
	"atribuido_a_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"valor_servico" real,
	"iniciada_em" timestamp,
	"concluida_em" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confeccao_anexo" ADD CONSTRAINT "confeccao_anexo_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_anexo" ADD CONSTRAINT "confeccao_anexo_subtask_id_confeccao_subtask_id_fk" FOREIGN KEY ("subtask_id") REFERENCES "public"."confeccao_subtask"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_anexo" ADD CONSTRAINT "confeccao_anexo_ordem_producao_id_confeccao_ordem_producao_id_fk" FOREIGN KEY ("ordem_producao_id") REFERENCES "public"."confeccao_ordem_producao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_anexo" ADD CONSTRAINT "confeccao_anexo_enviado_por_id_user_id_fk" FOREIGN KEY ("enviado_por_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_nota" ADD CONSTRAINT "confeccao_nota_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_nota" ADD CONSTRAINT "confeccao_nota_ordem_producao_id_confeccao_ordem_producao_id_fk" FOREIGN KEY ("ordem_producao_id") REFERENCES "public"."confeccao_ordem_producao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_nota" ADD CONSTRAINT "confeccao_nota_subtask_id_confeccao_subtask_id_fk" FOREIGN KEY ("subtask_id") REFERENCES "public"."confeccao_subtask"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_nota" ADD CONSTRAINT "confeccao_nota_autor_id_user_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_ordem_producao" ADD CONSTRAINT "confeccao_ordem_producao_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_ordem_producao" ADD CONSTRAINT "confeccao_ordem_producao_produto_id_confeccao_produto_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."confeccao_produto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_ordem_producao" ADD CONSTRAINT "confeccao_ordem_producao_criada_por_id_user_id_fk" FOREIGN KEY ("criada_por_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_ordem_producao" ADD CONSTRAINT "confeccao_ordem_producao_atribuido_a_id_user_id_fk" FOREIGN KEY ("atribuido_a_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_ordem_producao" ADD CONSTRAINT "confeccao_ordem_producao_cancelada_por_id_user_id_fk" FOREIGN KEY ("cancelada_por_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_ordem_producao" ADD CONSTRAINT "confeccao_ordem_producao_cancelamento_autorizado_por_id_user_id_fk" FOREIGN KEY ("cancelamento_autorizado_por_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_subtask" ADD CONSTRAINT "confeccao_subtask_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_subtask" ADD CONSTRAINT "confeccao_subtask_ordem_producao_id_confeccao_ordem_producao_id_fk" FOREIGN KEY ("ordem_producao_id") REFERENCES "public"."confeccao_ordem_producao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_subtask" ADD CONSTRAINT "confeccao_subtask_atribuido_a_id_user_id_fk" FOREIGN KEY ("atribuido_a_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_confeccao_anexo_subtask" ON "confeccao_anexo" USING btree ("subtask_id");--> statement-breakpoint
CREATE INDEX "idx_confeccao_anexo_op" ON "confeccao_anexo" USING btree ("ordem_producao_id");--> statement-breakpoint
CREATE INDEX "idx_confeccao_anexo_lalamove" ON "confeccao_anexo" USING btree ("lalamove_id");--> statement-breakpoint
CREATE INDEX "idx_confeccao_anexo_categoria" ON "confeccao_anexo" USING btree ("categoria");--> statement-breakpoint
CREATE INDEX "idx_confeccao_nota_op_data" ON "confeccao_nota" USING btree ("ordem_producao_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_confeccao_nota_subtask_data" ON "confeccao_nota" USING btree ("subtask_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_confeccao_nota_auditoria" ON "confeccao_nota" USING btree ("is_auditoria","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_confeccao_op_numero" ON "confeccao_ordem_producao" USING btree ("numero");--> statement-breakpoint
CREATE INDEX "idx_confeccao_op_conta_status" ON "confeccao_ordem_producao" USING btree ("conta_id","status");--> statement-breakpoint
CREATE INDEX "idx_confeccao_op_atribuido" ON "confeccao_ordem_producao" USING btree ("atribuido_a_id");--> statement-breakpoint
CREATE INDEX "idx_confeccao_op_produto" ON "confeccao_ordem_producao" USING btree ("produto_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_confeccao_subtask_id_interno" ON "confeccao_subtask" USING btree ("id_interno");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_confeccao_subtask_op_prefixo" ON "confeccao_subtask" USING btree ("ordem_producao_id","prefixo");--> statement-breakpoint
CREATE INDEX "idx_confeccao_subtask_status" ON "confeccao_subtask" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_confeccao_subtask_atribuido" ON "confeccao_subtask" USING btree ("atribuido_a_id");--> statement-breakpoint

-- ============================================================
-- Sequence dedicada para numeração de OP (RITM-02)
-- Sequencial global (não por conta), contínuo de 0000-9999 com CYCLE.
-- Usado pelo helper src/lib/confeccao/numeracao.ts via nextval().
-- MOD(nextval(...), 10000) garante range mesmo se CYCLE tiver ressalvas.
-- ============================================================
CREATE SEQUENCE "confeccao_op_sequencial" START 1 MINVALUE 0 MAXVALUE 9999 CYCLE;--> statement-breakpoint

-- ============================================================
-- CHECK constraints (Drizzle não gera; adicionados manualmente)
-- ============================================================

-- confeccao_anexo: pelo menos uma FK preenchida + tamanho ≤ 50MB
ALTER TABLE "confeccao_anexo" ADD CONSTRAINT "confeccao_anexo_tem_pai" CHECK ("subtask_id" IS NOT NULL OR "ordem_producao_id" IS NOT NULL OR "lalamove_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "confeccao_anexo" ADD CONSTRAINT "confeccao_anexo_tamanho_max_50mb" CHECK ("tamanho_bytes" <= 52428800);--> statement-breakpoint

-- confeccao_nota: pelo menos uma FK preenchida
ALTER TABLE "confeccao_nota" ADD CONSTRAINT "confeccao_nota_tem_pai" CHECK ("ordem_producao_id" IS NOT NULL OR "subtask_id" IS NOT NULL);--> statement-breakpoint

-- ============================================================
-- RLS: Row Level Security para tabelas da RITM-02
-- Padrão do projeto (ENABLE sem FORCE, tenant_isolation USING+WITH CHECK).
-- ============================================================

ALTER TABLE "confeccao_ordem_producao" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "confeccao_ordem_producao" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

ALTER TABLE "confeccao_subtask" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "confeccao_subtask" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

ALTER TABLE "confeccao_nota" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "confeccao_nota" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

ALTER TABLE "confeccao_anexo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "confeccao_anexo" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));