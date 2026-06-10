CREATE TABLE "analise_pedidos_import" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"importado_por" text NOT NULL,
	"nome_arquivo" text NOT NULL,
	"tamanho_arquivo" integer DEFAULT 0 NOT NULL,
	"periodo_min" timestamp with time zone NOT NULL,
	"periodo_max" timestamp with time zone NOT NULL,
	"total_linhas" integer NOT NULL,
	"estados_distintos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"avisos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"linhas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"importado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analise_pedidos_import" ADD CONSTRAINT "analise_pedidos_import_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analise_pedidos_import" ADD CONSTRAINT "analise_pedidos_import_importado_por_user_id_fk" FOREIGN KEY ("importado_por") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_analise_pedidos_import_conta" ON "analise_pedidos_import" USING btree ("conta_id");