import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { buttonClass, type ButtonSize as Size, type ButtonVariant as Variant } from '../../lib/ui'

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...props}>
      {icon}
      {children}
    </button>
  )
}

export function ButtonLink({
  to,
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className = '',
}: {
  to: string
  variant?: Variant
  size?: Size
  icon?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Link to={to} className={`${buttonClass(variant, size)} ${className}`}>
      {icon}
      {children}
    </Link>
  )
}
