CREATE TYPE "public"."central_envios_bipagem_categoria" AS ENUM('OK', 'DUPLICADO', 'CANCELADO_RETIRADO', 'CANCELADO_ENVIADO_MESMO_ASSIM', 'FORA_LOTE', 'DESCONHECIDA', 'LOCALIZADOR_ACHADO', 'LOCALIZADOR_LIVRE');--> statement-breakpoint
CREATE TYPE "public"."central_envios_notificacao_tipo" AS ENUM('DUPLICACAO_CROSS_SESSAO', 'CANCELAMENTO_RETROATIVO');--> statement-breakpoint
CREATE TABLE "central_envios_bipagem_pacote" (
	"id" text PRIMARY KEY NOT NULL,
	"sessao_id" text NOT NULL,
	"bipado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"codigo_bipado" text NOT NULL,
	"tracking_id" text,
	"order_id" text,
	"canal" text,
	"canal_venda_id" text,
	"categoria" "central_envios_bipagem_categoria" NOT NULL,
	"transportadora" "transportadora_label",
	"acao_cancelado" text,
	"usuario_id" text NOT NULL,
	"conta_id" text DEFAULT 'nwc-root' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "central_envios_notificacao" (
	"id" text PRIMARY KEY NOT NULL,
	"sessao_destino_id" text NOT NULL,
	"tipo" "central_envios_notificacao_tipo" NOT NULL,
	"payload" jsonb NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"lida_em" timestamp with time zone,
	"conta_id" text DEFAULT 'nwc-root' NOT NULL
);
--> statement-breakpoint
DROP INDEX "uq_sessao_ce_ativa_por_usuario";--> statement-breakpoint
ALTER TABLE "central_envios_bipagem_pacote" ADD CONSTRAINT "central_envios_bipagem_pacote_sessao_id_sessao_central_envios_id_fk" FOREIGN KEY ("sessao_id") REFERENCES "public"."sessao_central_envios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "central_envios_bipagem_pacote" ADD CONSTRAINT "central_envios_bipagem_pacote_usuario_id_user_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "central_envios_bipagem_pacote" ADD CONSTRAINT "central_envios_bipagem_pacote_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "central_envios_notificacao" ADD CONSTRAINT "central_envios_notificacao_sessao_destino_id_sessao_central_envios_id_fk" FOREIGN KEY ("sessao_destino_id") REFERENCES "public"."sessao_central_envios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "central_envios_notificacao" ADD CONSTRAINT "central_envios_notificacao_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ce_bipagem_sessao" ON "central_envios_bipagem_pacote" USING btree ("sessao_id");--> statement-breakpoint
CREATE INDEX "idx_ce_bipagem_categoria" ON "central_envios_bipagem_pacote" USING btree ("sessao_id","categoria");--> statement-breakpoint
CREATE INDEX "idx_ce_bipagem_dedup_global" ON "central_envios_bipagem_pacote" USING btree ("conta_id","tracking_id","bipado_em" DESC NULLS LAST) WHERE tracking_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_ce_bipagem_conta" ON "central_envios_bipagem_pacote" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_ce_notif_sessao_pendentes" ON "central_envios_notificacao" USING btree ("sessao_destino_id","criada_em" DESC NULLS LAST) WHERE lida_em IS NULL;--> statement-breakpoint
CREATE INDEX "idx_ce_notif_conta" ON "central_envios_notificacao" USING btree ("conta_id");--> statement-breakpoint
CREATE INDEX "idx_sessao_ce_ativas_conta" ON "sessao_central_envios" USING btree ("conta_id","status","iniciou_em" DESC NULLS LAST);