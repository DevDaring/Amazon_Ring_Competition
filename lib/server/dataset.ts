import fs from 'node:fs'
import path from 'node:path'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { config, hasAws } from '../config'
import { db } from './db'
import { DIRS, ensureDirs, readFile } from './storage'

// The "training flywheel" from Ring's CV guide: every Correct / Wrong tap becomes a
// labelled example (crop + model output + user label, tagged source: user_feedback).
// A nightly job writes them to data/dataset/<label>/ and, if S3_BUCKET is set, to S3.

export async function exportDataset(): Promise<{ exported: number; total: number; s3: boolean; errors: string[] }> {
  ensureDirs()
  const pending = await db.correction.findMany({ where: { exported: false }, include: { event: true } })
  const errors: string[] = []
  const bucket = config().S3_BUCKET
  const s3 = bucket && hasAws() ? new S3Client({ region: config().AWS_REGION, credentials: { accessKeyId: config().AWS_ACCESS_KEY_ID, secretAccessKey: config().AWS_SECRET_ACCESS_KEY } }) : null
  let exported = 0
  for (const c of pending) {
    const label = (c.verdict === 'wrong' ? `wrong_${c.objectType ?? 'unknown'}` : `${c.verdict}_${c.objectType ?? 'unknown'}`).replace(/[^a-z0-9_]/gi, '_')
    const dir = path.join(DIRS.dataset, label)
    fs.mkdirSync(dir, { recursive: true })
    const crop = c.cropPath ? readFile('corrections', c.cropPath) : null
    const meta = {
      id: c.id,
      label,
      verdict: c.verdict,
      user_label: c.userLabel,
      object_type: c.objectType,
      camera: c.cameraName,
      model_output: c.modelOutput ? JSON.parse(c.modelOutput) : null,
      narration: c.event.narration,
      simulated: c.event.simulated,
      source: c.source,
      created_at: c.createdAt.toISOString(),
    }
    fs.writeFileSync(path.join(dir, `${c.id}.json`), JSON.stringify(meta, null, 2))
    if (crop) fs.writeFileSync(path.join(dir, `${c.id}.jpg`), crop)
    fs.appendFileSync(path.join(DIRS.dataset, 'manifest.jsonl'), JSON.stringify({ ...meta, image: crop ? `${label}/${c.id}.jpg` : null }) + '\n')
    if (s3) {
      try {
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `doorvoice/${label}/${c.id}.json`, Body: JSON.stringify(meta), ContentType: 'application/json' }))
        if (crop) await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `doorvoice/${label}/${c.id}.jpg`, Body: crop, ContentType: 'image/jpeg' }))
      } catch (e) {
        errors.push(`S3: ${(e as Error).message.slice(0, 120)}`)
      }
    }
    await db.correction.update({ where: { id: c.id }, data: { exported: true } })
    exported++
  }
  return { exported, total: await datasetSize(), s3: Boolean(s3), errors }
}

export async function datasetSize() {
  return db.correction.count()
}
