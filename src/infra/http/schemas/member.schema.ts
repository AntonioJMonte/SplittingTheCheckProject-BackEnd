import z from 'zod'
import { badRequest, forbidden, notFound, unauthorized } from './shared.schema'

// D-77: exatamente um entre email e telefone. Um campo único ("identifier") exigiria adivinhar
// o tipo do valor; a união deixa explícito o que foi enviado e recusa ambos ou nenhum com 400.
export const addMemberBody = z.union([
    z.object({
        email: z.email().describe('Email de um usuário já registrado'),
        phone: z.undefined().optional(),
    }),
    z.object({
        phone: z.string().min(1).describe('Telefone de um usuário já registrado, em qualquer formato'),
        email: z.undefined().optional(),
    }),
]).meta({
    example: { email: 'bruno@example.com' },
})

export const updateMemberRoleBody = z.object({
    newRole: z.enum(['OWNER', 'MEMBER']),
}).meta({
    example: { newRole: 'OWNER' },
})

export const memberIdParam = z.object({
    memberId: z.uuid(),
})

const groupIdParam = z.object({ groupId: z.uuid() })
const groupAndMemberParams = z.object({ groupId: z.uuid(), memberId: z.uuid() })

const memberShape = z.object({
    id: z.uuid(),
    userId: z.uuid(),
    groupId: z.uuid(),
    role: z.enum(['OWNER', 'MEMBER']),
    joinedAt: z.date(),
})

export const memberWithUserShape = z.object({
    id: z.uuid(),
    userId: z.uuid(),
    role: z.enum(['OWNER', 'MEMBER']),
    joinedAt: z.date(),
    name: z.string(),
    email: z.string(),
})

export const addMemberRouteSchema = {
    summary: 'Adicionar membro ao grupo',
    description: 'Adiciona ao grupo, como MEMBER, um usuário já registrado, identificado por email ou telefone (exatamente um dos dois). Requer papel OWNER. Responde 404 se ninguém estiver registrado com aquele contato.',
    tags: ['Groups'],
    security: [{ bearerAuth: [] }],
    params: groupIdParam,
    body: addMemberBody,
    response: {
        201: z.object({ member: memberShape }).describe('Membro adicionado'),
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
    },
}

export const removeMemberRouteSchema = {
    summary: 'Remover membro do grupo',
    description: 'Remove um membro do grupo. Requer papel OWNER. O membro não pode ter saldo pendente.',
    tags: ['Groups'],
    security: [{ bearerAuth: [] }],
    params: groupAndMemberParams,
    response: {
        204: z.null().describe('Membro removido'),
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
    },
}

export const leaveGroupRouteSchema = {
    summary: 'Sair do grupo',
    description: 'Remove o usuário autenticado do grupo. O OWNER só pode sair se for o único membro.',
    tags: ['Groups'],
    security: [{ bearerAuth: [] }],
    params: groupIdParam,
    response: {
        204: z.null().describe('Saída concluída'),
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
    },
}

export const listMembersRouteSchema = {
    summary: 'Listar membros do grupo',
    description: 'Retorna todos os membros do grupo com suas informações de usuário.',
    tags: ['Groups'],
    security: [{ bearerAuth: [] }],
    params: groupIdParam,
    response: {
        200: z.object({ members: z.array(memberWithUserShape) }).describe('Membros do grupo'),
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
    },
}

export const updateMemberRoleRouteSchema = {
    summary: 'Atualizar papel do membro',
    description: 'Promove ou rebaixa um membro. Requer papel OWNER. Não é possível rebaixar o único OWNER.',
    tags: ['Groups'],
    security: [{ bearerAuth: [] }],
    params: groupAndMemberParams,
    body: updateMemberRoleBody,
    response: {
        200: z.object({ memberId: z.uuid(), role: z.enum(['OWNER', 'MEMBER']) }).describe('Papel atualizado'),
        400: badRequest,
        401: unauthorized,
        403: forbidden,
        404: notFound,
    },
}
