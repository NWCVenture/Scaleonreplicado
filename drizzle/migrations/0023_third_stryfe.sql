CREATE TYPE "public"."confeccao_fornecedor_categoria" AS ENUM('risco', 'tecido', 'corte', 'costura', 'vies');--> statement-breakpoint
CREATE TABLE "confeccao_cor" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"nome" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confeccao_fornecedor" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"nome" text NOT NULL,
	"categorias" "confeccao_fornecedor_categoria"[] NOT NULL,
	"whatsapp" text NOT NULL,
	"telefone_e164" text,
	"endereco_rua" text NOT NULL,
	"endereco_numero" text NOT NULL,
	"endereco_complemento" text,
	"endereco_bairro" text NOT NULL,
	"endereco_cep" text NOT NULL,
	"endereco_cidade" text NOT NULL,
	"endereco_estado" text NOT NULL,
	"latitude" text,
	"longitude" text,
	"contato_nome" text,
	"observacoes" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confeccao_fornecedor_tecido_preco" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"fornecedor_id" text NOT NULL,
	"tipo_tecido_id" text NOT NULL,
	"preco_kg_sugerido" real NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confeccao_produto" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confeccao_tipo_tecido" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"nome" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confeccao_cor" ADD CONSTRAINT "confeccao_cor_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_fornecedor" ADD CONSTRAINT "confeccao_fornecedor_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_fornecedor_tecido_preco" ADD CONSTRAINT "confeccao_fornecedor_tecido_preco_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_fornecedor_tecido_preco" ADD CONSTRAINT "confeccao_fornecedor_tecido_preco_fornecedor_id_confeccao_fornecedor_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."confeccao_fornecedor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_fornecedor_tecido_preco" ADD CONSTRAINT "confeccao_fornecedor_tecido_preco_tipo_tecido_id_confeccao_tipo_tecido_id_fk" FOREIGN KEY ("tipo_tecido_id") REFERENCES "public"."confeccao_tipo_tecido"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_produto" ADD CONSTRAINT "confeccao_produto_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confeccao_tipo_tecido" ADD CONSTRAINT "confeccao_tipo_tecido_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_confeccao_cor_conta" ON "confeccao_cor" USING btree ("conta_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_confeccao_cor_nome_conta" ON "confeccao_cor" USING btree ("conta_id","nome");--> statement-breakpoint
CREATE INDEX "idx_confeccao_fornecedor_conta" ON "confeccao_fornecedor" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_confeccao_fornecedor_categorias" ON "confeccao_fornecedor" USING gin ("categorias");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_confeccao_fornecedor_tecido_preco" ON "confeccao_fornecedor_tecido_preco" USING btree ("fornecedor_id","tipo_tecido_id");--> statement-breakpoint
CREATE INDEX "idx_confeccao_fornecedor_tecido_preco_conta" ON "confeccao_fornecedor_tecido_preco" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_confeccao_produto_conta" ON "confeccao_produto" USING btree ("conta_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_confeccao_produto_nome_conta" ON "confeccao_produto" USING btree ("conta_id","nome");--> statement-breakpoint
CREATE INDEX "idx_confeccao_tipo_tecido_conta" ON "confeccao_tipo_tecido" USING btree ("conta_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_confeccao_tipo_tecido_nome_conta" ON "confeccao_tipo_tecido" USING btree ("conta_id","nome");--> statement-breakpoint

-- ============================================================
-- RLS: Row Level Security para tabelas do módulo Confecção (RITM-01)
-- Padrão do projeto (ver 0014_nappy_ben_parker.sql):
--  - ENABLE sem FORCE: owner bypassa (compatível com neondb_owner em prod e
--    postgres superuser em dev). Policies ficam armadas pra role dedicado.
--  - USING + WITH CHECK em `conta_id = current_setting('app.conta_atual')`.
--  - `withConta`/`withContaAtiva` em src/lib/tenancy.ts seta a var em transação.
-- ============================================================

ALTER TABLE "confeccao_produto" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "confeccao_produto" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

ALTER TABLE "confeccao_fornecedor" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "confeccao_fornecedor" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

ALTER TABLE "confeccao_tipo_tecido" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "confeccao_tipo_tecido" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

ALTER TABLE "confeccao_cor" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "confeccao_cor" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));--> statement-breakpoint

ALTER TABLE "confeccao_fornecedor_tecido_preco" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "confeccao_fornecedor_tecido_preco" USING (conta_id = current_setting('app.conta_atual', true)) WITH CHECK (conta_id = current_setting('app.conta_atual', true));