// Runs once when the Next.js server starts. The Node-only work lives in
// instrumentation-node.ts so the edge compile never sees node:fs.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node')
  }
}
