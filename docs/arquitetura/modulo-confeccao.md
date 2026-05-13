# Módulo Confecção — Arquitetura Completa

**Documento de especificação para desenvolvimento**
**Versão:** 2.1 — Integração Lalamove API v3 incorporada
**Base conceitual:** Modelo REQ + RITMs do ServiceNow
**Última atualização:** Maio 2026

---

## Sumário

1. [Visão geral e princípios](#1-visão-geral-e-princípios)
2. [Estrutura do módulo](#2-estrutura-do-módulo)
3. [Modelo de dados — visão lógica](#3-modelo-de-dados--visão-lógica)
4. [Numeração e identificadores](#4-numeração-e-identificadores)
5. [Permissões](#5-permissões)
6. [Ordem de Produção (OP)](#6-ordem-de-produção-op)
7. [Especificação detalhada das subtasks](#7-especificação-detalhada-das-subtasks)
8. [Cadastros](#8-cadastros)
9. [Templates de mensagem WhatsApp](#9-templates-de-mensagem-whatsapp)
10. [Sistema de saldo](#10-sistema-de-saldo)
11. [Notificações por email](#11-notificações-por-email)
12. [Custos e relatório financeiro](#12-custos-e-relatório-financeiro)
13. [Integração com Estante Virtual](#13-integração-com-estante-virtual)
14. [Lalamove — integração com a API v3](#14-lalamove--integração-com-a-api-v3)
15. [Dashboards](#15-dashboards)
16. [Auditoria e edição retroativa](#16-auditoria-e-edição-retroativa)
17. [Infraestrutura](#17-infraestrutura)
18. [Casos especiais e exceções](#18-casos-especiais-e-exceções)
19. [Roadmap de implementação](#19-roadmap-de-implementação)
20. [Glossário](#20-glossário)

---

## 1. Visão geral e princípios

### 1.1 Propósito

O módulo **Confecção** é um módulo principal do ERP, no mesmo nível hierárquico de Dashboard, Expedição e Estante Virtual. Seu objetivo é substituir a coordenação informal (WhatsApp, planilhas, anotações) por um fluxo estruturado, rastreável e auditável de produção têxtil, permitindo:

- Saber exatamente o **custo real por peça** produzida
- Rastrear qualquer peça do estoque até a Ordem de Produção que a gerou
- Documentar todas as etapas da confecção com evidências
- Avaliar performance de fornecedores e oficinas com dados objetivos
- Preparar a base para integração futura com a API do Lalamove (com modelagem completa e fluxo manual funcionando, a integração via API entra como evolução previsível, não como refatoração)

### 1.2 Princípios

1. **Encadeamento bloqueante:** cada subtask só se torna editável quando a anterior é concluída
2. **Zero contextualização verbal:** quem executa uma subtask encontra tudo registrado nas anteriores
3. **Notas em todos os níveis:** OP e cada subtask têm seu próprio espaço de notas
4. **Rastreabilidade por lote:** cada OP gera um número de lote único que viaja com as peças até o estoque
5. **Uploads como evidência:** NF, comprovantes Lalamove, risco digital, mensagens WhatsApp e fotos ficam anexados à subtask correspondente
6. **Auditoria total:** toda mudança em campo concluído gera registro nas notas
7. **Dados reais primeiro, estimativas só como alerta:** o sistema trabalha com dados confirmados sempre que possível
8. **Saldos bloqueantes:** o sistema impede distribuições que excedam o disponível

---

## 2. Estrutura do módulo

```
Módulo Confecção
│
├── Ordens de Produção (tela principal)
│   ├── Lista de OPs (kanban + filtros)
│   └── OP individual (stepper vertical)
│       ├── Subtask 1 — Compra de Tecido       (OPBUY)
│       ├── Subtask 2 — Risco                   (OPRIS)
│       ├── Subtask 3 — Corte                   (OPCOR)
│       ├── Subtask 4 — Viés (condicional)      (OPVIE)
│       ├── Subtask 5 — Costura                 (OPSEW)
│       └── Subtask 6 — Conferência             (OPCONF)
│
├── Cadastros
│   ├── Fornecedores / Prestadores de Serviço
│   ├── Tipos de Tecido
│   └── Cores
│
├── Templates de Mensagem WhatsApp (globais)
│   ├── Compra de Tecido
│   ├── Risco
│   ├── Corte
│   ├── Viés
│   └── Costura
│
└── Dashboards
    ├── Dashboard Geral (admins)
    └── Dashboard de Qualidade por Oficina (admins)
```

### 2.1 Posicionamento da subtask Viés

A subtask **Viés é condicional** — só existe se o usuário marcar o checkbox correspondente na criação da OP. Quando presente, posiciona-se **entre Corte e Costura**, pois a bandeira de viés só existe fisicamente após o corte.

---

## 3. Modelo de dados — visão lógica

### 3.1 Entidades principais

| Entidade | Descrição |
|---|---|
| `OrdemProducao` | A OP em si — agrega todas as subtasks e o produto |
| `Subtask` | Unidade de trabalho de uma etapa do processo |
| `RetiradaParcial` | Evento de retirada de peças da oficina de costura |
| `SubConferencia` | Conferência associada a uma retirada (parcial ou final) |
| `Fornecedor` | Cadastro de prestador de serviço categorizado |
| `TipoTecido` | Catálogo expansível de tipos de tecido |
| `Cor` | Catálogo expansível de cores |
| `TemplateMensagem` | Template WhatsApp global por categoria |
| `Lalamove` | Registro de transporte (anexa-se a uma subtask) |
| `Anexo` | Arquivo armazenado no R2, referenciado por uma subtask |
| `Nota` | Comentário ou registro de auditoria em OP ou subtask |
| `Usuario` | Usuário interno do sistema |

### 3.2 Status padrão de uma subtask

```
Bloqueada (anterior não concluída)
  └─→ Pendente (anterior concluída, aguardando início)
        └─→ Em andamento
              ├─→ Concluída
              └─→ Cancelada (apenas em caso de cancelamento da OP)
```

Algumas subtasks têm estados intermediários próprios (ex: Compra tem "Pedido realizado", "Em trânsito", "Recebido"; Costura tem "Enviado", "Em produção", "Retirada parcial", "Finalizada").

### 3.3 Relações principais

- Uma OP tem **1..N subtasks** (5 fixas + Viés condicional)
- Uma OP tem **1..N notas**
- Uma subtask tem **0..N anexos**, **0..N Lalamoves**, **0..N notas**
- Uma subtask Costura tem **1..N retiradas** (sendo a última obrigatoriamente "final")
- Cada retirada gera **1 subconferência** dentro da subtask Conferência
- Um fornecedor pode ter **1..N categorias** (Risco, Tecido, Corte, Costura, Viés)
- Um fornecedor de tecido tem **0..N tipos de tecido** que trabalha

---

## 4. Numeração e identificadores

### 4.1 Padrão da OP

**Formato:** `OPMMAANNNN`

- `MM` — dois últimos dígitos do mês
- `AA` — dois últimos dígitos do ano
- `NNNN` — sequencial de 4 dígitos, **contínuo, reseta de 9999 para 0000**

**Exemplo:** `OP05260001` (primeira OP de maio de 2026)

### 4.2 Padrão das subtasks

**Formato:** `[PREFIXO]NNNN`

| Subtask | Prefixo | Exemplo |
|---|---|---|
| Compra de Tecido | OPBUY | OPBUY0001 |
| Risco | OPRIS | OPRIS0001 |
| Corte | OPCOR | OPCOR0001 |
| Viés | OPVIE | OPVIE0001 |
| Costura | OPSEW | OPSEW0001 |
| Conferência | OPCONF | OPCONF0001 |

O sequencial das subtasks **segue o sequencial da OP correspondente**. Subtasks da `OP05260001` recebem sequencial `0001` (`OPBUY0001`, `OPRIS0001`, etc).

**ID interno único no banco:** `[PREFIXO]-MMAA-NNNN` (ex: `OPBUY-0526-0001`), garantindo unicidade entre meses diferentes que compartilham o mesmo sequencial.

### 4.3 Número do lote

O número do lote é **igual ao número da OP** (`OP05260001`). É esse número que vai gravado no QR code dos fardos gerados na Estante Virtual.

### 4.4 Identificador de retiradas e subconferências

- Retiradas: `[OP]-RET-NN` (ex: `OP05260001-RET-01`, `OP05260001-RET-02`)
- Subconferências: herdam o identificador da retirada (`OP05260001-CONF-RET01`)

---

## 5. Permissões

Na primeira versão, o sistema é de **uso interno apenas**, com dois níveis:

| Ação | Admin | Usuário Interno |
|---|:---:|:---:|
| Criar OP | ✓ | ✗ |
| Editar subtask em andamento | ✓ | ✓ |
| Concluir subtask | ✓ | ✓ |
| Reabrir subtask concluída | ✓ | ✗ |
| Editar campo de subtask concluída | ✓ | ✗ |
| Cancelar OP | ✓ | ✗ |
| Reabrir OP fechada (autorizar) | ✓ (outro admin) | ✗ |
| Cadastrar fornecedor | ✓ | ✗ |
| Editar fornecedor existente | ✓ | ✗ |
| Cadastrar tipo de tecido / cor | ✓ | ✗ |
| Editar template WhatsApp | ✓ | ✗ |
| Ver custos da OP | ✓ | ✗ |
| Ver dashboards | ✓ | ✗ |
| Receber digest semanal | ✓ | ✗ |

**Notas:**
- Cancelamento de OP já concluída exige **autorização de outro admin** (dupla confirmação)
- A segregação mais fina (criação de novos tipos de usuário) é roadmap futuro

---

## 6. Ordem de Produção (OP)

### 6.1 Criação

Ao abrir uma nova OP, o usuário informa:

| Campo | Tipo | Obrigatório |
|---|---|:---:|
| Produto | Lookup (cadastro de SKUs existente) | ✓ |
| Incluir Viés? | Checkbox | ✓ |
| Atribuído a | Lookup (usuário interno) | ✓ |
| Observações gerais | Texto livre | — |

Ao salvar, o sistema:
1. Gera número da OP e número do lote
2. Cria as subtasks fixas + Viés (se marcado), com status inicial correto
3. Registra "Criada por" automaticamente com o usuário atual
4. Notifica o usuário atribuído por email
5. Encaminha o usuário para a tela da OP recém-criada

### 6.2 Tela da OP

**Header fixo (sempre visível, independente da subtask aberta):**

- Número da OP + número do lote
- Produto + SKU
- Status geral (% de progresso visual, baseado em subtasks concluídas)
- Criada por / Atribuído a
- Data de criação
- Botões: Editar atribuição / Imprimir / Histórico / Evidências de Pagamento / Cancelar OP

**Corpo:** Stepper vertical com as subtasks (cards expandíveis), inspirado no Change Management do ServiceNow.

Cada subtask pode ser **aberta em nova aba** via botão dedicado, permitindo múltiplas subtasks abertas em paralelo (URLs próprias).

### 6.3 Edição da atribuição

- Campo "Atribuído a" da OP é editável a qualquer momento por admin
- Cada subtask tem seu próprio "Atribuído a", editável independentemente
- Toda mudança é **registrada automaticamente nas notas** da OP ou subtask correspondente
- Notificação por email para o novo atribuído e para o anterior

### 6.4 Cancelamento de OP

- **Quem pode cancelar:** apenas admins
- **Quando pode cancelar:** em qualquer etapa, inclusive após conclusão (mas exige autorização de outro admin se OP já estiver fechada)
- **Campos obrigatórios no cancelamento:**
  - Justificativa (texto livre, obrigatório)
  - Confirmação ("Tenho certeza que quero cancelar esta OP")
  - Em caso de OP fechada: campo "Autorizado por" (outro admin)
- **Comportamento após cancelamento:**
  - Todas as subtasks ficam read-only com tag visual "OP cancelada"
  - Custos já registrados são preservados e marcados como "custo de OP cancelada"
  - Tecidos, peças e materiais em processo são alocados em categoria especial "Cancelados (OP05260001)" para contabilidade separada
  - Dados completos preservados no banco
  - OP cancelada **não pode ser reaberta** — definitivo
- **Notificações:**
  - Todos os admins
  - Atribuído atual da OP
  - Atribuídos das subtasks ativas

---

## 7. Especificação detalhada das subtasks

### 7.1 Estrutura comum a todas as subtasks

Todas as subtasks têm:

- **Header:** identificador, status, atribuído a, datas (criação, início, conclusão)
- **Bloco de campos específicos** (ver detalhamento por subtask)
- **Bloco de Lalamove** (todas, exceto Conferência) — operador escolhe entre solicitação manual ou via API quando criar; ver seção 14
- **Bloco de Valor do Serviço** (todas exceto Conferência — com cobrança fixa por subtask)
- **Bloco de Anexos** (uploads diversos)
- **Bloco de Notas** (registro manual + auditoria automática)
- **Botão de concluir** (validações obrigatórias passam antes de fechar)

---

### 7.2 Subtask 1 — Compra de Tecido (OPBUY)

**Objetivo:** registrar a aquisição do tecido com fornecedor e disparar logística para a oficina de corte.

#### Campos de pedido (antes da compra)

| Campo | Tipo | Obrigatório |
|---|---|:---:|
| Fornecedor de tecido | Lookup (categoria "Tecido") | ✓ |
| Tipo de tecido | Select com opção de cadastrar novo inline | ✓ |
| Cor(es) | Multi-select com opção de cadastrar nova inline | ✓ |
| Quantidade de KGs solicitada por cor | Numérico, um campo por cor | ✓ |
| Preço/KG sugerido | Read-only (puxa do cadastro fornecedor + tecido, se houver) | — |

#### Campos pós-compra

| Campo | Tipo | Obrigatório |
|---|---|:---:|
| Quantidade de rolos recebidos por cor | Numérico | ✓ |
| Peso de cada rolo | Lista de pesos (kg) — um campo por rolo | ✓ |
| Preço por KG efetivo | Monetário | ✓ |
| Gramatura do tecido | Numérico (g/m²) | ✓ |
| Largura do rolo | Numérico (cm) | ✓ |
| NF | Upload | — |

> ⚠️ A **largura do rolo** propaga automaticamente para Risco e Corte (read-only nessas subtasks).
>
> ⚠️ Se houver preço sugerido cadastrado e o preço efetivo divergir mais de 20%, exibir alerta visual (não-bloqueante).

#### Logística

| Campo | Tipo | Obrigatório |
|---|---|:---:|
| Remetente | Pré-preenchido com o fornecedor de tecido | ✓ |
| Destinatário | Lookup (categoria "Corte") | ✓ |

#### Lalamove

Bloco padrão de Lalamove (ver seção 14).

#### Valor do serviço

**Modelo de cobrança:** por KG.
- Cálculo automático: peso total × preço/KG = custo total do tecido

#### Ação WhatsApp

Botão "Enviar mensagem ao fornecedor" abre nova aba do WhatsApp Web (`wa.me/{telefone}?text={mensagem}`) com template editável pré-preenchido.

---

### 7.3 Subtask 2 — Risco (OPRIS)

**Objetivo:** documentar a configuração do risco com proporção de tamanhos e dados técnicos.

#### Configuração da grade

| Campo | Tipo | Obrigatório |
|---|---|:---:|
| Fornecedor de risco | Lookup (categoria "Risco") | ✓ |
| Tamanhos na folha | Multi-select (P, M, G, GG, EGG) | ✓ |
| Proporção por tamanho | Numérico, um campo por tamanho selecionado | ✓ |

**Exemplo:** se o usuário seleciona M, G, GG e informa 4, 5, 3 respectivamente, cada folha do enfesto renderá 4 M + 5 G + 3 GG = 12 peças.

#### Dados técnicos

| Campo | Tipo | Obrigatório |
|---|---|:---:|
| % de rendimento do risco | Numérico (%) | ✓ |
| Comprimento do risco | Numérico (m) | ✓ |
| Largura do risco | Numérico (cm) — ≤ largura do rolo | ✓ |
| Arquivo do risco digital | Upload (PDF/imagem) | ✓ |

> ⚠️ **Validação bloqueante:** largura do risco não pode ser maior que largura do rolo (puxada da Compra). Caso contrário, exibir mensagem clara e bloquear conclusão.

#### Lalamove

Bloco padrão (origem: empresa de risco → destino: oficina de corte). **Nós que solicitamos o Lalamove.**

#### Valor do serviço

**Modelo de cobrança:** valor total fixo (inclui digitalização + impressão).
- Campo único: valor total do serviço.

---

### 7.4 Subtask 3 — Corte (OPCOR)

**Objetivo:** registrar envio para o(s) cortador(es) e armazenar resultados do corte.

#### Distribuição entre oficinas de corte

A subtask suporta múltiplas oficinas de corte. O usuário adiciona uma oficina por vez (modelo "linhas dinâmicas").

**Para cada oficina de corte:**

| Campo | Tipo | Obrigatório |
|---|---|:---:|
| Oficina de corte | Lookup (categoria "Corte") | ✓ |
| Rolos enviados por cor | Numérico (consome do saldo de rolos da Compra) | ✓ |
| Modo de separação solicitado | Select: "por cor" / "sem separação" | ✓ |
| Lalamove (envio do risco) | Bloco padrão de Lalamove | — |
| Lalamove (envio do tecido) | Bloco padrão de Lalamove (se a oficina é diferente da que recebeu o tecido) | — |

> ⚠️ **Saldo bloqueante:** a soma dos rolos enviados por cor não pode exceder o saldo disponível (registrado na Compra). Se exceder, o sistema bloqueia.

#### Pós-corte (resultados por oficina)

| Campo | Tipo | Obrigatório |
|---|---|:---:|
| Quantidade de folhas do enfesto (papagaio) | Numérico | ✓ |
| Rendimento total | Numérico (peças totais) | ✓ |
| Rendimento por tamanho e cor | Tabela dinâmica (cor × tamanho) | ✓ |
| Foto do papagaio | Upload | — |
| Rolos descartados por defeito | Numérico + justificativa obrigatória | — |
| Fotos de defeitos no tecido | Upload múltiplo | — |

> ⚠️ **Sobre o rendimento por cor:** o cortador deve informar quantidade por cor. Esse é o dado oficial — não é estimativa.
>
> ⚠️ **Validação não-bloqueante:** o sistema calcula `folhas × proporção total` e compara com o rendimento total informado, alertando divergências.
>
> ⚠️ **Rolos descartados:** o custo desses rolos compõe o indicador "Perdas da OP" no relatório financeiro, mas não altera o custo total do tecido comprado (a NF é registrada integralmente).

#### Valor do serviço (por oficina)

**Modelo de cobrança:** por peça.
- Inputs: preço por peça × peças cortadas (puxado do rendimento total).

#### Ação WhatsApp

Botão "Enviar instruções ao cortador" com template de Corte.

---

### 7.5 Subtask 4 — Viés (OPVIE) — condicional

**Objetivo:** registrar envio da bandeira para a fábrica de viés e retorno do viés pronto para a oficina de costura.

> Só existe se o usuário marcou "Incluir Viés?" na criação da OP. Posicionada entre Corte e Costura.

#### Campos

| Campo | Tipo | Obrigatório |
|---|---|:---:|
| Fábrica de viés | Lookup (categoria "Viés") | ✓ |
| Tamanho da bandeira | Numérico (cm) | ✓ |
| Tipo de tecido | Select (pré-preenchido da Compra) | ✓ |
| Cor | Select (pré-preenchido) | ✓ |
| Metragem de viés produzida | Numérico (m) — preenchido pós-retorno | ✓ |

#### Lalamove

**Dois Lalamoves** nesta subtask:
1. Origem: oficina de corte → Destino: fábrica de viés
2. Origem: fábrica de viés → Destino: oficina de costura

#### Valor do serviço

**Modelo de cobrança:** por metro.
- Inputs: preço por metro × metragem total = custo do viés.

#### Ação WhatsApp

Botão "Solicitar viés à fábrica" com template específico.

---

### 7.6 Subtask 5 — Costura (OPSEW)

**Objetivo:** instruir oficina(s) de costura, definir etiquetagem cruzada e prazo, registrar retiradas (parciais e final).

#### Estrutura: uma subtask com sub-blocos por oficina

A Costura suporta **múltiplas oficinas em paralelo**, cada uma com seus próprios campos, prazos e retiradas.

#### Para cada oficina de costura

**Configuração de envio:**

| Campo | Tipo | Obrigatório |
|---|---|:---:|
| Oficina de costura | Lookup (categoria "Costura") | ✓ |
| Peças enviadas (tamanho × cor) | Tabela (consome do saldo do Corte) | ✓ |
| Prazo de produção | DateTime picker (calendário + relógio) | ✓ |
| Lalamove (envio das peças) | Bloco padrão | — |
| Lalamove (envio de etiquetas, opcional) | Bloco padrão — origem: armazém interno | — |

> ⚠️ O Lalamove de etiquetas é **independente** do Lalamove de peças. Seu custo é registrado em campo separado **"Lalamove (outros)"** no relatório financeiro.

**Configuração de etiquetagem (modal por oficina):**

Para cada oficina, o usuário configura como as peças devem ser etiquetadas. Esta é a regra de negócio mais complexa do módulo:

1. Sistema exibe os tamanhos comerciais disponíveis: P, M, G, GG, EGG
2. Para cada tamanho que o usuário deseja produzir nessa oficina:
   - Quantidade a ser etiquetada
3. Para cada tamanho informado que **não existe na grade de corte da OP**, o sistema pergunta: "Qual a fonte (tamanho da grade de corte) deste tamanho?"
4. Validação: soma das quantidades etiquetadas a partir de cada tamanho da grade ≤ peças enviadas para a oficina daquele tamanho

**Exemplo:**

Grade de corte: M, G, GG. Peças enviadas para Oficina X: 200 M, 400 G, 200 GG.

| Tamanho etiqueta | Quantidade | Fonte (grade) |
|---|---|---|
| P | 100 | M |
| M | 100 | M |
| G | 400 | G |
| GG | 100 | GG |
| EGG | 100 | GG |

Validação: 100+100 ≤ 200 (M) ✓, 400 ≤ 400 (G) ✓, 100+100 ≤ 200 (GG) ✓.

**Status próprio da oficina:**

```
Enviado → Em produção → (Retirada parcial → Em produção)* → Retirada final → Finalizada
```

**Valor do serviço:**
- Modelo: por peça
- Inputs: preço por peça × peças produzidas pela oficina

#### Retiradas

Botão **"Nova retirada parcial"** disponível na seção da oficina (enquanto status ≠ Finalizada).
Botão **"Retirada final"** disponível quando todas as peças estão prontas.

**Para cada retirada:**

| Campo | Tipo | Obrigatório |
|---|---|:---:|
| Tipo | Parcial / Final | ✓ |
| Quantidade retirada por tamanho × cor | Tabela | ✓ |
| Lalamove (oficina → armazém) | Bloco padrão | — |
| Data da retirada | DateTime | ✓ |

Ao confirmar uma retirada:
1. Sistema cria automaticamente uma **subconferência** dentro da subtask Conferência
2. A subtask Conferência fica ativa (status "Em andamento") se ainda estiver bloqueada
3. Notifica o atribuído da Conferência por email
4. **Modal informativo (apenas visualização):** mostra custo estimado por peça naquela retirada, dissolvendo o custo do Lalamove no lote da retirada — apenas visual, não vai pro relatório financeiro

**Cancelamento de retirada:**
- Possível **antes** da subconferência começar
- Reverte o estado anterior (saldo, status da oficina)
- Registra nas notas

#### Conclusão da subtask

A subtask Costura **só fecha** quando todas as oficinas têm status "Finalizada" (retirada final realizada).

Ao concluir, o usuário informa a **quantidade total de peças informada por cada oficina** (separada por tamanho × cor) — esse dado vai ser usado na Conferência para detectar divergências.

#### Ação WhatsApp

Botão "Enviar instruções de costura" com template incluindo peças, etiquetagem cruzada e prazo.

---

### 7.7 Subtask 6 — Conferência (OPCONF)

**Objetivo:** validar quantidade, inspecionar qualidade visual e preparar peças para entrada no estoque via Estante Virtual.

#### Estrutura: container de subconferências

A subtask Conferência é um **container** de uma ou mais subconferências (uma por retirada — parcial ou final).

```
Subtask Conferência
├── Subconferência #1 (Oficina A — retirada parcial 1) ✓
├── Subconferência #2 (Oficina A — retirada parcial 2) ✓
├── Subconferência #3 (Oficina A — retirada final)     ◐
└── Subconferência #4 (Oficina B — retirada final)     ⊘
```

A subtask Conferência **só fecha** quando:
- Todas as subconferências existentes estão concluídas
- Não há retiradas pendentes em nenhuma oficina (todas em status "Finalizada" na Costura)

#### Estrutura de cada subconferência (3 blocos)

Todas as subconferências (parciais e finais) seguem os mesmos 3 blocos.

##### Bloco 1 — Conferência quantitativa (papagaio)

**Comportamento:**

1. Sistema **NÃO mostra** a quantidade esperada antes da contagem
2. Conferente preenche quantidade recebida por tamanho × cor (tabela)
3. Ao confirmar contagem, sistema compara com:
   - Quantidade informada pela oficina (registrada na conclusão da Costura)
   - Quantidade esperada do Corte (transparência total)
4. Se houver divergência: sistema oferece **recontagem** antes de revelar os valores comparativos
5. Após a recontagem (ou recusa): sistema revela divergências com destaque visual

**Campos:**

| Campo | Tipo | Obrigatório |
|---|---|:---:|
| Quantidade recebida por tamanho × cor | Tabela | ✓ |
| Marcar oficina responsável pela divergência | Checkbox + lookup | — |
| Justificativa (se editar após confirmar) | Texto | Condicional |

##### Bloco 2 — Inspeção visual

A inspeção é **peça por peça**, realizada no ato da conferência.

**Campos:**

| Campo | Tipo | Obrigatório |
|---|---|:---:|
| Responsável pela inspeção | Lookup (usuário) | ✓ |
| Aprovadas por tamanho × cor | Tabela | ✓ |
| Reprovadas por tamanho × cor | Tabela | ✓ |
| Tipos de defeito encontrados | Multi-select | — |
| Fotos dos defeitos | Upload múltiplo | — |
| Data da inspeção | DateTime (auto-preenchido) | ✓ |

**Tipos de defeito:**
- Rebarba
- Costura desalinhada
- Costura incompleta
- Gola
- Mancha
- Tecido
- Furo
- Outros

##### Bloco 3 — Destinação

**Aprovadas:**
- Encaminhadas para organização em fardos
- **NÃO há entrada direta no estoque** — isso é feito pela Estante Virtual (ver seção 13)
- Localização física no armazém (texto livre)

**Reprovadas:**

| Campo | Tipo | Obrigatório |
|---|---|:---:|
| Destino | Select: Doação / Descarte / Retrabalho* | ✓ |

*Retrabalho registra a intenção; o fluxo de retorno à oficina como sub-fluxo é roadmap futuro.

---

## 8. Cadastros

### 8.1 Fornecedores / Prestadores de Serviço

**Campos:**

| Campo | Tipo | Obrigatório |
|---|---|:---:|
| Nome | Texto | ✓ |
| Categoria(s) | Multi-select: Risco / Tecido / Corte / Costura / Viés | ✓ |
| Endereço | Estruturado: rua, número, complemento, bairro, CEP, cidade, estado | ✓ |
| Coordenadas (lat/long) | Auto-geocoded a partir do endereço | — |
| Número de WhatsApp | Texto formatado (+55...) | ✓ |
| Observações | Texto livre | — |
| **Se categoria inclui "Tecido":** | | |
| Tipos de tecido que trabalha | Multi-select (lookup TipoTecido) | — |
| Preço sugerido por tipo de tecido | Tabela: tipo × preço/KG | — |

**Comportamento:**
- Lookups nas subtasks filtram fornecedores pela categoria correspondente
- Endereço estruturado e telefone E.164 são consumidos diretamente pela API Lalamove na criação de pedidos
- Geocoding automático (lat/long) é feito em background no save do fornecedor — campo obrigatório para uso da API

### 8.2 Tipos de Tecido

Cadastro simples: apenas nome (ex: Helanca, Moletinho, Dry-fit, Moletom).

Expansível inline a partir da subtask Compra (com confirmação).

### 8.3 Cores

Cadastro simples: apenas nome.

Expansível inline a partir da subtask Compra.

---

## 9. Templates de mensagem WhatsApp

### 9.1 Modelo

Templates **globais** (todos os usuários veem os mesmos), categorizados por tipo de subtask.

### 9.2 Categorias

- Compra de Tecido
- Risco
- Corte
- Viés
- Costura

### 9.3 Campos do template

| Campo | Tipo |
|---|---|
| Nome do template | Texto |
| Categoria | Select |
| Corpo da mensagem | Texto longo com placeholders |

### 9.4 Placeholders disponíveis

```
{op_numero}         — número da OP
{produto}           — produto da OP
{tipo_tecido}       — tipo de tecido da Compra
{cor}               — cores
{kg_total}          — peso total
{qtd_rolos}         — quantidade de rolos
{largura_rolo}      — largura do rolo
{tamanhos}          — tamanhos a serem produzidos
{proporcao}         — proporção da grade do risco
{prazo}             — prazo acordado
{fornecedor_nome}   — nome do fornecedor destinatário
{tamanho_bandeira}  — tamanho da bandeira (viés)
{etiquetagem}       — descrição da etiquetagem cruzada
```

### 9.5 Fluxo de envio

1. Usuário clica em "Enviar WhatsApp" na subtask
2. Sistema abre modal com template pré-selecionado (com opção de trocar)
3. Sistema substitui placeholders com dados reais da OP
4. Usuário pode editar a mensagem antes de enviar
5. Ao confirmar, sistema gera URL `https://wa.me/{telefone}?text={mensagem_url_encoded}` e abre em nova aba
6. Sistema registra timestamp do envio nas notas da subtask

---

## 10. Sistema de saldo

O conceito de **saldo da OP** atravessa todas as subtasks e impede distribuições que excedam o disponível.

### 10.1 Saldos rastreados

| Saldo | Origem | Consumido em |
|---|---|---|
| KG de tecido por cor | Compra | Distribuição entre cortadores (Corte) |
| Rolos por cor | Compra | Distribuição entre cortadores |
| Folhas/papagaio | Corte | (informativo) |
| Peças por tamanho × cor | Corte | Distribuição entre oficinas de costura |
| Peças por tamanho × cor por oficina | Costura | Configuração de etiquetagem |
| Peças prontas por oficina | Costura | Retiradas |

### 10.2 Comportamento

- O sistema **bloqueia** distribuições que excedam o saldo disponível, com mensagem clara
- Saldos são exibidos visualmente em cada ponto onde fazem sentido (ex: "saldo de rolos pretos: 5 de 8")
- Cancelamento de uma retirada parcial **reverte o saldo automaticamente**

### 10.3 Imutabilidade do rendimento do corte

⚠️ **Regra crítica:** o rendimento informado no Corte (total e por tamanho × cor) é **dado sólido e imutável**. Não é alterado em nenhuma circunstância, mesmo se a conferência revelar divergências. Divergências são registradas e investigadas separadamente, mas o número do corte permanece.

---

## 11. Notificações por email

### 11.1 Eventos que disparam notificações

| Evento | Destinatário(s) |
|---|---|
| Subtask anterior concluída (transição) | Atribuído da próxima subtask + atribuído da anterior (se diferente) |
| Subtask aberta há 24h sem progresso | Atribuído da subtask |
| Conclusão da OP | Todos os admins (com relatório completo) |
| Cancelamento da OP | Todos os admins + atribuído atual |
| Mudança de atribuído | Novo atribuído + anterior |
| Retirada parcial registrada | Atribuído da Conferência |
| Prazo de oficina vencendo em 24h | Atribuído da Costura |
| Prazo de oficina vencido (no momento) | Atribuído da Costura + admins |

### 11.2 Digest semanal

- Para todos os admins
- Resumo: OPs em aberto, etapas em andamento, alertas pendentes, fornecedores em atraso

### 11.3 Conteúdo dos emails

- Identificação clara da OP e subtask
- Link direto para a subtask no sistema
- Resumo do que precisa ser feito
- Para o digest de 24h: lembrete simples ("Você tem N OPs com atividades em andamento")

---

## 12. Custos e relatório financeiro

### 12.1 Modelo de cobrança por subtask (fixo)

| Subtask | Modelo | Inputs |
|---|---|---|
| Compra de Tecido | Por KG | Preço/KG × peso total |
| Risco | Valor total fixo | Valor único |
| Corte | Por peça | Preço/peça × peças cortadas (por oficina) |
| Viés | Por metro | Preço/metro × metragem |
| Costura | Por peça | Preço/peça × peças produzidas (por oficina) |
| Conferência | (sem custo) | — |

Adicionalmente: **Lalamoves** (todas as subtasks exceto Conferência).

### 12.2 Cálculos finais da OP

Ao fechar a Conferência (ou ao consultar a OP), o sistema calcula:

```
Custo total da OP = Tecido + Risco + Corte + Viés (se houver) + Costura + Lalamoves
Custo por peça produzida = Custo total / peças costuradas (com defeituosas)
Custo por peça aprovada = Custo total / peças aprovadas na Conferência
Perdas = Custo de rolos descartados (não compõe o custo principal)
```

### 12.3 Aba "Evidências de Pagamento"

Acessível a partir do header da OP, exibe:

- Lista de todos os comprovantes anexados em todas as subtasks
- Lista de todos os Lalamoves (consolidada)
- Resumo financeiro da OP (custos totais + indicadores)
- Categoria especial **"Lalamove (outros)"** para Lalamoves não-principais (ex: envio de etiquetas)

A aba serve apenas como **repositório de evidências e visualização consolidada**. Os inputs estruturados (que alimentam os cálculos) permanecem dentro das subtasks correspondentes.

### 12.4 Cancelamento e perdas

OPs canceladas:
- Custos preservados, categorizados como "Custo de OP cancelada (OP05260001)"
- Materiais em processo categorizados em "Cancelados (OP05260001)"
- Não somam ao custo médio operacional

Rolos descartados por defeito:
- Compõe indicador separado "Perdas da OP" no relatório
- Não altera o custo principal

---

## 13. Integração com Estante Virtual

### 13.1 Fluxo

```
Conferência aprova peças
         │
         ▼
Organização em fardos (por cor + tamanho)
         │
         ▼
Geração de etiquetas com QR code (módulo Estante Virtual)
   └─ QR contém: SKU, quantidade, número da OP/lote
         │
         ▼
Bipagem dos fardos → entrada no estoque
```

### 13.2 Pontos de integração

- O **gerador de QR code da Estante Virtual** recebe nova funcionalidade: campo "OP/Lote" no momento de gerar o QR
- O número da OP fica gravado no QR
- A subtask Conferência **não dispara** automaticamente a geração de QR — esse passo é feito separadamente no módulo Estante Virtual
- Não há feedback do estoque de volta para a OP (fluxo unidirecional)

### 13.3 Padrão de fardo

- Cada fardo contém **apenas uma cor + um tamanho**
- Se chegar misturado da oficina, é reorganizado no armazém antes da geração do QR
- A oficina é orientada a enviar fardos já no padrão (mas a conformidade é validada no recebimento)

---

## 14. Lalamove — integração com a API v3

### 14.1 Modos de operação

O módulo suporta dois modos simultâneos, controlados por feature flag global e por escolha do operador em cada Lalamove individual:

- **Manual**: operador preenche valor, faz upload do comprovante e atualiza status à mão. Sempre disponível, mesmo com a API habilitada.
- **API**: backend cota e cria pedido via API Lalamove v3; status é atualizado em tempo real por webhook. Disponível quando `lalamove_api_habilitada = true` e o operador opta por usar a API ao criar o Lalamove.

Os dois modos compartilham a mesma entidade no banco. O campo `origem_solicitacao` (`manual` | `api`) distingue os registros.

### 14.2 Estrutura do registro

Cada Lalamove é uma entidade separada no banco com:

| Campo | Tipo | Modo manual | Modo API |
|---|---|---|---|
| Subtask de origem | FK | Sim | Sim |
| Retirada de origem | FK (opcional) | Sim | Sim |
| Tipo | Principal / Outros | Sim | Sim |
| Origem da solicitação | manual / api | Sim | Sim |
| Endereço de origem (estruturado) | JSONB | Sim | Sim |
| Endereço de destino (estruturado) | JSONB | Sim | Sim |
| Coordenadas origem/destino | lat/long | Sim | Sim (obrigatório) |
| Contato origem (nome + telefone E.164) | Texto | Opcional | Obrigatório |
| Contato destino (nome + telefone E.164) | Texto | Opcional | Obrigatório |
| Instruções pro motorista (`remarks`) | Texto | — | Opcional |
| Status | Enum (ver tabela em 14.5) | Sim | Sim |
| Valor | Monetário | Digitado | Vem da API |
| Moeda | Texto (default BRL) | Sim | Sim |
| Conteúdo transportado | Texto descritivo | Sim | Sim |
| Quantidade de peças | Numérico | Sim | Sim |
| Service type (ex: MOTORCYCLE, VAN) | Texto | — | Obrigatório |
| Special requests | Array de texto | — | Opcional |
| Schedule at (agendamento) | DateTime (UTC) | — | Opcional |
| Quotation ID (API) | Texto | — | Sim |
| Order ID (API) | Texto (19 dígitos) | — | Sim |
| Share link (rastreio público) | URL | — | Sim |
| Driver: id, nome, telefone, placa | Texto | — | Sim |
| Distância (metros) | Numérico | — | Sim |
| Price breakdown | JSONB | — | Sim |
| Última localização do motorista | lat/long + timestamp | — | Sim |
| Comprovante (upload) | Anexo | Sim | Opcional |
| Data de solicitação | DateTime | Sim | Sim |
| Data de coleta | DateTime | Sim | Sim |
| Data de entrega | DateTime | Sim | Sim |

### 14.3 Tabelas auxiliares (modo API)

**`lalamove_cotacoes`** — toda cotação criada pela API fica registrada. Tem validade de 5 minutos. Cada Lalamove pode acumular várias cotações (ex: cotou, operador demorou, cotou de novo) até uma virar pedido.

**`lalamove_webhook_events`** — log cru de todo evento recebido da API. Tabela append-only, processada em job assíncrono. Permite reprocessar histórico se necessário.

Detalhes técnicos completos no `CLAUDE.md`.

### 14.4 Lalamoves por subtask (não muda com a API)

| Subtask | Lalamoves |
|---|---|
| Compra de Tecido | 1 (fornecedor → corte) |
| Risco | 1 (empresa de risco → corte) — solicitado por nós |
| Corte | 1..N (corte → costura ou viés), dividido se múltiplas oficinas |
| Viés | 2 (corte → fábrica viés, fábrica viés → costura) |
| Costura | 1 por retirada + 0..N para etiquetas (categoria "outros") |
| Conferência | — |

### 14.5 Status: mapeamento interno ↔ API

| Status interno | Status API | Significado |
|---|---|---|
| `rascunho` | — | Lalamove criado mas sem ação ainda |
| `cotado` | — | Cotação válida criada, sem order |
| `procurando_motorista` | `ASSIGNING_DRIVER` | Order criado, esperando match |
| `motorista_designado` | `ON_GOING` (early) | Motorista aceitou, ainda não saiu |
| `a_caminho_coleta` | `ON_GOING` | Motorista a caminho do pickup |
| `coletado` | `PICKED_UP` | Mercadoria coletada |
| `entregue` | `COMPLETED` | Entrega concluída |
| `cancelado` | `CANCELED` | Cancelado por nós ou pelo motorista |
| `rejeitado` | `REJECTED` | Nenhum motorista aceitou |
| `expirado` | `EXPIRED` | Pedido expirou sem motorista |

> No modo manual, o operador transita explicitamente entre `rascunho` → `coletado` → `entregue`. Os status `procurando_motorista`, `rejeitado` e `expirado` são exclusivos do modo API.

### 14.6 Fluxo de criação via API (UI)

1. Operador abre o bloco Lalamove da subtask
2. Preenche conteúdo transportado e quantidade de peças
3. Confere endereços de origem e destino (puxados do cadastro de fornecedor; editáveis se necessário)
4. Escolhe service type (default sugerido pelo sistema com base no conteúdo)
5. Clica **"Cotar via API"**
   - Sistema chama a API e mostra o valor cotado + countdown de 5 minutos
   - Modal exibe valor, distância estimada e breakdown
6. Operador clica **"Confirmar pedido"**
   - Sistema revalida cotação (recota se expirou)
   - Cria order na API
   - Status muda para `procurando_motorista`
7. UI mostra share link de rastreio público (compartilhável com fornecedor/oficina)
8. Eventos do webhook atualizam status, driver e localização em tempo real

### 14.7 Cancelamento de Lalamove via API

- Cancelamento individual: botão "Cancelar Lalamove" disponível enquanto status ∈ {`cotado`, `procurando_motorista`, `motorista_designado`, `a_caminho_coleta`}
- Após `coletado`, cancelamento não é mais possível pela API — sistema bloqueia o botão e instrui a contatar a Lalamove
- Cancelamento em cascata: quando a OP ou subtask é cancelada, todos os Lalamoves ativos com `origem_solicitacao = 'api'` recebem `DELETE /v3/orders/{id}` automaticamente
- Falha no cancelamento via API não bloqueia o cancelamento interno — gera nota de auditoria e alerta para um admin

### 14.8 Webhook

- Endpoint público: `POST /api/webhooks/lalamove`
- Configurado uma única vez no Partner Portal da Lalamove (ou via `PATCH /v3/webhook`)
- Eventos esperados: `ORDER_STATUS_CHANGED`, `DRIVER_ASSIGNED`
- Responde 200 em até 5 segundos sempre; processamento real é assíncrono
- Idempotência: eventos duplicados (mesma chave evento+order_id+timestamp) são ignorados
- Fallback: a cada 5 minutos, job consulta `GET /v3/orders/{id}` para Lalamoves ativos cuja `atualizada_em` está estagnada — cobre eventuais falhas de webhook

### 14.9 Mapa em tempo real (dashboard)

- Job a cada 60s busca `last_driver_lat/lng` via `GET /v3/orders/{id}/drivers/{driverId}/location`
- Apenas para Lalamoves com status ∈ {`a_caminho_coleta`, `coletado`}
- Dashboard renderiza pontos no mapa com cor por status e tooltip com OP, conteúdo e motorista

---

## 15. Dashboards

### 15.1 Dashboard Geral (acesso: admins)

**KPIs (top):**
- OPs abertas
- OPs em atraso
- OPs concluídas no mês

**Painéis:**
- OPs por etapa (gráfico de barras: Compra, Risco, Corte, Viés, Costura, Conferência)
- Mapa de Lalamoves ativos (renderiza posições reais quando a API está habilitada; vazio no modo manual)
- Lista/kanban resumido de OPs em andamento

**Alertas:**
- Lalamove com tempo de procura alto
- Oficinas em atraso (prazo vencido)
- Conferências com peças a menos vs. informado pela oficina

**Filtros:** período, produto, fornecedor

### 15.2 Dashboard de Qualidade por Oficina (acesso: admins)

**Métricas por oficina/costureiro:**
- % de aprovação (peças aprovadas / peças retornadas)
- Tempo médio de entrega
- % de descumprimento de prazo

**Funcionalidades:**
- Ranking de oficinas
- Histórico individual ao clicar na ficha do costureiro
- Filtros por produto e período (checkbox para alterar visão)

### 15.3 Definição de "atraso"

- Comparação entre prazo cadastrado (calendário + relógio) e data atual
- Alertas:
  - 24h antes do vencimento
  - No momento do vencimento
  - Diariamente após vencimento (lembrete persistente)

---

## 16. Auditoria e edição retroativa

### 16.1 Registro automático nas notas

Todas as ações abaixo geram entrada automática no campo de notas da subtask ou OP correspondente:

- Mudança de status
- Mudança de atribuído
- Edição de campo concluído
- Cancelamento de OP
- Reabertura de subtask
- Cancelamento de retirada parcial
- Envio de mensagem WhatsApp (timestamp)

### 16.2 Edição retroativa

- Só admin pode editar campo de subtask concluída
- Botão "Editar informações" exige popup de confirmação:
  > "As alterações realizadas continuarão registradas no sistema. Confirma?"
- Campo de justificativa obrigatório
- Registro completo nas notas: quem editou, quando, valor antigo, valor novo, justificativa

### 16.3 Reabertura de subtask

- Só admin
- Permite reabrir subtask **concluída** (caso de "marcou como concluída por engano")
- Registro automático nas notas

### 16.4 Edição na Conferência

- O conferente pode editar a contagem após confirmar inicialmente
- Edição **exige justificativa**, registrada nas notas

---

## 17. Infraestrutura

### 17.1 Banco de dados

**PostgreSQL via Neon** (free tier inicialmente).

**Free tier (suficiente para fase de implementação e operação inicial):**
- 0,5 GB de armazenamento por projeto
- 100 CU-hours/mês de compute
- PITR de 6 horas (sem backups agendados automáticos)
- Compute escala até 2 CUs
- Cold start ~500ms p99

**Critérios para migrar para o plano Launch ($5/mês):**
- Uso de armazenamento > 400 MB
- Uso de CU-hours > 80/mês por 2 meses seguidos
- OPs reais em produção há mais de 3 meses
- Mais de 1 usuário simultâneo regularmente
- Dados que não podem ser perdidos sob nenhuma hipótese

### 17.2 Backup

**Plano enquanto no Neon free:**
- Backup automatizado semanal via script (configurado pelo dev)
- Dump completo (`pg_dump`) exportado para o Cloudflare R2
- Reter pelo menos 4 backups (mês corrente)
- Mensalmente, backup adicional retido por 12 meses

### 17.3 Object storage para anexos

**Cloudflare R2** (free tier).

**Free tier:**
- 10 GB de armazenamento
- 1 milhão de operações Classe A (uploads)/mês
- 10 milhões de operações Classe B (reads)/mês
- Egress gratuito

**Configuração:**
- Limite de **50 MB por arquivo** no upload
- Buckets organizados por OP (`op-{numero}/anexo-{id}.{ext}`)
- URLs assinadas para acesso seguro

### 17.4 Estimativa de uso inicial

- 20 OPs/mês × ~10 MB de dados estruturados/mês = ~5 anos de margem no Neon free
- 20 OPs/mês × ~50 MB de anexos/mês = ~200 meses de margem no R2 free

---

## 18. Casos especiais e exceções

### 18.1 Defeito grave em rolo de tecido (no Corte)

- Campo "Rolos descartados por defeito" com:
  - Quantidade
  - Justificativa obrigatória
  - Foto opcional
- Custo desses rolos vai para indicador "Perdas da OP" (não altera custo principal)
- A NF da Compra permanece registrada integralmente

### 18.2 Atraso de oficina

- Sistema compara prazo cadastrado com data atual
- Alertas:
  - 24h antes do vencimento (notificação)
  - No vencimento (notificação)
  - Diariamente após vencimento (alerta persistente no dashboard)

### 18.3 Retalhos de tecido

- Não rastreados pelo sistema (volume pequeno, geralmente fica com a oficina)

### 18.4 Cancelamento de retirada parcial

- Possível antes da subconferência começar
- Reverte estado anterior (saldos, status da oficina)
- Registro automático nas notas

### 18.5 OP cancelada após conclusão

- Exige autorização de **outro admin**
- Dados preservados integralmente
- Categorização especial "Cancelados (OP05260001)"

### 18.6 Sequencial passando de 9999

- Reseta para 0000
- Não causa colisão porque o ID completo no banco inclui mês/ano (`OP-MMAA-NNNN`)

---

## 19. Roadmap de implementação

### 19.1 MVP (versão 1.0)

Funcionalidades essenciais para o sistema ser usável em produção:

- OP + 6 subtasks (incluindo Viés condicional)
- Cadastros de fornecedores, tecidos, cores
- Sistema de saldo bloqueante
- Campos básicos de todas as subtasks
- Múltiplas oficinas no Corte e na Costura
- Retiradas parciais com subconferências
- Lalamove manual (upload + valor)
- Templates WhatsApp (versão simples sem placeholders dinâmicos avançados)
- Cálculo de custo real
- Aba "Evidências de Pagamento"
- Notificações por email (eventos críticos)
- Auditoria nas notas
- Dashboards básicos
- Backup semanal automatizado
- Integração com Estante Virtual (campo OP/Lote no QR)

### 19.2 V1.1

- Templates WhatsApp com placeholders dinâmicos completos
- Validações cruzadas refinadas (largura risco vs. rolo, etiquetagem vs. saldo)
- Dashboard de Qualidade por Oficina completo
- Alertas de atraso completos
- Histórico individual de costureiro

### 19.3 V1.2

- Notas internas vs. públicas (modelagem desde o MVP, mas funcionalidade visível em V1.2)
- Refinamento de permissões (novos tipos de usuário)
- Otimizações de UX

### 19.4 V1.3 — Integração Lalamove API

Sub-fases entregáveis individualmente:

- **V1.3a:** cotação assistida — usar a API só para mostrar valor estimado antes do operador pedir no app oficial
- **V1.3b:** pedido automatizado via API com feature flag por Lalamove individual
- **V1.3c:** webhook em produção + cancelamento em cascata
- **V1.3d:** mapa de Lalamoves ativos no dashboard com posição do motorista em tempo real

A modelagem de banco já contempla os campos da API desde o MVP — V1.3 ativa o fluxo, sem migration estrutural.

### 19.5 V2

- Sub-fluxo de retrabalho (retorno à oficina)
- Acesso externo controlado para oficinas (com notas públicas)
- Tempo médio de produção no cadastro de SKU
- Reordens / clonagem inteligente de OP

---

## 20. Glossário

| Termo | Definição |
|---|---|
| **OP** | Ordem de Produção — a unidade central do módulo |
| **Subtask** | Etapa do processo de confecção (Compra, Risco, Corte, Viés, Costura, Conferência) |
| **Subconferência** | Conferência associada a uma retirada específica (parcial ou final) |
| **Lote** | Identificador único da produção, igual ao número da OP |
| **Saldo** | Quantidade disponível de um recurso (rolos, peças) em um ponto do fluxo |
| **Papagaio** | Amostra de folhas do enfesto que indica a quantidade real cortada |
| **Bandeira** | Pedaço de tecido cortado com sobra de mesa para confecção de viés |
| **Viés** | Acabamento de gola/braço, geralmente em galoneira |
| **Enfesto** | Empilhamento de folhas de tecido sobre a mesa de corte |
| **Grade de corte** | Tamanhos efetivamente cortados (geralmente M, G, GG) |
| **Grade comercial** | Tamanhos etiquetados para venda (P, M, G, GG, EGG) |
| **Etiquetagem cruzada** | Processo de etiquetar uma peça da grade de corte com um tamanho da grade comercial diferente |
| **Retirada parcial** | Retirada de parte das peças da oficina antes da conclusão total |
| **Retirada final** | Última retirada de uma oficina, encerra a costura naquela oficina |
| **Fardo** | Conjunto de peças da mesma cor e tamanho, agrupadas para entrada no estoque |

---

**Fim do documento de arquitetura.**

Próximos passos:
1. Validar este documento com o dev parceiro
2. Wireframes das telas principais
3. Modelagem física do banco (ver `CLAUDE.md`)
4. Priorização final do MVP
