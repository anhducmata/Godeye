import React, { useState, useRef, useEffect } from 'react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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
      const results = await window.meetsense?.searchKnowledge(query)
      const answer = results && results.length > 0
        ? results.map((r: any) => r.content || r.text || JSON.stringify(r)).join('\n\n')
        : 'No relevant knowledge found. Try recording more sessions to build your knowledge base.'

      setMessages(prev => [...prev, { role: 'assistant', content: answer, timestamp: Date.now() }])
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I couldn\'t search the knowledge base right now.',
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
        title="Ask anything"
      >
        {isOpen ? '✕' : '💬'}
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div className="chat-panel">
          <div className="chat-panel__header">
            <span className="chat-panel__title">🧠 Ask MeetSense</span>
            <span className="chat-panel__subtitle">Search across all your meetings</span>
          </div>

          <div className="chat-panel__messages">
            {messages.length === 0 && (
              <div className="chat-panel__empty">
                <div style={{ fontSize: 28 }}>💡</div>
                <p>Ask anything about your past meetings</p>
                <div className="chat-panel__hints">
                  <button onClick={() => setInput('What decisions were made this week?')}>Decisions this week?</button>
                  <button onClick={() => setInput('Summarize the last standup')}>Last standup summary</button>
                  <button onClick={() => setInput('What open questions remain?')}>Open questions?</button>
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
              placeholder="Ask about your meetings..."
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
