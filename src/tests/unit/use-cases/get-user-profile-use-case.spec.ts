import { describe, it, expect, beforeEach } from 'vitest'
import { GetUserProfileUseCase } from '../../../application/use-cases/users/get-user-profile-use-case'
import { InMemoryUserRepository } from '../../doubles/in-memory-user-repository'
import { User } from '../../../domain/entities/user'
import { AppError } from '../../../shared/errors/app-error'

describe('GetUserProfileUseCase (D-88)', () => {
  let userRepository: InMemoryUserRepository
  let sut: GetUserProfileUseCase

  beforeEach(() => {
    userRepository = new InMemoryUserRepository()
    sut = new GetUserProfileUseCase(userRepository)
  })

  it('devolve o usuário do token', async () => {
    const user = User.create({ name: 'Ana', email: 'ana@example.com', passwordHash: 'hash', phone: '11987654321' })
    await userRepository.create(user)

    const { user: found } = await sut.execute({ userId: user.id })

    expect(found.id).toBe(user.id)
    expect(found.phone?.value).toBe('+5511987654321')
  })

  it('responde 404 quando o usuário do token não existe mais', async () => {
    const error = await sut.execute({ userId: 'inexistente' }).catch(e => e)

    expect(error).toBeInstanceOf(AppError)
    expect(error.statusCode).toBe(404)
  })
})
