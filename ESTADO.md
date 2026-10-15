# Estado do Projeto — Splittr

**Última atualização:** 2026-10-15
**Branch:** `chore/deploy-readiness` (local, sem push), a partir de `main` em `f25b369`
**Etapa atual:** 6 — Frontend. Spec, DESIGN e plano (`../splittr-web/docs/plans/frontend-mvp.md`) aprovados em 13/10; front em construção.

Histórico concluído (Etapa 5, API para o front, Fase B, detalhes da prontidão e decisões D-01…D-107): `docs/historico.md`.

## Concluído (confirmado no código em 13/10)

- **Domínio:** 6 entidades, 5 VOs (Money, Email, `Phone`, SplitMethod, ExpenseCategory), 2 domain services
  (`DebtMinimizer` guloso O(n log n) e `SplitCalculator` com distribuição de resto).
- **Aplicação:** 28 use cases + 5 interfaces de repositório + 3 serviços. DIP respeitada.
- **Infra HTTP:** 30 rotas/controllers (incl. `/health/live` e `/health/ready`), 5 arquivos de rotas, error handler central, OpenAPI.
- **Persistência:** 5 repositórios Prisma; **6 migrations**.
- **WebSocket:** auth JWT no handshake, rooms, adapter Redis, dedup, 9 eventos de grupo.
- **Redis:** cache de saldos, cache de categoria, blacklist de refresh tokens e store do rate limit.
- **LLM (2.1):** regras → cache → `claude-haiku-4-5` → "Outros". Validado em runtime em 26/09; testes 100% mockados.
- **Etapas 2–5, API para o front (D-88…D-93) e Fase B (D-98…D-105):** concluídas e na `main`; detalhes no histórico.
- **Prontidão para deploy (esta branch, alvo Azure Container Apps, 1 réplica):** migrate na inicialização (D-106), tini +
  entrypoint (D-109), encerramento pelos hooks do Fastify, IP por saltos (D-108), porta 3333, CORS exato, health live/ready,
  cookie `Lax` (D-110) e compose com Redis 8 sem volume. Verificação da Fase 3 no histórico.

## Baseline de qualidade (2026-10-15)

| Verificação | Resultado |
|---|---|
| `npx tsc --noEmit` | limpo |
| `npx vitest run` | 563 testes, 77 arquivos, 100% |
| `npx vitest run --coverage` | 88,53% stmts · 76,37% branch · 82,28% funcs · 88,86% lines (thresholds 84/71/78/84) |
| `npm run test:integration` | 46 de 47: falha "5 edições concorrentes"; causa ambiental, ver Pendências (correção aguardando aprovação) |
| `npm audit` | 0 vulnerabilidades (3 avisos novos de 13/10 corrigidos no D-96) |
| `/docs/json` | gera 22 paths com as rotas novas (verificado em runtime) |

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
- **Integração (5 edições concorrentes):** cada conexão nova via `localhost` leva ~2 s, porque o engine do Prisma tenta `::1`
  primeiro e o compose publica o Postgres só em `127.0.0.1` desde `357c094`. As transações interativas que precisam de conexão
  nova estouram o `maxWait` de 2 s. O CAS está correto (com `127.0.0.1`: 1 vence e 4 perdem por versão). Correção proposta.

### Backlog
Deploy, CI (não existe `.github/`), linter, vídeo demo. Fila durável para a categorização (hoje em memória).
`categorySource` (D-08 B). Refresh tokens persistidos (D-34 B). Auditoria de grupo/membro (D-80 cobriu só despesa).

## Decisões pendentes

| ID | Tema | Situação |
|----|------|----------|
| — | Correção da falha de integração (IPv6 do `localhost` × compose em `127.0.0.1`) | Proposta, aguardando aprovação |

## Decisões tomadas

D-01…D-107: `docs/historico.md`.

### 2026-10-15 (D-108…D-112)
D-108: contagem de saltos (`TRUST_PROXY_HOPS`) por função de confiança; a versão por faixas (A) foi trocada antes do commit.
  Evidência: `node_modules/fastify/lib/request.js`, `getTrustProxyFn` (l. 51-54): número devolve `() => false` ("Hop-count-only
  trust cannot validate the immediate peer. Fail closed..."). Premissa: no Container Apps o vizinho imediato é sempre o ingress e
  a API não é alcançável direto pela internet. Testes cobrem 0, 1 e 2 saltos.
D-109: `tini` como PID 1 e `docker-entrypoint.sh` com `exec node`, sem npm como processo principal.
D-110: front na Vercel com rewrite `/api/*` → API; Socket.IO direto na Azure, autenticado por token (D-60). Cookie de refresh
  com `SameSite=Lax` também em produção (first-party pelo rewrite), substituindo a D-59.
D-111 (A; apresentada como D-110, renumerada porque a D-110 ficou para o rewrite da Vercel): volume Redis de dev recriado (o dump da 8.10, RDB 15, não abre na 7.4; só cache) e contêiner órfão `migrate` removido.
D-112: Node 24 + Prisma 5.22, combinação sem suporte oficial (o Prisma 5 só lista até o Node 20, que está em EOL; o Node 22
  só é oficial a partir do Prisma 6.0.0). Testada e funcional na imagem; upgrade para o Prisma 6 planejado após o primeiro deploy.

## Riscos e observações

- **Auditoria cobre só despesa** (D-80). Grupo, membro e acerto não registram edições.
- **Membro removido continua na sala do socket** até desconectar: não existe `leave_group` (D-103).
- **`docker compose up -d` reaproveita a imagem velha do app:** depois de mexer no Dockerfile ou no código, use `--build`.
- **Deploy com uma instância só:** com 2+, o polling do Socket.IO exige sticky sessions ou `transports: ['websocket']`.
- **Limitação aceita (D-110): pelo rewrite, o rate limit vê o IP da Vercel** nas chamadas REST, então o limite de `/auth` (5/min)
  fica compartilhado entre todos. Correção futura: header secreto da Vercel + `x-real-ip`.
- **O cookie `Lax` só funciona com o rewrite no ar (D-110):** chamando a API direto de `*.vercel.app`, o refresh deixa de ir.
- **`/health/ready` responde 503 com o Redis fora:** a réplica sai do tráfego, mas não reinicia (o liveness é `/health/live`).
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
- **Thresholds do relatório principal** seguem 84/71/78/84 com o medido em ~88/76/82/88: dá para subir.
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

1. Aprovar a correção da falha de integração; depois, revisar e publicar `chore/deploy-readiness` (sem push até aprovação).
2. Integrar os PRs do front (#1 a #13) e concluir a verificação do MVP (Fase 8).
