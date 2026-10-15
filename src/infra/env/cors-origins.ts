/**
 * A origem exatamente como o navegador manda no header Origin: esquema, host em minúsculas e porta só quando não
 * é a padrão. Barra final, caminho ou espaço nunca casariam, e o CORS falharia sem aviso. Lista exata, sem curinga:
 * o URL aceita `*` no host, mas o @fastify/cors compararia esse texto literalmente.
 */
export function isExactOrigin(item: string): boolean {
    try {
        return !item.includes('*') && new URL(item).origin === item
    } catch {
        return false
    }
}
