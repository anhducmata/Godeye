import React, { useEffect, useState } from 'react'

interface Session {
  id: string
  title: string | null
  document_type: string
  created_at: string
  duration_seconds: number | null
  status: string
  tags?: Array<{ id: number; name: string; color: string }>
}

interface SidebarProps {
  onLoadSession: (id: string) => void
  isRecording: boolean
}

const DOC_TYPE_ICONS: Record<string, string> = {
  standup: '📋',
  planning: '🗓️',
  feedback: '💬',
  retrospective: '🔄',
  brainstorm: '💡',
  general: '📝'
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function Sidebar({ onLoadSession, isRecording }: SidebarProps) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [tags, setTags] = useState<Array<{ id: number; name: string; color: string }>>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTag, setSelectedTag] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    loadSessions()
    loadTags()
  }, [])

  const loadSessions = async () => {
    try {
      const result = await window.meetsense.listSessions()
      setSessions(result || [])
    } catch {
      console.error('[Sidebar] Failed to load sessions')
    }
  }

  const loadTags = async () => {
    try {
      const result = await window.meetsense.listTags()
      setTags(result || [])
    } catch {
      console.error('[Sidebar] Failed to load tags')
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this session?')) return
    await window.meetsense.deleteSession(id)
    loadSessions()
  }

  const filtered = sessions.filter(s => {
    if (searchQuery && !(s.title || 'Untitled').toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })

  if (collapsed) {
    return (
      <aside className="sidebar sidebar--collapsed" onClick={() => setCollapsed(false)}>
        <div className="sidebar__expand">☰</div>
      </aside>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <span className="sidebar__brand">🧠 MeetSense</span>
        <button className="sidebar__collapse" onClick={() => setCollapsed(true)}>◀</button>
      </div>

      <div className="sidebar__search">
        <input
          type="text"
          placeholder="Search sessions..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="sidebar__search-input"
        />
      </div>

      {tags.length > 0 && (
        <div className="sidebar__tags">
          <button
            className={`tag-chip ${selectedTag === null ? 'tag-chip--active' : ''}`}
            onClick={() => setSelectedTag(null)}
          >All</button>
          {tags.map(tag => (
            <button
              key={tag.id}
              className={`tag-chip ${selectedTag === tag.id ? 'tag-chip--active' : ''}`}
              style={{ '--tag-color': tag.color } as React.CSSProperties}
              onClick={() => setSelectedTag(tag.id === selectedTag ? null : tag.id)}
            >{tag.name}</button>
          ))}
        </div>
      )}

      <div className="sidebar__sessions">
        {filtered.length === 0 && (
          <div className="sidebar__empty">
            {isRecording ? 'Recording in progress...' : 'No sessions yet. Start recording!'}
          </div>
        )}
        {filtered.map(session => (
          <div
            key={session.id}
            className="session-card"
            onClick={() => onLoadSession(session.id)}
          >
            <div className="session-card__header">
              <span className="session-card__icon">{DOC_TYPE_ICONS[session.document_type] || '📝'}</span>
              <span className="session-card__title">{session.title || 'Untitled Session'}</span>
            </div>
            <div className="session-card__meta">
              <span className="session-card__date">{formatDate(session.created_at)}</span>
              {session.duration_seconds && (
                <span className="session-card__duration">{formatDuration(session.duration_seconds)}</span>
              )}
              <button
                className="session-card__delete"
                onClick={(e) => handleDelete(session.id, e)}
              >×</button>
            </div>
          </div>
        ))}
      </div>

      <div className="sidebar__footer">
        <button className="sidebar__refresh" onClick={loadSessions}>↻ Refresh</button>
      </div>
    </aside>
  )
}
