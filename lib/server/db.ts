import { PrismaClient } from '@prisma/client'

// One client per process; Next.js dev reloads modules, so park it on globalThis.
const g = globalThis as unknown as { __doorvoicePrisma?: PrismaClient }
export const db = g.__doorvoicePrisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') g.__doorvoicePrisma = db
