import { MemberRepository, MembersWithUser } from '../../../application/repositories/member-repository'
import { Member } from '../../../domain/entities/member'
import { prisma } from './prismaClient'

function toMember(row: { id: string; userId: string; groupId: string; role: string; joinedAt: Date }): Member {
    return new Member(row.id, row.userId, row.groupId, row.role as 'OWNER' | 'MEMBER', row.joinedAt)
}

// D-73: todas as leituras de membros ativos passam por aqui. Um lugar só para o filtro evita
// que uma consulta esquecida traga de volta quem já saiu do grupo.
const ACTIVE = { deletedAt: null }

export class PrismaMemberRepository implements MemberRepository {

    async addMemberToGroup(data: Member): Promise<void> {
        await prisma.member.create({
            data: {
                id: data.id,
                groupId: data.groupId,
                userId: data.userId,
                role: data.role,
                joinedAt: data.joinedAt,
            },
        })
    }

    // D-79: sem o filtro de propósito — resolver o membro de uma despesa antiga exige enxergar
    // quem já saiu, senão o histórico fica sem nome.
    async findById(id: string): Promise<Member | null> {
        const row = await prisma.member.findUnique({ where: { id } })
        if (!row) return null
        return toMember(row)
    }

    async findByUserAndGroup(userId: string, groupId: string): Promise<Member | null> {
        const row = await prisma.member.findFirst({
            where: { userId, groupId, ...ACTIVE },
        })
        if (!row) return null
        return toMember(row)
    }

    // D-78: o registro de quem saiu continua ocupando o par (userId, groupId), então readicionar
    // é reativar. Devolve null quando a pessoa nunca esteve no grupo.
    async findRemovedByUserAndGroup(userId: string, groupId: string): Promise<Member | null> {
        const row = await prisma.member.findFirst({
            where: { userId, groupId, NOT: { deletedAt: null } },
        })
        if (!row) return null
        return toMember(row)
    }

    async findByGroupId(groupId: string): Promise<Member[]> {
        const rows = await prisma.member.findMany({ where: { groupId, ...ACTIVE } })
        return rows.map(toMember)
    }

    async removeMemberGroup(memberId: string, removedByUserId: string): Promise<void> {
        await prisma.member.update({
            where: { id: memberId },
            data: { deletedAt: new Date(), deletedBy: removedByUserId },
        })
    }

    async reactivate(memberId: string): Promise<void> {
        await prisma.member.update({
            where: { id: memberId },
            data: { deletedAt: null, deletedBy: null },
        })
    }

    async updateRole(memberId: string, role: 'OWNER' | 'MEMBER'): Promise<void> {
        await prisma.member.update({
            where: { id: memberId },
            data: { role },
        })
    }

    async findByGroupIdWithUser(groupId: string): Promise<MembersWithUser[]> {
        const rows = await prisma.member.findMany({
            where: { groupId, ...ACTIVE },
            include: {
                user: {
                    select: { name: true, email: true },
                },
            },
            orderBy: { joinedAt: 'asc' },
        })

        return rows.map(row => ({
            id: row.id,
            userId: row.userId,
            role: row.role as 'OWNER' | 'MEMBER',
            joinedAt: row.joinedAt,
            name: row.user.name,
            email: row.user.email
        }))
    }
}
