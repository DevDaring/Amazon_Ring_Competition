import { spawn } from 'node:child_process'
import { config } from '../config'

/** Pipes a buffer through ffmpeg and returns stdout. Used for clip frames and audio resampling. */
export function runFfmpeg(args: string[], input?: Buffer, timeoutMs = 20_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config().FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true })
    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('ffmpeg timed out'))
    }, timeoutMs)
    proc.stdout.on('data', (d) => out.push(d))
    proc.stderr.on('data', (d) => err.push(d))
    proc.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`ffmpeg not available (${e.message}). Install ffmpeg or set FFMPEG_PATH.`))
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(Buffer.concat(out))
      else reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(err).toString().slice(0, 300)}`))
    })
    proc.stdin.on('error', () => {}) // ffmpeg may close stdin early once it has enough input
    if (input) proc.stdin.end(input)
    else proc.stdin.end()
  })
}

/** Browser audio (webm/ogg/mp4) -> 16 kHz mono signed 16-bit PCM, what Transcribe streaming expects. */
export function toPcm16k(audio: Buffer) {
  return runFfmpeg(['-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], audio)
}

export function toWav16k(audio: Buffer) {
  return runFfmpeg(['-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1'], audio)
}

/** Pulls evenly spaced JPEG frames out of an MP4 clip (Ring media/video/download). */
export async function clipToFrames(mp4: Buffer, fps = 1, max = 6): Promise<Buffer[]> {
  const mjpeg = await runFfmpeg(
    ['-i', 'pipe:0', '-vf', `fps=${fps}`, '-frames:v', String(max), '-q:v', '3', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'],
    mp4,
    30_000
  )
  // Split the MJPEG stream on JPEG start/end markers.
  const frames: Buffer[] = []
  let start = -1
  for (let i = 0; i < mjpeg.length - 1; i++) {
    if (mjpeg[i] === 0xff && mjpeg[i + 1] === 0xd8 && start < 0) start = i
    if (mjpeg[i] === 0xff && mjpeg[i + 1] === 0xd9 && start >= 0) {
      frames.push(mjpeg.subarray(start, i + 2))
      start = -1
    }
  }
  return frames
}
