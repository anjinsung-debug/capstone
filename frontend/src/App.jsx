import { useEffect, useRef, useState } from 'react'
import {
  createPlot,
  createReport,
  getHealth,
  getSubstation,
  listSubstations,
  runSimulation,
} from './api/client.js'
import Diagram from './components/Diagram.jsx'
import ResultPanel from './components/ResultPanel.jsx'

// 변전소 선택 → 단선도 표시 → 시뮬레이션 → 결과·그래프·AI 리포트 표시
export default function App() {
  const [health, setHealth] = useState('확인 중...')
  const [substations, setSubstations] = useState([])
  const [graph, setGraph] = useState(null)
  const [result, setResult] = useState(null)
  const [plotUrl, setPlotUrl] = useState(null)
  const [report, setReport] = useState(null)
  const [message, setMessage] = useState('')
  const [reportMessage, setReportMessage] = useState('')
  const runId = useRef(0) // 마지막 요청의 결과만 표시하기 위한 번호 (변전소 선택·시뮬레이션마다 증가)

  useEffect(() => {
    getHealth()
      .then((h) => setHealth(`서버 ${h.status}, Neo4j ${h.neo4j}`))
      .catch((e) => setHealth(`백엔드 연결 실패 (${e.message})`))
    listSubstations()
      .then(setSubstations)
      .catch((e) => setMessage(`변전소 목록을 불러오지 못했습니다 (${e.message})`))
  }, [])

  function clearResult() {
    setResult(null)
    setPlotUrl(null)
    setReport(null)
    setReportMessage('')
    setMessage('')
  }

  async function selectSubstation(substationId) {
    ++runId.current
    clearResult()
    try {
      setGraph(await getSubstation(substationId))
    } catch (e) {
      setMessage(`계통을 불러오지 못했습니다 (${e.message})`)
    }
  }

  async function simulate() {
    const id = ++runId.current
    clearResult()
    let res
    try {
      res = await runSimulation(graph.substation.id)
    } catch (e) {
      if (id === runId.current) setMessage(`시뮬레이션 실패 (${e.message})`)
      return
    }
    if (id !== runId.current) return
    setResult(res)
    setReportMessage('AI 리포트 생성 중...')
    createPlot(res)
      .then((url) => id === runId.current && setPlotUrl(url))
      .catch(() => {})
    createReport(res)
      .then((r) => id === runId.current && setReport(r))
      .catch((e) => id === runId.current && setReportMessage(`AI 리포트 실패 (${e.message})`))
  }

  return (
    <main style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ margin: 0 }}>배전계통 통합 분석 플랫폼</h1>
      <p style={{ margin: 0 }}>백엔드 상태: {health}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <select defaultValue="" onChange={(e) => selectSubstation(e.target.value)}>
          <option value="" disabled>
            변전소 선택
          </option>
          {substations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button type="button" disabled={!graph} onClick={simulate}>
          시뮬레이션
        </button>
      </div>
      {message && <p style={{ margin: 0 }}>{message}</p>}
      <Diagram graph={graph} result={result} />
      <ResultPanel graph={graph} result={result} plotUrl={plotUrl} report={report} reportMessage={reportMessage} />
    </main>
  )
}
