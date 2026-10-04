import { GetExpenseRevisionsUseCase } from '../../application/use-cases/expenses/get-expense-revisions-use-case'
import { PrismaExpenseRepository } from '../database/prisma/prismaExpenseRepository'
import { PrismaMemberRepository } from '../database/prisma/prismaMemberRepository'
import { PrismaUserRepository } from '../database/prisma/prismaUserRepository'

export function makeGetExpenseRevisionsUseCase() {
    const expenseRepository = new PrismaExpenseRepository()
    const memberRepository = new PrismaMemberRepository()
    const userRepository = new PrismaUserRepository()
    return new GetExpenseRevisionsUseCase(expenseRepository, memberRepository, userRepository)
}
