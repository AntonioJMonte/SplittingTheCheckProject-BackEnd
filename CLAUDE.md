# Projeto: Plataforma de Rachamento de Contas em Grupo

## Visão geral
API REST + WebSocket para grupos compartilharem despesas.
Calcula automaticamente quem deve a quem usando algoritmo de
minimização de transações. Categoriza despesas via LLM como fallback.

## Stack
- TypeScript 5+ / Node.js 24 LTS (imagem Docker `node:24-bookworm-slim`; Node 20 chegou ao fim de vida em 30/04/2026)
- Fastify 4+ (HTTP)
- Prisma ORM 5+ / PostgreSQL 16
- Socket.io (WebSocket)
- Redis (cache + pub/sub)
- Zod (validação)
- Vitest (testes)
- decimal.js (aritmética monetária)
- Anthropic SDK (categorização)
- Docker Compose (ambiente local)


# Estado atual do projeto

@ESTADO.md

---

# 0. Protocolo de início de sessão (OBRIGATÓRIO)

Antes de qualquer ação na sessão:

1. Responda com um resumo de no máximo 5 linhas contendo: etapa atual, pendências abertas, decisões aguardando aprovação e último passo concluído (tudo extraído do ESTADO.md).
2. Rode `git status` e `git branch --show-current` e aponte qualquer divergência entre o ESTADO.md e o estado real do repositório.
3. Se o ESTADO.md estiver ausente, vazio ou claramente desatualizado em relação ao código, PARE e avise. Exceção: se a tarefa atual for a Etapa 0 (criação do ESTADO.md), siga direto para ela.
4. Se a sessão for retomada ou compactada (`/compact`), releia o ESTADO.md e reconfirme a etapa atual antes de seguir.

# 1. Protocolo de decisão (OBRIGATÓRIO)

Você não toma decisões por conta própria. Qualquer escolha que se enquadre em pelo menos um critério abaixo deve ser apresentada ANTES de ser implementada:

- adiciona, remove ou atualiza dependência;
- altera `schema.prisma` ou gera migration;
- altera contrato da API (rota, método, status code, payload, evento WebSocket);
- altera estrutura de pastas ou responsabilidade de uma camada;
- existe mais de uma abordagem técnica viável;
- apaga arquivo, código ou dado;
- contradiz alguma regra já registrada neste CLAUDE.md.

Detalhes já cobertos por convenção deste arquivo (nome de variável local, ordem de imports, formatação) não exigem aprovação. Na dúvida, trate como decisão.

Formato obrigatório, uma decisão por bloco:

    ### D-<número>: <título curto>
    Contexto: <o que foi encontrado no código, 1-3 linhas>
    Opção A: <descrição>
      Prós: ...
      Contras: ...
    Opção B: <descrição>
      Prós: ...
      Contras: ...
    Recomendação: <A ou B> — <justificativa objetiva ligada ao contexto do projeto>
    Impacto: <arquivos afetados, migration sim/não, quebra de contrato sim/não>

Regras:
- Agrupe as decisões de uma subtarefa em uma única lista, numeradas em sequência.
- Depois de apresentar a lista, PARE e aguarde. Nunca apresente decisão e implementação na mesma resposta.
- Implemente somente as opções aprovadas explicitamente. Resposta ambígua = pergunte de novo.

# 2. Regras de git

- Nunca execute `git commit`, `git push`, `git reset`, `git stash`, `git clean`, `git checkout -- .`, `git restore` ou `git worktree remove` sem autorização explícita na mensagem atual.
- Ao final de cada etapa, sugira mensagem(ns) de commit em conventional commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`) com corpo em tópicos, no formato de múltiplos `-m` para PowerShell.

# 3. Verificação após cada subtarefa

- Rode `npx tsc --noEmit` e a suíte de testes (`npx vitest run`).
- Reporte o resultado. Se algo quebrar, corrija antes de avançar ou apresente como decisão se a correção não for óbvia.
- Código novo de domínio ou use case entra acompanhado de teste.
- Testes cobrem regra de negócio e casos de borda. Não escreva teste que só executa linhas sem asserção relevante.
- Nunca exclua arquivos do relatório de cobertura nem reduza thresholds sem aprovação.
- Nunca chame a API real da Anthropic em testes. Use mock.

# 4. Manutenção do ESTADO.md

- Atualize o ESTADO.md ao final de cada etapa concluída (não a cada arquivo alterado).
- Mantenha o ESTADO.md com no máximo ~120 linhas: ele é carregado em toda sessão e consome contexto.
- Histórico detalhado fica no git log e nos relatórios, não no ESTADO.md.
- Decisão aprovada sai de "Decisões pendentes" e vai para "Decisões tomadas" com ID, data e escolha.
- Atualize "Última atualização" sempre que editar o arquivo.



## Arquitetura
DDD + Clean Architecture em camadas. Regra inviolável:
domínio NUNCA importa de fora. Direção de dependência:
infra → application → domain.

Estrutura:
- src/domain/        → entidades, value objects, services puros
- src/application/   → use cases + interfaces de repositório
- src/infra/         → Prisma, HTTP, WebSocket, LLM, Pix
- src/shared/        → erros, utils
- tests/             → unit, integration, factories

## Padrões obrigatórios
- SOLID: cada arquivo tem UMA responsabilidade
- Repositórios são interfaces em /application,
  implementações concretas em /infra/database/repositories
- Validação de payloads com Zod nos controllers
- Erros de domínio extendem DomainError
- Aritmética monetária SEMPRE com decimal.js, nunca float
- Variáveis de ambiente validadas com Zod no startup
- Testes unitários para domain services e use cases

## Convenções de código
- TypeScript strict mode
- Sem comentários óbvios; documentar apenas decisões não-triviais
- Nomes em inglês no código, mensagens de erro em português
- Imports ordenados: libs externas → internos
- Sem console.log em código de produção; usar pino

## Comandos comuns
- npm run dev         → servidor com hot reload
- npm test            → roda testes
- npm run test:watch  → testes em watch mode
- npm run db:migrate  → aplica migrations
- docker compose up   → sobe Postgres + Redis

## Glossário do domínio
- Group: agregado raiz, contém membros e despesas
- Member: vínculo User-Group com papel (OWNER ou MEMBER)
- Expense: despesa lançada por um pagador, dividida entre membros
- ExpenseShare: parte de uma despesa atribuída a um membro
- Settlement: acerto sugerido entre dois membros
- DebtMinimizer: domain service que calcula transferências mínimas

## O que NÃO fazer
- Não usar Express (escolha foi Fastify)
- Não usar TypeORM (escolha foi Prisma)
- Não criar arquivos com mais de uma responsabilidade
- Não retornar dados brutos do Prisma para HTTP — sempre passar
  pela camada de aplicação
- Não usar float para dinheiro
- Não chamar LLM antes de tentar regras determinísticas