CREATE TABLE "historico_impressao_etiquetas" (
	"id" text PRIMARY KEY NOT NULL,
	"conta_id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"blob_url" text NOT NULL,
	"file_name" text NOT NULL,
	"group_label" text NOT NULL,
	"subgroup_ids" text[] DEFAULT '{}' NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"cleaned_up" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "historico_impressao_etiquetas" ADD CONSTRAINT "historico_impressao_etiquetas_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historico_impressao_etiquetas" ADD CONSTRAINT "historico_impressao_etiquetas_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_hist_impressao_conta" ON "historico_impressao_etiquetas" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_hist_impressao_expires" ON "historico_impressao_etiquetas" USING btree ("expires_at");