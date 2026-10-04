import { ExpenseRepository, ExpenseRevisionRecord } from '../../repositories/expense-repository'
import { MemberRepository } from '../../repositories/member-repository'
import { UserRepository } from '../../repositories/users-repository'
import { ExpenseNotFoundError } from '../../../shared/errors/expense-not-found-error'
import { NotGroupMemberError } from '../../../shared/errors/not-group-member-error'

interface GetExpenseRevisionsUseCaseRequest {
    expenseId: string
    requestUserId: string
}

export interface ExpenseRevisionWithEditor extends ExpenseRevisionRecord {
    editorName: string | null
}

interface GetExpenseRevisionsUseCaseResponse {
    revisions: ExpenseRevisionWithEditor[]
}

export class GetExpenseRevisionsUseCase {

    constructor(
        private expenseRepository: ExpenseRepository,
        private memberRepository: MemberRepository,
        private userRepository: UserRepository,
    ) {}

    async execute({ expenseId, requestUserId }: GetExpenseRevisionsUseCaseRequest): Promise<GetExpenseRevisionsUseCaseResponse> {
        const expense = await this.expenseRepository.findById(expenseId)
        if (!expense) {
            throw new ExpenseNotFoundError()
        }

        // D-31: sem :groupId na rota, a associação só é conhecida depois de carregar a despesa.
        const requestingMember = await this.memberRepository.findByUserAndGroup(requestUserId, expense.groupId)
        if (!requestingMember) {
            throw new NotGroupMemberError()
        }

        const revisions = await this.expenseRepository.findRevisions(expenseId)

        // D-93: o nome vem do usuário, não da lista de membros — quem editou pode já ter saído do
        // grupo, e a lista de membros só traz os ativos.
        const editorIds = [...new Set(revisions.map(r => r.editedByUserId))]
        const editors = await Promise.all(editorIds.map(id => this.userRepository.findById(id)))
        const nameById = new Map(editors.flatMap(user => (user ? [[user.id, user.name] as const] : [])))

        return {
            revisions: revisions.map(revision => ({
                ...revision,
                editorName: nameById.get(revision.editedByUserId) ?? null,
            })),
        }
    }
}
