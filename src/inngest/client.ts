// Cliente Inngest compartilhado por todos os módulos. Um único cliente,
// um único endpoint serve em /api/inngest. Eventos são namespaceados por
// módulo no nome (ex.: "central-envios/*", "canais/*", "confeccao/*").
//
// Em dev local: rodar `npm run inngest:dev` num terminal separado.
// Em prod: precisar de INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY no env.

import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "scaleon-erp",
});
