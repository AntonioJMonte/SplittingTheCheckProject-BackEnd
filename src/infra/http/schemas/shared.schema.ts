import z from 'zod'

export const errorBody = z.object({
    message: z.string(),
})

// D-90: `issues` vem em todo erro de validação, com o caminho pontuado do campo ("shares.0.amount").
// Fica opcional porque o mesmo 400 cobre regra de domínio, que não tem campo.
export const validationErrorBody = z.object({
    message: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
})

// Respostas de erro reaproveitadas por todas as rotas. O .describe() vira a `description` da
// resposta no OpenAPI — sem ele o Swagger UI mostra "Default Response" em cada status.
export const badRequest = validationErrorBody.describe('Corpo, parâmetro de rota ou filtro inválido')
export const unauthorized = errorBody.describe('Token de acesso ausente, inválido ou expirado')
export const forbidden = errorBody.describe('Autenticado, mas sem permissão sobre este recurso')
export const notFound = errorBody.describe('Recurso não encontrado')
export const conflict = errorBody.describe('Conflito com o estado atual do recurso')
export const unprocessableEntity = errorBody.describe('Regra de negócio violada')

// D-98: dinheiro chega como string decimal ("1234.50"), que o front envia sem converter para float, ou como number,
// para quem já usa a API. A string recusa vírgula e mais de 2 casas para não haver arredondamento silencioso.
// D-105: e no máximo 8 dígitos inteiros, o que cabe nas colunas Decimal(10, 2); acima disso o Postgres responderia 500.
export const moneyInput = z.union([
    z.number().positive(),
    z.string()
        .regex(/^\d+(\.\d{1,2})?$/, 'Use ponto e no máximo 2 casas decimais, como "1234.50"')
        .refine(value => value.split('.')[0].length <= 8, 'Use no máximo 8 dígitos antes do ponto (até 99999999.99)')
        .refine(value => !/^0+(\.0+)?$/.test(value), 'O valor precisa ser maior que zero'),
])
