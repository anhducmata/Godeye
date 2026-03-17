import React, { useEffect, useState, useImperativeHandle, forwardRef } from 'react'

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
  onOpenSettings: () => void
  onOpenAuth: () => void
  isRecording: boolean
  isProcessing: boolean
}

export interface SidebarHandle {
  refresh: () => void
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

export const Sidebar = forwardRef<SidebarHandle, SidebarProps>(function Sidebar({ onLoadSession, onOpenSettings, onOpenAuth, isRecording, isProcessing }, ref) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null)

  useImperativeHandle(ref, () => ({
    refresh: () => loadSessions()
  }))

  useEffect(() => {
    loadSessions()
  }, [])

  // Close 3-dot menu on click outside
  useEffect(() => {
    if (!menuSessionId) return
    const handleClick = () => setMenuSessionId(null)
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [menuSessionId])

  const loadSessions = async () => {
    try {
      if (!window.meetsense?.listSessions) return
      const result = await window.meetsense.listSessions()
      setSessions(result || [])
    } catch {
      console.error('[Sidebar] Failed to load sessions')
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this session?')) return
    await window.meetsense?.deleteSession(id)
    setMenuSessionId(null)
    loadSessions()
  }

  const handleExport = (type: 'md' | 'json', e: React.MouseEvent) => {
    e.stopPropagation()
    if (type === 'md') window.meetsense?.exportMarkdown()
    else window.meetsense?.exportJSON()
    setMenuSessionId(null)
  }

  const toggleMenu = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuSessionId(menuSessionId === id ? null : id)
  }

  const filtered = sessions.filter(s => {
    if (searchQuery && !(s.title || 'Untitled').toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })

  if (collapsed) {
    return (
      <aside className="sidebar sidebar--collapsed">
        <div className="sidebar__header">
          <span className="sidebar__brand">🧠</span>
          <button className="sidebar__collapse" onClick={() => setCollapsed(false)}>▶</button>
        </div>
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
            <div className="session-card__menu-wrap">
              <button
                className="session-card__dots"
                onClick={(e) => toggleMenu(session.id, e)}
              >⋮</button>
              {menuSessionId === session.id && (
                <div className="session-card__menu">
                  <button onClick={(e) => handleExport('md', e)}>📄 Export MD</button>
                  <button onClick={(e) => handleExport('json', e)}>📋 Export JSON</button>
                  <button className="session-card__menu-delete" onClick={(e) => handleDelete(session.id, e)}>🗑️ Delete</button>
                </div>
              )}
            </div>
            <div className="session-card__header">
              <span className="session-card__icon">{DOC_TYPE_ICONS[session.document_type] || '📝'}</span>
              <span className="session-card__title">{session.title || 'Untitled Session'}</span>
            </div>
            {session.tags && session.tags.length > 0 && (
              <div className="session-card__tags">
                {session.tags.slice(0, 3).map(tag => (
                  <span key={tag.id} className="session-card__tag" style={{ color: tag.color }}>
                    #{tag.name}
                  </span>
                ))}
              </div>
            )}
            <div className="session-card__meta">
              <span className="session-card__date">{formatDate(session.created_at)}</span>
              {session.duration_seconds && (
                <span className="session-card__duration">{formatDuration(session.duration_seconds)}</span>
              )}
              {isProcessing && filtered.indexOf(session) === 0 && (
                <span className="session-card__processing">⏳ Processing...</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="sidebar__footer">
        <button className="sidebar__settings" onClick={onOpenSettings} title="Settings">⚙️</button>
        <button className="sidebar__auth" onClick={onOpenAuth}>Sign In</button>
        <button className="sidebar__refresh" onClick={loadSessions}>↻ Refresh</button>
      </div>
    </aside>
  )
})
