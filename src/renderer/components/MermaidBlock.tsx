import React, { useEffect, useState } from 'react'
import mermaid from 'mermaid'

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
})

export const MermaidBlock: React.FC<{ chart: string }> = ({ chart }) => {
  const [svg, setSvg] = useState<string>('')

  useEffect(() => {
    let isMounted = true

    const renderChart = async () => {
      try {
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`
        const { svg: renderedSvg } = await mermaid.render(id, chart)
        if (isMounted) {
          setSvg(renderedSvg)
        }
      } catch (err: any) {
        console.warn('Mermaid render error:', err)
        if (isMounted) {
          setSvg(`<pre style="color:var(--danger, #ef4444); padding: 10px; background: rgba(239, 68, 68, 0.1); border-radius: 8px;">Mermaid syntax error: ${err.message || 'Unknown error'}</pre>`)
        }
      }
    }

    if (chart) {
      renderChart()
    }

    return () => {
      isMounted = false
    }
  }, [chart])

  if (!svg) {
    return <div style={{ color: 'var(--text-3)', padding: 10 }}>Drawing diagram...</div>
  }

  return (
    <div 
      className="mermaid-wrapper" 
      style={{ margin: '20px 0', display: 'flex', justifyContent: 'center' }}
      dangerouslySetInnerHTML={{ __html: svg }} 
    />
  )
}
