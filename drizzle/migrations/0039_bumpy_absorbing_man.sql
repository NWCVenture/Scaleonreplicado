DROP INDEX "uq_estante_fardo_uuid_conta";--> statement-breakpoint
DROP INDEX "uq_estante_fardo_codigo_conta";--> statement-breakpoint
ALTER TABLE "estante_fardo" ADD COLUMN "duplicado_autorizado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "estante_movimentacao" ADD COLUMN "duplicado_autorizado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_estante_fardo_uuid_conta" ON "estante_fardo" USING btree ("conta_id","fardo_uuid") WHERE fardo_uuid IS NOT NULL AND duplicado_autorizado = false;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_estante_fardo_codigo_conta" ON "estante_fardo" USING btree ("conta_id","codigo_fardo") WHERE codigo_fardo IS NOT NULL AND duplicado_autorizado = false;