import OpenAI from 'openai'

let vectorStoreId: string | null = null
const VECTOR_STORE_NAME = 'meetsense-sessions'

function getClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

async function ensureVectorStore(): Promise<string> {
  if (vectorStoreId) return vectorStoreId

  const client = getClient()
  // Try to find existing vector store
  const stores = await client.vectorStores.list({ limit: 100 })
  const existing = stores.data.find((s: any) => s.name === VECTOR_STORE_NAME)

  if (existing) {
    vectorStoreId = existing.id
    console.log(`[RAG] Using existing vector store: ${vectorStoreId}`)
  } else {
    const vs = await client.vectorStores.create({ name: VECTOR_STORE_NAME })
    vectorStoreId = vs.id
    console.log(`[RAG] Created vector store: ${vectorStoreId}`)
  }

  return vectorStoreId
}

export async function uploadSessionToVectorStore(sessionId: string, content: string): Promise<string | null> {
  try {
    const client = getClient()
    const vsId = await ensureVectorStore()

    // Create a file from the content
    const blob = new Blob([content], { type: 'text/markdown' })
    const file = new File([blob], `session-${sessionId}.md`, { type: 'text/markdown' })

    const uploaded = await client.files.create({
      file,
      purpose: 'assistants'
    })

    // Add to vector store
    await client.vectorStores.files.create(vsId, {
      file_id: uploaded.id
    })

    console.log(`[RAG] Uploaded session ${sessionId} to vector store (file: ${uploaded.id})`)
    return uploaded.id
  } catch (err) {
    console.error('[RAG] Failed to upload to vector store:', err)
    return null
  }
}

export async function searchKnowledge(query: string, maxResults = 5): Promise<Array<{ text: string; score: number; filename: string }>> {
  try {
    const client = getClient()
    const vsId = await ensureVectorStore()

    const response = await client.responses.create({
      model: 'gpt-4o-mini',
      input: query,
      tools: [{
        type: 'file_search' as any,
        vector_store_ids: [vsId]
      }]
    } as any)

    // Extract search results from the response
    const results: Array<{ text: string; score: number; filename: string }> = []

    if (response.output) {
      for (const item of response.output) {
        if ((item as any).type === 'file_search_call' && (item as any).results) {
          for (const r of (item as any).results.slice(0, maxResults)) {
            results.push({
              text: r.text || '',
              score: r.score || 0,
              filename: r.filename || ''
            })
          }
        }
      }
    }

    console.log(`[RAG] Search returned ${results.length} results for: "${query.slice(0, 50)}..."`)
    return results
  } catch (err) {
    console.error('[RAG] Search failed:', err)
    return []
  }
}
