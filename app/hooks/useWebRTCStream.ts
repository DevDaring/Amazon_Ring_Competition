'use client'

// Adapted from AmazonAppDev/ring-api-helloworld (MIT, Copyright 2026 Amazon):
// same WHEP offer/answer flow, plus graceful reconnect when Ring ends the session
// (30 s on battery cameras, 60 s on line-powered ones) and a stop that always
// DELETEs the session on Ring's side.

import { RefObject, useCallback, useEffect, useRef, useState } from 'react'

interface Options {
  videoRef: RefObject<HTMLVideoElement>
  deviceId?: string
  keepWatching: boolean
}

export function useWebRTCStream({ videoRef, deviceId, keepWatching }: Options) {
  const [streamActive, setStreamActive] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [reconnects, setReconnects] = useState(0)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const sessionUrlRef = useRef<string | null>(null)
  const wantRef = useRef(false)
  const keepRef = useRef(keepWatching)
  keepRef.current = keepWatching

  const closeSession = useCallback(async () => {
    pcRef.current?.close()
    pcRef.current = null
    const url = sessionUrlRef.current
    sessionUrlRef.current = null
    if (url) {
      await fetch('/api/ring/stream', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionUrl: url }) }).catch(() => {})
    }
  }, [])

  const startStream = useCallback(async () => {
    if (!deviceId) return
    wantRef.current = true
    setStreamError(null)
    try {
      await closeSession()
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] })
      pcRef.current = pc
      pc.addTransceiver('audio', { direction: 'sendrecv' })
      pc.addTransceiver('video', { direction: 'recvonly' })
      pc.ontrack = (e) => {
        if (videoRef.current && e.streams[0]) {
          videoRef.current.srcObject = e.streams[0]
          setStreamActive(true)
          setStartedAt(Date.now())
        }
      }
      pc.onconnectionstatechange = () => {
        if (pc !== pcRef.current) return
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
          setStreamActive(false)
          // Ring ended the session (time limit) or the network blipped: reconnect if asked.
          if (wantRef.current && keepRef.current) {
            setReconnects((n) => n + 1)
            setTimeout(() => wantRef.current && startStream(), 1500)
          }
        }
      }
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve()
        const t = setTimeout(resolve, 3000)
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(t)
            resolve()
          }
        }
      })
      const res = await fetch('/api/ring/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdpOffer: pc.localDescription!.sdp, deviceId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not start the live view')
      sessionUrlRef.current = data.sessionUrl
      await pc.setRemoteDescription({ type: 'answer', sdp: data.sdpAnswer })
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : 'Live view failed')
      setStreamActive(false)
      wantRef.current = false
    }
  }, [deviceId, videoRef, closeSession])

  const stopStream = useCallback(async () => {
    wantRef.current = false
    await closeSession()
    if (videoRef.current) videoRef.current.srcObject = null
    setStreamActive(false)
    setStartedAt(null)
  }, [closeSession, videoRef])

  useEffect(() => () => {
    wantRef.current = false
    closeSession()
  }, [closeSession])

  return { streamActive, streamError, startStream, stopStream, startedAt, reconnects }
}
