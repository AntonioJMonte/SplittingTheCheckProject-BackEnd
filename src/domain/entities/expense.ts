import { randomUUID } from 'node:crypto'
import { DomainError } from '../../shared/errors/domain-error'
import { Money } from '../value-objects/money'
import { SplitMethodType } from '../value-objects/split-method'
import { ExpenseCategory } from '../value-objects/expense-category'
import { ExpenseShare } from './expense-share'

interface ShareInput {
    memberId: string
    amount: Money
}

export class Expense {
    constructor(
        public readonly id: string,
        public readonly groupId: string,
        public readonly payerId: string,
        public readonly description: string,
        public readonly amount: Money,
        public readonly shares: ReadonlyArray<ExpenseShare>,
        public readonly splitMethod: SplitMethodType,
        public readonly occurredAt: Date,
        public readonly category?: ExpenseCategory,
        // D-82: lock otimista. Quem edita declara a versão que leu; o repositório só grava se
        // ela ainda for a atual.
        public readonly version: number = 0,
    ) {}

    static create(props: {
        groupId: string
        payerId: string
        description: string
        amount: Money
        shareInputs: ShareInput[]
        splitMethod: SplitMethodType
        occurredAt?: Date
        category?: ExpenseCategory
    }) {
        if (!props.description.trim()) {
            throw new DomainError('A descrição da despesa não pode ser vazia')
        }

        if (props.shareInputs.length === 0) {
            throw new DomainError('A despesa deve ter ao menos uma parte')
        }

        const id = randomUUID()
        const shares = props.shareInputs.map(s =>
            ExpenseShare.create({ expenseId: id, memberId: s.memberId, amount: s.amount }),
        )

        const sharesTotal = shares.reduce((acc, s) => acc.add(s.amount), new Money(0))
        if (!sharesTotal.equals(props.amount)) {
            throw new DomainError('A soma das partes não corresponde ao valor total da despesa')
        }

        return new Expense(
            id,
            props.groupId,
            props.payerId,
            props.description.trim(),
            props.amount,
            shares,
            props.splitMethod,
            props.occurredAt ?? new Date(),
            props.category,
        )
    }

    update(props: {
        description?: string
        amount?: Money
        shareInputs?: Array<{ memberId: string; amount: Money }>
        splitMethod?: SplitMethodType
    }): Expense {
        const newDescription = props.description !== undefined
            ? props.description.trim()
            : this.description

        if (props.description !== undefined && !newDescription) {
            throw new DomainError('A descrição da despesa não pode ser vazia')
        }

        const newAmount = props.amount ?? this.amount
        const newSplitMethod = props.splitMethod ?? this.splitMethod

        let newShares: ReadonlyArray<ExpenseShare>
        if (props.shareInputs !== undefined) {
            if (props.shareInputs.length === 0) {
                throw new DomainError('A despesa deve ter ao menos uma parte')
            }
            const shares = props.shareInputs.map(s =>
                ExpenseShare.create({ expenseId: this.id, memberId: s.memberId, amount: s.amount }),
            )
            const sharesTotal = shares.reduce((acc, s) => acc.add(s.amount), new Money(0))
            if (!sharesTotal.equals(newAmount)) {
                throw new DomainError('A soma das partes não corresponde ao valor total da despesa')
            }
            newShares = shares
        } else {
            newShares = this.shares
        }

        return new Expense(
            this.id,
            this.groupId,
            this.payerId,
            newDescription,
            newAmount,
            newShares as ExpenseShare[],
            newSplitMethod,
            this.occurredAt,
            this.category,
            this.version,
        )
    }

    // D-92: o repositório incrementa a versão ao gravar; isto devolve a despesa como ficou salva,
    // para o cliente mandar a versão nova na próxima edição.
    withVersion(version: number): Expense {
        return new Expense(
            this.id,
            this.groupId,
            this.payerId,
            this.description,
            this.amount,
            this.shares,
            this.splitMethod,
            this.occurredAt,
            this.category,
            version,
        )
    }

    withCategory(category: ExpenseCategory | undefined): Expense {
        return new Expense(
            this.id,
            this.groupId,
            this.payerId,
            this.description,
            this.amount,
            this.shares,
            this.splitMethod,
            this.occurredAt,
            category,
            this.version,
        )
    }
}