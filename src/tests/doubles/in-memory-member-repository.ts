import { MemberRepository, MembersWithUser } from '../../application/repositories/member-repository'
import { Member } from '../../domain/entities/member'

export class InMemoryMemberRepository implements MemberRepository {
    public items: Member[] = []
    public userLookup: Map<string, { name: string; email: string }> = new Map()
    // Espelha o soft delete do Prisma (D-72/D-73): o membro sai das leituras ativas mas continua
    // encontrável por id, que é o que mantém o histórico de despesas legível (D-79).
    public removed: Map<string, { deletedBy: string }> = new Map()

    private isActive(member: Member): boolean {
        return !this.removed.has(member.id)
    }

    async addMemberToGroup(data: Member): Promise<void> {
        this.items.push(data)
    }

    async findById(id: string): Promise<Member | null> {
        return this.items.find(m => m.id === id) ?? null
    }

    async findByUserAndGroup(userId: string, groupId: string): Promise<Member | null> {
        return this.items.find(m => m.userId === userId && m.groupId === groupId && this.isActive(m)) ?? null
    }

    async findRemovedByUserAndGroup(userId: string, groupId: string): Promise<Member | null> {
        return this.items.find(m => m.userId === userId && m.groupId === groupId && !this.isActive(m)) ?? null
    }

    async findByGroupId(groupId: string): Promise<Member[]> {
        return this.items.filter(m => m.groupId === groupId && this.isActive(m))
    }

    async removeMemberGroup(memberId: string, removedByUserId: string): Promise<void> {
        if (this.items.some(m => m.id === memberId)) {
            this.removed.set(memberId, { deletedBy: removedByUserId })
        }
    }

    async reactivate(memberId: string): Promise<void> {
        this.removed.delete(memberId)
    }

    async updateRole(memberId: string, role: 'OWNER' | 'MEMBER'): Promise<void> {
        const index = this.items.findIndex(m => m.id === memberId)
        if (index !== -1) {
            const m = this.items[index]
            this.items[index] = new Member(m.id, m.userId, m.groupId, role, m.joinedAt)
        }
    }

    async findByGroupIdWithUser(groupId: string): Promise<MembersWithUser[]> {
        return this.items
            .filter(m => m.groupId === groupId && this.isActive(m))
            .map(m => {
                const userData = this.userLookup.get(m.userId) ?? { name: '', email: '' }
                return {
                    id: m.id,
                    userId: m.userId,
                    role: m.role,
                    joinedAt: m.joinedAt,
                    name: userData.name,
                    email: userData.email,
                }
            })
    }
}
