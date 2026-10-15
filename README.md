# Splittr — Plataforma de Rachamento de Contas em Grupo

> API REST + WebSocket para grupos compartilharem despesas e calcularem automaticamente quem deve a quem, usando algoritmo de minimização de transações, sincronização em tempo real e categorização inteligente de despesas via LLM.

[![Status](https://img.shields.io/badge/status-em%20desenvolvimento-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6)]()
[![Node.js](https://img.shields.io/badge/Node.js-24.x-339933)]()

---

## Índice

- [Sobre o projeto](#sobre-o-projeto)
- [Por que este projeto existe](#por-que-este-projeto-existe)
- [Funcionalidades](#funcionalidades)
- [Stack técnica](#stack-técnica)
- [Arquitetura](#arquitetura)
- [Status de desenvolvimento](#status-de-desenvolvimento)
- [Como rodar localmente](#como-rodar-localmente)
- [Documentação da API](#documentação-da-api)
- [Decisões arquiteturais](#decisões-arquiteturais)
- [Testes](#testes)
- [Roadmap](#roadmap)
- [Sobre o autor](#sobre-o-autor)

---

## Sobre o projeto

**Splittr** é uma API backend para grupos compartilharem despesas continuamente — repúblicas, viagens em grupo, casais, eventos — e resolverem automaticamente os acertos financeiros. O sistema calcula saldos conforme despesas são lançadas e usa um algoritmo guloso de minimização para sugerir o **menor número possível de transferências** que zera todas as dívidas do grupo.

A categorização das despesas é híbrida: uma engine de regras determinísticas resolve os casos com palavras-chave conhecidas (ex: "Uber" → Transporte), e a LLM (Claude Haiku) entra apenas quando as regras e o cache não decidem. Isso reduz custo, latência e dependência da API externa.

Para acertos, o sistema gera **Pix copia-e-cola** no padrão EMV/BR Code do Banco Central, permitindo transferência direta entre os membros.

---

## Por que este projeto existe

Grupos que dividem despesas continuamente enfrentam três problemas recorrentes:

1. **Cálculo manual propenso a erro:** somar despesas e cruzar quem pagou o quê é tedioso e gera disputas.
2. **Acertos desnecessariamente complexos:** quando A deve a B, B deve a C e C deve a A, é possível simplificar — mas ninguém calcula isso na mão.
3. **Falta de histórico auditável:** WhatsApp e planilhas não preservam contexto. Despesa lançada hoje precisa ser questionável daqui a 6 meses.

O Splitwise resolve isso, mas é em inglês, não integra com Pix, não é open source e tem limitações na versão gratuita. **Splittr** entrega o núcleo da funcionalidade adaptado ao mercado brasileiro.

---

## Funcionalidades

### Núcleo

- Autenticação JWT com access token de 15 minutos e refresh token em cookie `httpOnly`
- Logout com revogação do refresh token (blacklist em Redis, fail-closed)
- Criação e gerenciamento de grupos com papéis (OWNER, MEMBER)
- Convite de membros por **email ou telefone** — quem convida não precisa conhecer o id interno de ninguém
- Lançamento de despesas com três métodos de divisão: igualitária, valor fixo e percentual
- Divisão com distribuição de resto: R$ 100 entre 3 pessoas vira 33,34 / 33,33 / 33,33, sem perder centavo
- Cálculo automático de saldo de cada membro
- Algoritmo de minimização do número de transferências para zerar dívidas
- Exclusão lógica de despesas e membros: o registro permanece, com data e autor da remoção

### Tempo real

- Sincronização via WebSocket entre membros conectados ao mesmo grupo
- Autenticação por JWT no handshake e isolamento por sala (um grupo, uma sala)
- Adapter Redis para escalar horizontalmente sem perder eventos entre instâncias
- Eventos emitidos: `expense_created`, `expense_updated`, `expense_deleted`, `expense_categorized`, `member_added`, `member_removed`, `settlement_computed`, `settlement_confirmed` e `balances_updated`

### Inteligência

- Categorização automática em 8 categorias (Alimentação, Transporte, Moradia, Lazer, Assinaturas, Saúde, Compras, Outros)
- Cadeia híbrida: **regras determinísticas → cache → LLM → fallback "Outros"**
- Cerca de 150 palavras-chave cobrem os casos mais comuns sem nenhuma chamada à API
- Cache de categorizações em Redis, indexado pelo hash da descrição normalizada (TTL de 7 dias)
- Sem chave da Anthropic configurada, a API continua funcionando: cai direto no fallback

### Brasil

- Geração de Pix copia-e-cola no padrão EMV/BR Code com CRC16-CCITT implementado do zero
- Suporte a chave Pix por usuário para receber acertos

### Segurança

- Headers de segurança via `@fastify/helmet`, com CSP restrito para uma API JSON
- Rate limit com contagem compartilhada em Redis: 100 req/min global, 5/min nas rotas de autenticação e 10/min na recategorização
- Senhas com bcrypt a 12 rounds
- CORS por allowlist explícita, configurável por ambiente
- Redação automática de 7 campos sensíveis nos logs
- Documentação OpenAPI servida apenas fora de produção

---

## Stack técnica

### Principais

| Tecnologia | Versão | Função |
|---|---|---|
| **TypeScript** | 6.x | Linguagem principal, com strict mode habilitado |
| **Node.js** | 24 LTS | Runtime |
| **Fastify** | 5.x | Framework HTTP |
| **Prisma ORM** | 5.x | ORM type-safe com migrations declarativas |
| **PostgreSQL** | 16 | Banco relacional |
| **Socket.io** | 4.x | WebSocket com salas e autenticação |
| **Redis** | 7 (alpine) | Cache, rate limit e pub/sub para WebSocket escalável |
| **Zod** | 4.x | Validação runtime de payloads e variáveis de ambiente |
| **Vitest** | 4.x | Test runner e cobertura |
| **decimal.js** | 10.x | Aritmética decimal precisa para valores monetários |
| **Anthropic SDK** | 0.91.x | Cliente Claude API (`claude-haiku-4-5`) para categorização |
| **Docker + Docker Compose** | — | Ambiente reproduzível |

### Auxiliares

`bcryptjs` (hash de senha) · `jsonwebtoken` + `@fastify/jwt` (JWT) · `@fastify/cookie` · `@fastify/cors` · `@fastify/helmet` · `@fastify/rate-limit` · `@fastify/swagger` · `ioredis` · `pino` (logger estruturado) · `dayjs` (datas)

---

## Arquitetura

O projeto segue **Clean Architecture** com fortes influências de **Domain-Driven Design**, organizado em camadas com fluxo unidirecional de dependências:

```
┌─────────────────────────────────────────┐
│  infra (HTTP, WebSocket, DB, LLM, Pix)  │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│        application (use cases)          │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│  domain (entities, services, errors)    │
└─────────────────────────────────────────┘
```

**Regra inviolável:** o domínio nunca importa de fora. Use cases podem importar do domínio. A infraestrutura pode importar use cases e domínio. Nada do domínio sabe que existe Fastify, Prisma ou Socket.io.

Os repositórios são **interfaces declaradas em `application`**, com implementações concretas em `infra/database/repositories`. Os use cases dependem da interface, nunca do Prisma.

### Estrutura de pastas

```
src/
├── domain/              # Entidades, value objects, domain services
├── application/         # Use cases + interfaces de repositório
├── infra/
│   ├── database/        # Prisma + implementações de repositório
│   ├── http/            # Fastify, controllers, middlewares, schemas
│   ├── websocket/       # Socket.io e handlers
│   ├── llm/             # Cliente Anthropic + categorizer + engine de regras
│   ├── pix/             # Geração de BR Code + CRC16
│   ├── cache/           # Cache de saldos, de categorias e blacklist de tokens
│   ├── redis/           # Clientes Redis
│   └── env/             # Validação de variáveis de ambiente
├── shared/              # Erros base e utilitários
├── tests/               # unit, e2e, integration, doubles, factories
└── server.ts            # Bootstrap
```

---

## Status de desenvolvimento

> Este projeto está em desenvolvimento ativo como parte do meu portfólio. O roadmap abaixo é executado em fases iterativas.

### Fase 1 — Fundação e Domínio
- [x] Setup do projeto (TypeScript, Fastify, Prisma, Postgres em Docker)
- [x] Schema Prisma (User, Group, Member, Expense, ExpenseShare, Settlement)
- [x] Entidades de domínio + value objects (Money, Email, Phone, SplitMethod, ExpenseCategory)
- [x] Use cases de autenticação (register, login, refresh, logout)
- [x] Testes unitários da camada de domínio

### Fase 2 — Grupos e Despesas
- [x] Use cases de grupos (criar, listar, detalhar, atualizar, excluir, membros)
- [x] Use cases de despesas (criar, listar com filtros e paginação, atualizar, excluir)
- [x] Middlewares de autenticação e verificação de membership
- [x] Validação de payloads com Zod
- [x] Testes end-to-end das rotas HTTP

### Fase 3 — Algoritmo e Acertos
- [x] Domain service `DebtMinimizer` (algoritmo guloso O(n log n))
- [x] Cálculo de saldos por membro do grupo
- [x] Endpoint de sugestão de acertos
- [x] Cobertura de casos de borda do algoritmo (grupo vazio, empates, valores quebrados, 50+ membros)
- [x] Lock otimista por versão nos acertos, com 409 em caso de conflito

### Fase 4 — Tempo Real e Pix
- [x] WebSocket com autenticação via JWT
- [x] Eventos de despesa, membro, acerto e saldo em tempo real
- [x] Geração de Pix copia-e-cola (BR Code + CRC16-CCITT)
- [x] CRC16 validado contra o vetor canônico da especificação do Banco Central (`0x29B1`)
- [ ] Validação de ponta a ponta com app bancário real

### Fase 5 — Categorização via LLM
- [x] Engine de regras determinísticas
- [x] Integração com Claude Haiku como fallback
- [x] Cache de categorizações em Redis
- [x] Categorização em background, sem bloquear a resposta HTTP
- [ ] Fila durável para a categorização em background (hoje é em memória e se perde num crash)

### Fase 6 — Polimento
- [x] Documentação OpenAPI completa (26 operações, com exemplos e respostas de erro)
- [x] Endurecimento de segurança (helmet, rate limit, CORS, bcrypt 12 rounds)
- [ ] Frontend simples para demonstração
- [ ] Deploy (backend + banco + frontend)
- [ ] Vídeo demo

---

## Como rodar localmente

### Pré-requisitos

- Node.js 24+
- Docker e Docker Compose
- Uma chave de API da Anthropic (opcional — sem ela a categorização usa apenas regras e cache)

### Opção A — tudo em containers

Sobe Postgres, Redis, aplica as migrations e inicia a API:

```bash
git clone https://github.com/AntonioJMonte/splittr.git
cd splittr

cp .env.example .env
# Edite o .env com seus valores

docker compose up -d
```

A API sobe em `http://localhost:3333`.

### Opção B — API local, dependências em container

Use esta opção para desenvolver com hot reload:

```bash
npm install
cp .env.example .env

# Sobe apenas as dependências, sem o container da API
docker compose up -d postgres redis

# Aplica as migrations no banco
npx prisma migrate deploy

npm run dev
```

A API sobe em `http://localhost:3333` e a documentação em `http://localhost:3333/docs`.

> O serviço `app` do compose e o `npm run dev` disputam a porta 3333 — use uma opção ou a outra, não as duas ao mesmo tempo.

### Variáveis de ambiente

Veja [`.env.example`](.env.example) para a lista completa. As principais:

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Connection string do PostgreSQL |
| `REDIS_URL` | Connection string do Redis |
| `JWT_SECRET` | Secret para assinatura de tokens (mínimo 32 caracteres) |
| `JWT_REFRESH_SECRET` | Secret para refresh tokens (mínimo 32 caracteres) |
| `CORS_ORIGIN` | Origens permitidas, separadas por vírgula |
| `TRUST_PROXY_HOPS` | Proxies entre o cliente e a API, para o IP do rate limit (padrão 0; 1 no Azure Container Apps) |
| `ANTHROPIC_API_KEY` | Chave da API Anthropic (opcional) |
| `LOG_LEVEL` | Nível do pino (padrão `info`) |
| `PORT` | Porta do servidor (padrão 3333) |

Todas são validadas por Zod no startup: uma variável ausente ou malformada derruba o processo antes de servir a primeira requisição.

---

## Documentação da API

A API é auto-documentada via OpenAPI em `/docs` quando o servidor está rodando fora de produção — com exemplos de corpo, respostas de erro e autenticação `bearerAuth`. Rotas disponíveis:

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/register` | Cria a conta (nome, email, senha e telefone opcional) |
| `POST` | `/auth` | Login; devolve access token e cookie `refreshToken` |
| `POST` | `/refresh` | Renova o access token a partir do cookie |
| `POST` | `/logout` | Revoga o refresh token (idempotente) |
| `PATCH` | `/users/pix-key` | Define ou remove a chave Pix |
| `PATCH` | `/users/phone` | Define ou remove o telefone usado para receber convites |
| `POST` · `GET` | `/groups` | Cria grupo · lista os grupos do usuário |
| `GET` · `PATCH` · `DELETE` | `/groups/:groupId` | Detalhes com membros · atualiza · exclui |
| `GET` | `/groups/:groupId/balances` | Saldo por membro e transferências sugeridas |
| `POST` · `GET` | `/groups/:groupId/members` | Convida por email ou telefone · lista membros |
| `DELETE` | `/groups/:groupId/members/:memberId` | Remove membro (requer OWNER) |
| `PATCH` | `/groups/:groupId/members/:memberId/role` | Promove ou rebaixa um membro |
| `DELETE` | `/groups/:groupId/leave` | Sai do grupo |
| `POST` · `GET` | `/groups/:groupId/expenses` | Lança despesa · lista com filtros e paginação |
| `PATCH` · `DELETE` | `/expenses/:expenseId` | Edita · exclui (pagador ou OWNER) |
| `POST` | `/expenses/:expenseId/categorize` | Recategoriza via regras → cache → LLM |
| `GET` | `/groups/:groupId/settlements/compute` | Transferências mínimas (DebtMinimizer) |
| `POST` | `/groups/:groupId/settlements` | Devedor registra o pagamento; gera copia-e-cola Pix |
| `PATCH` | `/settlements/:settlementId/acknowledge` | Credor confirma o recebimento |
| `GET` | `/health` | Estado de Postgres e Redis; 503 se alguma cair |

Os filtros de `GET /groups/:groupId/expenses` são `view` (`all`, `involved`, `paid`, `pending`), `category`, `startDate`, `endDate`, `minAmount`, `maxAmount`, `page` e `limit`.

As rotas de autenticação não usam o prefixo `/auth/` do documento original do desafio
(`/register` em vez de `/auth/register`, e assim por diante), e o registro de acertos é
`POST /groups/:groupId/settlements` em vez de `POST /settlements` — assim a rota carrega o
`:groupId` que o middleware de associação precisa. Os nomes acima são os que valem.

WebSocket disponível em `ws://localhost:3333`, com o token JWT em `handshake.auth.token`.

---

## Decisões arquiteturais

### Por que Fastify em vez de Express?

Fastify entrega validação nativa via JSON Schema, plugin system mais robusto, performance superior e tipagem melhor com TypeScript. Express continua sendo mais popular, mas Fastify é a escolha técnica correta para projetos novos em TypeScript em 2026.

### Por que Prisma em vez de TypeORM ou Drizzle?

Prisma oferece o melhor balanço entre type-safety, ergonomia e maturidade. O Prisma Client gera tipos automaticamente do schema, e as migrations declarativas reduzem fricção em iterações rápidas de modelagem.

### Por que decimal.js em vez de números nativos?

Float não é adequado para dinheiro. `0.1 + 0.2 !== 0.3` em JavaScript. Em domínio financeiro, isso causa bugs de auditoria que aparecem em produção. `decimal.js` garante precisão arbitrária e operações associativas.

### Por que algoritmo guloso e não busca exaustiva?

O problema geral de minimização de dívidas é NP-difícil. A heurística gulosa entrega resultado ótimo na grande maioria dos casos práticos com complexidade O(n log n), enquanto busca exaustiva seria O(n!). Para grupos do tamanho real (até ~50 membros), a heurística é a escolha pragmática.

### Por que regras antes de LLM na categorização?

Custo, latência e previsibilidade. Descrições como "Pizza Hut", "Uber" ou "Netflix" não precisam de um modelo para serem classificadas — uma tabela de palavras-chave resolve em microssegundos e sem custo. A LLM entra apenas quando regra e cache não decidem, e o resultado dela é cacheado por 7 dias, de modo que a mesma descrição não é cobrada duas vezes.

### Por que exclusão lógica em despesas e membros?

Um grupo que divide contas precisa poder responder "quem apagou a despesa do churrasco?" seis meses depois. Exclusão física apaga a pergunta junto com o dado. Despesas e membros carregam `deletedAt` e `deletedBy`: somem de toda leitura, mas continuam no banco. Em membros isso também evita que o cascade leve embora os `ExpenseShare`, o que deixaria despesas antigas sem saber quem participou delas.

### Por que o cache falha fechado e o rate limit falha aberto?

São riscos opostos. Se o Redis cair e a blacklist de refresh tokens ficar indisponível, não há como provar que um token **não** foi revogado — então ele é tratado como revogado, e `/refresh` responde 401. Já no rate limit, perder a contagem por alguns minutos é preferível a recusar todo mundo: ali a falha não bloqueia.

---

## Testes

```bash
npm test                  # Suíte completa (unit + e2e)
npm run test:watch        # Modo watch
npm run test:coverage     # Com relatório de cobertura
npm run test:integration  # Testes contra Postgres real (requer o compose de pé)
```

**Estado atual:** 436 testes em 65 arquivos, 85% de statements no total.

**Thresholds que falham o build** (configurados em `vitest.config.ts`):

| Escopo | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `src/domain` | 90% | 85% | 94% | 90% |
| `src/application` | 95% | 90% | 93% | 95% |
| Global | 84% | 71% | 78% | 84% |

O `DebtMinimizer` tem 13 casos de teste cobrindo grupo vazio, saldos zerados, empates, valores que não dividem igualmente, grupos com mais de 50 membros e a garantia de não mutar a entrada.

A API da Anthropic **nunca** é chamada nos testes — o categorizador é sempre injetado como dublê.

---

## Roadmap

Ver [seção Status de desenvolvimento](#status-de-desenvolvimento) para o roadmap detalhado em fases.

**Pós-MVP (futuro):**
- Trilha de auditoria de edições (hoje só exclusões deixam rastro)
- OCR de notas fiscais via Claude Vision (extração automática de despesas a partir de foto)
- Frontend mobile com React Native
- Notificações push para acertos pendentes
- Suporte a múltiplas moedas com conversão automática
- Modo offline com sincronização ao reconectar

---

## Sobre o autor

**Antônio José Monteiro Neto**

Estudante de Ciência da Computação na Universidade Federal do Cariri, focado em desenvolvimento backend com TypeScript e Node.js. Este projeto faz parte do meu portfólio profissional, executado com foco em demonstrar domínio de fundamentos sólidos: arquitetura limpa, modelagem de domínio, algoritmos sobre estruturas de dados, concorrência e integração responsável com IA.

- 🔗 [LinkedIn](https://www.linkedin.com/in/antonioomonteiro)
- 💻 [GitHub](https://github.com/AntonioJMonte)
- 📍 Juazeiro do Norte, CE

---

## Licença

Distribuído sob a licença MIT. Veja [`LICENSE`](LICENSE) para mais informações.
