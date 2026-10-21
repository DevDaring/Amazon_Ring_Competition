import './globals.css'
import type { Metadata, Viewport } from 'next'
import { config } from '@/lib/config'
import { AppProvider } from './providers'
import { AppShell } from './components/AppShell'

export const metadata: Metadata = {
  title: 'DoorVoice',
  description: 'A spoken, safety-checked guide to what is at your Ring door.',
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export const dynamic = 'force-dynamic'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const demoMode = config().DEMO_MODE
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AppProvider>
          <AppShell demoMode={demoMode}>{children}</AppShell>
        </AppProvider>
      </body>
    </html>
  )
}
