import { recentAnnouncements, subscribe } from '@/lib/server/bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Server-sent events: stage progress, announcements, metric refresh hints. */
export async function GET() {
  const enc = new TextEncoder()
  let unsubscribe: () => void = () => {}
  let ping: ReturnType<typeof setInterval>
  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => controller.enqueue(enc.encode(s))
      send(': connected\n\n')
      // Replay the latest announcement so a freshly opened tab shows it at once.
      const last = recentAnnouncements()[0]
      if (last) send(`data: ${JSON.stringify({ kind: 'announcement', announcement: last, replay: true })}\n\n`)
      unsubscribe = subscribe({ send })
      ping = setInterval(() => {
        try {
          send(': ping\n\n')
        } catch {
          clearInterval(ping)
        }
      }, 25_000)
    },
    cancel() {
      unsubscribe()
      clearInterval(ping)
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  })
}
