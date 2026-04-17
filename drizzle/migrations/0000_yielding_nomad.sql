CREATE TYPE "public"."conta_operacao" AS ENUM('TIKTOK_SHOP', 'MERCADO_LIVRE', 'SHOPEE');--> statement-breakpoint
CREATE TYPE "public"."localizacao_avaria" AS ENUM('DEVOLUCAO', 'ESTANTE', 'LOTE_DE_COSTURA');--> statement-breakpoint
CREATE TYPE "public"."tipo_coleta" AS ENUM('FLEX', 'COLETA', 'DEVOLUCAO', 'CANCELADO');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimentacao" AS ENUM('ENTRADA', 'SAIDA', 'BIPAGEM_SEMANAL', 'IMPORTACAO', 'BALANCO');--> statement-breakpoint
CREATE TYPE "public"."transportadora_label" AS ENUM('TTK_JDLOG', 'TTK_IMILE', 'ML', 'SHP', 'DESCONHECIDA');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'funcionario');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alteracao_estoque" (
	"id" text PRIMARY KEY NOT NULL,
	"saidas" json NOT NULL,
	"entradas" json NOT NULL,
	"codigo_pacote" text,
	"usuario_id" text,
	"revisado" boolean DEFAULT false NOT NULL,
	"revisado_por" text,
	"revisado_em" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coleta_bipagem" (
	"id" text PRIMARY KEY NOT NULL,
	"tipo" "tipo_coleta" NOT NULL,
	"conta" "conta_operacao" NOT NULL,
	"total" integer NOT NULL,
	"revisado" boolean DEFAULT false NOT NULL,
	"revisado_por" text,
	"revisado_em" timestamp,
	"usuario_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coleta_bipagem_pacote" (
	"id" text PRIMARY KEY NOT NULL,
	"bipagem_id" text NOT NULL,
	"codigo" text NOT NULL,
	"transportadora" "transportadora_label"
);
--> statement-breakpoint
CREATE TABLE "coleta_bipagem_temporaria" (
	"id" text PRIMARY KEY NOT NULL,
	"tipo" "tipo_coleta" NOT NULL,
	"conta" "conta_operacao" NOT NULL,
	"total" integer NOT NULL,
	"dados" json NOT NULL,
	"usuario_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coleta_devolucao" (
	"id" text PRIMARY KEY NOT NULL,
	"pacote_id" text NOT NULL,
	"operacao" "conta_operacao" NOT NULL,
	"avaria" boolean DEFAULT false NOT NULL,
	"observacao" text,
	"tipo" "tipo_coleta" NOT NULL,
	"foto_pacote_url" text,
	"foto_avaria_url" text
);
--> statement-breakpoint
CREATE TABLE "coleta_devolucao_sku" (
	"id" text PRIMARY KEY NOT NULL,
	"devolucao_id" text NOT NULL,
	"sku" text NOT NULL,
	"quantidade" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contagem_bipagem" (
	"id" text PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"lote" text NOT NULL,
	"quantidade" integer NOT NULL,
	"raw" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contagem_embalado" (
	"id" text PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"quantidade" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contagem_manuseavel" (
	"id" text PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"quantidade" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estante" (
	"id" text PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"ultima_bipagem" timestamp,
	"ultima_bipagem_por" text,
	"usuario_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estante_fardo" (
	"id" text PRIMARY KEY NOT NULL,
	"estante_id" text NOT NULL,
	"qr_code" text NOT NULL,
	"sku" text NOT NULL,
	"lote" text NOT NULL,
	"quantidade" integer NOT NULL,
	"adicionado_por" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estante_movimentacao" (
	"id" text PRIMARY KEY NOT NULL,
	"estante_id" text NOT NULL,
	"estante_nome" text NOT NULL,
	"tipo" "tipo_movimentacao" NOT NULL,
	"fardo_sku" text,
	"fardo_lote" text,
	"fardo_quantidade" integer,
	"total_antes" integer NOT NULL,
	"total_depois" integer NOT NULL,
	"total_pecas" integer,
	"usuario_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "etiqueta_associacao" (
	"id" text PRIMARY KEY NOT NULL,
	"etiqueta" text NOT NULL,
	"sku" text NOT NULL,
	"quantidade" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lote_cadastrado" (
	"id" text PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lote_cadastrado_nome_unique" UNIQUE("nome")
);
--> statement-breakpoint
CREATE TABLE "produto_avariado" (
	"id" text PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"avaria" text NOT NULL,
	"localizacao" "localizacao_avaria" NOT NULL,
	"codigo_fardo" text,
	"usuario_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sku_catalogo" (
	"id" text PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sku_catalogo_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "sku_kit_componente" (
	"id" text PRIMARY KEY NOT NULL,
	"kit_regra_id" text NOT NULL,
	"sku" text NOT NULL,
	"quantidade" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sku_kit_regra" (
	"id" text PRIMARY KEY NOT NULL,
	"kit_sku" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_item" (
	"id" text PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"lote" text NOT NULL,
	"quantidade" integer NOT NULL,
	"usuario_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "textil_lote" (
	"id" text PRIMARY KEY NOT NULL,
	"nome_lote" text NOT NULL,
	"peso_rolo_kg" real NOT NULL,
	"metragem_rolo_metros" real NOT NULL,
	"custo_total_rolo" real NOT NULL,
	"area_risco_m2" real NOT NULL,
	"aproveitamento_risco_percentual" real NOT NULL,
	"pecas_geradas_risco" integer NOT NULL,
	"custo_total_corte" real NOT NULL,
	"quantidade_pecas_cortadas" integer NOT NULL,
	"custo_total_costura" real NOT NULL,
	"quantidade_pecas_boas_costura" integer NOT NULL,
	"custo_total_aviamentos" real NOT NULL,
	"margem_lucro_percentual" real NOT NULL,
	"resultados" json NOT NULL,
	"usuario_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transportadora_padrao" (
	"id" text PRIMARY KEY NOT NULL,
	"transportadora" text NOT NULL,
	"prefixos" json DEFAULT '[]'::json NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'funcionario' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alteracao_estoque" ADD CONSTRAINT "alteracao_estoque_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alteracao_estoque" ADD CONSTRAINT "alteracao_estoque_revisado_por_user_id_fk" FOREIGN KEY ("revisado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coleta_bipagem" ADD CONSTRAINT "coleta_bipagem_revisado_por_user_id_fk" FOREIGN KEY ("revisado_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coleta_bipagem" ADD CONSTRAINT "coleta_bipagem_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coleta_bipagem_pacote" ADD CONSTRAINT "coleta_bipagem_pacote_bipagem_id_coleta_bipagem_id_fk" FOREIGN KEY ("bipagem_id") REFERENCES "public"."coleta_bipagem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coleta_bipagem_temporaria" ADD CONSTRAINT "coleta_bipagem_temporaria_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coleta_devolucao" ADD CONSTRAINT "coleta_devolucao_pacote_id_coleta_bipagem_pacote_id_fk" FOREIGN KEY ("pacote_id") REFERENCES "public"."coleta_bipagem_pacote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coleta_devolucao_sku" ADD CONSTRAINT "coleta_devolucao_sku_devolucao_id_coleta_devolucao_id_fk" FOREIGN KEY ("devolucao_id") REFERENCES "public"."coleta_devolucao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estante" ADD CONSTRAINT "estante_ultima_bipagem_por_user_id_fk" FOREIGN KEY ("ultima_bipagem_por") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estante" ADD CONSTRAINT "estante_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estante_fardo" ADD CONSTRAINT "estante_fardo_estante_id_estante_id_fk" FOREIGN KEY ("estante_id") REFERENCES "public"."estante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estante_fardo" ADD CONSTRAINT "estante_fardo_adicionado_por_user_id_fk" FOREIGN KEY ("adicionado_por") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estante_movimentacao" ADD CONSTRAINT "estante_movimentacao_estante_id_estante_id_fk" FOREIGN KEY ("estante_id") REFERENCES "public"."estante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estante_movimentacao" ADD CONSTRAINT "estante_movimentacao_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produto_avariado" ADD CONSTRAINT "produto_avariado_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_kit_componente" ADD CONSTRAINT "sku_kit_componente_kit_regra_id_sku_kit_regra_id_fk" FOREIGN KEY ("kit_regra_id") REFERENCES "public"."sku_kit_regra"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textil_lote" ADD CONSTRAINT "textil_lote_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_alteracao_revisado" ON "alteracao_estoque" USING btree ("revisado");--> statement-breakpoint
CREATE INDEX "idx_alteracao_created_at" ON "alteracao_estoque" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_coleta_bipagem_tipo" ON "coleta_bipagem" USING btree ("tipo");--> statement-breakpoint
CREATE INDEX "idx_coleta_bipagem_conta" ON "coleta_bipagem" USING btree ("conta");--> statement-breakpoint
CREATE INDEX "idx_coleta_bipagem_revisado" ON "coleta_bipagem" USING btree ("revisado");--> statement-breakpoint
CREATE INDEX "idx_coleta_bipagem_created_at" ON "coleta_bipagem" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_coleta_bipagem_usuario" ON "coleta_bipagem" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "idx_coleta_pacote_bipagem" ON "coleta_bipagem_pacote" USING btree ("bipagem_id");--> statement-breakpoint
CREATE INDEX "idx_contagem_bipagem_sku" ON "contagem_bipagem" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "idx_estante_fardo_estante" ON "estante_fardo" USING btree ("estante_id");--> statement-breakpoint
CREATE INDEX "idx_estante_fardo_sku" ON "estante_fardo" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "idx_estante_mov_estante" ON "estante_movimentacao" USING btree ("estante_id");--> statement-breakpoint
CREATE INDEX "idx_estante_mov_tipo" ON "estante_movimentacao" USING btree ("tipo");--> statement-breakpoint
CREATE INDEX "idx_estante_mov_created_at" ON "estante_movimentacao" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_etiqueta_etiqueta" ON "etiqueta_associacao" USING btree ("etiqueta");--> statement-breakpoint
CREATE INDEX "idx_avariado_sku" ON "produto_avariado" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "idx_avariado_localizacao" ON "produto_avariado" USING btree ("localizacao");--> statement-breakpoint
CREATE INDEX "idx_avariado_created_at" ON "produto_avariado" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_stock_item_sku" ON "stock_item" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "idx_stock_item_created_at" ON "stock_item" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_textil_created_at" ON "textil_lote" USING btree ("created_at");