export const BONO_INICIAL = 500;

/** Tope de lo que los bots pueden soltar por encima de la entrada, en una sentada. */
export const TOPE_BOTS = 48;

/** Saldo corto: alcanzan para la casa y poco más, así no inflan la banca. */
export function botStack(casa: number): number {
  return casa + 3;
}
