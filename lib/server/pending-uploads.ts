// A simulated webhook is a byte-exact Ring payload, so it has no field for a demo
// image. The Demo panel parks the uploaded file name here, keyed by request_id.
const g = globalThis as unknown as { __doorvoiceUploads?: Map<string, string> }
const uploads = (g.__doorvoiceUploads ??= new Map())

export function attachUpload(requestId: string, fileName: string) {
  uploads.set(requestId, fileName)
  setTimeout(() => uploads.delete(requestId), 120_000).unref?.()
}

export function takeUpload(requestId: string) {
  const name = uploads.get(requestId) ?? null
  uploads.delete(requestId)
  return name
}
