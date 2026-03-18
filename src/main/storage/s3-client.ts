import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'

let s3Client: S3Client | null = null

function getS3(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_VALUE || process.env.AWS_SECRET_ACCESS_KEY || ''
      }
    })
    console.log('[S3] Client initialized')
  }
  return s3Client
}

function getBucket(): string {
  return process.env.S3_BUCKET || 'meetsense-sessions'
}

export async function uploadFile(key: string, body: Buffer, contentType = 'application/octet-stream'): Promise<string> {
  const client = getS3()
  const bucket = getBucket()

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType
  }))

  console.log(`[S3] Uploaded: s3://${bucket}/${key} (${(body.length / 1024).toFixed(1)} KB)`)
  return key
}

export async function uploadSessionAudio(sessionId: string, audioBuffer: Buffer): Promise<string> {
  const key = `audio/${sessionId}.webm`
  return uploadFile(key, audioBuffer, 'audio/webm')
}

export async function uploadSessionTranscript(sessionId: string, transcript: object): Promise<string> {
  const key = `transcripts/${sessionId}-diarized.json`
  const body = Buffer.from(JSON.stringify(transcript, null, 2))
  return uploadFile(key, body, 'application/json')
}

export async function uploadSessionSummary(sessionId: string, summary: string): Promise<string> {
  const key = `summaries/${sessionId}-final.md`
  return uploadFile(key, Buffer.from(summary), 'text/markdown')
}

export async function uploadFinetuneData(batchName: string, jsonlData: string): Promise<string> {
  const key = `finetune/${batchName}.jsonl`
  return uploadFile(key, Buffer.from(jsonlData), 'application/jsonl')
}

export async function uploadSessionFrame(sessionId: string, frameIndex: number, jpegBuffer: Buffer): Promise<string> {
  const key = `frames/${sessionId}/frame-${String(frameIndex).padStart(5, '0')}.jpg`
  return uploadFile(key, jpegBuffer, 'image/jpeg')
}

export async function downloadFile(key: string): Promise<Buffer> {
  const client = getS3()
  const result = await client.send(new GetObjectCommand({
    Bucket: getBucket(),
    Key: key
  }))

  const chunks: Uint8Array[] = []
  if (result.Body) {
    // @ts-ignore - Body is a ReadableStream in Node
    for await (const chunk of result.Body) {
      chunks.push(chunk)
    }
  }
  return Buffer.concat(chunks)
}
