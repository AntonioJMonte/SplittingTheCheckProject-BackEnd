import { ZodError } from 'zod'

// D-90: um formato só para os dois caminhos de erro de validação — o schema da rota, que o
// Fastify valida antes do controller, e um ZodError lançado depois dele.
export const VALIDATION_ERROR_MESSAGE = 'Dados inválidos.'

export interface ValidationIssue {
    path: string
    message: string
}

interface SchemaValidationItem {
    instancePath?: string
    message?: string
}

export function isSchemaValidationError(error: unknown): error is Error & { validation: SchemaValidationItem[] } {
    return error instanceof Error && Array.isArray((error as { validation?: unknown }).validation)
}

// O type-provider-zod entrega o caminho como JSON Pointer ("/shares/0/amount"); o frontend
// casa campo de formulário pela forma pontuada ("shares.0.amount").
export function issuesFromSchemaValidation(items: SchemaValidationItem[]): ValidationIssue[] {
    return items.map(item => ({
        path: (item.instancePath ?? '').split('/').filter(Boolean).join('.'),
        message: item.message ?? '',
    }))
}

export function issuesFromZodError(error: ZodError): ValidationIssue[] {
    return error.issues.map(issue => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
    }))
}
