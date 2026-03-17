import fs from 'fs'
import crypto from 'crypto'

export async function processPostMeeting(audioPath: string, apiKey: string, summaryEngine: any) {
  try {
    console.log('[PostMeeting] Starting post-meeting processing for:', audioPath)
    
    // 1. Send WebM to gpt-4o-transcribe-diarize
    const audioBuffer = fs.readFileSync(audioPath)
    console.log(`[PostMeeting] Audio file size: ${audioBuffer.length} bytes (${(audioBuffer.length / 1024).toFixed(1)} KB)`)
    
    // Build multipart form data manually
    const boundary = '----FormBoundary' + crypto.randomUUID().replace(/-/g, '')
    const parts: Buffer[] = []

    // File part
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="session.webm"\r\n` +
      `Content-Type: audio/webm\r\n\r\n`
    ))
    parts.push(audioBuffer)
    parts.push(Buffer.from('\r\n'))

    // Model part
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `gpt-4o-transcribe-diarize\r\n`
    ))
    
    // Response format
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
      `diarized_json\r\n`
    ))

    // Chunking Strategy (Required for diarization models)
    // Must be sent with Content-Type: application/json on this part
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="chunking_strategy"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `{"type":"server_vad"}\r\n`
    ))

    parts.push(Buffer.from(`--${boundary}--\r\n`))
    const body = Buffer.concat(parts)

    console.log('[PostMeeting] Calling gpt-4o-transcribe-diarize...')
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('[PostMeeting] Diarization API error:', response.status, errText)
      return
    }

    const diarizedResult = await response.json()
    console.log('[PostMeeting] Diarization successful.')
    
    // 2. Feed diarized text to gpt-5.4 for expensive summary
    const fullText = typeof diarizedResult === 'string' ? diarizedResult : JSON.stringify(diarizedResult)
    console.log('[PostMeeting] Calling gpt-5.4 for expensive final summary...')

    // Force gpt-5.4 in summaryEngine or do raw fetch
    const prompt = `This is the complete diarized transcript of a meeting:

${fullText}

Please generate a highly detailed, professional meeting summary, including:
1. A comprehensive document summary
2. Key statements and decisions
3. Logical flows, steps, or systems discussed (format suitably for a Mermaid.js diagram if applicable)
4. Follow-up answers and questions.

Output ONLY a JSON object matching this structure:
{
  "documentSummary": "Markdown document...",
  "statements": ["..."],
  "questions": ["..."],
  "followUpQuestions": [{ "question": "...", "answer": "..." }]
}
`;

    const summaryResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-5.4',
        messages: [
          { role: 'system', content: 'You are an expert meeting analyst. Always respond with valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_completion_tokens: 4000,
        response_format: { type: 'json_object' }
      })
    })

    if (!summaryResponse.ok) {
      const errText = await summaryResponse.text()
      console.error('[PostMeeting] Final summary API error:', summaryResponse.status, errText)
      return
    }

    const data = await summaryResponse.json()
    const content = data.choices?.[0]?.message?.content
    if (content) {
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      const finalState = JSON.parse(cleanContent)
      console.log('[PostMeeting] Final expensive summary completed successfully.')
      return finalState
    }
    return null

  } catch (err: any) {
    console.error('[PostMeeting] Process failed:', err.message || err)
    return null
  } finally {
    // Delete raw audio per security preference
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath)
      console.log('[PostMeeting] Deleted temporary WebM audio file:', audioPath)
    }
  }
}
