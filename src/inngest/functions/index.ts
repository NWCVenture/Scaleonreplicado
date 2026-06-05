// Registro central de Inngest functions. Cada módulo adiciona suas
// functions aqui. O serve handler em /api/inngest registra esse array
// no Inngest Cloud automaticamente.
//
// Convenção de nomenclatura:
//   - Pasta por módulo: central-envios/, canais/, confeccao/
//   - Eventos: "<modulo>/<acao>.<estado>" (ex.: "central-envios/parsear-tiktok.solicitado")

import { parsearTikTokFunction } from "./central-envios/parsear-tiktok";

export const functions = [parsearTikTokFunction];
