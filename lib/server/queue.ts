import PQueue from 'p-queue'

// The webhook handler only enqueues; Ring needs its 200 within 5 seconds and a
// vision call can take longer. Two jobs at a time keeps Bedrock under its rate limits.
const g = globalThis as unknown as { __doorvoiceQueue?: PQueue }
export const queue = (g.__doorvoiceQueue ??= new PQueue({ concurrency: 2, timeout: 60_000 }))

export function enqueue(name: string, job: () => Promise<unknown>) {
  queue.add(async () => {
    try {
      await job()
    } catch (err) {
      console.error(`[queue] ${name} failed:`, err)
    }
  })
}
