'use client'

import Link from 'next/link'
import { useApp } from './providers'
import { AnnouncementCard } from './components/AnnouncementCard'
import { PushToTalk } from './components/PushToTalk'
import { Badge, Card } from './components/ui'

export default function Home() {
  const { selectedDevice, deviceError, latest, settings } = useApp()
  const watching = selectedDevice ? selectedDevice.displayName : 'your door'
  return (
    <div className="space-y-6">
      <h1 className="text-hero font-bold">
        {selectedDevice ? `Watching ${watching}` : deviceError ? 'Ring is not connected' : 'Connecting to Ring…'}
      </h1>
      <div className="flex flex-wrap items-center gap-2" aria-label="Camera status">
        {selectedDevice && <Badge tone={selectedDevice.online ? 'ok' : 'bad'}>{selectedDevice.online ? 'Camera online' : 'Camera offline'}</Badge>}
        {selectedDevice?.e2ee && <Badge tone="warn">End-to-end encrypted: cannot be described</Badge>}
        {settings && <Badge>{settings.mode === 'voice' ? 'Speaking announcements' : 'Visual mode: flash, captions, vibration'}</Badge>}
      </div>
      {deviceError && !selectedDevice && (
        <Card role="note">
          <p className="text-lg">{deviceError}</p>
          <p className="mt-2">
            <Link href="/settings" className="font-semibold text-accent underline">
              Paste a Ring Developer Playground token in Settings
            </Link>{' '}
            or use the Demo panel.
          </p>
        </Card>
      )}

      <section aria-labelledby="last-title" className="space-y-3">
        <h2 id="last-title" className="text-2xl font-bold">
          Last announcement
        </h2>
        {latest ? <AnnouncementCard a={latest} big /> : <Card><p className="text-xl text-muted">Nothing yet. DoorVoice will speak when someone rings or moves at the door.</p></Card>}
      </section>

      <PushToTalk />
    </div>
  )
}
