// Endpoint serve do Inngest. Registra TODAS as Inngest functions do app
// (de todos os módulos) e responde a:
//   - GET:  introspecção (Inngest Cloud verifica o app aqui)
//   - POST: execução de uma function (chamada pelo Inngest)
//   - PUT:  sync manual via dashboard
//
// Em dev local, o Inngest dev server (npm run inngest:dev) chama esse
// endpoint em http://localhost:3009/api/inngest. Em prod, Inngest Cloud
// usa o NEXT_PUBLIC_APP_URL.

import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
