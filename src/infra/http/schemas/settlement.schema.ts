import z from 'zod'
import { badRequest, conflict, forbidden, moneyInput, notFound, unauthorized, unprocessableEntity } from './shared.schema'

export const confirmSettlementBody = z.object({
    fromMemberId: z.uuid().describe('Membro devedor — precisa ser o usuário autenticado'),
    toMemberId: z.uuid().describe('Membro credor'),
    amount: moneyInput.describe('Não pode exceder a dívida calculada'),
}).meta({
    example: {
        fromMemberId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
        toMemberId: '3f2504e0-4f89-41d3-9a0c-0305e82c3303',
        amount: 90.25,
    },
})

export const settlementIdParam = z.object({
    settlementId: z.uuid(),
})

const groupIdParam = z.object({ groupId: z.uuid() })

const settlementShape = z.object({
    id: z.uuid(),
    fromMemberId: z.uuid(),
    toMemberId: z.uuid(),
    amount: z.string(),
    status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED']),
    pixCopyPaste: z.string().nullable().optional(),
    confirmedAt: z.date().nullable().optional(),
})

export const listSettlementsQuery = z.object({
    status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED']).optional().describe('Sem filtro, devolve todos'),
})

export const listSettlementsRouteSchema = {
    summary: 'Listar acertos do grupo',
    description: 'Acertos registrados no grupo, mais recentes primeiro. Com `status=PENDING`, o credor encontra o que ainda precisa reconhecer em `PATCH /settlements/:settlementId/acknowledge`, mesmo que estivesse offline quando o evento `settlement_confirmed` foi emitido.',
    tags: ['Settlements'],
    security: [{ bearerAuth: [] }],
    params: groupIdParam,
    querystring: listSettlementsQuery,
    response: {
        200: z.object({
            settlements: z.array(settlementShape.extend({ createdAt: z.date() })),
        }).describe('Acertos do grupo'),
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
    },
}

const computedSettlementShape = z.object({
    fromMemberId: z.uuid(),
    fromMemberName: z.string(),
    toMemberId: z.uuid(),
    toMemberName: z.string(),
    amount: z.string(),
})

export const computeSettlementsRouteSchema = {
    summary: 'Calcular acertos sugeridos',
    description: 'Calcula as transferências mínimas necessárias para quitar todas as dívidas do grupo usando o algoritmo DebtMinimizer.',
    tags: ['Settlements'],
    security: [{ bearerAuth: [] }],
    params: groupIdParam,
    response: {
        200: z.object({ settlements: z.array(computedSettlementShape) }).describe('Transferências mínimas sugeridas'),
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
    },
}

export const confirmSettlementRouteSchema = {
    summary: 'Registrar acerto',
    description: 'O devedor registra um pagamento ao credor. O valor não pode exceder a dívida calculada. Gera copia-e-cola Pix se o credor tiver chave Pix cadastrada.',
    tags: ['Settlements'],
    security: [{ bearerAuth: [] }],
    params: groupIdParam,
    body: confirmSettlementBody,
    response: {
        201: z.object({ settlement: settlementShape }).describe('Acerto registrado como PENDING'),
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        409: conflict,
        422: unprocessableEntity,
    },
}

export const acknowledgeSettlementRouteSchema = {
    summary: 'Confirmar recebimento do acerto',
    description: 'O credor confirma que recebeu o pagamento, encerrando o acerto com status CONFIRMED. Responde 409 se o acerto foi alterado por outra operação entre a leitura e a escrita (lock otimista).',
    tags: ['Settlements'],
    security: [{ bearerAuth: [] }],
    params: settlementIdParam,
    response: {
        200: z.object({ settlement: settlementShape }).describe('Acerto confirmado'),
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
        409: conflict,
    },
}
