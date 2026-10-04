# Estado do Projeto — Splittr

**Última atualização:** 2026-10-03
**Branch:** main (sincronizada com `origin/main` em `4761f12`; API para o frontend **não commitada**)
**Etapa atual:** 6 — Frontend. Pré-requisito em andamento: rotas que o frontend precisa (D-88…D-93), código pronto.

---

## Concluído (confirmado no código em 03/10)

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

### API para o frontend — pronta, **não commitada**
- **D-88:** `GET /users/me` → `{ user: { id, name, email, phone, pixKey } }`.
- **D-89:** `GET /groups/:groupId/settlements?status=` (mais recentes primeiro); `Settlement` ganhou `createdAt`.
- **D-90:** todo erro de validação responde `{ message: 'Dados inválidos.', issues: [{ path, message }] }`,
  com caminho pontuado e mensagens do Zod em português (`z.locales.pt()`).
- **D-91:** `/refresh` saiu do limite de 5/min; fica no global de 100/min.
- **D-92:** `version` obrigatório no `PATCH /expenses/:id`; diferente da atual → 409. Listagem e resposta do
  `PATCH` trazem `version`. Fecha o risco do D-82 (cliente com tela velha).
- **D-93:** `GET /expenses/:expenseId/revisions` com `editedBy: { userId, name }`, inclusive de quem saiu.
- Postman: `version` no `PATCH`, 3 requests novos, script que salva o `settlementId` pendente.

## Baseline de qualidade (2026-10-03)

| Verificação | Resultado |
|---|---|
| `npx tsc --noEmit` | limpo |
| `npx vitest run` | 511 testes, 73 arquivos, 100% |
| `npx vitest run --coverage` | 87,86% stmts · 75,6% branch · 80,88% funcs · 88,29% lines (thresholds 84/71/78/84) |
| `npm run test:integration` | 47 testes, 5 arquivos · `src/infra/database` 97,69 · 89,74 · 100 · 100 (thresholds 96/87/98/98) |
| `npm audit` | 0 vulnerabilidades |
| `/docs/json` | gera 22 paths com as rotas novas (verificado em runtime) |

---

## Pendências

### Antes do primeiro arquivo do frontend (decisões do usuário)
Onde o frontend mora (pasta neste repositório ou repositório separado), stack (framework, roteamento, estado,
componentes) e como tipar a API (gerar do OpenAPI ou à mão).

### Lacunas pequenas encontradas no D-92 (não aprovadas, não feitas)
- `version` **não** vem na resposta do `POST` (criar) nem do `POST .../categorize`: o campo é opcional no
  schema compartilhado. Um cliente que edita logo após criar precisa assumir 0 ou listar de novo.
- O evento `expense_updated` passou a levar `version`, porque reaproveita o payload do `PATCH` (aditivo).

### Backlog
Deploy, CI (não existe `.github/`), linter, vídeo demo. Fila durável para a categorização (hoje em memória).
`categorySource` (D-08 B). Refresh tokens persistidos (D-34 B). Auditoria de grupo/membro (D-80 cobriu só despesa).

### Documentação divergente do código
- CLAUDE.md cita `tests/` na raiz e `infra/database/repositories`; o real é `src/tests/` e
  `src/infra/database/prisma/`. CLAUDE.md diz "Fastify 4+"; o projeto usa Fastify 5, Zod 4 e TS 6.
- CLAUDE.md diz que o domínio nunca importa de fora, mas 7 arquivos de `src/domain` importam
  `DomainError`/`DomainPermissionError` de `src/shared/errors`.
- `package.json` declara `"license": "ISC"` e `"main": "index.js"`; o LICENSE é MIT e a entrada é `dist/server.js`.
- Swagger do `DELETE /expenses/:id` diz "remove permanentemente"; desde o D-72 a exclusão é lógica.

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

---

## Riscos e observações

- **Auditoria cobre só despesa** (D-80). Grupo, membro e acerto não registram edições.
- **Dublês em memória não modelam soft delete na linha:** filtram pelo agregado. Regra de `deletedAt`
  só se prova na integração.
- **Ramo de `ZodError` no error handler hoje é inalcançável**: nenhum controller chama `.parse()`. Mantido
  com o mesmo formato do D-90 para quando alguém chamar.
- **`EnvironmentTeardownError` intermitente** do Vitest já derrubou o `test:coverage`; não reproduziu em 03/10.
- **Rodar um spec de integração sozinho reprova a catraca** (D-86). Use `--coverage.enabled=false`.
- **Relatório principal mostra repositórios em ~0%** de propósito: lá são mockados; a medida real é a da integração.
- **Thresholds do relatório principal** seguem 84/71/78/84 com o medido em ~88/76/81/88: dá para subir.
- **Rate limit pendura o hook na rota** (`onRoute`): auth em `onRequest` escaparia dele (D-63).
- **Vitest avisa "ESM syntax in a file loaded as CommonJS"** nos configs; roda normalmente.
- **Logout não invalida o access token** (D-36): a sessão morre em até 15 min.
- **Fail-closed é intencional** (D-37) e **o rate limit é o oposto** (D-68): sem Redis ele não bloqueia.
- **`vitest.config.ts` define `ANTHROPIC_API_KEY: ''` de propósito.** Compose usa segredos do `.env`.
- **Sem linter.** O arquivo de instruções está em disco como `CLAUDE.MD` (maiúsculo).
- **Repositório em** `C:\Dev\Projeto Rachamento de Contas\SplittingTheCheckProject`; `prisma migrate dev` não
  funciona nesta sessão (interativo): migrations são escritas à mão e aplicadas com `migrate deploy`.

## Próximo passo

1. Commitar D-88…D-93 (mensagens sugeridas na sessão de 03/10).
2. Decidir onde o frontend mora, a stack e a tipagem da API; depois, as lacunas do D-92.
