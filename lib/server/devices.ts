import { RingDevice, listDevices } from '../ring/client'

// Device metadata (name, E2EE flag, privacy zones) changes rarely; cache it for five
// minutes so every event does not cost an extra Ring call.

let cache: { at: number; devices: RingDevice[] } | null = null

export async function getDevices(force = false): Promise<RingDevice[]> {
  if (!force && cache && Date.now() - cache.at < 5 * 60_000) return cache.devices
  const devices = await listDevices()
  cache = { at: Date.now(), devices }
  return devices
}

export async function getDevice(id: string | null | undefined): Promise<RingDevice | null> {
  if (!id) return null
  try {
    return (await getDevices()).find((d) => d.id === id) ?? null
  } catch {
    return cache?.devices.find((d) => d.id === id) ?? null
  }
}

export function cachedDevices() {
  return cache?.devices ?? []
}

export function clearDeviceCache() {
  cache = null
}
