# RITM-05 — CRUD de cadastros do módulo (API + UI)

> **Bloqueia:** RITM-06, RITM-08–13 (qualquer subtask que tenha lookup de fornecedor/tecido/cor)
> **Depende de:** RITM-01 (tabelas dos cadastros)
> **Dependência externa:** API de geocoding (Nominatim grátis com rate limit, ou OpenCage/Mapbox tier free)

---

## Objetivo

Implementar telas + endpoints CRUD pra os 4 cadastros do módulo:

1. **Produtos da confecção** (`confeccao_produto`)
2. **Fornecedores** (`confeccao_fornecedor`) — com geocoding background
3. **Tipos de tecido** (`confeccao_tipo_tecido`) — cadastro simples
4. **Cores** (`confeccao_cor`) — cadastro simples

Mais um **componente reutilizável de cadastro inline** que vai ser usado nas subtasks (ex: "+ Novo tipo de tecido" direto no fluxo da Compra).

---

## Arquivos a criar/modificar

### API

- `src/app/api/confeccao/produtos/route.ts` — GET (list) + POST (create)
- `src/app/api/confeccao/produtos/[id]/route.ts` — GET, PATCH, DELETE
- `src/app/api/confeccao/fornecedores/route.ts`
- `src/app/api/confeccao/fornecedores/[id]/route.ts`
- `src/app/api/confeccao/fornecedores/[id]/geocode/route.ts` — POST re-geocode manual
- `src/app/api/confeccao/tipos-tecido/route.ts`
- `src/app/api/confeccao/tipos-tecido/[id]/route.ts`
- `src/app/api/confeccao/cores/route.ts`
- `src/app/api/confeccao/cores/[id]/route.ts`
- `src/app/api/confeccao/fornecedores/[id]/precos/route.ts` — CRUD de `confeccao_fornecedor_tecido_preco`

### UI

- `src/app/(dashboard)/confeccao/cadastros/page.tsx` — landing dos cadastros (tabs)
- `src/app/(dashboard)/confeccao/cadastros/produtos/page.tsx`
- `src/app/(dashboard)/confeccao/cadastros/fornecedores/page.tsx`
- `src/app/(dashboard)/confeccao/cadastros/fornecedores/[id]/page.tsx` — detalhe + precos
- `src/app/(dashboard)/confeccao/cadastros/tipos-tecido/page.tsx`
- `src/app/(dashboard)/confeccao/cadastros/cores/page.tsx`

### Componentes reutilizáveis

- `src/components/confeccao/lookup-com-cadastro-inline.tsx` — Combobox + botão "+ Novo" que abre modal

### Geocoding

- `src/lib/confeccao/geocoding.ts` — wrapper de Nominatim (ou outro provedor)
- `src/lib/confeccao/__tests__/geocoding.test.ts`

---

## Validação Zod (compartilhada entre API e UI)

`src/lib/confeccao/schemas/cadastros.ts`:

```ts
import { z } from "zod";

export const ConfeccaoFornecedorCategoriaSchema = z.enum([
  "risco", "tecido", "corte", "costura", "vies",
]);

export const CriarProdutoSchema = z.object({
  nome: z.string().min(2).max(120),
  descricao: z.string().max(500).optional(),
});

export const CriarFornecedorSchema = z.object({
  nome: z.string().min(2).max(120),
  categorias: z.array(ConfeccaoFornecedorCategoriaSchema).min(1),
  whatsapp: z.string().min(10).max(30),
  telefoneE164: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),
  enderecoRua: z.string().min(2),
  enderecoNumero: z.string().min(1),
  enderecoComplemento: z.string().optional(),
  enderecoBairro: z.string().min(2),
  enderecoCep: z.string().regex(/^\d{5}-?\d{3}$/),  // CEP brasileiro
  enderecoCidade: z.string().min(2),
  enderecoEstado: z.string().length(2),
  contatoNome: z.string().max(120).optional(),
  observacoes: z.string().max(1000).optional(),
});

export const CriarTipoTecidoSchema = z.object({
  nome: z.string().min(2).max(60),
});

export const CriarCorSchema = z.object({
  nome: z.string().min(2).max(40),
});

export const CriarFornecedorTecidoPrecoSchema = z.object({
  fornecedorId: z.string().min(1),
  tipoTecidoId: z.string().min(1),
  precoKgSugerido: z.number().positive(),
});
```

---

## Endpoints — comportamento padrão

### Autenticação e autorização

- Todos exigem sessão ativa
- Mutations (POST/PATCH/DELETE) exigem `role = 'admin'` na conta
- GETs aceitam qualquer `role` da conta (leitura)
- RLS isola por `conta_id` automaticamente (já configurado no schema)

### Padrão de response

```ts
// GET list
{
  "items": [...],
  "total": 42
}

// GET single, POST, PATCH
{
  "item": { ... }
}

// DELETE
{
  "deleted": true
}
```

### Paginação

- `?page=1&pageSize=20` nos GETs de lista
- `?search=...` filtro por nome (case-insensitive `ILIKE`)
- `?categoria=tecido` (apenas em `/fornecedores`) — filtra por categoria

### Soft delete vs hard delete

- **Default:** soft delete via `ativo = false` (preserva integridade referencial com OPs antigas)
- **Hard delete:** apenas pra admin via flag `?hard=true` E somente se não houver referências em OPs

---

## Geocoding (fornecedores)

`src/lib/confeccao/geocoding.ts`:

```ts
export interface GeocodingInput {
  rua: string;
  numero: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
}

export interface GeocodingResult {
  latitude: string;
  longitude: string;
  precisao: "exato" | "aproximado" | "cidade";
}

export async function geocodificarEndereco(
  input: GeocodingInput,
): Promise<GeocodingResult | null>;
```

### Provedor

**Default: Nominatim (OpenStreetMap, grátis).** Endpoint: `https://nominatim.openstreetmap.org/search`.

**Rate limit:** 1 req/segundo. Implementar limiter local (in-memory ou via Inngest/queue).

**Fallback:** se Nominatim falhar 3x, marcar `latitude/longitude` como `NULL` e gerar nota interna avisando admin pra geocodar manualmente.

> Migrar pra OpenCage/Mapbox/Google quando volume justificar — ponto de reabertura.

### Quando rodar

- **Background, não síncrono.** Salvar fornecedor primeiro com `latitude/longitude = NULL`, retornar 201 imediato. Job assíncrono (cron rápido, ou disparado por trigger no save) atualiza depois.
- **Re-geocode manual** disponível na ficha do fornecedor (botão "Atualizar coordenadas") via endpoint `POST /api/confeccao/fornecedores/[id]/geocode`.

### Cache

- Mesma combinação de endereço (hash do payload normalizado) não chama o serviço duas vezes em 24h
- Cache em memória ou Redis se já existir no projeto; senão, tabela `confeccao_geocoding_cache` simples (rua+numero+cep → lat/lng + criado_em)
- Não escopo desta RITM se preferir começar sem cache, mas comentar TODO

---

## UI — componente `<LookupComCadastroInline>`

`src/components/confeccao/lookup-com-cadastro-inline.tsx`:

### Props

```ts
interface LookupComCadastroInlineProps<T> {
  label: string;
  entidade: "fornecedor" | "tipo-tecido" | "cor" | "produto";
  filtros?: { categoria?: ConfeccaoFornecedorCategoria };
  value?: string;  // id selecionado
  onChange: (id: string, item: T) => void;
  permiteCadastrar?: boolean;  // default true
  multi?: boolean;
}
```

### Comportamento

1. Renderiza um Combobox (estilo shadcn) com debounce de busca (300ms)
2. Lista de items vem do GET `/api/confeccao/{entidade}` com `?search=...`
3. Botão fixo no final da lista: **"+ Novo {entidade}"**
4. Click no "+" abre **modal** com formulário do cadastro
5. No submit do modal: POST → recebe id → seleciona automaticamente no Combobox → fecha modal
6. Cache local com React Query (ou SWR — seguir padrão do projeto)
7. Quando filtro `categoria` está presente, só mostra fornecedores que têm aquela categoria

### Visual

Seguir padrões existentes — provavelmente shadcn/ui já está no projeto (verificar `src/components/ui/`).

---

## Telas

### `/confeccao/cadastros` (landing)

- 4 cards/tabs: Produtos, Fornecedores, Tipos de Tecido, Cores
- Cada um leva pra sua página específica
- Contador de items ativos em cada

### `/confeccao/cadastros/produtos`

- Lista paginada
- Botão "+ Novo produto"
- Inline edit ou modal
- Ações: editar, ativar/desativar (soft delete)

### `/confeccao/cadastros/fornecedores`

- Lista paginada com filtro por categoria
- Coluna mostra badges das categorias
- Cada linha tem coordenadas (✓ se geocoded, ⚠️ se NULL)
- "+ Novo fornecedor" → modal grande com 3 seções: básico, endereço, contato

### `/confeccao/cadastros/fornecedores/[id]`

- Detalhe completo
- Tab "Preços de tecido" só aparece se fornecedor tem categoria `tecido`
- Tabela: tipo de tecido × preço/KG, com botão "+"
- Botão "Atualizar coordenadas" se latitude está NULL ou stale

### `/confeccao/cadastros/tipos-tecido` e `/confeccao/cadastros/cores`

- Listas simples, edit inline, "+ Novo"

---

## Testes obrigatórios

### Unit

`src/lib/confeccao/__tests__/geocoding.test.ts`:

1. ✅ Geocoding com endereço completo válido → retorna lat/lng
2. ✅ Endereço inválido → retorna `null` sem throw
3. ✅ Rate limiter respeitado (mock de 2 chamadas seguidas; segunda espera 1s)

### Integração (API)

`src/app/api/confeccao/__tests__/cadastros.test.ts`:

4. ✅ POST `/produtos` sem auth → 401
5. ✅ POST `/produtos` com role `funcionario` → 403
6. ✅ POST `/produtos` válido → 201 + item criado
7. ✅ POST `/produtos` duplicado (mesmo nome) → 409
8. ✅ GET `/produtos?search=camis` → filtra corretamente
9. ✅ DELETE soft `/produtos/[id]` → `ativo=false` e GET continua retornando (com flag)
10. ✅ POST `/fornecedores` com endereço válido → 201, geocoding agendado, depois lat/lng preenchidos
11. ✅ POST `/fornecedores` com cep mal formatado → 400 (Zod)
12. ✅ RLS: fornecedor de conta A não aparece em GET de conta B

### E2E (manual)

- [ ] Cadastrar produto novo via UI
- [ ] Cadastrar fornecedor de categoria "tecido" com endereço real → verificar lat/lng aparecer após 5s
- [ ] Adicionar preço de tecido (fornecedor × tipo) na ficha do fornecedor
- [ ] Usar `<LookupComCadastroInline>` numa página de teste e cadastrar inline

---

## Critérios de aceitação

- [ ] 10 endpoints CRUD implementados com Zod, RLS, status codes corretos
- [ ] Geocoding background funcionando com Nominatim (rate limit respeitado)
- [ ] Botão de re-geocode manual funcional
- [ ] Componente `<LookupComCadastroInline>` reutilizável com cache local
- [ ] 4 telas de cadastro implementadas e estilizadas
- [ ] Todos os 12 testes passam
- [ ] Validação manual end-to-end conforme checklist
- [ ] Soft delete em vez de hard delete (preserva referências futuras)
- [ ] Admin pode hard-deletar via `?hard=true` apenas se não houver referências

---

## Pontos críticos

- ⚠️ **Geocoding é assíncrono.** Tela do fornecedor mostra "Geocodificando..." quando `latitude IS NULL`. UX precisa deixar claro.
- ⚠️ Rate limit do Nominatim é **estrito** — 1 req/s. Se cadastrar 10 fornecedores em batch, leva 10s. Considerar fila Inngest se a carga crescer.
- ⚠️ Nominatim devolve resultados de qualidade variável pra endereços brasileiros. Marcar `precisao` no resultado e exibir aviso visual quando "aproximado" ou "cidade".
- ❌ **NÃO** chamar API de geocoding direto do frontend — passa pelo backend, evita expor key se mudar de provedor.
- ⚠️ Se já existir helper de validação de CEP/endereço no projeto (ex: integração ViaCEP em outro módulo), reusar pra autocompletar campos quando usuário digita o CEP.

---

## Dúvidas a confirmar

- O projeto já usa shadcn/ui? Confirmar pra usar `Combobox`/`Dialog` padrão.
- Já tem React Query ou SWR? Padronizar.
- Já tem helper de toast/notificação pra success/error? Reusar.
- ViaCEP já integrado em outra parte? Reusar pra autocompletar endereço.
