export type ClassValue = string | number | null | false | undefined | ClassValue[];

/** Joins class names, dropping falsy values and flattening nested arrays. */
export function cn(...inputs: ClassValue[]): string {
  const classes: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (Array.isArray(input)) {
      const nested = cn(...input);
      if (nested) classes.push(nested);
      continue;
    }
    classes.push(String(input));
  }
  return classes.join(' ');
}
