# Estado do Projeto — Splittr

**Última atualização:** 2026-10-15
**Branch:** `chore/deploy-readiness` (local, sem push), a partir de `main` em `f25b369`
**Etapa atual:** 6 — Frontend. Spec, DESIGN e plano (`../splittr-web/docs/plans/frontend-mvp.md`) aprovados em 13/10; front em construção.

---

## Concluído (confirmado no código em 13/10)

- **Domínio:** 6 entidades, 5 VOs (Money, Email, `Phone`, SplitMethod, ExpenseCategory), 2 domain services
  (`DebtMinimizer` guloso O(n log n) e `SplitCalculator` com distribuição de resto).
- **Aplicação:** 28 use cases + 5 interfaces de repositório + 3 serviços. DIP respeitada.
- **Infra HTTP:** 29 rotas/controllers (incl. `/health`), 5 arquivos de rotas, error handler central, OpenAPI.
- **Persistência:** 5 repositórios Prisma; **6 migrations**.
- **WebSocket:** auth JWT no handshake, rooms, adapter Redis, dedup, 9 eventos de grupo.
- **Redis:** cache de saldos, cache de categoria, blacklist de refresh tokens e store do rate limit.
- **LLM (2.1):** regras → cache → `claude-haiku-4-5` → "Outros". Validado em runtime em 26/09; testes 100% mockados.
- **Etapas 2–4:** lock otimista em `Settlement`, Docker, logging pino, Swagger detalhado,
  `SplitCalculator` (D-57), cobertura com thresholds que falham o build.

### Etapa 5 — concluída e commitada
| Entrega | Decisões | Commit |
|---|---|---|
| CORS, Redis resiliente, helmet, rate limit, bcrypt 12, Swagger fora de produção | D-58…D-62, D-66…D-70 | `cc59d3b`…`d100475` |
| Convite por email/telefone, soft delete, 403, auditoria de despesa | D-71…D-82 | `f40a9ab`…`7f3a816` |
| README + LICENSE; 0 vulnerabilidades, auth em `preValidation`, Postman | D-63, D-64, D-83, D-84 | `0ac392d`, `ff1a921` |
| Bloco 4: integração dos 5 repositórios, socket server, caches, bcrypt injetável, bug do `findByUserId` | D-85…D-87 | `86b79e4`…`4761f12` |

### API para o frontend — commitada (`dc1ff53`, `826b98e`)
- **D-88:** `GET /users/me` → `{ user: { id, name, email, phone, pixKey } }`.
- **D-89:** `GET /groups/:groupId/settlements?status=` (mais recentes primeiro); `Settlement` ganhou `createdAt`.
- **D-90:** todo erro de validação responde `{ message: 'Dados inválidos.', issues: [{ path, message }] }`,
  com caminho pontuado e mensagens do Zod em português (`z.locales.pt()`).
- **D-91:** `/refresh` saiu do limite de 5/min; fica no global de 100/min.
- **D-92:** `version` obrigatório no `PATCH /expenses/:id`; diferente da atual → 409. Listagem e resposta do
  `PATCH` trazem `version`. Fecha o risco do D-82 (cliente com tela velha).
- **D-93:** `GET /expenses/:expenseId/revisions` com `editedBy: { userId, name }`, inclusive de quem saiu.
- Postman: `version` no `PATCH`, 3 requests novos, script que salva o `settlementId` pendente.

### Contrato do back para o front — Fase B (branch `fix/api-para-o-front`, um commit por decisão)
- **D-104:** login e cadastro respondem em português ("Email ou senha incorretos.", "Já existe uma conta com este email.").
- **D-100:** `GET /groups/:id` e `/members` trazem `userId` em cada membro.
- **D-98 (+P-8):** `amount` de despesa (criar e editar), partes e acerto aceitam string decimal com até 2 casas, além de number.
- **D-99:** `GET /balances` desconta acertos CONFIRMED; cache de saldos invalidado ao adicionar/remover membro, sair e confirmar acerto.
- **D-105:** a string de dinheiro aceita no máximo 8 dígitos inteiros (até `99999999.99`, o que cabe em `Decimal(10, 2)`); 9 ou mais → 400 em `amount`.

### Prontidão para deploy — branch `chore/deploy-readiness` (alvo: Azure Container Apps, 1 réplica)
- **D-106:** migrations na inicialização; `prisma` em `dependencies` e `prisma/` no runtime (+~61 MB); serviço `migrate` do compose saiu.
- **D-109:** `tini` é o PID 1 e `docker-entrypoint.sh` (`set -e`) migra e faz `exec node`: node é filho direto do tini, sem npm/sh.
- **Encerramento pelos hooks do Fastify:** `preClose` faz `io.local.disconnectSockets(true)`; `onClose` fecha pub/sub (no
  `createSocketServer`) e Prisma + cache (no `app.ts`, com `allSettled`). SIGTERM/SIGINT só chamam `app.close()`, com prazo de 10 s.
- Porta 3333 no schema e `ENV PORT=3333` na imagem; `CORS_ORIGIN` exige origens exatas (`new URL(item).origin === item`, sem `*`);
  `.dockerignore` com `.env.*`/`src/tests`; compose com `redis:7.4-alpine` e Postgres/Redis só em `127.0.0.1`.
- **Fase 3 (15/10, projeto compose isolado):** app `healthy`; 544 → 545 MB (tini +0,8 MB; a cópia de `.prisma` removida
  era 4,1 kB); `tini` PID 1 e `node` PID 7 com PPID 1; `compose stop` em 0,68 s, socket aberto recebeu `io server disconnect`,
  logs na ordem sinal → sockets → HTTP → pub/sub → Prisma/cache → concluído, saída 0, sem warn/erro.
- Já atendidos: `/health` (Postgres + Redis, 503), `0.0.0.0` + `PORT`, CORS do Fastify e do Socket.IO por `CORS_ORIGIN`,
  `rediss://` nos 3 clients (todos leem `REDIS_URL`).
- **D-107 inviável:** o Fastify 5.12.5 tornou `trustProxy` numérico fail-closed (`lib/request.js`) e tirou `number` dos tipos.
- **D-108 (revista):** `TRUST_PROXY_HOPS` (inteiro >= 0, padrão 0; 1 no Container Apps) via função de confiança, já que o
  Fastify 5.12 ignora número. O IP vem da direita do `X-Forwarded-For`; o valor forjado à esquerda é ignorado.

## Baseline de qualidade (2026-10-15)

| Verificação | Resultado |
|---|---|
| `npx tsc --noEmit` | limpo |
| `npx vitest run` | 561 testes, 77 arquivos, 100% |
| `npx vitest run --coverage` | 88,51% stmts · 76,44% branch · 82,24% funcs · 88,84% lines (thresholds 84/71/78/84) |
| `npm run test:integration` | 46 de 47 em 15/10: falha "5 edições concorrentes" (Unable to start a transaction), igual na `main` `f25b369` |
| `npm audit` | 0 vulnerabilidades (3 avisos novos de 13/10 corrigidos no D-96) |
| `/docs/json` | gera 22 paths com as rotas novas (verificado em runtime) |

---

## Pendências

### Frontend
Mora em `C:\dev\Projeto Rachamento de Contas\splittr-web` (D-97), repositório `SplittingTheCheckProject-FrontEnd`,
com PRs empilhados por fase (#1 a #13 abertos, até a Fase 8, MVP parcialmente verificado). D-98, D-99, D-100,
D-104 e D-105 implementadas aqui; o PR #1 (Fase B) foi integrado em `008e30c` e a D-105 entrou direto na `main` (`f25b369`).

### Lacunas encontradas no D-105 (não aprovadas, não feitas)
- O ramo `number` do `moneyInput` não tem limite: um number acima de 99999999.99 ainda chega ao banco e responde 500.
- O `toApiAmount` do front aceita mais de 8 dígitos inteiros; a API devolve 400 com a mensagem no campo `amount`.

### Lacunas pequenas encontradas no D-92 (não aprovadas, não feitas)
- `version` **não** vem na resposta do `POST` (criar) nem do `POST .../categorize`: o campo é opcional no
  schema compartilhado. Um cliente que edita logo após criar precisa assumir 0 ou listar de novo.
- O evento `expense_updated` passou a levar `version`, porque reaproveita o payload do `PATCH` (aditivo).

### Encontrado na prontidão para deploy (15/10, não aprovado, não feito)
- `pino-pretty` (só dev) e `dayjs` (sem uso no código) estão em `dependencies`; `start:prod` ficou sem uso (o entrypoint migra).
- Prisma 5.22 não lista Node 22 nem 24 como suportados (Node 22 oficial só a partir do Prisma 6.0.0); a imagem segue em Node 24.
- Integração: o teste de 5 edições concorrentes falha também na `main`; investigar pool/`maxWait` à parte.

### Backlog
Deploy, CI (não existe `.github/`), linter, vídeo demo. Fila durável para a categorização (hoje em memória).
`categorySource` (D-08 B). Refresh tokens persistidos (D-34 B). Auditoria de grupo/membro (D-80 cobriu só despesa).

---

## Decisões pendentes

| ID | Tema | Situação |
|----|------|----------|
| — | Nenhuma | — |

## Decisões tomadas

### Etapas 2–4 (D-01…D-57)
Ver git log. Exceções à opção A: **D-09** (B), **D-23** (B), **D-35** (B), **D-39** (B), **D-48** (B),
**D-50** (B), **D-54** (B), **D-55** (C).

### Etapa 5 — 2026-09-26 (D-58…D-82)
Todas na opção **A**, exceto **D-59** (C — `sameSite` derivado de `NODE_ENV`), **D-72** (C — soft
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

### 2026-10-15 (D-108, D-109)
D-108: o usuário pediu contagem de saltos (`TRUST_PROXY_HOPS`); a versão por faixas (A) foi trocada antes de ser commitada.
D-109: `tini` como PID 1 e `docker-entrypoint.sh` com `exec node`, sem npm como processo principal.
D-111 (A; apresentada como D-110, renumerada porque a D-110 ficou para o rewrite da Vercel): volume Redis de dev recriado (o dump da 8.10, RDB 15, não abre na 7.4; só cache) e contêiner órfão `migrate` removido.

---

## Riscos e observações

- **Auditoria cobre só despesa** (D-80). Grupo, membro e acerto não registram edições.
- **Membro removido continua na sala do socket** até desconectar: não existe `leave_group` (D-103).
- **`docker compose up -d` reaproveita a imagem velha do app:** depois de mexer no Dockerfile ou no código, use `--build`.
- **Deploy com uma instância só:** com 2+, o polling do Socket.IO exige sticky sessions ou `transports: ['websocket']`.
- **Cookie de refresh entre `*.vercel.app` e `*.azurecontainerapps.io` é de terceiros** (`vercel.app` está na Public Suffix List;
  `azurecontainerapps.io` não): o Safari bloqueia e a sessão cai após 15 min. Domínio próprio para front e API resolve.
- **`/health` responde 503 com o Redis fora:** a plataforma pode reiniciar o contêiner num soluço do Upstash.
- **`TRUST_PROXY_HOPS=1` no Container Apps:** confira no log "incoming request" que o `remoteAddress` é o IP do cliente.
- **`GET .../settlements/compute` emite `settlement_computed`** para a sala: GET com efeito colateral.
- **Fórmula de saldo copiada em 5 use cases** (saldos, compute, confirm, leave, remove). Com o D-99 todas descontam
  acertos confirmados; mudar uma exige mudar as outras. Cache `grupo:*:saldos` gravado antes do D-99 vive até 24h: apague no Redis de dev.
- **Dublês em memória não modelam soft delete na linha:** filtram pelo agregado. Regra de `deletedAt`
  só se prova na integração.
- **Ramo de `ZodError` no error handler hoje é inalcançável**: nenhum controller chama `.parse()`. Mantido
  com o mesmo formato do D-90 para quando alguém chamar.
- **`EnvironmentTeardownError` intermitente** do Vitest já derrubou o `test:coverage`; não reproduziu em 03/10.
- **Rodar um spec de integração sozinho reprova a catraca** (D-86). Use `--coverage.enabled=false`.
- **Relatório principal mostra repositórios em ~0%** de propósito: lá são mockados; a medida real é a da integração.
- **Thresholds do relatório principal** seguem 84/71/78/84 com o medido em ~88/76/81/88: dá para subir.
- **Depois de `git pull` que mexe no lock, rode `npm ci`:** em 13/10 o `node_modules` velho derrubou `tsc` e um spec.
- **Rate limit pendura o hook na rota** (`onRoute`): auth em `onRequest` escaparia dele (D-63).
- **Vitest avisa "ESM syntax in a file loaded as CommonJS"** nos configs; roda normalmente.
- **Logout não invalida o access token** (D-36): a sessão morre em até 15 min.
- **Fail-closed é intencional** (D-37) e **o rate limit é o oposto** (D-68): sem Redis ele não bloqueia.
- **`vitest.config.ts` define `ANTHROPIC_API_KEY: ''` de propósito.** Compose usa segredos do `.env`.
- **Sem linter.**
- **Repositório em** `C:\dev\Projeto Rachamento de Contas\ProjetoRachamentoDeContas`; `prisma migrate dev` não
  funciona nesta sessão (interativo): migrations são escritas à mão e aplicadas com `migrate deploy`.

## Próximo passo

1. Revisar e publicar `chore/deploy-readiness` (sem push até aprovação) e decidir os itens "Encontrado na prontidão".
2. Integrar os PRs do front (#1 a #13) e concluir a verificação do MVP (Fase 8).
