CREATE TABLE "cor_catalogo" (
	"id" text PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"conta_id" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tamanho_catalogo" (
	"id" text PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"conta_id" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cor_catalogo" ADD CONSTRAINT "cor_catalogo_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tamanho_catalogo" ADD CONSTRAINT "tamanho_catalogo_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cor_catalogo_conta" ON "cor_catalogo" USING btree ("conta_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cor_catalogo_codigo_conta" ON "cor_catalogo" USING btree ("codigo","conta_id");--> statement-breakpoint
CREATE INDEX "idx_tamanho_catalogo_conta" ON "tamanho_catalogo" USING btree ("conta_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tamanho_catalogo_codigo_conta" ON "tamanho_catalogo" USING btree ("codigo","conta_id");