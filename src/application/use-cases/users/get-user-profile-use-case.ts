import { UserRepository } from '../../repositories/users-repository'
import { User } from '../../../domain/entities/user'
import { AppError } from '../../../shared/errors/app-error'

interface GetUserProfileUseCaseRequest {
    userId: string
}

interface GetUserProfileUseCaseResponse {
    user: User
}

export class GetUserProfileUseCase {

    constructor(private userRepository: UserRepository) {}

    async execute({ userId }: GetUserProfileUseCaseRequest): Promise<GetUserProfileUseCaseResponse> {
        const user = await this.userRepository.findById(userId)
        if (!user) {
            throw new AppError('Usuário não encontrado', 404)
        }
        return { user }
    }
}
