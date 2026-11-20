/** Woof pets have no deceased flag. A missing field is a living pet. */
export function isPetDeceased(pet: { deceased?: boolean | null } | null | undefined): boolean {
  return pet?.deceased === true;
}
