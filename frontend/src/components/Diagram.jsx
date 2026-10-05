// 단선도 뷰어·편집기 (제안서 3·4단계, FR-05, FR-06)
// 변전소 계통(SubstationGraph)을 Cytoscape.js 다크모드 단선도로 그리고, 시뮬레이션 결과가 있으면 오버레이한다.
import cytoscape from 'cytoscape'
import { useEffect, useRef } from 'react'

function toElements(graph) {
  const nodes = graph.nodes.map((n) => ({
    data: { id: n.id, label: n.name, type: n.type, feederId: n.feeder_id },
    position: { x: n.x, y: n.y },
  }))
  const edges = graph.lines.map((l) => ({
    data: { id: l.id, source: l.from_node_id, target: l.to_node_id, label: l.name, kind: l.kind },
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
        { selector: 'node', style: { label: 'data(label)', 'font-size': 10, color: '#e4eae8', 'background-color': '#8c979d' } },
        { selector: 'edge', style: { width: 2, 'line-color': '#5a6770' } },
      ],
    })
    // TODO(편집, 4단계): 노드 이동 시 그리드 스냅·수평/수직 가이드라인 정렬, 두 노드 선택해 연결선 드로잉,
    // 새 노드·선로에 crypto.randomUUID()로 id 할당, 편집 종료 시 saveSubstation으로 스냅샷 저장
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
    // breaker 노드 옆에 result.feeders의 피더별 송출 MW·MVAr 황색 표시.
    // 판정 기준은 simulation/models.py와 같게: 전압 0.95~1.05 pu 밖, 부하율 100% 초과면 경고 색
  }, [result])

  return <div ref={containerRef} style={{ width: '100%', height: 600, background: '#11171b', border: '1px solid #2a363d' }} />
}
