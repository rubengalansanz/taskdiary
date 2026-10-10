import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merges class names, resolving Tailwind conflicts.
 *
 * `clsx` handles conditional composition; `tailwind-merge` makes the *last* utility win
 * when two classes set the same CSS property, so a component's default padding can be
 * overridden by a caller's `p-8` instead of both landing in the class list and letting
 * stylesheet order decide.
 *
 * @param inputs Any number of class values: strings, arrays, or conditional objects.
 * @returns A single class string.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
