# RITM-01 — Módulo de criptografia (AES-256-GCM)

> **Bloqueia:** RITM-05, RITM-07, RITM-09
> **Depende de:** nada
> **Dependência externa:** nenhuma (não precisa da doc TikTok)

---

## Objetivo

Criar helper genérico pra encriptar/decriptar strings usando AES-256-GCM. Usado pra tokens OAuth (nesta onda) e futuramente certificados digitais A1, credenciais Shopee, credenciais ML, etc.

---

## Arquivos a criar

- `src/lib/crypto.ts`
- `src/lib/crypto.test.ts` (ou `.spec.ts` seguindo convenção do projeto)
- `.env.example` — adicionar `ENCRYPTION_MASTER_KEY`

---

## Especificação

### Chave mestra
- Env var: `ENCRYPTION_MASTER_KEY`
- Formato: base64 de 32 bytes
- Gerar com: `openssl rand -base64 32`
- Gabriel deve colocar no `.env.local` **antes** de rodar os testes

### Algoritmo
- `aes-256-gcm` (nativo do `node:crypto`)
- IV de 12 bytes (padrão GCM)
- IV novo gerado a cada chamada de `encrypt` (aleatório, via `randomBytes`)
- AuthTag de 16 bytes (extraído pelo `cipher.getAuthTag()`)

### Formato do envelope
String única contendo `base64(iv) . base64(ciphertext) . base64(authTag)` separados por ponto.

Exemplo: `"XYZabc123==.LongCipherTextInBase64==.AuthTagInBase64=="`

### API

```typescript
export function encrypt(plaintext: string): string;
export function decrypt(envelope: string): string;
```

### Comportamento

- `encrypt("")` deve funcionar (string vazia é input válido)
- `encrypt("hello")` duas vezes deve retornar envelopes **diferentes** (IV aleatório)
- `decrypt(envelope)` de envelope adulterado **deve lançar erro** (authTag não valida)
- `decrypt("formato-invalido")` deve lançar erro claro
- Falha ao inicializar se `ENCRYPTION_MASTER_KEY` ausente ou com tamanho errado

---

## Implementação de referência

```typescript
// src/lib/crypto.ts
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function getKey(): Buffer {
  const b64 = process.env.ENCRYPTION_MASTER_KEY;
  if (!b64) {
    throw new Error('ENCRYPTION_MASTER_KEY não configurada no ambiente');
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_MASTER_KEY deve ter 32 bytes (base64), recebido ${key.length}`
    );
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    ciphertext.toString('base64'),
    authTag.toString('base64'),
  ].join('.');
}

export function decrypt(envelope: string): string {
  const parts = envelope.split('.');
  if (parts.length !== 3) {
    throw new Error('Envelope inválido: formato esperado "iv.ct.tag"');
  }
  const [ivB64, ctB64, tagB64] = parts;
  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');

  if (iv.length !== IV_LEN) {
    throw new Error(`IV inválido: esperado ${IV_LEN} bytes`);
  }

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plaintext.toString('utf8');
}
```

---

## Testes obrigatórios

Em `src/lib/crypto.test.ts`:

1. ✅ Round-trip: `decrypt(encrypt("hello")) === "hello"`
2. ✅ Round-trip string vazia: `decrypt(encrypt("")) === ""`
3. ✅ Round-trip unicode: `decrypt(encrypt("café 🎉 日本")) === "café 🎉 日本"`
4. ✅ Round-trip string longa (10k chars)
5. ✅ Duas chamadas de `encrypt` com mesmo input retornam envelopes diferentes
6. ✅ `decrypt` com envelope adulterado (trocar 1 char do ciphertext) lança erro
7. ✅ `decrypt` com formato inválido ("abc") lança erro
8. ✅ `decrypt` com authTag adulterado lança erro

---

## Critérios de aceitação

- [ ] Todos os 8 testes passam
- [ ] `ENCRYPTION_MASTER_KEY` documentada no `.env.example`
- [ ] Função nunca loga plaintext descriptografado
- [ ] Código usa apenas `node:crypto` (sem libs externas)
- [ ] TypeScript strict sem warnings

---

## Notas de segurança

- **MVP:** chave em env var é aceitável
- **Produção SaaS (futuro):** migrar pra KMS (AWS KMS ou Google KMS). Ponto de reabertura: quando este módulo começar a armazenar dados de terceiros.
- Nunca incluir este envelope em logs, stack traces ou mensagens de erro ao usuário
