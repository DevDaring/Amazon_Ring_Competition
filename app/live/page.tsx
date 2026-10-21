'use client'

import { useEffect, useRef, useState } from 'react'
import '@/lib/video-processors'
import { processorRegistry } from '@/lib/video-processors/registry'
import { useVideoProcessing } from '@/lib/video-processors/useVideoProcessing'
import { useApp } from '../providers'
import { useWebRTCStream } from '../hooks/useWebRTCStream'
import { PushToTalk } from '../components/PushToTalk'
import { Badge, Button, Card, PageTitle, Switch, inputClass } from '../components/ui'

export default function LivePage() {
  const { devices, selectedDevice, settings, updateSettings, latest, deviceError } = useApp()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [keepWatching, setKeepWatching] = useState(true)
  const [narrator, setNarrator] = useState(false)
  const [boxes, setBoxes] = useState<Array<{ left: number; top: number; width: number; height: number; label: string }>>([])
  const [now, setNow] = useState(Date.now())
  const { streamActive, streamError, startStream, stopStream, startedAt, reconnects } = useWebRTCStream({ videoRef, deviceId: selectedDevice?.id, keepWatching })
  const { results } = useVideoProcessing({ video: videoRef.current, canvas: canvasRef.current, enabled: streamActive && narrator, fps: 4 })
  const limit = selectedDevice?.power === 'battery' ? 30 : 60

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Hand frames to the server every 2 s so events and questions can use the live picture.
  useEffect(() => {
    if (!streamActive || !selectedDevice) return
    const c = document.createElement('canvas')
    const t = setInterval(() => {
      const v = videoRef.current
      if (!v || v.readyState < 2) return
      c.width = v.videoWidth
      c.height = v.videoHeight
      c.getContext('2d')!.drawImage(v, 0, 0)
      c.toBlob(
        (blob) => {
          if (!blob) return
          const f = new FormData()
          f.append('deviceId', selectedDevice.id)
          f.append('frame', blob, 'frame.jpg')
          fetch('/api/frames', { method: 'POST', body: f }).catch(() => {})
        },
        'image/jpeg',
        0.85
      )
    }, 2000)
    return () => clearInterval(t)
  }, [streamActive, selectedDevice])

  useEffect(() => {
    const p = processorRegistry.get('accessible-narrator')
    if (p && p.enabled !== narrator) processorRegistry.setEnabled('accessible-narrator', narrator)
  }, [narrator])

  // Bounding boxes from the latest event (off by default; on for low-vision users).
  useEffect(() => {
    if (!settings?.showBoxes || !latest || latest.source !== 'event') return setBoxes([])
    fetch(`/api/events/${latest.id.replace(/-early$/, '')}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBoxes((d?.stage1?.detections ?? []).filter((x: any) => x.box).map((x: any) => ({ ...x.box, label: x.category }))))
      .catch(() => setBoxes([]))
  }, [settings?.showBoxes, latest])

  // Draw overlays: event boxes + local narrator regions.
  useEffect(() => {
    const c = canvasRef.current
    const v = videoRef.current
    if (!c || !v) return
    c.width = c.clientWidth
    c.height = c.clientHeight
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.lineWidth = 4
    ctx.font = 'bold 18px system-ui'
    for (const b of boxes) {
      ctx.strokeStyle = '#ffb86b'
      ctx.strokeRect(b.left * c.width, b.top * c.height, b.width * c.width, b.height * c.height)
      ctx.fillStyle = '#ffb86b'
      ctx.fillText(b.label, b.left * c.width + 4, b.top * c.height + 20)
    }
    const r = results.get('accessible-narrator')
    if (r?.boundingBoxes && v.videoWidth) {
      const sx = c.width / v.videoWidth
      const sy = c.height / v.videoHeight
      for (const b of r.boundingBoxes) {
        ctx.strokeStyle = '#7cb8ff'
        ctx.strokeRect(b.x * sx, b.y * sy, b.width * sx, b.height * sy)
      }
    }
  }, [boxes, results, now])

  const elapsed = startedAt ? Math.floor((now - startedAt) / 1000) : 0
  const narratorMsg = results.get('accessible-narrator')?.message

  return (
    <div className="space-y-6">
      <PageTitle sub="The Ring sandbox camera, streamed over WebRTC (WHEP). Spoken descriptions appear as captions.">Live view</PageTitle>

      {devices.length > 1 && (
        <div className="max-w-md">
          <label htmlFor="cam" className="font-semibold">
            Camera
          </label>
          <select id="cam" className={inputClass} value={selectedDevice?.id ?? ''} onChange={(e) => updateSettings({ selectedDeviceId: e.target.value })}>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.displayName}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="relative aspect-video w-full overflow-hidden rounded-xl2 border-2 border-line bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" aria-label={`Live video from ${selectedDevice?.displayName ?? 'the camera'}`} />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
        {latest && (
          <p aria-hidden="true" className="absolute inset-x-0 bottom-0 bg-black/80 px-4 py-3 text-center text-xl font-semibold text-white sm:text-2xl">
            {latest.text}
          </p>
        )}
        {!streamActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-white">
            <Button variant="primary" size="lg" onClick={startStream} disabled={!selectedDevice}>
              {selectedDevice ? 'Start live view' : 'No camera yet'}
            </Button>
            {(streamError || (!selectedDevice && deviceError)) && <p role="alert" className="max-w-lg text-lg">{streamError ?? deviceError}</p>}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {streamActive && (
          <Button variant="danger" onClick={stopStream}>
            Stop live view
          </Button>
        )}
        {streamActive && <Badge tone="ok">Live · {elapsed}s of Ring’s {limit}s session limit</Badge>}
        {reconnects > 0 && <Badge>Reconnected {reconnects}×</Badge>}
        {selectedDevice && <Badge>{selectedDevice.power === 'battery' ? 'Battery camera: 30 s sessions' : 'Wired camera: 60 s sessions'}</Badge>}
      </div>

      <Card className="space-y-1">
        <h2 className="text-xl font-bold">View options</h2>
        <Switch id="keep" label="Keep watching" description="Reconnect automatically when Ring ends the session." checked={keepWatching} onCheckedChange={setKeepWatching} />
        <Switch id="boxes" label="Show boxes" description="Outline what the last event detected. Off by default; useful for low vision." checked={Boolean(settings?.showBoxes)} onCheckedChange={(v) => updateSettings({ showBoxes: v })} />
        <Switch id="narrator" label="Local narrator (no cloud)" description="Speaks where movement is, computed in this browser only. The open-source plugin from our Ring sample PR." checked={narrator} onCheckedChange={setNarrator} />
        {narrator && narratorMsg && <p className="text-base text-muted">Narrator: {narratorMsg}</p>}
      </Card>

      <PushToTalk />
    </div>
  )
}
