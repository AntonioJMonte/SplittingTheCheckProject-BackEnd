import { SettlementRepository } from '../../application/repositories/settlement-repository'
import { Settlement, SettlementStatus } from '../../domain/entities/settlement'

interface SnapshotChanges {
    status?: SettlementStatus
    confirmedAt?: Date
    version?: number
}

// Stores and returns copies so a use case mutating the entity it read cannot bypass the version check,
// mirroring how rows behave in the database.
function snapshot(settlement: Settlement, changes: SnapshotChanges = {}): Settlement {
    return new Settlement(
        settlement.id,
        settlement.groupId,
        settlement.fromMemberId,
        settlement.toMemberId,
        settlement.amount,
        changes.status ?? settlement.status,
        changes.confirmedAt ?? settlement.confirmedAt,
        settlement.pixCopyPaste,
        changes.version ?? settlement.version,
        settlement.createdAt,
    )
}

export class InMemorySettlementRepository implements SettlementRepository {
    public items: Settlement[] = []

    async create(settlement: Settlement): Promise<boolean> {
        const duplicatedPending = settlement.status === 'PENDING' && this.items.some(
            s => s.fromMemberId === settlement.fromMemberId && s.toMemberId === settlement.toMemberId && s.status === 'PENDING',
        )
        if (duplicatedPending) return false

        this.items.push(snapshot(settlement))
        return true
    }

    async findById(id: string): Promise<Settlement | null> {
        const found = this.items.find(s => s.id === id)
        return found ? snapshot(found) : null
    }

    async findByGroup(groupId: string, status?: SettlementStatus): Promise<Settlement[]> {
        return this.items
            .filter(s => s.groupId === groupId && (status === undefined || s.status === status))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map(s => snapshot(s))
    }

    async findPendingBetweenMembers(fromMemberId: string, toMemberId: string): Promise<Settlement | null> {
        const found = this.items.find(
            s => s.fromMemberId === fromMemberId && s.toMemberId === toMemberId && s.status === 'PENDING',
        )
        return found ? snapshot(found) : null
    }

    async findConfirmedByMemberAndGroup(memberId: string, groupId: string): Promise<Settlement[]> {
        return this.items
            .filter(
                s =>
                    s.groupId === groupId &&
                    s.status === 'CONFIRMED' &&
                    (s.fromMemberId === memberId || s.toMemberId === memberId),
            )
            .map(s => snapshot(s))
    }

    async findConfirmedByGroup(groupId: string): Promise<Settlement[]> {
        return this.items
            .filter(s => s.groupId === groupId && s.status === 'CONFIRMED')
            .map(s => snapshot(s))
    }

    async updateStatus(id: string, status: 'CONFIRMED' | 'CANCELLED', expectedVersion: number): Promise<boolean> {
        const index = this.items.findIndex(s => s.id === id && s.version === expectedVersion)
        if (index === -1) return false

        const current = this.items[index]
        this.items[index] = snapshot(current, {
            status,
            confirmedAt: status === 'CONFIRMED' ? new Date() : undefined,
            version: current.version + 1,
        })
        return true
    }

    async cancelPendingByGroupId(groupId: string): Promise<void> {
        this.items = this.items.map(s =>
            s.groupId === groupId && s.status === 'PENDING'
                ? snapshot(s, { status: 'CANCELLED', version: s.version + 1 })
                : s,
        )
    }
}
