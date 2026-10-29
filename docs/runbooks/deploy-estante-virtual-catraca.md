# Runbook — Deploy da catraca anti-duplicata (Estante Virtual)

Corrige três defeitos na inclusão de fardos: duplicata por corrida entre
operadores, SKU sem padronização e etiqueta malformada. Envolve mudança de
banco (duas colunas e dois índices únicos parciais em `estante_fardo`).

As operações no banco de produção rodam pelo workflow
**Manutenção do banco — Estante Virtual**
(`.github/workflows/manutencao-estante.yml`), que recebe a conexão pelo
segredo `NEON_DATABASE_URL_PROD`. Ninguém precisa ter a senha do banco na
máquina.

---

## ⚠️ Três regras

### 1. Banco antes do merge

O projeto da Vercel está ligado ao GitHub: **todo merge na `main` publica
produção automaticamente**.

```
app nova + banco velho  →  INSERT em coluna inexistente  →  toda inclusão quebra
app velha + banco novo  →  colunas nulas, índices parciais ignoram  →  seguro
```

O modo `aplicar` do workflow é seguro com a aplicação atual no ar. O merge só
vem depois dele.

### 2. Não usar `drizzle-kit push` para esta mudança

O `db:migrate:prod` usa `drizzle-kit push`, que remove objetos que não estão
declarados no `schema.ts` (ver AGENTS.md). Em vez dele, o workflow aplica o SQL
exato das migrations `0037` e `0038`, de forma idempotente
(`ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`). O modo
`aplicar` confere que nenhum outro objeto do banco foi alterado.

### 3. Duplicatas saem antes do índice

Índice único não nasce sobre dados que o violam. O modo `aplicar` já segue a
ordem: backup → limpeza → colunas → preenchimento → índices.

---

## Repositório público: o que o workflow nunca imprime

Os logs e artefatos de workflows de um repositório público são visíveis a
qualquer pessoa. Por isso:

- Os scripts rodam com `SAIDA_RESUMIDA=1` e imprimem **só contagens**: nenhum
  SKU, lote, código de fardo, nome de estante ou endereço do banco.
- Backup e relatório de linhas removidas saem **criptografados com GPG** para
  uma chave pública informada no disparo. Só quem tem a chave privada abre.
- Artefatos ficam retidos por 1 dia e devem ser apagados após o download.

---

## Passo a passo

Gerar o par de chaves na máquina de quem vai operar (uma vez):

```bash
export GNUPGHOME=/caminho/privado/gnupg
gpg --batch --passphrase '' --quick-gen-key "scaleon-deploy" rsa4096 encr 1d
gpg --armor --export scaleon-deploy > chave-publica.asc
```

### Passo 1 — Auditar (só leitura)

```bash
gh workflow run manutencao-estante.yml -f modo=auditar
```

Confira no log: é o banco certo (contagens batem com o que a aplicação mostra),
quantas duplicatas existem e quantas peças estão contadas a mais.

### Passo 2 — Backup e ensaio local

```bash
gh workflow run manutencao-estante.yml -f modo=backup -f chave_publica="$(cat chave-publica.asc)"
gh run download <id> -n backup-producao
gpg --decrypt backup.dump.gpg > backup.dump
```

Restaurar o `backup.dump` num banco local descartável e rodar lá a mesma
sequência (`auditar-duplicatas-estante.ts --apply`,
`aplicar-migracao-estante.ts --fase=colunas`,
`backfill-identidade-estante.ts --apply`,
`aplicar-migracao-estante.ts --fase=indices`).

### Passo 3 — Aplicar em produção

```bash
gh workflow run manutencao-estante.yml -f modo=aplicar \
  -f confirmacao=APLICAR -f chave_publica="$(cat chave-publica.asc)"
```

Faz backup criptografado, remove duplicatas (mantendo a linha mais antiga),
cria as colunas, preenche a identidade, cria os índices e audita de novo.
O relatório das linhas removidas vai criptografado no artefato
`relatorio-duplicatas`. **Guarde-o**: as linhas removidas não voltam sem ele ou
sem o backup.

### Passo 4 — Merge da Estante

Só depois do passo 3 concluído. O merge publica automaticamente.

### Passo 5 — Aplicar de novo

Rode o passo 3 outra vez. Fardos incluídos pela aplicação antiga entre o
passo 3 e o merge ficaram sem identidade; a segunda execução preenche esses e
remove eventuais duplicatas do intervalo. Todos os passos são idempotentes.

### Passo 6 — Validar

- `modo=auditar`: zero duplicatas, índices presentes
- Na aplicação: incluir um fardo novo (entra), repetir o mesmo (duplicado),
  colar texto inválido (recusado)

Apagar os artefatos:

```bash
gh api -X DELETE repos/NWCVenture/Scaleonreplicado/actions/artifacts/<id>
```

---

## Rollback

**Aplicação:** promover o deploy anterior na Vercel. A aplicação antiga ignora
as colunas novas — elas ficam nulas e nada quebra.

**Banco:** colunas e índices são aditivos; mantê-los é inofensivo. Para
remover:

```sql
DROP INDEX IF EXISTS uq_estante_fardo_uuid_conta;
DROP INDEX IF EXISTS uq_estante_fardo_codigo_conta;
ALTER TABLE estante_fardo DROP COLUMN IF EXISTS codigo_fardo;
ALTER TABLE estante_fardo DROP COLUMN IF EXISTS fardo_uuid;
```

**Duplicatas removidas não voltam com isso** — precisam do relatório
criptografado ou do backup.

---

## O que este deploy não resolve

**Etiquetas v1** (`SKU}LOTE}QTD`) continuam sem como ser deduplicadas: não
carregam identificador, e dois fardos físicos distintos do mesmo produto, lote
e quantidade geram strings idênticas. A aplicação agora avisa ("incluído sem
verificação de duplicata"). Resolver exige reimprimir essas etiquetas.

**SKUs divergentes já gravados** não são corrigidos; a padronização vale para
inclusões novas.

---

## Adendo — "Autorizar QR duplicado" (migration 0039)

Etiquetas foram impressas em várias cópias e coladas em fardos físicos
diferentes. A catraca recusava a segunda bipagem. Agora o scanner tem a chave
**Autorizar QR duplicado** (por sessão, começa desligada): com ela ligada, a
repetição entra como **cópia** (`duplicado_autorizado = true`), marcada no
histórico com o selo "QR DUPLICADO" e o filtro "Só QR duplicado" — base da
auditoria diária.

Mudança de banco, aditiva:

- coluna `duplicado_autorizado boolean NOT NULL DEFAULT false` em
  `estante_fardo` e `estante_movimentacao`;
- os dois índices da catraca recriados com `AND duplicado_autorizado = false`:
  continua existindo no máximo **um original** por etiqueta; as cópias ficam
  fora do índice.

### Mesmas regras, mesma ordem: banco antes do merge

```
app nova + banco velho  →  coluna inexistente  →  inclusão, retirada, detalhe e histórico da Estante quebram
app velha + banco novo  →  coluna fica false, índice equivale ao antigo  →  seguro
```

1. Disparar o workflow **a partir da branch da feature** (o arquivo do
   workflow que roda é o da branch escolhida), `modo=aplicar`. O passo novo
   "Cópias autorizadas (migration 0039)" roda `aplicar-migracao-estante.ts
   --fase=duplicados`. A troca dos índices é DROP + CREATE na mesma transação
   — não há instante sem catraca.
2. Conferir no log: `colunas_duplicado=2/2 indices_com_duplicado=2/2` e
   "Conferência OK".
3. Merge do PR. A Vercel publica.

### O script de limpeza respeita as cópias

`auditar-duplicatas-estante.ts` ignora linhas com `duplicado_autorizado` (e
roda igual antes da 0039, quando a coluna ainda não existe). Sem isso, qualquer
disparo do workflow em modo `aplicar` depois da feature em uso **apagaria as
cópias autorizadas** como se fossem duplicatas.

### Rollback

**Aplicação:** promover o deploy anterior na Vercel. A aplicação antiga ignora
a coluna; as cópias já gravadas continuam no estoque e podem ser retiradas.

**Banco:** não voltar os índices à definição antiga com cópias gravadas — o
`CREATE UNIQUE INDEX` falha (as cópias violam). Manter a 0039 é inofensivo.
