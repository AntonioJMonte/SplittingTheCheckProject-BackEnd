import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from '@fastify/type-provider-zod'
import { verifyJwt } from '../middlewares/verify-jwt'
import { categorizeRateLimit } from '../rate-limit'
import { updateExpense } from '../controllers/update-expense-controller'
import { deleteExpense } from '../controllers/delete-expense-controller'
import { categorizeExpense } from '../controllers/categorize-expense-controller'
import { getExpenseRevisions } from '../controllers/get-expense-revisions-controller'
import {
    updateExpenseRouteSchema,
    deleteExpenseRouteSchema,
    categorizeExpenseRouteSchema,
    getExpenseRevisionsRouteSchema,
} from '../schemas/expense.schema'

// Sem verifyMembership de propósito (D-31): o middleware resolve a associação por :groupId,
// que estas rotas não têm. O grupo só é conhecido depois de carregar a despesa, então a checagem
// vive no use case — UpdateExpense, DeleteExpense e CategorizeExpense lançam NotGroupMemberError (403).
export async function expenseRoutes(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>()

    app.addHook('preValidation', verifyJwt)

    app.patch('/expenses/:expenseId', { schema: updateExpenseRouteSchema }, updateExpense)
    app.delete('/expenses/:expenseId', { schema: deleteExpenseRouteSchema }, deleteExpense)
    app.get('/expenses/:expenseId/revisions', { schema: getExpenseRevisionsRouteSchema }, getExpenseRevisions)
    app.post('/expenses/:expenseId/categorize', { schema: categorizeExpenseRouteSchema, config: { rateLimit: categorizeRateLimit } }, categorizeExpense)
}
