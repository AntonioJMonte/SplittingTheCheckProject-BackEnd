import { describe, it, expect, beforeEach } from 'vitest'
import { UpdateExpenseUseCase } from '../../../application/use-cases/expenses/update-expense-use-case'
import { InMemoryExpenseRepository } from '../../doubles/in-memory-expense-repository'
import { InMemoryMemberRepository } from '../../doubles/in-memory-member-repository'
import { InMemoryGroupRepository } from '../../doubles/in-memory-group-repository'
import { InMemorySettlementRepository } from '../../doubles/in-memory-settlement-repository'
import { Group } from '../../../domain/entities/group'
import { Member } from '../../../domain/entities/member'
import { Expense } from '../../../domain/entities/expense'
import { Settlement } from '../../../domain/entities/settlement'
import { Money } from '../../../domain/value-objects/money'
import { ExpenseNotFoundError } from '../../../shared/errors/expense-not-found-error'
import { NotGroupMemberError } from '../../../shared/errors/not-group-member-error'
import { UnauthorizedError } from '../../../shared/errors/unauthorized-error'
import { MemberNotInGroupError } from '../../../shared/errors/member-not-in-group-error'
import { ExpenseConcurrentModificationError } from '../../../shared/errors/expense-concurrent-modification-error'
import { FakeExpenseCategorizer } from '../../helpers/fake-expense-categorizer'

describe('UpdateExpenseUseCase', () => {
  let expenseRepository: InMemoryExpenseRepository
  let memberRepository: InMemoryMemberRepository
  let groupRepository: InMemoryGroupRepository
  let settlementRepository: InMemorySettlementRepository
  let categorizer: FakeExpenseCategorizer
  let sut: UpdateExpenseUseCase

  let group: Group
  let owner: Member
  let member2: Member

  beforeEach(async () => {
    expenseRepository = new InMemoryExpenseRepository()
    memberRepository = new InMemoryMemberRepository()
    groupRepository = new InMemoryGroupRepository()
    settlementRepository = new InMemorySettlementRepository()
    categorizer = new FakeExpenseCategorizer()
    sut = new UpdateExpenseUseCase(expenseRepository, memberRepository, groupRepository, settlementRepository, categorizer)

    group = Group.create({ name: 'Grupo', creatorUserId: 'user-1', currency: 'BRL' })
    owner = group.members[0] as Member
    member2 = group.addMember(owner, 'user-2')
    await groupRepository.create(group)
    await memberRepository.addMemberToGroup(owner)
    await memberRepository.addMemberToGroup(member2)
  })

  function makeExpense(category?: 'Alimentação' | 'Lazer') {
    return Expense.create({
      groupId: group.id,
      payerId: owner.userId,
      description: 'Jantar',
      amount: new Money('60.00'),
      shareInputs: [
        { memberId: owner.id, amount: new Money('30.00') },
        { memberId: member2.id, amount: new Money('30.00') },
      ],
      splitMethod: 'EQUAL',
      category,
    })
  }

  it('should update the description of an expense', async () => {
    const expense = makeExpense()
    await expenseRepository.create(expense)

    const { expense: updated } = await sut.execute({
      expenseId: expense.id,
      requestUserId: owner.userId,
      version: 0,
      description: 'Almoço atualizado',
    })

    expect(updated.description).toBe('Almoço atualizado')
  })

  it('should allow a group owner to update another member\'s expense', async () => {
    // member2 is the payer; owner updates it
    const memberPayerExpense = Expense.create({
      groupId: group.id,
      payerId: member2.userId,
      description: 'Compra',
      amount: new Money('40.00'),
      shareInputs: [
        { memberId: owner.id, amount: new Money('20.00') },
        { memberId: member2.id, amount: new Money('20.00') },
      ],
      splitMethod: 'EQUAL',
    })
    await expenseRepository.create(memberPayerExpense)

    const { expense: updated } = await sut.execute({
      expenseId: memberPayerExpense.id,
      requestUserId: owner.userId,
      version: 0,
      description: 'Compra atualizada',
    })

    expect(updated.description).toBe('Compra atualizada')
  })

  it('should cancel pending settlements when expense is updated', async () => {
    const expense = makeExpense()
    await expenseRepository.create(expense)

    const pendingSettlement = Settlement.create({
      groupId: group.id,
      fromMemberId: member2.id,
      toMemberId: owner.id,
      amount: new Money('30.00'),
    })
    await settlementRepository.create(pendingSettlement)

    await sut.execute({ expenseId: expense.id, requestUserId: owner.userId, version: 0, description: 'Novo' })

    const remaining = settlementRepository.items.find(s => s.id === pendingSettlement.id)
    expect(remaining!.status).toBe('CANCELLED')
  })

  it('should throw ExpenseNotFoundError when expense does not exist', async () => {
    await expect(
      sut.execute({ expenseId: 'nonexistent', requestUserId: owner.userId, version: 0 }),
    ).rejects.toBeInstanceOf(ExpenseNotFoundError)
  })

  it('should throw NotGroupMemberError when requester is not a member', async () => {
    const expense = makeExpense()
    await expenseRepository.create(expense)

    await expect(
      sut.execute({ expenseId: expense.id, requestUserId: 'stranger', version: 0 }),
    ).rejects.toBeInstanceOf(NotGroupMemberError)
  })

  it('should throw UnauthorizedError when requester is member but not payer or owner', async () => {
    // Create a third member who is not payer and not owner
    const thirdMember = group.addMember(owner, 'user-3')
    await memberRepository.addMemberToGroup(thirdMember)
    await groupRepository.update(group)

    const expense = makeExpense()
    await expenseRepository.create(expense)

    await expect(
      sut.execute({ expenseId: expense.id, requestUserId: thirdMember.userId, version: 0 }),
    ).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('should throw MemberNotInGroupError when a share refers to a non-member', async () => {
    const expense = makeExpense()
    await expenseRepository.create(expense)

    await expect(
      sut.execute({
        expenseId: expense.id,
        requestUserId: owner.userId,
        version: 0,
        shares: [
          { memberId: owner.id, amount: '30.00' },
          { memberId: 'outsider-id', amount: '30.00' },
        ],
      }),
    ).rejects.toBeInstanceOf(MemberNotInGroupError)
  })

  describe('categorization', () => {
    it('should set the category sent by the user and skip automatic categorization', async () => {
      const expense = makeExpense('Alimentação')
      await expenseRepository.create(expense)

      const { expense: updated, pendingCategorization } = await sut.execute({
        expenseId: expense.id,
        requestUserId: owner.userId,
        version: 0,
        description: 'Cinema com a turma',
        category: 'Lazer',
      })

      expect(updated.category).toBe('Lazer')
      expect(expenseRepository.items[0].category).toBe('Lazer')
      expect(pendingCategorization).toBe(false)
      expect(categorizer.quickCalls).toHaveLength(0)
    })

    it('should recategorize with rules or cache when only the description changes', async () => {
      const expense = makeExpense('Alimentação')
      await expenseRepository.create(expense)
      categorizer.quickResults.set('Cinema com a turma', 'Lazer')

      const { expense: updated, pendingCategorization } = await sut.execute({
        expenseId: expense.id,
        requestUserId: owner.userId,
        version: 0,
        description: 'Cinema com a turma',
      })

      expect(updated.category).toBe('Lazer')
      expect(pendingCategorization).toBe(false)
    })

    it('should clear a stale category and flag background categorization when rules and cache cannot decide', async () => {
      const expense = makeExpense('Alimentação')
      await expenseRepository.create(expense)

      const { expense: updated, pendingCategorization } = await sut.execute({
        expenseId: expense.id,
        requestUserId: owner.userId,
        version: 0,
        description: 'Rateio diverso',
      })

      expect(updated.category).toBeUndefined()
      expect(expenseRepository.items[0].category).toBeUndefined()
      expect(pendingCategorization).toBe(true)
      expect(categorizer.fullCalls).toHaveLength(0)
    })

    it('should keep the current category when the description does not change', async () => {
      const expense = makeExpense('Alimentação')
      await expenseRepository.create(expense)

      const { expense: updated, pendingCategorization } = await sut.execute({
        expenseId: expense.id,
        requestUserId: owner.userId,
        version: 0,
        description: '  Jantar  ',
        amount: '60.00',
      })

      expect(updated.category).toBe('Alimentação')
      expect(pendingCategorization).toBe(false)
      expect(categorizer.quickCalls).toHaveLength(0)
    })
  })

  describe('version lida pelo cliente (D-92)', () => {
    it('devolve a despesa com a versão que ficou gravada', async () => {
      const expense = makeExpense()
      await expenseRepository.create(expense)

      const { expense: updated } = await sut.execute({ expenseId: expense.id, requestUserId: owner.userId, version: 0, description: 'Novo' })

      expect(updated.version).toBe(1)
      expect((await expenseRepository.findById(expense.id))?.version).toBe(1)
    })

    it('recusa com 409 uma edição feita sobre uma versão que já não é a atual, sem gravar nem revisar', async () => {
      const expense = makeExpense()
      await expenseRepository.create(expense)
      await sut.execute({ expenseId: expense.id, requestUserId: owner.userId, version: 0, description: 'Primeira' })

      await expect(
        sut.execute({ expenseId: expense.id, requestUserId: owner.userId, version: 0, description: 'Tela velha' }),
      ).rejects.toBeInstanceOf(ExpenseConcurrentModificationError)

      expect((await expenseRepository.findById(expense.id))?.description).toBe('Primeira')
      expect(expenseRepository.revisions).toHaveLength(1)
      expect(settlementRepository.items).toHaveLength(0)
    })

    it('checa permissão antes da versão: quem não pode editar recebe 403, não 409', async () => {
      const expense = makeExpense()
      await expenseRepository.create(expense)

      await expect(
        sut.execute({ expenseId: expense.id, requestUserId: member2.userId, version: 99, description: 'Intrusa' }),
      ).rejects.toBeInstanceOf(UnauthorizedError)
    })
  })
})
