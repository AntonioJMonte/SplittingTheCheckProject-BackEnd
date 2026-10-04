import { Prisma } from '@prisma/client'
import { prisma } from './prismaClient'
import { SettlementRepository } from '../../../application/repositories/settlement-repository'
import { Settlement, SettlementStatus } from '../../../domain/entities/settlement'
import { Money } from '../../../domain/value-objects/money'

function toSettlement(row: {
    id: string
    groupId: string
    fromMemberId: string
    toMemberId: string
    amount: { toString(): string }
    status: string
    confirmedAt: Date | null
    pixCopyPaste: string | null
    version: number
    createdAt: Date
}): Settlement {
    return new Settlement(
        row.id,
        row.groupId,
        row.fromMemberId,
        row.toMemberId,
        new Money(row.amount.toString()),
        row.status as SettlementStatus,
        row.confirmedAt ?? undefined,
        row.pixCopyPaste ?? undefined,
        row.version,
        row.createdAt,
    )
}

function pendingKeyFor(settlement: Settlement): string | null {
    return settlement.status === 'PENDING' ? `${settlement.fromMemberId}:${settlement.toMemberId}` : null
}

function isPendingKeyConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false
    const target = error.meta?.target
    return Array.isArray(target) ? target.includes('pendingKey') : String(target).includes('pendingKey')
}

export class PrismaSettlementRepository implements SettlementRepository {

    async create(settlement: Settlement): Promise<boolean> {
        try {
            await prisma.settlement.create({
                data: {
                    id: settlement.id,
                    groupId: settlement.groupId,
                    fromMemberId: settlement.fromMemberId,
                    toMemberId: settlement.toMemberId,
                    amount: settlement.amount.toString(),
                    status: settlement.status,
                    pixCopyPaste: settlement.pixCopyPaste,
                    version: settlement.version,
                    createdAt: settlement.createdAt,
                    pendingKey: pendingKeyFor(settlement),
                },
            })
            return true
        } catch (error) {
            if (isPendingKeyConflict(error)) return false
            throw error
        }
    }

    async findById(id: string): Promise<Settlement | null> {
        const row = await prisma.settlement.findUnique({ where: { id } })
        if (!row) return null
        return toSettlement(row)
    }

    async findByGroup(groupId: string, status?: SettlementStatus): Promise<Settlement[]> {
        const rows = await prisma.settlement.findMany({
            where: { groupId, ...(status ? { status } : {}) },
            orderBy: { createdAt: 'desc' },
        })
        return rows.map(toSettlement)
    }

    async findPendingBetweenMembers(fromMemberId: string, toMemberId: string): Promise<Settlement | null> {
        const row = await prisma.settlement.findFirst({
            where: { fromMemberId, toMemberId, status: 'PENDING' },
        })
        if (!row) return null
        return toSettlement(row)
    }

    async findConfirmedByMemberAndGroup(memberId: string, groupId: string): Promise<Settlement[]> {
        const rows = await prisma.settlement.findMany({
            where: {
                groupId,
                status: 'CONFIRMED',
                OR: [
                    { fromMemberId: memberId },
                    { toMemberId: memberId },
                ],
            },
        })
        return rows.map(toSettlement)
    }

    async findConfirmedByGroup(groupId: string): Promise<Settlement[]> {
        const rows = await prisma.settlement.findMany({
            where: { groupId, status: 'CONFIRMED' },
        })
        return rows.map(toSettlement)
    }

    async updateStatus(id: string, status: 'CONFIRMED' | 'CANCELLED', expectedVersion: number): Promise<boolean> {
        const { count } = await prisma.settlement.updateMany({
            where: { id, version: expectedVersion },
            data: {
                status,
                confirmedAt: status === 'CONFIRMED' ? new Date() : undefined,
                pendingKey: null,
                version: { increment: 1 },
            },
        })
        return count === 1
    }

    async cancelPendingByGroupId(groupId: string): Promise<void> {
        await prisma.settlement.updateMany({
            where: { groupId, status: 'PENDING' },
            data: {
                status: 'CANCELLED',
                pendingKey: null,
                version: { increment: 1 },
            },
        })
    }
}
