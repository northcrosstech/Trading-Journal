/** Shared class strings for form controls, so every input in the app looks and behaves
 * the same. Components live in components/ui/. */
export const INPUT =
  'w-full rounded-lg border border-(--border-strong) bg-(--card-raised) px-3 py-2 text-sm text-neutral-100 outline-none transition placeholder:text-neutral-600 focus:border-(--accent) focus:ring-2 focus:ring-(--accent-soft) disabled:opacity-50'
export const INPUT_SM =
  'w-full rounded-md border border-(--border-strong) bg-(--card-raised) px-2.5 py-1.5 text-sm text-neutral-100 outline-none transition placeholder:text-neutral-600 focus:border-(--accent) focus:ring-2 focus:ring-(--accent-soft) disabled:opacity-50'
export const LABEL = 'text-xs font-medium text-neutral-400'

/** Text color for a signed money/percent value. */
export const toneClass = (n: number | null | undefined) =>
  n == null || n === 0 ? 'text-neutral-300' : n > 0 ? 'text-(--status-good)' : 'text-(--status-critical)'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-(--accent) text-white shadow-sm hover:brightness-110',
  secondary: 'border border-(--border-strong) bg-(--card-raised) text-neutral-200 hover:border-neutral-600 hover:text-white',
  ghost: 'text-neutral-400 hover:bg-(--card-raised) hover:text-neutral-100',
  danger: 'bg-red-600/90 text-white hover:bg-red-500',
}
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-md px-2.5 text-xs',
  md: 'h-9 gap-2 rounded-lg px-3.5 text-sm',
}

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md') {
  return `inline-flex shrink-0 items-center justify-center font-medium transition disabled:pointer-events-none disabled:opacity-40 ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]}`
}

