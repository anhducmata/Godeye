import React, { useState, useRef, useEffect } from 'react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface ActiveSession {
  session: any
  transcripts: any[]
  summary: any
}

interface ChatWidgetProps {
  activeSession?: ActiveSession | null
}

export function ChatWidget({ activeSession }: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const prevSessionIdRef = useRef<string | null>(null)

  const isSessionMode = !!activeSession?.session?.id
  const sessionTitle = activeSession?.session?.title || 'Session'

  // Clear messages when session changes
  useEffect(() => {
    const currentId = activeSession?.session?.id || null
    if (currentId !== prevSessionIdRef.current) {
      setMessages([])
      prevSessionIdRef.current = currentId
    }
  }, [activeSession?.session?.id])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  const handleSend = async () => {
    const query = input.trim()
    if (!query || loading) return

    setMessages(prev => [...prev, { role: 'user', content: query, timestamp: Date.now() }])
    setInput('')
    setLoading(true)

    try {
      if (isSessionMode) {
        // Context-aware: chat with AI about this specific session
        const history = messages.map(m => ({ role: m.role, content: m.content }))
        const result = await (window as any).meetsense?.chatWithSession({
          sessionId: activeSession!.session.id,
          query,
          history,
          language: undefined // will use backend default
        })
        const answer = result?.success && result.answer
          ? result.answer
          : result?.error || 'Sorry, I couldn\'t answer that right now.'

        setMessages(prev => [...prev, { role: 'assistant', content: answer, timestamp: Date.now() }])
      } else {
        // Global mode: search across all sessions
        const results = await (window as any).meetsense?.searchKnowledge(query)
        const answer = results && results.length > 0
          ? results.map((r: any) => r.content || r.text || JSON.stringify(r)).join('\n\n')
          : 'No relevant knowledge found. Try recording more sessions to build your knowledge base.'

        setMessages(prev => [...prev, { role: 'assistant', content: answer, timestamp: Date.now() }])
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I couldn\'t process your request right now.',
        timestamp: Date.now()
      }])
    }
    setLoading(false)
  }

  return (
    <>
      {/* Floating Button */}
      <button
        className={`chat-fab ${isOpen ? 'chat-fab--active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title={isSessionMode ? `Ask about ${sessionTitle}` : 'Ask anything'}
      >
        {isOpen ? '✕' : '💬'}
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div className="chat-panel">
          <div className="chat-panel__header">
            <span className="chat-panel__title">
              {isSessionMode ? `💬 ${sessionTitle}` : '🧠 Ask MeetSense'}
            </span>
            <span className="chat-panel__subtitle">
              {isSessionMode
                ? 'Ask anything about this session'
                : 'Search across all your meetings'}
            </span>
          </div>

          <div className="chat-panel__messages">
            {messages.length === 0 && (
              <div className="chat-panel__empty">
                <div style={{ fontSize: 28 }}>{isSessionMode ? '💬' : '💡'}</div>
                <p>{isSessionMode
                  ? `Ask anything about "${sessionTitle}"`
                  : 'Ask anything about your past meetings'}</p>
                <div className="chat-panel__hints">
                  {isSessionMode ? (
                    <>
                      <button onClick={() => setInput('Tóm tắt nội dung buổi này')}>Tóm tắt nội dung?</button>
                      <button onClick={() => setInput('Những quyết định quan trọng?')}>Quyết định quan trọng?</button>
                      <button onClick={() => setInput('Có câu hỏi nào chưa được giải quyết?')}>Câu hỏi chưa giải quyết?</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setInput('What decisions were made this week?')}>Decisions this week?</button>
                      <button onClick={() => setInput('Summarize the last standup')}>Last standup summary</button>
                      <button onClick={() => setInput('What open questions remain?')}>Open questions?</button>
                    </>
                  )}
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`chat-panel__msg chat-panel__msg--${msg.role}`}>
                <div className="chat-panel__msg-content">{msg.content}</div>
              </div>
            ))}
            {loading && (
              <div className="chat-panel__msg chat-panel__msg--assistant">
                <div className="chat-panel__msg-content chat-panel__typing">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-panel__input-bar">
            <input
              ref={inputRef}
              type="text"
              placeholder={isSessionMode ? `Ask about ${sessionTitle}...` : 'Ask about your meetings...'}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              disabled={loading}
            />
            <button onClick={handleSend} disabled={loading || !input.trim()}>→</button>
          </div>
        </div>
      )}
    </>
  )
}
