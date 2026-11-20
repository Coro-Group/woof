/**
 * Woof pets have no deceased flag. A missing field is a living pet.
 *
 * The parameter is deliberately `unknown`: Woof's pet types carry no `deceased`
 * property at all, so a narrower shape makes every call site a TS2559
 * ("no properties in common") error. Ported Petzania components keep calling this.
 */
export function isPetDeceased(pet: unknown): boolean {
  return (pet as { deceased?: boolean | null } | null | undefined)?.deceased === true;
}
