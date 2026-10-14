import { describe, it, expect, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { GetGroupBalancesUseCase } from '../../../application/use-cases/groups/get-group-balances-use-case'
import { InMemoryGroupRepository } from '../../doubles/in-memory-group-repository'
import { InMemoryMemberRepository } from '../../doubles/in-memory-member-repository'
import { InMemoryExpenseRepository } from '../../doubles/in-memory-expense-repository'
import { InMemorySettlementRepository } from '../../doubles/in-memory-settlement-repository'
import { Group } from '../../../domain/entities/group'
import { Member } from '../../../domain/entities/member'
import { Expense } from '../../../domain/entities/expense'
import { Settlement } from '../../../domain/entities/settlement'
import { Money } from '../../../domain/value-objects/money'
import { GroupNotFoundError } from '../../../shared/errors/group-not-found-error'
import { AppError } from '../../../shared/errors/app-error'

describe('GetGroupBalancesUseCase', () => {
  let groupRepository: InMemoryGroupRepository
  let memberRepository: InMemoryMemberRepository
  let expenseRepository: InMemoryExpenseRepository
  let settlementRepository: InMemorySettlementRepository
  let sut: GetGroupBalancesUseCase

  beforeEach(() => {
    groupRepository = new InMemoryGroupRepository()
    memberRepository = new InMemoryMemberRepository()
    expenseRepository = new InMemoryExpenseRepository()
    settlementRepository = new InMemorySettlementRepository()
    sut = new GetGroupBalancesUseCase(groupRepository, memberRepository, expenseRepository, settlementRepository)
  })

  async function makeGroupWithTwoMembers() {
    const group = Group.create({ name: 'Grupo', creatorUserId: 'user-1', currency: 'BRL' })
    const owner = group.members[0] as Member
    const member2 = group.addMember(owner, 'user-2')
    await groupRepository.create(group)
    await memberRepository.addMemberToGroup(owner)
    await memberRepository.addMemberToGroup(member2)
    return { group, owner, member2 }
  }

  it('should return zero balances when there are no expenses', async () => {
    const { group, owner } = await makeGroupWithTwoMembers()

    const { memberBalances } = await sut.execute({
      groupId: group.id,
      requestingUserId: owner.userId,
    })

    expect(memberBalances.every(b => b.balance.isZero())).toBe(true)
  })

  it('should calculate correct balances when one member pays for all', async () => {
    const { group, owner, member2 } = await makeGroupWithTwoMembers()

    // owner pays 100, split 50/50
    const expense = Expense.create({
      groupId: group.id,
      payerId: owner.userId,
      description: 'Jantar',
      amount: new Money('100.00'),
      shareInputs: [
        { memberId: owner.id, amount: new Money('50.00') },
        { memberId: member2.id, amount: new Money('50.00') },
      ],
      splitMethod: 'EQUAL',
    })
    await expenseRepository.create(expense)

    const { memberBalances, transfers } = await sut.execute({
      groupId: group.id,
      requestingUserId: owner.userId,
    })

    const ownerBalance = memberBalances.find(b => b.userId === owner.userId)!
    const member2Balance = memberBalances.find(b => b.userId === member2.userId)!

    expect(ownerBalance.balance.toString()).toBe('50')
    expect(member2Balance.balance.toString()).toBe('-50')
    expect(transfers).toHaveLength(1)
    expect(transfers[0].fromMemberId).toBe(member2.id)
    expect(transfers[0].toMemberId).toBe(owner.id)
    expect(transfers[0].amount.toNumber()).toBe(50)
  })

  it('should throw GroupNotFoundError when group does not exist', async () => {
    await expect(
      sut.execute({ groupId: 'nonexistent', requestingUserId: 'user-1' }),
    ).rejects.toBeInstanceOf(GroupNotFoundError)
  })

  it('should throw AppError when requester is not a member', async () => {
    const { group } = await makeGroupWithTwoMembers()

    await expect(
      sut.execute({ groupId: group.id, requestingUserId: 'stranger' }),
    ).rejects.toBeInstanceOf(AppError)
  })

  async function ownerPaysHundredSplitInHalf() {
    const setup = await makeGroupWithTwoMembers()
    await expenseRepository.create(Expense.create({
      groupId: setup.group.id,
      payerId: setup.owner.userId,
      description: 'Jantar',
      amount: new Money('100.00'),
      shareInputs: [
        { memberId: setup.owner.id, amount: new Money('50.00') },
        { memberId: setup.member2.id, amount: new Money('50.00') },
      ],
      splitMethod: 'EQUAL',
    }))
    return setup
  }

  function settle(groupId: string, fromMemberId: string, toMemberId: string, amount: string, confirmed: boolean) {
    const settlement = Settlement.create({ groupId, fromMemberId, toMemberId, amount: new Money(amount) })
    if (confirmed) settlement.confirm()
    settlementRepository.items.push(settlement)
  }

  it('should zero balances and transfers after a confirmed settlement', async () => {
    const { group, owner, member2 } = await ownerPaysHundredSplitInHalf()
    settle(group.id, member2.id, owner.id, '50.00', true)

    const { memberBalances, transfers } = await sut.execute({ groupId: group.id, requestingUserId: owner.userId })

    expect(memberBalances.every(b => b.balance.isZero())).toBe(true)
    expect(transfers).toHaveLength(0)
  })

  it('should keep the debt while the settlement is only pending', async () => {
    const { group, owner, member2 } = await ownerPaysHundredSplitInHalf()
    settle(group.id, member2.id, owner.id, '50.00', false)

    const { transfers } = await sut.execute({ groupId: group.id, requestingUserId: owner.userId })

    expect(transfers).toHaveLength(1)
    expect(transfers[0].amount.toNumber()).toBe(50)
  })

  it('should leave only the remainder after a partial confirmed settlement', async () => {
    const { group, owner, member2 } = await ownerPaysHundredSplitInHalf()
    settle(group.id, member2.id, owner.id, '30.00', true)

    const { memberBalances, transfers } = await sut.execute({ groupId: group.id, requestingUserId: owner.userId })

    expect(memberBalances.find(b => b.memberId === owner.id)!.balance.toString()).toBe('20')
    expect(memberBalances.find(b => b.memberId === member2.id)!.balance.toString()).toBe('-20')
    expect(transfers[0].amount.toNumber()).toBe(20)
  })
})
