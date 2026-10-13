import z from 'zod'
import { EXPENSE_CATEGORIES } from '../../../domain/value-objects/expense-category'
import { badRequest, conflict, forbidden, moneyInput, notFound, unauthorized } from './shared.schema'

const expenseCategory = z.enum(EXPENSE_CATEGORIES)

const shareInput = z.object({
    memberId: z.uuid(),
    amount: moneyInput.optional().describe('Valor fixo da parte; use com splitMethod FIXED'),
    percentage: z.number().positive().optional().describe('Percentual da parte; use com splitMethod PERCENTAGE'),
})

export const createExpenseBody = z.object({
    description: z.string().min(1).describe('Texto usado também pela categorização automática'),
    amount: moneyInput,
    payerId: z.uuid().describe('Id do usuário que pagou'),
    occurredAt: z.iso.datetime().optional().describe('Data da despesa em ISO 8601; padrão é agora'),
    splitMethod: z.enum(['EQUAL', 'FIXED', 'PERCENTAGE']),
    shares: z.array(shareInput).min(1).describe('Uma entrada por membro que participa do rateio'),
    category: expenseCategory.optional().describe('Informar a categoria desliga a categorização automática'),
}).meta({
    example: {
        description: 'Jantar no restaurante',
        amount: 180.5,
        payerId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        splitMethod: 'EQUAL',
        shares: [
            { memberId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302' },
            { memberId: '3f2504e0-4f89-41d3-9a0c-0305e82c3303' },
        ],
    },
})

export const updateExpenseBody = z.object({
    description: z.string().min(1).optional(),
    amount: moneyInput.optional(),
    splitMethod: z.enum(['EQUAL', 'FIXED', 'PERCENTAGE']).optional(),
    shares: z.array(shareInput).min(1).optional(),
    category: expenseCategory.optional(),
    version: z.number().int().min(0).describe('Campo `version` da despesa como o cliente a leu. Se outra edição gravou antes, responde 409 e o cliente precisa recarregar'),
}).meta({
    example: { description: 'Jantar no restaurante japonês', amount: 210, version: 0 },
})

export const expenseIdParam = z.object({
    expenseId: z.uuid(),
})

export const listExpensesQuery = z.object({
    view: z.enum(['all', 'involved', 'paid', 'pending']).optional().describe('Recorte da lista; padrão all'),
    category: expenseCategory.optional(),
    startDate: z.string().optional().describe('Data inicial em ISO 8601'),
    endDate: z.string().optional().describe('Data final em ISO 8601'),
    minAmount: z.coerce.number().positive().optional(),
    maxAmount: z.coerce.number().positive().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().optional(),
})

const groupIdParam = z.object({ groupId: z.uuid() })

const expenseShareShape = z.object({
    id: z.uuid(),
    memberId: z.uuid(),
    amount: z.string(),
})

const expenseShape = z.object({
    id: z.uuid(),
    groupId: z.uuid(),
    payerId: z.uuid(),
    description: z.string(),
    amount: z.string(),
    splitMethod: z.enum(['EQUAL', 'FIXED', 'PERCENTAGE']),
    occurredAt: z.date(),
    category: expenseCategory.optional(),
    shares: z.array(expenseShareShape),
    // D-92: presente na listagem e na resposta do PATCH, que é o que o cliente usa para editar.
    version: z.number().int().optional().describe('Enviar de volta no PATCH; muda a cada edição'),
})

export const createExpenseRouteSchema = {
    summary: 'Criar despesa',
    description: 'Registra uma despesa no grupo, distribuindo o valor entre os membros conforme o método de divisão (EQUAL, FIXED ou PERCENTAGE). Sem `category`, regras e cache categorizam na hora; se não decidirem, a categoria chega depois pelo evento `expense_categorized`.',
    tags: ['Expenses'],
    security: [{ bearerAuth: [] }],
    params: groupIdParam,
    body: createExpenseBody,
    response: {
        201: z.object({ expense: expenseShape }).describe('Despesa criada'),
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
    },
}

export const listExpensesRouteSchema = {
    summary: 'Listar despesas do grupo',
    description: 'Retorna as despesas do grupo com suporte a filtros por categoria, data, valor e paginação.',
    tags: ['Expenses'],
    security: [{ bearerAuth: [] }],
    params: groupIdParam,
    querystring: listExpensesQuery,
    response: {
        200: z.object({
            expenses: z.array(expenseShape),
            total: z.number().int(),
        }).describe('Despesas do grupo e o total sem paginação'),
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
    },
}

export const updateExpenseRouteSchema = {
    summary: 'Atualizar despesa',
    description: 'Edita descrição, valor, divisão ou categoria de uma despesa. Apenas o pagador ou OWNER podem editar. Mudar a descrição sem enviar `category` recategoriza automaticamente. Exige a `version` que o cliente leu: se outra edição gravou antes (inclusive enquanto a tela estava aberta), responde 409. A resposta traz a versão nova. Cada edição bem-sucedida guarda o estado anterior como revisão.',
    tags: ['Expenses'],
    security: [{ bearerAuth: [] }],
    params: expenseIdParam,
    body: updateExpenseBody,
    response: {
        200: z.object({ expense: expenseShape }).describe('Despesa atualizada'),
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        409: conflict,
    },
}

export const categorizeExpenseRouteSchema = {
    summary: 'Recategorizar despesa automaticamente',
    description: 'Roda a categorização automática (regras → cache → LLM → Outros) e sobrescreve a categoria atual. Qualquer membro do grupo da despesa pode solicitar. Emite o evento `expense_categorized`.',
    tags: ['Expenses'],
    security: [{ bearerAuth: [] }],
    params: expenseIdParam,
    response: {
        200: z.object({ expense: expenseShape }).describe('Despesa com a categoria recalculada'),
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
    },
}

export const deleteExpenseRouteSchema = {
    summary: 'Excluir despesa',
    description: 'Exclui uma despesa (exclusão lógica: some da listagem e dos saldos, mas o registro é mantido no histórico). Apenas o pagador ou OWNER podem excluir.',
    tags: ['Expenses'],
    security: [{ bearerAuth: [] }],
    params: expenseIdParam,
    response: {
        204: z.null().describe('Despesa excluída'),
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
    },
}

const expenseRevisionShape = z.object({
    version: z.number().int().describe('Versão que este snapshot representa — o estado antes da edição seguinte'),
    description: z.string(),
    amount: z.string(),
    splitMethod: z.enum(['EQUAL', 'FIXED', 'PERCENTAGE']),
    category: expenseCategory.optional(),
    occurredAt: z.date(),
    shares: z.array(z.object({ memberId: z.uuid(), amount: z.string() })),
    editedBy: z.object({
        userId: z.uuid(),
        name: z.string().nullable().describe('Nome atual de quem editou, mesmo que já tenha saído do grupo'),
    }),
    editedAt: z.date(),
})

export const getExpenseRevisionsRouteSchema = {
    summary: 'Histórico de edições da despesa',
    description: 'Cada item é o estado da despesa ANTES de uma edição, com quem editou e quando, da mais recente para a mais antiga. Qualquer membro do grupo pode consultar. Despesa excluída responde 404.',
    tags: ['Expenses'],
    security: [{ bearerAuth: [] }],
    params: expenseIdParam,
    response: {
        200: z.object({ revisions: z.array(expenseRevisionShape) }).describe('Revisões da despesa'),
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
    },
}
