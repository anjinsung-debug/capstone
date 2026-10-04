// 단선도 뷰어·편집기 (제안서 3·4단계, FR-05, FR-06)
// FeederGraph(노드·선로)를 Cytoscape.js로 그리고, 시뮬레이션 결과가 있으면 오버레이한다.
import cytoscape from 'cytoscape'
import { useEffect, useRef } from 'react'

function toElements(graph) {
  const nodes = graph.nodes.map((n) => ({
    data: { id: n.id, label: n.name, type: n.type },
    position: { x: n.x, y: n.y },
  }))
  const edges = graph.lines.map((l) => ({
    data: { id: l.id, source: l.from_node_id, target: l.to_node_id, label: l.name },
  }))
  return [...nodes, ...edges]
}

export default function Diagram({ graph, result }) {
  const containerRef = useRef(null)
  const cyRef = useRef(null)

  // 계통이 바뀌면 단선도를 다시 그린다
  useEffect(() => {
    if (!graph) return undefined
    const cy = cytoscape({
      container: containerRef.current,
      elements: toElements(graph),
      layout: { name: 'preset' }, // 저장된 x, y 좌표 그대로 배치
      style: [
        { selector: 'node', style: { label: 'data(label)', 'font-size': 10 } },
        { selector: 'edge', style: { width: 2 } },
      ],
    })
    // TODO(편집, 4단계): 노드 이동 시 그리드 스냅·정렬 가이드라인, 연결선 드로잉, 편집 종료 시 saveFeeder로 스냅샷 저장
    cyRef.current = cy
    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [graph])

  // 시뮬레이션 결과가 오면 오버레이한다
  useEffect(() => {
    if (!cyRef.current || !result) return
    // TODO(오버레이, 3단계): 4대 시뮬레이션(전압 pu, 부하율, 역조류, 고장전류)을 색상·두께로 표시,
    // 변전소 차단기 옆에 피더 송출 MW·MVAr 황색 표시. 기준은 회의 안건 6번(결과 표시 방식)
  }, [result])

  return <div ref={containerRef} style={{ width: '100%', height: 600, border: '1px solid #444' }} />
}
