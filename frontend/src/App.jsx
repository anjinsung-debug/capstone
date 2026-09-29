import { useEffect, useState } from 'react'
import { getHealth } from './api/client.js'
import SingleLineDiagram from './graph/SingleLineDiagram.jsx'

// 동작 확인용 예시 계통 (실제 데이터는 백엔드에서 받아올 예정)
const sampleElements = [
  { data: { id: 'src', label: '변전소 모선' }, position: { x: 100, y: 200 } },
  { data: { id: 'b1', label: '버스 1' }, position: { x: 300, y: 200 } },
  { data: { id: 'b2', label: '버스 2' }, position: { x: 500, y: 120 } },
  { data: { id: 'b3', label: '버스 3' }, position: { x: 500, y: 280 } },
  { data: { id: 'l1', source: 'src', target: 'b1', label: '선로 1' } },
  { data: { id: 'l2', source: 'b1', target: 'b2', label: '선로 2' } },
  { data: { id: 'l3', source: 'b1', target: 'b3', label: '선로 3' } },
]

export default function App() {
  const [health, setHealth] = useState('확인 중...')

  useEffect(() => {
    getHealth()
      .then((h) => setHealth(`서버 ${h.status}, Neo4j ${h.neo4j}`))
      .catch((e) => setHealth(`백엔드 연결 실패 (${e.message})`))
  }, [])

  return (
    <main style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ margin: 0 }}>배전계통 통합 분석 플랫폼</h1>
      <p style={{ margin: 0 }}>백엔드 상태: {health}</p>
      <SingleLineDiagram elements={sampleElements} />
    </main>
  )
}
