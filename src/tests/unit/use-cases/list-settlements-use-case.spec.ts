import { describe, it, expect, beforeEach } from 'vitest'
import { ListSettlementsUseCase } from '../../../application/use-cases/settlements/list-settlements-use-case'
import { InMemoryGroupRepository } from '../../doubles/in-memory-group-repository'
import { InMemoryMemberRepository } from '../../doubles/in-memory-member-repository'
import { InMemorySettlementRepository } from '../../doubles/in-memory-settlement-repository'
import { Group } from '../../../domain/entities/group'
import { Member } from '../../../domain/entities/member'
import { Settlement, SettlementStatus } from '../../../domain/entities/settlement'
import { Money } from '../../../domain/value-objects/money'
import { GroupNotFoundError } from '../../../shared/errors/group-not-found-error'
import { NotGroupMemberError } from '../../../shared/errors/not-group-member-error'

describe('ListSettlementsUseCase (D-89)', () => {
  let groupRepository: InMemoryGroupRepository
  let memberRepository: InMemoryMemberRepository
  let settlementRepository: InMemorySettlementRepository
  let sut: ListSettlementsUseCase
  let group: Group
  let owner: Member
  let debtor: Member

  beforeEach(async () => {
    groupRepository = new InMemoryGroupRepository()
    memberRepository = new InMemoryMemberRepository()
    settlementRepository = new InMemorySettlementRepository()
    sut = new ListSettlementsUseCase(groupRepository, memberRepository, settlementRepository)

    group = Group.create({ name: 'Casa', creatorUserId: 'user-1' })
    owner = group.members[0] as Member
    debtor = group.addMember(owner, 'user-2')
    await groupRepository.create(group)
    await memberRepository.addMemberToGroup(owner)
    await memberRepository.addMemberToGroup(debtor)
  })

  function seed(status: SettlementStatus, createdAt: string, groupId = group.id) {
    const settlement = new Settlement(
      crypto.randomUUID(), groupId, debtor.id, owner.id, new Money('10.00'), status, undefined, undefined, 0, new Date(createdAt),
    )
    settlementRepository.items.push(settlement)
    return settlement
  }

  it('lista os acertos do grupo do mais recente para o mais antigo, ignorando outros grupos', async () => {
    const older = seed('CONFIRMED', '2026-09-01T00:00:00Z')
    const newer = seed('PENDING', '2026-09-15T00:00:00Z')
    seed('PENDING', '2026-09-20T00:00:00Z', 'outro-grupo')

    const { settlements } = await sut.execute({ groupId: group.id, requestUserId: 'user-1' })

    expect(settlements.map(s => s.id)).toEqual([newer.id, older.id])
  })

  it('filtra pelo status pedido', async () => {
    seed('CONFIRMED', '2026-09-01T00:00:00Z')
    const pending = seed('PENDING', '2026-09-15T00:00:00Z')
    seed('CANCELLED', '2026-09-16T00:00:00Z')

    const { settlements } = await sut.execute({ groupId: group.id, requestUserId: 'user-1', status: 'PENDING' })

    expect(settlements.map(s => s.id)).toEqual([pending.id])
  })

  it('recusa grupo inexistente e quem não é membro', async () => {
    await expect(sut.execute({ groupId: 'nao-existe', requestUserId: 'user-1' })).rejects.toBeInstanceOf(GroupNotFoundError)
    await expect(sut.execute({ groupId: group.id, requestUserId: 'user-3' })).rejects.toBeInstanceOf(NotGroupMemberError)
  })
})
