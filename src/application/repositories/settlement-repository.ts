import { Settlement, SettlementStatus } from '../../domain/entities/settlement'

export interface SettlementRepository {
    /** Resolves to false, without writing, when another PENDING settlement already exists for the same pair. */
    create(settlement: Settlement): Promise<boolean>
    findById(id: string): Promise<Settlement | null>
    /** D-89: acertos do grupo, mais recentes primeiro; sem `status`, todos. */
    findByGroup(groupId: string, status?: SettlementStatus): Promise<Settlement[]>
    findPendingBetweenMembers(fromMemberId: string, toMemberId: string): Promise<Settlement | null>
    findConfirmedByMemberAndGroup(memberId: string, groupId: string): Promise<Settlement[]>
    findConfirmedByGroup(groupId: string): Promise<Settlement[]>
    /** Optimistic lock: writes only if the stored version still equals `expectedVersion`; resolves to whether it wrote. */
    updateStatus(id: string, status: 'CONFIRMED' | 'CANCELLED', expectedVersion: number): Promise<boolean>
    cancelPendingByGroupId(groupId: string): Promise<void>
}
