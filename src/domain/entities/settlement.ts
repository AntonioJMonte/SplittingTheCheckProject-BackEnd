import { randomUUID } from 'node:crypto'
import { DomainError } from '../../shared/errors/domain-error'
import { Money } from '../value-objects/money'

export type SettlementStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED'

export class Settlement {
    private _status: SettlementStatus
    private _confirmedAt?: Date

    constructor(
        public readonly id: string,
        public readonly groupId: string,
        public readonly fromMemberId: string,
        public readonly toMemberId: string,
        public readonly amount: Money,
        status: SettlementStatus = 'PENDING',
        confirmedAt?: Date,
        public readonly pixCopyPaste?: string,
        public readonly version: number = 0,
        // D-89: quando o devedor registrou o pagamento — é a data que o credor vê na lista.
        public readonly createdAt: Date = new Date(),
    ) {
        this._status = status
        this._confirmedAt = confirmedAt
    }

    get status(): SettlementStatus {
        return this._status
    }

    get confirmedAt(): Date | undefined {
        return this._confirmedAt
    }

    static create(props: {
        groupId: string
        fromMemberId: string
        toMemberId: string
        amount: Money
        pixCopyPaste?: string
    }) {
        return new Settlement(
            randomUUID(),
            props.groupId,
            props.fromMemberId,
            props.toMemberId,
            props.amount,
            'PENDING',
            undefined,
            props.pixCopyPaste,
        )
    }

    confirm(): void {
        if (this._status !== 'PENDING') {
            throw new DomainError('Apenas acertos pendentes podem ser confirmados')
        }
        this._status = 'CONFIRMED'
        this._confirmedAt = new Date()
    }

    cancel(): void {
        if (this._status !== 'PENDING') {
            throw new DomainError('Apenas acertos pendentes podem ser cancelados')
        }
        this._status = 'CANCELLED'
    }
}