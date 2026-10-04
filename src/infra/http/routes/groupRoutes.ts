import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from '@fastify/type-provider-zod'
import { verifyJwt } from '../middlewares/verify-jwt'
import { verifyMembership } from '../middlewares/verify-membership'
import { createGroup } from '../controllers/create-group-controller'
import { listGroups } from '../controllers/list-groups-controller'
import { getGroup } from '../controllers/get-group-controller'
import { updateGroup } from '../controllers/update-group-controller'
import { deleteGroup } from '../controllers/delete-group-controller'
import { addMember } from '../controllers/add-member-controller'
import { removeMember } from '../controllers/remove-member-controller'
import { leaveGroup } from '../controllers/leave-group-controller'
import { listMembers } from '../controllers/list-member-controller'
import { updateMemberRole } from '../controllers/update-member-role-controller'
import { getGroupBalances } from '../controllers/get-group-balances-controller'
import { createExpense } from '../controllers/create-expense-controller'
import { listExpenses } from '../controllers/list-expenses-controller'
import { computeSettlements } from '../controllers/compute-settlements-controller'
import { confirmSettlement } from '../controllers/confirm-settlement-controller'
import { listSettlements } from '../controllers/list-settlements-controller'
import {
    createGroupRouteSchema,
    listGroupsRouteSchema,
    getGroupRouteSchema,
    updateGroupRouteSchema,
    deleteGroupRouteSchema,
    getGroupBalancesRouteSchema,
} from '../schemas/group.schema'
import {
    addMemberRouteSchema,
    removeMemberRouteSchema,
    leaveGroupRouteSchema,
    listMembersRouteSchema,
    updateMemberRoleRouteSchema,
} from '../schemas/member.schema'
import { createExpenseRouteSchema, listExpensesRouteSchema } from '../schemas/expense.schema'
import { computeSettlementsRouteSchema, confirmSettlementRouteSchema, listSettlementsRouteSchema } from '../schemas/settlement.schema'

export async function groupRoutes(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>()

    app.addHook('preValidation', verifyJwt)

    app.post('/groups', { schema: createGroupRouteSchema }, createGroup)
    app.get('/groups', { schema: listGroupsRouteSchema }, listGroups)

    app.get('/groups/:groupId', { schema: getGroupRouteSchema, preHandler: [verifyMembership] }, getGroup)
    app.patch('/groups/:groupId', { schema: updateGroupRouteSchema, preHandler: [verifyMembership] }, updateGroup)
    app.delete('/groups/:groupId', { schema: deleteGroupRouteSchema, preHandler: [verifyMembership] }, deleteGroup)

    app.post('/groups/:groupId/members', { schema: addMemberRouteSchema, preHandler: [verifyMembership] }, addMember)
    app.delete('/groups/:groupId/members/:memberId', { schema: removeMemberRouteSchema, preHandler: [verifyMembership] }, removeMember)
    app.delete('/groups/:groupId/leave', { schema: leaveGroupRouteSchema, preHandler: [verifyMembership] }, leaveGroup)
    app.get('/groups/:groupId/members', { schema: listMembersRouteSchema, preHandler: [verifyMembership] }, listMembers)
    app.patch('/groups/:groupId/members/:memberId/role', { schema: updateMemberRoleRouteSchema, preHandler: [verifyMembership] }, updateMemberRole)
    app.get('/groups/:groupId/balances', { schema: getGroupBalancesRouteSchema, preHandler: [verifyMembership] }, getGroupBalances)

    app.post('/groups/:groupId/expenses', { schema: createExpenseRouteSchema, preHandler: [verifyMembership] }, createExpense)
    app.get('/groups/:groupId/expenses', { schema: listExpensesRouteSchema, preHandler: [verifyMembership] }, listExpenses)

    app.get('/groups/:groupId/settlements/compute', { schema: computeSettlementsRouteSchema, preHandler: [verifyMembership] }, computeSettlements)
    app.post('/groups/:groupId/settlements', { schema: confirmSettlementRouteSchema, preHandler: [verifyMembership] }, confirmSettlement)
    app.get('/groups/:groupId/settlements', { schema: listSettlementsRouteSchema, preHandler: [verifyMembership] }, listSettlements)
}
