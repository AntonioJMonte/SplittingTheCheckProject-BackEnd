import { describe, it, expect, beforeEach } from 'vitest'
import { GetExpenseRevisionsUseCase } from '../../../application/use-cases/expenses/get-expense-revisions-use-case'
import { InMemoryExpenseRepository } from '../../doubles/in-memory-expense-repository'
import { InMemoryMemberRepository } from '../../doubles/in-memory-member-repository'
import { InMemoryUserRepository } from '../../doubles/in-memory-user-repository'
import { Group } from '../../../domain/entities/group'
import { Member } from '../../../domain/entities/member'
import { Expense } from '../../../domain/entities/expense'
import { User } from '../../../domain/entities/user'
import { Money } from '../../../domain/value-objects/money'
import { ExpenseNotFoundError } from '../../../shared/errors/expense-not-found-error'
import { NotGroupMemberError } from '../../../shared/errors/not-group-member-error'

describe('GetExpenseRevisionsUseCase (D-93)', () => {
  let expenseRepository: InMemoryExpenseRepository
  let memberRepository: InMemoryMemberRepository
  let userRepository: InMemoryUserRepository
  let sut: GetExpenseRevisionsUseCase
  let ana: User
  let bruno: User
  let anaMember: Member
  let expense: Expense

  beforeEach(async () => {
    expenseRepository = new InMemoryExpenseRepository()
    memberRepository = new InMemoryMemberRepository()
    userRepository = new InMemoryUserRepository()
    sut = new GetExpenseRevisionsUseCase(expenseRepository, memberRepository, userRepository)

    ana = User.create({ name: 'Ana', email: 'ana@example.com', passwordHash: 'hash' })
    bruno = User.create({ name: 'Bruno', email: 'bruno@example.com', passwordHash: 'hash' })
    await userRepository.create(ana)
    await userRepository.create(bruno)

    const group = Group.create({ name: 'Casa', creatorUserId: ana.id })
    anaMember = group.members[0] as Member
    const brunoMember = group.addMember(anaMember, bruno.id)
    await memberRepository.addMemberToGroup(anaMember)
    await memberRepository.addMemberToGroup(brunoMember)

    expense = Expense.create({
      groupId: group.id, payerId: ana.id, description: 'Mercado', amount: new Money('50.00'),
      shareInputs: [{ memberId: anaMember.id, amount: new Money('50.00') }], splitMethod: 'FIXED',
    })
    await expenseRepository.create(expense)
  })

  async function edit(from: Expense, description: string, editorId: string) {
    const next = from.update({ description })
    await expenseRepository.updateWithRevision(next, from, editorId)
    return (await expenseRepository.findById(from.id))!
  }

  it('devolve as revisões da mais recente para a mais antiga, com o nome de quem editou', async () => {
    const afterFirst = await edit(expense, 'Mercado do mês', ana.id)
    await edit(afterFirst, 'Mercado do mês e feira', bruno.id)

    const { revisions } = await sut.execute({ expenseId: expense.id, requestUserId: ana.id })

    expect(revisions.map(r => [r.version, r.description, r.editorName])).toEqual([
      [1, 'Mercado do mês', 'Bruno'],
      [0, 'Mercado', 'Ana'],
    ])
    expect(revisions[1].amount.toString()).toBe('50.00')
  })

  it('resolve o nome pelo usuário, então quem saiu do grupo continua identificado', async () => {
    await edit(expense, 'Mercado do mês', ana.id)
    await memberRepository.removeMemberGroup(anaMember.id, ana.id)

    const { revisions } = await sut.execute({ expenseId: expense.id, requestUserId: bruno.id })

    expect(revisions[0].editorName).toBe('Ana')
  })

  it('devolve null no nome quando o editor não é encontrado', async () => {
    await edit(expense, 'Mercado do mês', 'usuario-apagado')

    const { revisions } = await sut.execute({ expenseId: expense.id, requestUserId: ana.id })

    expect(revisions[0].editorName).toBeNull()
  })

  it('recusa despesa inexistente ou excluída e quem não é do grupo', async () => {
    await expect(sut.execute({ expenseId: expense.id, requestUserId: 'estranho' })).rejects.toBeInstanceOf(NotGroupMemberError)

    await expenseRepository.softDelete(expense.id, ana.id)
    await expect(sut.execute({ expenseId: expense.id, requestUserId: ana.id })).rejects.toBeInstanceOf(ExpenseNotFoundError)
  })
})
