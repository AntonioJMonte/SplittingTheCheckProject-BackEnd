import { GroupRepository } from '../../repositories/group-repository'
import { MemberRepository } from '../../repositories/member-repository'
import { SettlementRepository } from '../../repositories/settlement-repository'
import { Settlement, SettlementStatus } from '../../../domain/entities/settlement'
import { GroupNotFoundError } from '../../../shared/errors/group-not-found-error'
import { NotGroupMemberError } from '../../../shared/errors/not-group-member-error'

interface ListSettlementsUseCaseRequest {
    groupId: string
    requestUserId: string
    status?: SettlementStatus
}

interface ListSettlementsUseCaseResponse {
    settlements: Settlement[]
}

// D-89: sem esta leitura, o credor só descobria um acerto pelo evento do WebSocket — e quem
// estivesse offline nunca conseguia reconhecê-lo.
export class ListSettlementsUseCase {

    constructor(
        private groupRepository: GroupRepository,
        private memberRepository: MemberRepository,
        private settlementRepository: SettlementRepository,
    ) {}

    async execute({ groupId, requestUserId, status }: ListSettlementsUseCaseRequest): Promise<ListSettlementsUseCaseResponse> {
        const group = await this.groupRepository.findById(groupId)
        if (!group) {
            throw new GroupNotFoundError()
        }

        const requestingMember = await this.memberRepository.findByUserAndGroup(requestUserId, groupId)
        if (!requestingMember) {
            throw new NotGroupMemberError()
        }

        const settlements = await this.settlementRepository.findByGroup(groupId, status)
        return { settlements }
    }
}
