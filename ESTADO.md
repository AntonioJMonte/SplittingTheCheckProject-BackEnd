# Estado do Projeto — Splittr

**Última atualização:** 2026-10-13
**Branch:** main (sincronizada com `origin/main` em `826b98e`)
**Etapa atual:** 6 — Frontend. Spec e DESIGN aprovados em 13/10; plano em `../splittr-web/docs/plans/frontend-mvp.md` aguardando aprovação.

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

## Baseline de qualidade (2026-10-13)

| Verificação | Resultado |
|---|---|
| `npx tsc --noEmit` | limpo |
| `npx vitest run` | 511 testes, 73 arquivos, 100% |
| `npx vitest run --coverage` | 87,86% stmts · 75,6% branch · 80,88% funcs · 88,29% lines (thresholds 84/71/78/84) |
| `npm run test:integration` | 47 testes, 5 arquivos · `src/infra/database` 97,69 · 89,74 · 100 · 100 (thresholds 96/87/98/98) |
| `npm audit` | 0 vulnerabilidades (3 avisos novos de 13/10 corrigidos no D-96) |
| `/docs/json` | gera 22 paths com as rotas novas (verificado em runtime) |

---

## Pendências

### Frontend
Mora em `C:\dev\Projeto Rachamento de Contas\splittr-web` (D-97), ainda sem `git init`. Stack e tipagem (orval)
definidas pelo usuário em `splittr-web/docs/FRONTEND_SETUP.md`. **Aqui no back, antes da Fase 4 do front
(codegen):** implementar D-98, D-99, D-100 e D-104 (aprovadas, não feitas).

### Lacunas pequenas encontradas no D-92 (não aprovadas, não feitas)
- `version` **não** vem na resposta do `POST` (criar) nem do `POST .../categorize`: o campo é opcional no
  schema compartilhado. Um cliente que edita logo após criar precisa assumir 0 ou listar de novo.
- O evento `expense_updated` passou a levar `version`, porque reaproveita o payload do `PATCH` (aditivo).

### Backlog
Deploy, CI (não existe `.github/`), linter, vídeo demo. Fila durável para a categorização (hoje em memória).
`categorySource` (D-08 B). Refresh tokens persistidos (D-34 B). Auditoria de grupo/membro (D-80 cobriu só despesa).

### Documentação divergente do código
Corrigida em 13/10 (falta commitar): stack e caminhos no CLAUDE.md, `package.json`, Swagger do `DELETE /expenses/:id`.

---

## Decisões pendentes

| ID | Tema | Situação |
|----|------|----------|
| P-8 | D-98 estendido ao `PATCH /expenses/:id` (`shareInput` é compartilhado) | Aguarda aprovação junto com o plano do front |

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
Pix (D-102); sem `leave_group` (D-103); mensagens de login e cadastro traduzidas para português (D-104).

---

## Riscos e observações

- **Auditoria cobre só despesa** (D-80). Grupo, membro e acerto não registram edições.
- **Membro removido continua na sala do socket** até desconectar: não existe `leave_group` (D-103).
- **`GET .../settlements/compute` emite `settlement_computed`** para a sala: GET com efeito colateral.
- **Fórmula de saldo copiada em 3 use cases** (saldos, compute, confirm). O D-99 mexe numa delas.
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

1. Commitar as correções de 13/10 (documentação, rename e lock).
2. Aprovar o plano do front; a Fase B dele (D-98…D-100, D-104) roda aqui, depois do passo 1.
3. Implementar D-98…D-100 e D-104 aqui antes da Fase 4 do front.
