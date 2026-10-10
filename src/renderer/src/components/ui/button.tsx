import * as React from 'react'

/**
 * Phase 0 stand-in for the shadcn/ui `button` component.
 *
 * The canonical registry version (https://ui.shadcn.com/r/styles/new-york/button.json)
 * depends on `@radix-ui/react-slot`, `class-variance-authority` and `@/lib/utils`
 * (clsx + tailwind-merge). Those packages are not in the Phase 0 pinned matrix and
 * `src/renderer/src/lib/utils.ts` is outside the authorized edit surface, so the
 * shadcn CLI could not be used for Phase 0.
 *
 * The class strings, the exported `buttonVariants` shape and the `data-slot`
 * attribute below are copied from the registry so that Fase 2 can replace this file
 * with `npx shadcn add button` without touching any call site.
 */

const BUTTON_BASE_CLASSES =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'

const VARIANT_CLASSES = {
  default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
  destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
  outline:
    'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
  secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  link: 'text-primary underline-offset-4 hover:underline'
} as const

const SIZE_CLASSES = {
  default: 'h-9 px-4 py-2',
  sm: 'h-8 rounded-md px-3 text-xs',
  lg: 'h-10 rounded-md px-8',
  icon: 'h-9 w-9'
} as const

export type ButtonVariant = keyof typeof VARIANT_CLASSES
export type ButtonSize = keyof typeof SIZE_CLASSES

/** Class-name resolver kept API-compatible with shadcn's `buttonVariants`. */
export function buttonVariants({
  variant = 'default',
  size = 'default'
}: { variant?: ButtonVariant; size?: ButtonSize } = {}): string {
  return [BUTTON_BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size]].join(' ')
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      data-slot="button"
      className={[buttonVariants({ variant, size }), className].filter(Boolean).join(' ')}
      {...props}
    />
  )
)
Button.displayName = 'Button'

export { Button }
