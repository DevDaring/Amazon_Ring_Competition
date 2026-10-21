'use client'

// shadcn/ui-style primitives, trimmed to what DoorVoice needs. Large hit targets
// (min 48px), visible focus, and no colour-only meaning.

import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px] px-5',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-ink hover:brightness-110',
        secondary: 'bg-raised text-ink border-2 border-line hover:border-ink',
        ghost: 'text-ink hover:bg-raised',
        danger: 'bg-bad text-bad-ink hover:brightness-110',
      },
      size: { md: 'text-lg', lg: 'text-xl min-h-[64px] px-8', sm: 'text-base min-h-[44px] px-4' },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  }
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button'
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
})
Button.displayName = 'Button'

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl2 border-2 border-line bg-surface p-5 sm:p-6', className)} {...props} />
}

export function Badge({ tone = 'neutral', className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'accent' }) {
  const tones = {
    neutral: 'border-line text-muted',
    ok: 'border-ok text-ok',
    warn: 'border-warn text-warn',
    bad: 'border-bad text-bad',
    accent: 'border-accent text-accent',
  }
  return <span className={cn('inline-flex items-center gap-1 rounded-full border-2 px-3 py-0.5 text-sm font-semibold', tones[tone], className)} {...props} />
}

export function Switch({ label, description, checked, onCheckedChange, id }: { label: string; description?: string; checked: boolean; onCheckedChange: (v: boolean) => void; id: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <label htmlFor={id} className="flex-1 cursor-pointer">
        <span className="block font-semibold">{label}</span>
        {description && <span className="block text-base text-muted">{description}</span>}
      </label>
      <SwitchPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="relative h-9 w-16 shrink-0 rounded-full border-2 border-line bg-raised data-[state=checked]:border-accent data-[state=checked]:bg-accent"
      >
        <SwitchPrimitive.Thumb className="block h-7 w-7 translate-x-0.5 rounded-full bg-ink transition-transform data-[state=checked]:translate-x-[1.85rem] data-[state=checked]:bg-accent-ink" />
      </SwitchPrimitive.Root>
    </div>
  )
}

export function Field({ label, hint, children, id }: { label: string; hint?: string; children: React.ReactNode; id: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {hint && (
        <span id={`${id}-hint`} className="text-base text-muted">
          {hint}
        </span>
      )}
      {children}
    </div>
  )
}

export const inputClass = 'min-h-[48px] w-full rounded-xl border-2 border-line bg-surface px-4 text-lg text-ink placeholder:text-muted focus:border-accent'

export function PageTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-3xl font-bold sm:text-4xl">{children}</h1>
      {sub && <p className="mt-2 text-lg text-muted">{sub}</p>}
    </header>
  )
}

export function SimulatedBadge() {
  return <Badge tone="warn">Simulated</Badge>
}
