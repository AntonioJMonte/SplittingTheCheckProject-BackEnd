import { ListSettlementsUseCase } from '../../application/use-cases/settlements/list-settlements-use-case'
import { PrismaGroupRepository } from '../database/prisma/prismaGroupRepository'
import { PrismaMemberRepository } from '../database/prisma/prismaMemberRepository'
import { PrismaSettlementRepository } from '../database/prisma/prismaSettlementRepository'

export function makeListSettlementsUseCase() {
    const groupRepository = new PrismaGroupRepository()
    const memberRepository = new PrismaMemberRepository()
    const settlementRepository = new PrismaSettlementRepository()
    return new ListSettlementsUseCase(groupRepository, memberRepository, settlementRepository)
}
