CREATE TABLE "modelo_cor" (
	"id" text PRIMARY KEY NOT NULL,
	"modelo_id" text NOT NULL,
	"codigo" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"conta_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modelo_principal" (
	"id" text PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"conta_id" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"etiqueta_imagem_url" text,
	"etiqueta_imagem_atualizada_em" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modelo_tamanho" (
	"id" text PRIMARY KEY NOT NULL,
	"modelo_id" text NOT NULL,
	"codigo" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"conta_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "modelo_cor" ADD CONSTRAINT "modelo_cor_modelo_id_modelo_principal_id_fk" FOREIGN KEY ("modelo_id") REFERENCES "public"."modelo_principal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modelo_cor" ADD CONSTRAINT "modelo_cor_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modelo_principal" ADD CONSTRAINT "modelo_principal_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modelo_tamanho" ADD CONSTRAINT "modelo_tamanho_modelo_id_modelo_principal_id_fk" FOREIGN KEY ("modelo_id") REFERENCES "public"."modelo_principal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modelo_tamanho" ADD CONSTRAINT "modelo_tamanho_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_modelo_cor_conta" ON "modelo_cor" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_modelo_cor_modelo" ON "modelo_cor" USING btree ("modelo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_modelo_cor_codigo_modelo" ON "modelo_cor" USING btree ("modelo_id","codigo");--> statement-breakpoint
CREATE INDEX "idx_modelo_principal_conta" ON "modelo_principal" USING btree ("conta_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_modelo_principal_codigo_conta" ON "modelo_principal" USING btree ("codigo","conta_id");--> statement-breakpoint
CREATE INDEX "idx_modelo_tamanho_conta" ON "modelo_tamanho" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_modelo_tamanho_modelo" ON "modelo_tamanho" USING btree ("modelo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_modelo_tamanho_codigo_modelo" ON "modelo_tamanho" USING btree ("modelo_id","codigo");