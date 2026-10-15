# Histórico do Projeto — Splittr

Blocos concluídos que saíram do `ESTADO.md` para ele caber em ~120 linhas (regra do CLAUDE.md, seção 4).
O texto foi movido sem edição em 2026-10-15. Daqui para frente, o que for concluído e sair do `ESTADO.md` entra
no fim deste arquivo, com a data da mudança. O detalhe de cada mudança continua no `git log`.

---

## Concluído nas Etapas 2–4 (como estava no ESTADO)
- **Etapas 2–4:** lock otimista em `Settlement`, Docker, logging pino, Swagger detalhado,
  `SplitCalculator` (D-57), cobertura com thresholds que falham o build.

## Etapa 5 — concluída e commitada
| Entrega | Decisões | Commit |
|---|---|---|
| CORS, Redis resiliente, helmet, rate limit, bcrypt 12, Swagger fora de produção | D-58…D-62, D-66…D-70 | `cc59d3b`…`d100475` |
| Convite por email/telefone, soft delete, 403, auditoria de despesa | D-71…D-82 | `f40a9ab`…`7f3a816` |
| README + LICENSE; 0 vulnerabilidades, auth em `preValidation`, Postman | D-63, D-64, D-83, D-84 | `0ac392d`, `ff1a921` |
| Bloco 4: integração dos 5 repositórios, socket server, caches, bcrypt injetável, bug do `findByUserId` | D-85…D-87 | `86b79e4`…`4761f12` |

## API para o frontend — commitada (`dc1ff53`, `826b98e`)
- **D-88:** `GET /users/me` → `{ user: { id, name, email, phone, pixKey } }`.
- **D-89:** `GET /groups/:groupId/settlements?status=` (mais recentes primeiro); `Settlement` ganhou `createdAt`.
- **D-90:** todo erro de validação responde `{ message: 'Dados inválidos.', issues: [{ path, message }] }`,
  com caminho pontuado e mensagens do Zod em português (`z.locales.pt()`).
- **D-91:** `/refresh` saiu do limite de 5/min; fica no global de 100/min.
- **D-92:** `version` obrigatório no `PATCH /expenses/:id`; diferente da atual → 409. Listagem e resposta do
  `PATCH` trazem `version`. Fecha o risco do D-82 (cliente com tela velha).
- **D-93:** `GET /expenses/:expenseId/revisions` com `editedBy: { userId, name }`, inclusive de quem saiu.
- Postman: `version` no `PATCH`, 3 requests novos, script que salva o `settlementId` pendente.

## Contrato do back para o front — Fase B (branch `fix/api-para-o-front`, um commit por decisão)
- **D-104:** login e cadastro respondem em português ("Email ou senha incorretos.", "Já existe uma conta com este email.").
- **D-100:** `GET /groups/:id` e `/members` trazem `userId` em cada membro.
- **D-98 (+P-8):** `amount` de despesa (criar e editar), partes e acerto aceitam string decimal com até 2 casas, além de number.
- **D-99:** `GET /balances` desconta acertos CONFIRMED; cache de saldos invalidado ao adicionar/remover membro, sair e confirmar acerto.
- **D-105:** a string de dinheiro aceita no máximo 8 dígitos inteiros (até `99999999.99`, o que cabe em `Decimal(10, 2)`); 9 ou mais → 400 em `amount`.

## Prontidão para deploy — branch `chore/deploy-readiness` (alvo: Azure Container Apps, 1 réplica)
- **D-106:** migrations na inicialização; `prisma` em `dependencies` e `prisma/` no runtime (+~61 MB); serviço `migrate` do compose saiu.
- **D-109:** `tini` é o PID 1 e `docker-entrypoint.sh` (`set -e`) migra e faz `exec node`: node é filho direto do tini, sem npm/sh.
- **Encerramento pelos hooks do Fastify:** `preClose` faz `io.local.disconnectSockets(true)`; `onClose` fecha pub/sub (no
  `createSocketServer`) e Prisma + cache (no `app.ts`, com `allSettled`). SIGTERM/SIGINT só chamam `app.close()`, com prazo de 10 s.
- Porta 3333 no schema e `ENV PORT=3333` na imagem; `CORS_ORIGIN` exige origens exatas (`new URL(item).origin === item`, sem `*`);
  `.dockerignore` com `.env.*`/`src/tests`; compose com `redis:8-alpine` sem volume nem snapshot (`--save ''`) e Postgres/Redis só em `127.0.0.1`.
- **Fase 3 (15/10, projeto compose isolado):** app `healthy`; 544 → 545 MB (tini +0,8 MB; a cópia de `.prisma` removida
  era 4,1 kB); `tini` PID 1 e `node` PID 7 com PPID 1; `compose stop` em 0,68 s, socket aberto recebeu `io server disconnect`,
  logs na ordem sinal → sockets → HTTP → pub/sub → Prisma/cache → concluído, saída 0, sem warn/erro.
- Já atendidos: `/health/live` (sem dependências) e `/health/ready` (Postgres + Redis, 503), `0.0.0.0` + `PORT`, CORS do Fastify e do Socket.IO por `CORS_ORIGIN`,
  `rediss://` nos 3 clients (todos leem `REDIS_URL`).
- **D-107 inviável:** o Fastify 5.12.5 tornou `trustProxy` numérico fail-closed (`lib/request.js`) e tirou `number` dos tipos.
- **D-108 (revista):** `TRUST_PROXY_HOPS` (inteiro >= 0, padrão 0; 1 no Container Apps) via função de confiança, já que o
  Fastify 5.12 ignora número. O IP vem da direita do `X-Forwarded-For`; o valor forjado à esquerda é ignorado.

---

## Decisões tomadas até 2026-10-14 (D-01…D-107)

### Etapas 2–4 (D-01…D-57)
Ver git log. Exceções à opção A: **D-09** (B), **D-23** (B), **D-35** (B), **D-39** (B), **D-48** (B),
**D-50** (B), **D-54** (B), **D-55** (C).

### Etapa 5 — 2026-09-26 (D-58…D-82)
Todas na opção **A**, exceto **D-59** (C — `sameSite` derivado de `NODE_ENV`; substituída pela D-110), **D-72** (C — soft
delete com `deletedBy`) e **D-73** (B — `Expense` e `Member`).

### 2026-10-03 (D-63…D-93)
Todas na opção **A**, exceto **D-63** (B — `preValidation`; a A, `onRequest`, foi aprovada e revertida antes de
implementar: tiraria anônimos do rate limit), **D-90** (B — `issues` + Zod em português) e **D-91** (B — `/refresh`
no limite global). **D-65** descartada.

### 2026-10-13 (D-94…D-96)
Todas na opção **A**: regra do CLAUDE.md passa a permitir que o domínio importe `src/shared`, `decimal.js` e
`node:crypto` (D-94); `CLAUDE.MD` renomeado para `CLAUDE.md` no git (D-95); `npm audit fix` atualizou
`fast-jwt` 6.3.4, `fast-copy` 4.1.2 e `source-map-js` 1.2.2, só no lock (D-96).

### 2026-10-13 — frontend (D-97…D-104)
Todas na opção **A**: front em repositório próprio, pasta irmã (D-97); valores monetários aceitos como string
nas requisições, além de number (D-98); saldos descontam acertos CONFIRMED e o cache é invalidado em
membro/saída/acerto (D-99); `userId` nos membros (D-100); refresh automático no front (D-101); diálogo de chave
Pix (D-102); sem `leave_group` (D-103); mensagens de login e cadastro traduzidas para português (D-104). P-8 (D-98
também no `PATCH` de despesa) aprovada com o plano do front.

### 2026-10-14 (D-105…D-107)
D-105: instrução direta do usuário (sem registro anterior nos repositórios): string de dinheiro com até 8 dígitos inteiros.
D-106 (A): migrations na inicialização da imagem. D-107 (B): `trustProxy` por contagem de saltos; aprovada, mas inviável no
Fastify 5.12.5; a escolha volta como D-108.
