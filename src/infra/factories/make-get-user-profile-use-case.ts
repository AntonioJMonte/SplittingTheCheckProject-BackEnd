import { GetUserProfileUseCase } from '../../application/use-cases/users/get-user-profile-use-case'
import { PrismaUserRepository } from '../database/prisma/prismaUserRepository'

export function makeGetUserProfileUseCase() {
    const userRepository = new PrismaUserRepository()
    return new GetUserProfileUseCase(userRepository)
}
