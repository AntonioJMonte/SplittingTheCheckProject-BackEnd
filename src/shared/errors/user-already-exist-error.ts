import { DomainError } from "./domain-error";


export class UserAlreadyExistError extends DomainError {
    constructor () {
        super('Já existe uma conta com este email.')
    }

}