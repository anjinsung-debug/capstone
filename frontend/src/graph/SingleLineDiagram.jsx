import cytoscape from 'cytoscape'
import { useEffect, useRef } from 'react'

// Cytoscape.js 단선도. elements 는 Cytoscape 형식({ data, position })의 배열.
export default function SingleLineDiagram({ elements }) {
  const containerRef = useRef(null)

  useEffect(() => {
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      layout: { name: 'preset' },
      style: [
        {
          selector: 'node',
          style: { label: 'data(label)', 'background-color': '#0b7a74', 'font-size': 12 },
        },
        {
          selector: 'edge',
          style: { width: 3, 'line-color': '#5a6770', label: 'data(label)', 'font-size': 10 },
        },
      ],
    })
    return () => cy.destroy()
  }, [elements])

  return <div ref={containerRef} style={{ width: '100%', height: 400, background: '#fff' }} />
}
