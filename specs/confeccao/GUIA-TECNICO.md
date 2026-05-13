# CLAUDE.md — Módulo Confecção

Guia de implementação para Claude Code. Este documento complementa `docs/arquitetura/modulo-confeccao.md` (referência funcional completa) com convenções técnicas, modelo de dados em pseudo-SQL, e regras invioláveis.

---

## Stack e infraestrutura

- **Banco:** PostgreSQL via Neon (free tier inicialmente)
- **Object storage:** Cloudflare R2 (limite: 50 MB/arquivo)
- **Backup:** script semanal automatizado (`pg_dump` → R2)
- **Cliente WhatsApp:** URLs `wa.me/{telefone}?text={mensagem}` (sem API oficial nesta fase)
- **Lalamove:** manual nesta fase; entidade modelada para receber integração API depois

---

## Convenções de naming

### Tabelas

- `snake_case` plural
- Prefixar tabelas do módulo com `confeccao_` para isolamento (ex: `confeccao_ordens_producao`)
- Cadastros transversais sem prefixo (ex: `fornecedores`, `tipos_tecido`, `cores`)

### Colunas

- `snake_case`
- IDs internos: `id` (UUID v4)
- IDs visíveis ao usuário: `numero` (ex: `OP05260001`)
- FKs: `{tabela_singular}_id` (ex: `ordem_producao_id`)
- Timestamps: `criado_em`, `atualizado_em`, `concluido_em`, `cancelado_em`
- Booleanos: prefixo `is_` ou `tem_` (ex: `is_concluida`, `tem_vies`)

### Enums

Tipos enumerados criados no banco (não strings soltas):

- `subtask_status`: `bloqueada`, `pendente`, `em_andamento`, `concluida`, `cancelada`
- `fornecedor_categoria`: `risco`, `tecido`, `corte`, `costura`, `vies`
- `lalamove_status`: `rascunho`, `cotado`, `procurando_motorista`, `motorista_designado`, `a_caminho_coleta`, `coletado`, `entregue`, `cancelado`, `rejeitado`, `expirado`
- `lalamove_tipo`: `principal`, `outros` (ex: etiquetas)
- `lalamove_origem_solicitacao`: `manual`, `api` — distingue Lalamoves preenchidos à mão dos solicitados via API
- `lalamove_cotacao_status`: `valida`, `expirada`, `convertida_em_pedido`, `descartada`
- `tipo_defeito`: `rebarba`, `costura_desalinhada`, `costura_incompleta`, `gola`, `mancha`, `tecido`, `furo`, `outros`
- `destino_reprovadas`: `doacao`, `descarte`, `retrabalho`
- `retirada_tipo`: `parcial`, `final`
- `usuario_role`: `admin`, `interno`
- `op_status`: `em_andamento`, `concluida`, `cancelada`
- `lalamove_webhook_evento`: `ORDER_STATUS_CHANGED`, `DRIVER_ASSIGNED`, `OUTROS` — espelha os event types da API Lalamove v3

---

## Modelo de dados (pseudo-SQL)

### Usuários e cadastros

```sql
CREATE TABLE usuarios (
  id UUID PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role usuario_role NOT NULL DEFAULT 'interno',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE fornecedores (
  id UUID PRIMARY KEY,
  nome TEXT NOT NULL,
  categorias fornecedor_categoria[] NOT NULL, -- multi-categoria
  whatsapp TEXT NOT NULL,                    -- formato livre, usado nos links wa.me
  telefone_e164 TEXT,                        -- formato +5511999999999, obrigatório para API Lalamove
  -- endereço estruturado para preparar Lalamove API
  endereco_rua TEXT NOT NULL,
  endereco_numero TEXT NOT NULL,
  endereco_complemento TEXT,
  endereco_bairro TEXT NOT NULL,
  endereco_cep TEXT NOT NULL,
  endereco_cidade TEXT NOT NULL,
  endereco_estado TEXT NOT NULL,
  latitude DECIMAL(10, 7),  -- preenchido por geocoding
  longitude DECIMAL(10, 7),
  contato_nome TEXT,         -- nome da pessoa de contato no fornecedor (sender/recipient name na API)
  observacoes TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tipos_tecido (
  id UUID PRIMARY KEY,
  nome TEXT UNIQUE NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE cores (
  id UUID PRIMARY KEY,
  nome TEXT UNIQUE NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- preço sugerido por (fornecedor, tipo de tecido) — opcional
CREATE TABLE fornecedor_tecido_preco (
  fornecedor_id UUID REFERENCES fornecedores(id),
  tipo_tecido_id UUID REFERENCES tipos_tecido(id),
  preco_kg_sugerido DECIMAL(10, 2),
  PRIMARY KEY (fornecedor_id, tipo_tecido_id)
);
```

### OP e subtasks

```sql
CREATE TABLE ordens_producao (
  id UUID PRIMARY KEY,
  numero TEXT UNIQUE NOT NULL,  -- formato OP05260001
  produto_id UUID NOT NULL REFERENCES produtos(id),  -- cadastro de SKUs existente
  tem_vies BOOLEAN NOT NULL DEFAULT FALSE,
  status op_status NOT NULL DEFAULT 'em_andamento',
  criada_por_id UUID NOT NULL REFERENCES usuarios(id),
  atribuido_a_id UUID NOT NULL REFERENCES usuarios(id),
  observacoes TEXT,
  -- cancelamento
  cancelada_em TIMESTAMPTZ,
  cancelada_por_id UUID REFERENCES usuarios(id),
  cancelamento_autorizado_por_id UUID REFERENCES usuarios(id),  -- só preenchido se OP já estava fechada
  cancelamento_justificativa TEXT,
  -- timestamps
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluida_em TIMESTAMPTZ,
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE subtasks (
  id UUID PRIMARY KEY,
  numero TEXT UNIQUE NOT NULL,  -- formato OPBUY0001, etc
  prefixo TEXT NOT NULL,  -- OPBUY | OPRIS | OPCOR | OPVIE | OPSEW | OPCONF
  ordem_producao_id UUID NOT NULL REFERENCES ordens_producao(id),
  ordem_sequencial INTEGER NOT NULL,  -- 1..6, define ordem no fluxo
  status subtask_status NOT NULL DEFAULT 'bloqueada',
  atribuido_a_id UUID REFERENCES usuarios(id),
  -- payload específico por tipo (JSONB para flexibilidade)
  -- ALTERNATIVA: tabelas separadas por tipo (mais rigoroso)
  -- recomendação: começar com JSONB, migrar para tabelas dedicadas se complexidade crescer
  payload JSONB NOT NULL DEFAULT '{}',
  valor_servico DECIMAL(10, 2),
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  iniciada_em TIMESTAMPTZ,
  concluida_em TIMESTAMPTZ
);
```

> **Decisão técnica:** o `payload` JSONB simplifica o MVP. Se o sistema crescer, migrar para tabelas dedicadas (`subtask_compra`, `subtask_risco`, etc) referenciando `subtasks.id`. Documentar schemas JSON em arquivo separado.

### Saldos (computados ou materializados)

```sql
-- view materializada para consulta rápida de saldos
-- atualizada a cada commit em subtasks/retiradas
CREATE MATERIALIZED VIEW saldos_op AS
SELECT
  op.id AS ordem_producao_id,
  -- agregações por cor, tamanho, etc
  ...
FROM ordens_producao op
LEFT JOIN subtasks s ON s.ordem_producao_id = op.id
...;

-- ALTERNATIVA mais simples: calcular saldos em queries on-demand
-- avaliar performance com volume real antes de materializar
```

### Retiradas e subconferências

```sql
CREATE TABLE retiradas (
  id UUID PRIMARY KEY,
  numero TEXT UNIQUE NOT NULL,  -- OP05260001-RET-01
  subtask_costura_id UUID NOT NULL REFERENCES subtasks(id),
  oficina_id UUID NOT NULL REFERENCES fornecedores(id),
  tipo retirada_tipo NOT NULL,
  pecas_por_tamanho_cor JSONB NOT NULL,  -- {"M": {"preto": 100, "branco": 50}, ...}
  data_retirada TIMESTAMPTZ NOT NULL,
  cancelada_em TIMESTAMPTZ,
  cancelada_por_id UUID REFERENCES usuarios(id),
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE subconferencias (
  id UUID PRIMARY KEY,
  numero TEXT UNIQUE NOT NULL,  -- OP05260001-CONF-RET01
  subtask_conferencia_id UUID NOT NULL REFERENCES subtasks(id),
  retirada_id UUID NOT NULL REFERENCES retiradas(id),
  status subtask_status NOT NULL DEFAULT 'em_andamento',
  -- Bloco 1: quantitativa
  pecas_recebidas JSONB,  -- por tamanho × cor
  divergencia_confirmada BOOLEAN,
  oficina_responsavel_divergencia_id UUID REFERENCES fornecedores(id),
  -- Bloco 2: inspeção
  responsavel_inspecao_id UUID REFERENCES usuarios(id),
  aprovadas JSONB,  -- por tamanho × cor
  reprovadas JSONB,  -- por tamanho × cor
  tipos_defeito tipo_defeito[],
  data_inspecao TIMESTAMPTZ,
  -- Bloco 3: destinação
  destino_reprovadas destino_reprovadas,
  localizacao_armazem TEXT,
  --
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluida_em TIMESTAMPTZ
);
```

### Lalamove

A modelagem cobre os dois modos de operação simultaneamente:

- **Modo manual** (fase inicial): operador preenche valor, faz upload do comprovante e atualiza status à mão. Campo `origem_solicitacao = 'manual'`.
- **Modo API** (fase futura, ativada por feature flag): backend chama `/v3/quotations` → `/v3/orders` da Lalamove e recebe atualizações via webhook. Campo `origem_solicitacao = 'api'`.

Os mesmos registros em `lalamoves` servem aos dois modos. Campos da API ficam `NULL` no modo manual e vice-versa.

```sql
CREATE TABLE lalamoves (
  id UUID PRIMARY KEY,
  subtask_id UUID REFERENCES subtasks(id),
  retirada_id UUID REFERENCES retiradas(id),  -- nullable; preenchido se for Lalamove de retirada
  tipo lalamove_tipo NOT NULL DEFAULT 'principal',
  origem_solicitacao lalamove_origem_solicitacao NOT NULL DEFAULT 'manual',

  -- endereços (snapshot — não acompanha edição posterior do fornecedor)
  origem_endereco JSONB NOT NULL,  -- estruturado: {rua, numero, bairro, cep, cidade, estado, complemento}
  origem_lat DECIMAL(10, 7),
  origem_lng DECIMAL(10, 7),
  destino_endereco JSONB NOT NULL,
  destino_lat DECIMAL(10, 7),
  destino_lng DECIMAL(10, 7),

  -- contatos (obrigatórios para API; opcionais para manual)
  contato_origem_nome TEXT,
  contato_origem_telefone TEXT,    -- formato E.164: +5511999999999
  contato_destino_nome TEXT,
  contato_destino_telefone TEXT,
  remarks_destino TEXT,             -- instruções pro motorista (ex: "Entregar para João — OP05260001")

  -- dados operacionais
  status lalamove_status NOT NULL DEFAULT 'rascunho',
  valor DECIMAL(10, 2),             -- manual: digitado; API: vem de priceBreakdown.total
  moeda TEXT NOT NULL DEFAULT 'BRL',
  conteudo_descricao TEXT,
  quantidade_pecas INTEGER,

  -- configuração da API (só preenchidos quando origem_solicitacao = 'api')
  service_type TEXT,                -- ex: 'MOTORCYCLE', 'CAR', 'VAN' — validar via Get City Info
  special_requests TEXT[],          -- ex: ['HELP_BUY', 'CASH_HANDLING_FEE']
  schedule_at TIMESTAMPTZ,          -- agendamento opcional; NULL = imediato. ATENÇÃO: enviar em UTC à API

  -- identificadores da API Lalamove
  quotation_id_api TEXT,            -- ID da última cotação aceita
  order_id_api TEXT,                -- ID do pedido na Lalamove. SEMPRE TEXT (19 dígitos desde set/2025)
  share_link TEXT,                  -- shareLink retornado pela API (link público de rastreio)
  driver_id_api TEXT,
  driver_nome TEXT,
  driver_telefone TEXT,
  driver_placa TEXT,
  distancia_metros INTEGER,         -- vem do priceBreakdown
  price_breakdown JSONB,            -- snapshot completo do breakdown da API
  last_driver_lat DECIMAL(10, 7),   -- última posição conhecida do motorista (polling)
  last_driver_lng DECIMAL(10, 7),
  last_driver_location_at TIMESTAMPTZ,

  -- timestamps
  data_solicitacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_coleta TIMESTAMPTZ,          -- preenchido quando status = 'coletado'
  data_entrega TIMESTAMPTZ,
  cancelada_em TIMESTAMPTZ,
  cancelada_por_id UUID REFERENCES usuarios(id),
  cancelamento_motivo TEXT,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- pelo menos uma das FKs deve estar preenchida
ALTER TABLE lalamoves ADD CONSTRAINT lalamove_tem_pai
  CHECK (subtask_id IS NOT NULL OR retirada_id IS NOT NULL);

-- quando origem = api, campos obrigatórios da API não podem ser nulos a partir do momento que o pedido é criado
ALTER TABLE lalamoves ADD CONSTRAINT lalamove_api_completo
  CHECK (
    origem_solicitacao = 'manual'
    OR status IN ('rascunho', 'cotado')
    OR (order_id_api IS NOT NULL AND service_type IS NOT NULL)
  );

CREATE INDEX idx_lalamoves_order_id_api ON lalamoves(order_id_api) WHERE order_id_api IS NOT NULL;
CREATE INDEX idx_lalamoves_status_procura ON lalamoves(status, data_solicitacao)
  WHERE status = 'procurando_motorista';  -- otimiza alerta de tempo de procura alto
```

#### Cotações da API (histórico, com expiração de 5 min)

```sql
-- A API exige cotação antes do pedido. Quotation é válida por 5 minutos.
-- Cada lalamove pode acumular várias cotações até uma virar pedido.
CREATE TABLE lalamove_cotacoes (
  id UUID PRIMARY KEY,
  lalamove_id UUID NOT NULL REFERENCES lalamoves(id) ON DELETE CASCADE,
  quotation_id_api TEXT NOT NULL UNIQUE,    -- ID retornado por POST /v3/quotations
  status lalamove_cotacao_status NOT NULL DEFAULT 'valida',
  valor_cotado DECIMAL(10, 2) NOT NULL,
  moeda TEXT NOT NULL DEFAULT 'BRL',
  distancia_metros INTEGER,
  service_type TEXT NOT NULL,
  stops_api JSONB NOT NULL,    -- array com {stopId, address, coordinates} retornado pela cotação
                                -- ESSENCIAL: os stopIds precisam ser repassados ao criar o order
  request_payload JSONB NOT NULL,   -- snapshot completo do request enviado
  response_payload JSONB NOT NULL,  -- snapshot completo da resposta da API
  expira_em TIMESTAMPTZ NOT NULL,   -- = criada_em + 5 minutos
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criada_por_id UUID NOT NULL REFERENCES usuarios(id)
);

CREATE INDEX idx_cotacoes_validas ON lalamove_cotacoes(lalamove_id, expira_em)
  WHERE status = 'valida';
```

#### Eventos de webhook (idempotência + auditoria)

```sql
-- A Lalamove envia POSTs para nosso endpoint público quando o status do pedido muda.
-- Gravamos cru e processamos em job assíncrono.
CREATE TABLE lalamove_webhook_events (
  id UUID PRIMARY KEY,
  lalamove_id UUID REFERENCES lalamoves(id),   -- resolvido na hora da gravação (lookup por order_id_api)
  evento lalamove_webhook_evento NOT NULL,
  order_id_api TEXT NOT NULL,                  -- vem no payload, usado para correlacionar
  payload JSONB NOT NULL,                      -- payload integral recebido
  assinatura_header TEXT,                      -- header de validação (se a Lalamove enviar)
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processado BOOLEAN NOT NULL DEFAULT FALSE,
  processado_em TIMESTAMPTZ,
  erro_processamento TEXT                      -- se falhou, registrar a exceção
);

CREATE INDEX idx_webhook_nao_processados ON lalamove_webhook_events(recebido_em)
  WHERE processado = FALSE;
```

#### Mapeamento status interno ↔ status da API

| API Lalamove          | Nosso `lalamove_status`    | Observação                                          |
|-----------------------|----------------------------|-----------------------------------------------------|
| —                     | `rascunho`                 | Antes de qualquer chamada à API                     |
| —                     | `cotado`                   | Cotação válida criada, sem order ainda              |
| `ASSIGNING_DRIVER`    | `procurando_motorista`     | Order criada, esperando motorista aceitar           |
| `ON_GOING`            | `motorista_designado` → `a_caminho_coleta` | Motorista a caminho do pickup       |
| `PICKED_UP`           | `coletado`                 | Preencher `data_coleta`                             |
| `COMPLETED`           | `entregue`                 | Preencher `data_entrega`                            |
| `CANCELED`            | `cancelado`                | Cancelado por nós ou pelo motorista                 |
| `REJECTED`            | `rejeitado`                | Nenhum motorista aceitou                            |
| `EXPIRED`             | `expirado`                 | Cotação ou pedido expirou                           |

### Anexos, notas, templates

```sql
CREATE TABLE anexos (
  id UUID PRIMARY KEY,
  subtask_id UUID REFERENCES subtasks(id),
  ordem_producao_id UUID REFERENCES ordens_producao(id),
  lalamove_id UUID REFERENCES lalamoves(id),
  nome_arquivo TEXT NOT NULL,
  tipo_mime TEXT NOT NULL,
  tamanho_bytes BIGINT NOT NULL CHECK (tamanho_bytes <= 52428800),  -- 50 MB
  r2_key TEXT NOT NULL UNIQUE,  -- chave no Cloudflare R2
  enviado_por_id UUID NOT NULL REFERENCES usuarios(id),
  enviado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notas (
  id UUID PRIMARY KEY,
  subtask_id UUID REFERENCES subtasks(id),
  ordem_producao_id UUID REFERENCES ordens_producao(id),
  autor_id UUID REFERENCES usuarios(id),  -- NULL se auditoria automática do sistema
  conteudo TEXT NOT NULL,
  is_auditoria BOOLEAN NOT NULL DEFAULT FALSE,
  is_interna BOOLEAN NOT NULL DEFAULT TRUE,  -- preparação para notas públicas futuras
  criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE templates_whatsapp (
  id UUID PRIMARY KEY,
  nome TEXT NOT NULL,
  categoria fornecedor_categoria NOT NULL,
  corpo TEXT NOT NULL,  -- texto com placeholders tipo {op_numero}
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## Regras invioláveis

Estas são regras que **NÃO podem ser violadas** em nenhuma implementação. Validar em backend, não apenas em frontend.

### Encadeamento de subtasks

- Subtask N+1 só pode ter status diferente de `bloqueada` se subtask N tiver `concluida`
- Subtask Conferência destrava parcialmente: se houver retirada parcial em qualquer Costura, Conferência vai pra `em_andamento` mesmo com Costura ainda em andamento
- Subtask Costura só conclui quando todas as oficinas têm status interno "Finalizada" (retirada final realizada)
- Subtask Conferência só conclui quando todas as subconferências existentes estão `concluidas` E não há mais retiradas pendentes

### Saldo

- Distribuição de rolos no Corte: soma por cor ≤ rolos comprados por cor
- Distribuição de peças na Costura: soma por (tamanho, cor) ≤ peças cortadas por (tamanho, cor)
- Etiquetagem dentro de uma oficina: soma de etiquetas por tamanho-fonte ≤ peças enviadas para a oficina daquele tamanho
- Cancelar retirada parcial: reverter os saldos automaticamente

### Imutabilidade do Corte

- O campo "rendimento por tamanho × cor" no Corte é **imutável** após a subtask concluída
- Mesmo se a Conferência revelar divergência, NÃO altera o rendimento do Corte
- Divergência é registrada na Conferência, não no Corte

### Validação largura

- `subtask_risco.largura_cm <= subtask_compra.largura_rolo_cm`
- Bloquear conclusão da subtask Risco se violar

### Cancelamento

- Só admin cancela OP
- OP fechada exige `cancelamento_autorizado_por_id` (outro admin)
- OP cancelada não pode ser reaberta — definitivo
- Subtask concluída pode ser reaberta (admin only) — diferente de OP
- Cancelamento de OP/subtask com Lalamove API em andamento dispara `DELETE /v3/orders/{id}` automaticamente se o status permitir (até `coletado`); falha do cancelamento na API gera alerta mas não bloqueia o cancelamento interno

### Integração Lalamove API

- `order_id_api` é sempre `TEXT` — nunca `INTEGER`. A Lalamove estendeu o ID de 12 para 19 dígitos em setembro de 2025
- Cotação da Lalamove vence em **5 minutos**. Antes de criar um order, validar que `expira_em > NOW()`. Se expirou, cotar de novo automaticamente
- `schedule_at` é sempre armazenado em UTC. Na UI, converter de/para horário de Brasília (UTC-3) explicitamente
- `service_type` e `special_requests` precisam ser validados contra `GET /v3/cities` antes de cotar — cachear a resposta por 24h
- Todo `contato_origem_telefone` e `contato_destino_telefone` enviados à API devem estar em formato E.164 (`+5511999999999`)
- Webhook responde HTTP 200 antes de processar — gravar evento cru, retornar 200, processar em job. Endpoint NUNCA pode demorar mais que 5s
- Webhook events são idempotentes: se receber o mesmo `evento` + `order_id_api` + timestamp já processado, ignorar
- Chamadas à API Lalamove SÓ no backend. Chave e segredo da API ficam em variáveis de ambiente, jamais no frontend ou no banco
- Feature flag `lalamove_api_habilitada` (config global): quando `false`, todo `lalamove` nasce com `origem_solicitacao = 'manual'` e os botões da API ficam ocultos
- Operador pode escolher entre "Solicitar manualmente" e "Solicitar via API" em cada Lalamove individualmente, mesmo com a flag ligada — modo manual nunca é removido

### Auditoria automática

A cada uma das ações abaixo, criar registro automático em `notas` com `is_auditoria = TRUE`:

- Mudança de status
- Mudança de `atribuido_a_id`
- Edição de campo após `concluida_em` ser preenchida
- Cancelamento de OP
- Reabertura de subtask
- Cancelamento de retirada parcial
- Envio de mensagem WhatsApp
- Upload/remoção de anexo
- Criação de cotação Lalamove (registrar `quotation_id_api` e valor)
- Criação de pedido Lalamove via API (registrar `order_id_api`)
- Mudança de status Lalamove via webhook (registrar evento + status anterior → novo)
- Cancelamento de pedido Lalamove via API
- Falha em chamada à API Lalamove (registrar `requestId` retornado pela API para suporte)

---

## Convenções de UI/UX

### Visualização da OP

- **Stepper vertical** das subtasks (modelo ServiceNow Change Management)
- Cards expandíveis inline
- Cada subtask tem URL própria (`/ops/{numero}/subtasks/{prefixo}`) permitindo abrir em nova aba
- Múltiplas abas simultâneas suportadas

### Header da OP (sempre visível)

- Número da OP + lote
- Produto + SKU
- Status geral (% progresso)
- Criada por / Atribuído a
- Botões: Editar atribuição, Imprimir, Histórico, Evidências de Pagamento, Cancelar OP

### Estados visuais das subtasks

| Status | Cor | Ícone |
|---|---|---|
| Bloqueada | Cinza | ⊘ |
| Pendente | Amarelo | ○ |
| Em andamento | Azul | ◐ |
| Concluída | Verde | ✓ |
| Cancelada | Vermelho | ✗ |

### Cadastros inline

Campos lookup de cadastros expansíveis (tipo de tecido, cor, fornecedor) devem ter botão "+ Novo" abrindo modal rápido para cadastro sem sair do fluxo da subtask.

### Mensagens WhatsApp

- Botão "Enviar WhatsApp" em cada subtask que tem destinatário externo
- Modal mostra: template selecionado (editável), prévia da mensagem com placeholders resolvidos, botão "Enviar"
- Ao clicar enviar: gera URL `wa.me/{telefone}?text={url_encoded}` e abre em nova aba

### Conferência

- Bloco 1 (quantitativa): **NÃO mostrar** quantidade esperada antes da contagem
- Após confirmação inicial, se houver divergência, oferecer **recontagem** antes de revelar valores
- Edição posterior exige justificativa textual

### Retiradas parciais

- Botões "Nova retirada parcial" / "Retirada final" dentro da seção da oficina na Costura
- Ao confirmar uma retirada: criar subconferência automaticamente, notificar atribuído da Conferência, exibir **modal informativo** com custo estimado por peça naquele lote (apenas visual)

---

## Pontos críticos de implementação

### Geração de número da OP

```
Pseudo-código:
  mes_atual = MM (dois últimos)
  ano_atual = AA (dois últimos)
  ultimo_sequencial = SELECT MAX(sequencial) FROM ordens_producao  -- global, não por mês
  proximo = (ultimo_sequencial + 1) % 10000
  numero = "OP" + mes_atual + ano_atual + zfill(proximo, 4)
```

> Atenção: o sequencial é **contínuo, não reseta no mês**. Reseta apenas após 9999 → 0000. O componente MMAA no número diferencia OPs com mesmo sequencial em momentos diferentes.

### Geração de números de subtasks

- Subtasks de uma OP recebem o mesmo sequencial da OP-mãe
- Subtasks de `OP05260001` são: `OPBUY0001`, `OPRIS0001`, `OPCOR0001`, etc

### Geocoding de endereços

- Ao criar/editar fornecedor, geocoding automático em background para preencher lat/long
- Usar serviço gratuito (Nominatim com rate limiting respeitado, ou API gratuita similar)
- Re-geocoding manual disponível como botão na ficha do fornecedor

### Backup automatizado

```bash
# script semanal (cron domingo 03:00)
pg_dump $DATABASE_URL > /tmp/backup_$(date +%Y%m%d).sql.gz
aws s3 cp /tmp/backup_*.sql.gz s3://confeccao-backups/ --endpoint-url $R2_ENDPOINT
# manter últimos 4 semanais + 12 mensais
```

### Upload para R2

- URLs assinadas (presigned URLs) para upload direto cliente → R2
- Backend valida tamanho < 50 MB
- Backend gera key estruturada: `op-{numero}/subtask-{numero}/{uuid}.{ext}`
- Registrar metadados em `anexos`

### Notificações por email

- Provider: a definir (SendGrid, Resend, ou similar com tier gratuito)
- Queue interna (job table no Postgres) para garantir entrega
- Templates de email armazenados em código (não no banco)

### Integração Lalamove API — implementação técnica

**Configuração**

Variáveis de ambiente:

```
LALAMOVE_API_KEY=...
LALAMOVE_API_SECRET=...
LALAMOVE_API_HOST=https://rest.lalamove.com    # sandbox: https://rest.sandbox.lalamove.com
LALAMOVE_MARKET=BR                              # mercado/país
LALAMOVE_WEBHOOK_SECRET=...                     # segredo compartilhado (validação)
LALAMOVE_FEATURE_FLAG=false                     # ligar somente quando pronto
```

Hosts:
- Sandbox: `https://rest.sandbox.lalamove.com/v3`
- Produção: `https://rest.lalamove.com/v3`

**Endpoints usados**

| Método | Endpoint                        | Quando chamar                                  |
|--------|---------------------------------|------------------------------------------------|
| GET    | `/v3/cities`                    | Cron diário; cachear `serviceType` e `specialRequest` válidos por mercado/cidade |
| POST   | `/v3/quotations`                | Operador clica "Cotar" em um Lalamove          |
| GET    | `/v3/quotations/{id}`           | Revalidar cotação antes de criar order         |
| POST   | `/v3/orders`                    | Operador confirma criação do pedido            |
| GET    | `/v3/orders/{id}`               | Polling de fallback / consulta manual          |
| DELETE | `/v3/orders/{id}`               | Cancelamento (manual ou em cascata da OP)      |
| PATCH  | `/v3/webhook`                   | Setup inicial do webhook URL (1×, ou via Partner Portal) |

**Autenticação**

A API usa HMAC-SHA256 com timestamp em cada request. Centralizar a geração da assinatura em um único módulo `lalamove/client.ts` (ou equivalente). Nunca duplicar a lógica de assinatura.

**Fluxo de criação de Lalamove via API**

```
1. Operador abre o bloco Lalamove da subtask, preenche conteúdo + quantidade.
2. Backend monta payload do quotation a partir de:
   - origem: endereço do fornecedor da subtask
   - destino: endereço do destinatário (próxima oficina, armazém, etc.)
   - service_type: default da config + opção de override pelo operador
3. Backend chama POST /v3/quotations, grava em `lalamove_cotacoes` com expira_em = NOW() + 5min,
   atualiza lalamoves.status = 'cotado'.
4. UI mostra valor cotado + countdown de 5min + botão "Confirmar pedido".
5. Operador confirma. Backend revalida cotação (se expira_em < NOW(), recota silenciosamente).
6. Backend chama POST /v3/orders passando quotationId + stopIds + contatos.
   Grava order_id_api, share_link em lalamoves; atualiza status = 'procurando_motorista'.
7. Eventos chegam por webhook, atualizam status, driver_*, data_coleta, data_entrega.
```

**Endpoint de webhook**

Caminho público: `POST /api/webhooks/lalamove`

```
Pseudo-código do handler:
  1. Validar assinatura do header (HMAC com LALAMOVE_WEBHOOK_SECRET)
  2. Extrair order_id_api do payload
  3. SELECT id FROM lalamoves WHERE order_id_api = $1
  4. INSERT INTO lalamove_webhook_events (...) com processado = FALSE
  5. RETURN 200 imediatamente
  6. Job assíncrono lê eventos não processados, atualiza lalamoves.status, dispara notas de auditoria
```

> Tempo máximo de resposta: 5 segundos. Sob carga, ainda assim retornar 200 — processar depois.

**Job de polling (fallback)**

A cada 5 minutos, varrer `lalamoves WHERE status IN ('procurando_motorista', 'a_caminho_coleta', 'coletado') AND atualizada_em < NOW() - INTERVAL '10 min'` e chamar `GET /v3/orders/{id}` para sincronizar. Evita perder eventos se o webhook falhar.

**Job de localização do motorista**

A cada 60s, para lalamoves com status `a_caminho_coleta` ou `coletado`, chamar `GET /v3/orders/{id}/drivers/{driverId}/location` e atualizar `last_driver_lat/lng`. Usado pelo mapa do dashboard.

**Tratamento de erros**

A API retorna formato padronizado:

```json
{
  "errors": [{ "id": "ERR_REQUIRED_FIELD", "message": "...", "detail": "..." }],
  "meta": { "requestId": "..." }
}
```

Sempre logar `requestId` na nota de auditoria — é o que o suporte da Lalamove pede.

---

## O que NÃO fazer

- ❌ Não permitir alteração do rendimento do Corte após conclusão (regra crítica)
- ❌ Não criar a subtask Viés se `tem_vies = FALSE`; e nunca permitir ativar Viés depois da OP criada
- ❌ Não permitir mais de uma OP com o mesmo número (constraint UNIQUE)
- ❌ Não permitir conclusão de subtask que viole validações cruzadas (largura, saldo)
- ❌ Não permitir reabertura de OP cancelada
- ❌ Não confiar em validação de frontend — todas as regras invioláveis precisam ser validadas no backend
- ❌ Não fazer entrada direta no estoque a partir da Conferência (passa pela Estante Virtual)
- ❌ Não alterar dados em subtask concluída sem registrar nas notas com justificativa
- ❌ Não enviar email sem registrar no log de auditoria
- ❌ Não mostrar custos para usuários não-admin
- ❌ Não armazenar arquivos no banco — sempre no R2
- ❌ Não usar string para enums — usar tipos PostgreSQL ENUM
- ❌ Não armazenar `order_id_api` da Lalamove como `INTEGER` — sempre `TEXT` (19 dígitos desde set/2025)
- ❌ Não criar order Lalamove com `quotation_id` expirado (>5min) — re-cotar antes
- ❌ Não chamar a API Lalamove direto do frontend — sempre via backend, segredo em env var
- ❌ Não responder o webhook da Lalamove com status diferente de 200 — gravar evento cru e responder rápido
- ❌ Não confiar no valor cotado antes do order ser criado — o preço final só é definitivo no `priceBreakdown` do order
- ❌ Não esquecer de cancelar o order Lalamove ao cancelar OP/subtask quando o status permitir
- ❌ Não enviar `schedule_at` à API em horário local — sempre converter para UTC

---

## Estrutura de pastas sugerida (referência)

```
/src
  /modules
    /confeccao
      /ops                  # OPs e fluxo geral
      /subtasks
        /compra
        /risco
        /corte
        /vies
        /costura
        /conferencia
      /cadastros            # fornecedores, tecidos, cores
      /templates            # templates WhatsApp
      /dashboards
      /shared
        /lalamove
          /manual           # fluxo manual (upload, valor digitado)
          /api              # client da API, mapeamento de status, cotações
          /webhook          # handler do POST /api/webhooks/lalamove
        /saldos             # cálculos de saldo
        /numeracao          # geração de números OP/subtasks
        /notificacoes       # disparo de emails
        /auditoria          # registro automático em notas
  /db
    /migrations
    /seeds
  /jobs
    /backup-semanal
    /notificacoes-pendentes
    /alertas-atraso
    /lalamove-polling-fallback     # sincroniza status caso webhook falhe
    /lalamove-driver-location      # polling de localização para mapa
    /lalamove-cidades-cache        # refresh diário de service types válidos
```

---

## Roadmap de desenvolvimento (alinhar com a arquitetura)

### Fase 1 — Base (semanas 1-2)
- Setup Neon + R2 + estrutura do projeto
- Migrations base (usuarios, fornecedores, tipos_tecido, cores, produtos)
- Auth e permissões (admin/interno)
- CRUD de cadastros

### Fase 2 — OP esqueleto (semanas 3-4)
- Migration de ordens_producao + subtasks
- Criação de OP com geração automática de subtasks
- Stepper vertical na UI
- Estados de subtasks e encadeamento bloqueante

### Fase 3 — Subtasks de compra, risco, corte (semanas 5-7)
- Implementar 3 primeiras subtasks com todos os campos
- Sistema de saldo entre Compra e Corte
- Validação largura risco vs. rolo
- Bloco Lalamove (manual)
- Bloco Valor do Serviço

### Fase 4 — Viés, costura, conferência (semanas 8-10)
- Viés condicional
- Costura com múltiplas oficinas e retiradas
- Conferência com subconferências
- Etiquetagem cruzada

### Fase 5 — Funcionalidades transversais (semanas 11-12)
- Templates WhatsApp
- Notas com auditoria automática
- Notificações por email
- Aba Evidências de Pagamento + cálculo de custos
- Cancelamento de OP

### Fase 6 — Dashboards e refinamento (semanas 13-14)
- Dashboard geral
- Dashboard de qualidade por oficina
- Alertas de atraso
- Backup automatizado

### Fase 7 — Integração Estante Virtual (semana 15)
- Campo OP/Lote no gerador de QR code
- Testes integrados

### Fase 8 — Integração Lalamove API (semanas 16-19)

Sub-fase 8A — Cotação assistida (semana 16):
- Tabela `lalamove_cotacoes` + endpoint backend de cotação
- Cache de `serviceType` válidos via `GET /v3/cities`
- UI mostra valor estimado da API antes de pedir manualmente
- Operador ainda solicita no app oficial

Sub-fase 8B — Pedido automatizado (semana 17):
- Migration ampliando `lalamoves` com campos da API
- Botão "Solicitar via API" cota + cria order em sequência
- Feature flag `lalamove_api_habilitada` controla disponibilidade
- Sem webhook ainda; status atualizado manualmente ou por polling de fallback

Sub-fase 8C — Webhook em produção (semana 18):
- Endpoint público `POST /api/webhooks/lalamove` com validação de assinatura
- Tabela `lalamove_webhook_events` + job de processamento
- Mapeamento completo de status da API → status interno
- Cancelamento em cascata (OP cancelada cancela orders ativos)

Sub-fase 8D — Mapa em tempo real (semana 19):
- Job de polling de localização do motorista
- Dashboard com mapa de Lalamoves ativos
- Alertas de tempo de procura alto (`status = 'procurando_motorista'` há mais de 10 min)

---

## Pontos de decisão diferida (perguntar ao Gabriel quando chegar a hora)

- Provider de email (SendGrid? Resend? Outro?)
- Implementação de notas internas vs. públicas (modelar agora, ativar funcionalidade depois)
- Acesso externo para oficinas (V2)
- Sub-fluxo de retrabalho (V2)
- Lalamove API: `service_type` default na confecção (provavelmente `MOTORCYCLE` para itens leves, `VAN` para tecido em rolos — confirmar com testes em sandbox)
- Lalamove API: validar se conta Business já existe ou criar uma nova
- Lalamove API: definir se webhook fica em subdomínio próprio (`webhooks.confeccao.com.br`) ou na app principal

---

**Fim do CLAUDE.md.**

Para detalhes funcionais e fluxos completos, consultar `docs/arquitetura/modulo-confeccao.md`.
