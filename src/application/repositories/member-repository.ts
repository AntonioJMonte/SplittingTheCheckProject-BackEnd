import { Member } from '../../domain/entities/member'

export interface MembersWithUser {
    id: string
    userId: string
    role: 'OWNER' | 'MEMBER'
    joinedAt: Date
    name: string
    email: string
    
}

export interface MemberRepository {
    addMemberToGroup(data: Member): Promise<void>
    /**
     * D-79: enxerga também quem já saiu. Usado para resolver o membro de uma despesa antiga,
     * cujo histórico deve continuar legível. As demais leituras devolvem só membros ativos.
     */
    findById(id: string): Promise<Member | null>
    findByUserAndGroup(userId: string, groupId: string): Promise<Member | null>
    findByGroupId(groupId: string): Promise<Member[]>
    /** D-72/D-73: exclusão lógica — o registro fica, marcado com quem removeu. */
    removeMemberGroup(memberId: string, removedByUserId: string): Promise<void>
    /** D-78: quem já saiu continua ocupando o par (userId, groupId); usado para reativar. */
    findRemovedByUserAndGroup(userId: string, groupId: string): Promise<Member | null>
    /** D-78: quem volta ao grupo reativa o próprio registro, preservando o id e o histórico. */
    reactivate(memberId: string): Promise<void>
    updateRole(memberId: string, role: 'OWNER' | 'MEMBER'): Promise<void>
    findByGroupIdWithUser(groupId: string): Promise<MembersWithUser[]>
}
