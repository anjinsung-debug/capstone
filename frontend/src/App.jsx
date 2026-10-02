import { useEffect, useState } from 'react'
import { getHealth } from './api/client.js'

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
    </main>
  )
}
