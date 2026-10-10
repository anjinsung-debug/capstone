// 화면 전체 흐름과 상태 (제안서 3·4·5단계, FR-03~09). 담당: 프론트엔드 (고영민, 최민준)
//
// 데이터 흐름 (계통의 원본은 이 파일의 graph 상태 하나뿐):
//   변전소 선택 → GET /api/substations/{id} → graph
//   편집 → Diagram/PropertyPanel이 lib/graphEdit.js로 새 graph를 만들어 onChange로 올림 → graph 교체
//   저장 → 편집이 바뀔 때마다 잠깐(AUTOSAVE_MS) 기다렸다 자동 저장: toSnapshot(graph) → PUT /api/substations/{id} → 서버가 돌려준 graph로 교체
//   시뮬레이션 → POST …/simulations → result → (동시에) POST /api/plots, POST /api/reports
// 서버 쪽 규칙은 cim/graph.py(조회·저장), simulation/dss.py(완성 검사), backend/main.py(오류 → 404·422·501)에 있다.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createPlot,
  createReport,
  getHealth,
  getSubstation,
  listSubstations,
  runSimulation,
  saveSubstation,
} from './api/client.js'
import Diagram from './components/Diagram.jsx'
import EditToolbar from './components/EditToolbar.jsx'
import NewSubstationDialog from './components/NewSubstationDialog.jsx'
import PropertyPanel from './components/PropertyPanel.jsx'
import ResultPanel from './components/ResultPanel.jsx'
import { emptyGraph, removeElements, toSnapshot } from './lib/graphEdit.js'

// ponytail: 되돌리기는 브라우저 메모리에 이전 계통을 최대 50개 통째로 보관한다 (새로고침하면 사라짐).
// 계통이 수천 개 노드로 커져 느려지면 바뀐 부분(diff)만 저장하는 방식으로 바꾼다
const HISTORY_LIMIT = 50
// 마지막 편집 뒤 이만큼 조용하면 자동 저장한다 (노드를 끄는 동안 저장 요청이 쏟아지지 않게)
const AUTOSAVE_MS = 800

// 변전소 선택 → 단선도 표시·편집(자동 저장) → 시뮬레이션 → 결과·그래프·AI 리포트 표시
export default function App() {
  const [health, setHealth] = useState({ ok: null, text: '확인 중...' })
  const [substations, setSubstations] = useState([])
  const [graph, setGraph] = useState(null) // 화면에 있는 계통 (저장 전 편집 포함)
  const [dirty, setDirty] = useState(false) // 아직 서버에 저장되지 않은 편집이 있는지
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null) // 자동 저장이 실패한 이유 (다음 편집 때까지 다시 시도하지 않음)
  const [navOpen, setNavOpen] = useState(false) // 왼쪽 편집 메뉴. 열려 있으면 편집 모드
  const [showNew, setShowNew] = useState(false) // 새 변전소 이름 입력 창
  const [tool, setTool] = useState('select')
  const [selectedIds, setSelectedIds] = useState([])
  const [sideTab, setSideTab] = useState('props') // 오른쪽 패널: props | result
  const [focus, setFocus] = useState(null) // 결과 패널에서 고른 위치 → 단선도가 그쪽으로 이동
  const [labelMode, setLabelMode] = useState('voltage') // 노드 아래 표시: voltage | fault | name
  const [busy, setBusy] = useState('') // 진행 중인 작업 이름
  const [result, setResult] = useState(null)
  const [plotUrl, setPlotUrl] = useState(null)
  const [plotMessage, setPlotMessage] = useState('')
  const [report, setReport] = useState(null)
  const [reportMessage, setReportMessage] = useState('')
  const [message, setMessage] = useState({ text: '', kind: 'info' })
  // 마지막 요청의 결과만 표시하기 위한 번호 (변전소 선택·시뮬레이션·편집마다 증가).
  // 리포트(LLM)는 수십 초 걸릴 수 있어서, 그사이 편집·재시뮬레이션하면 늦게 온 옛 결과를 버린다
  const runId = useRef(0)
  const history = useRef([]) // 되돌리기용 이전 계통들
  const editVersion = useRef(0) // 편집할 때마다 증가. 저장하는 동안 편집이 있었는지 알아내는 데 쓴다

  const editing = navOpen
  const tab = result ? sideTab : 'props'

  const info = (text) => setMessage({ text, kind: 'info' })
  const fail = (text) => setMessage({ text, kind: 'error' })

  useEffect(() => {
    if (message.kind !== 'info' || !message.text) return undefined
    const t = setTimeout(() => setMessage({ text: '', kind: 'info' }), 6000)
    return () => clearTimeout(t)
  }, [message])

  const refreshList = () =>
    listSubstations()
      .then(setSubstations)
      .catch((e) => fail(`변전소 목록을 불러오지 못했습니다 (${e.message})`))

  useEffect(() => {
    getHealth()
      .then((h) => setHealth({ ok: h.neo4j === 'connected' || h.neo4j === 'mock', text: `서버 ${h.status} · Neo4j ${h.neo4j}` }))
      .catch((e) => setHealth({ ok: false, text: `백엔드 연결 실패 (${e.message})` }))
    refreshList()
  }, [])

  function clearResult() {
    ++runId.current
    setResult(null)
    setPlotUrl(null)
    setPlotMessage('')
    setReport(null)
    setReportMessage('')
  }

  // 편집 스냅샷 전체 저장 (PUT). 성공하면 서버가 돌려준 계통으로 바꾼다.
  // 서버(cim/graph.py의 _prepare_snapshot)가 선로 kind·방향·feeder_id를 다시 계산하므로 화면 값보다 서버 값이 기준이다.
  // 저장하는 동안 또 편집했다면 화면의 편집을 지우지 않도록 서버 값으로 바꾸지 않고, 편집 내용을 다시 저장한다.
  // 실패 이유(전원 개수, bus_id 대상 등)는 client.js가 서버 detail을 붙여 주므로 그대로 보인다.
  // 서버는 전원(source) 노드가 1개일 때만 저장하므로, 계통을 처음 만드는 동안에는 저장이 실패하는 것이 정상이다
  async function save({ silent = false } = {}) {
    const version = editVersion.current
    setSaving(true)
    try {
      const saved = await saveSubstation(graph.substation.id, toSnapshot(graph))
      if (editVersion.current === version) {
        setGraph(saved.graph)
        setDirty(false)
      }
      setSaveError(null)
      refreshList()
      return true
    } catch (e) {
      setSaveError(e.message)
      if (!silent) fail(`저장 실패 (${e.message})`)
      return false
    } finally {
      setSaving(false)
    }
  }

  // 편집이 멈추면 자동 저장. 실패하면 다음 편집 전까지 다시 시도하지 않는다 (같은 실패를 반복하지 않도록)
  useEffect(() => {
    if (!graph || !dirty || saving || saveError) return undefined
    const t = setTimeout(() => save({ silent: true }), AUTOSAVE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save는 매 렌더 새로 만들어지지만 항상 최신 graph를 쓴다
  }, [graph, dirty, saving, saveError])

  // 다른 변전소로 가기 전에 저장을 마친다. 저장이 안 되면 (예: 전원이 아직 없음) 버릴지 물어본다
  async function confirmDiscard() {
    if (!dirty) return true
    if (!saving && (await save({ silent: true }))) return true
    return window.confirm('저장하지 못한 편집이 있습니다. 버리고 계속할까요?')
  }

  // 단선도에서 편집이 일어날 때마다 호출: 이전 결과는 계통과 맞지 않으므로 지운다
  const graphRef = useRef(graph)
  graphRef.current = graph
  const onChange = useCallback((g) => {
    if (graphRef.current) history.current = [...history.current.slice(-HISTORY_LIMIT + 1), graphRef.current]
    ++editVersion.current
    setGraph(g)
    setDirty(true)
    setSaveError(null)
    clearResult()
  }, [])

  async function selectSubstation(substationId) {
    if (!(await confirmDiscard())) return
    clearResult()
    info('')
    try {
      setGraph(await getSubstation(substationId))
      setDirty(false)
      setSaveError(null)
      setSelectedIds([])
      history.current = []
    } catch (e) {
      fail(`계통을 불러오지 못했습니다 (${e.message})`)
    }
  }

  async function openNewSubstation() {
    if (await confirmDiscard()) setShowNew(true)
  }

  // 빈 계통에서 새 변전소를 만든다 (프론트가 UUID 발급).
  // 구현 참고 (한승우 확인 필요): 진짜 백엔드의 save_substation은 이미 있는 변전소만 저장하고(없으면 404),
  // 전원(source) 노드가 정확히 1개여야 저장된다(아니면 422). 그래서 지금은 "새 변전소"가 모의 서버에서만 저장된다.
  // 진짜 백엔드에서는 자동 저장이 실패해 "저장 안 됨"으로 표시된다.
  // 웹에서 새 변전소를 만들게 할지(서버에서 생성 허용), 이 버튼을 숨길지 팀에서 정해야 한다
  function createSubstation(name) {
    setShowNew(false)
    clearResult()
    ++editVersion.current
    setGraph(emptyGraph(name))
    setDirty(true)
    setSaveError(null)
    setNavOpen(true)
    setTool('source')
    setSelectedIds([])
    history.current = []
    info('왼쪽 메뉴에서 설비를 고르고 단선도의 빈 곳을 누르세요. 편집은 자동으로 저장됩니다')
  }

  async function simulate() {
    // 시뮬레이션은 서버(Neo4j)에 저장된 계통으로 계산하므로, 저장 전 편집이 있으면 먼저 저장한다
    if (dirty && !(await save())) return
    clearResult()
    const id = runId.current
    setBusy('시뮬레이션 중')
    let res
    try {
      res = await runSimulation(graph.substation.id)
    } catch (e) {
      if (id === runId.current) fail(`시뮬레이션 실패 (${e.message})`)
      return
    } finally {
      setBusy('')
    }
    if (id !== runId.current) return
    info('')
    setResult(res)
    setSideTab('result') // 결과는 오른쪽 패널에 바로 보인다 (스크롤 없이)
    setPlotMessage('그래프 그리는 중...')
    setReportMessage('AI 리포트 생성 중... (수 초~수십 초)')
    createPlot(res)
      .then((url) => id === runId.current && setPlotUrl(url))
      .catch((e) => id === runId.current && setPlotMessage(`그래프 실패 (${e.message})`))
    createReport(res)
      .then((r) => id === runId.current && setReport(r))
      .catch((e) => id === runId.current && setReportMessage(`AI 리포트 실패 (${e.message})`))
  }

  const onSelect = useCallback((ids) => {
    setSelectedIds(ids)
    if (ids.length) setSideTab('props') // 설비를 누르면 그 속성을 보여 준다
  }, [])

  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return
    onChange(removeElements(graph, selectedIds))
    setSelectedIds([])
  }, [graph, selectedIds, onChange])

  const undo = useCallback(() => {
    const prev = history.current.pop()
    if (!prev) return
    ++editVersion.current
    setGraph(prev)
    setDirty(true)
    setSaveError(null)
    clearResult()
  }, [])

  // 단축키: Delete 삭제, Ctrl+Z 되돌리기, Esc 선택 도구 (입력칸에 쓰는 중에는 무시)
  useEffect(() => {
    if (!editing) return undefined
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelected()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
      } else if (e.key === 'Escape') setTool('select')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, deleteSelected, undo])

  // 아직 저장되지 않은 채(저장 대기·실패) 창을 닫으려 하면 경고
  useEffect(() => {
    if (!dirty) return undefined
    const warn = (e) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const isNew = graph && !substations.some((s) => s.id === graph.substation.id)

  // 저장 상태 표시 (저장 버튼 대신)
  let saveStatus = null
  if (graph) {
    if (saveError) saveStatus = { cls: 'warn', text: '저장 안 됨', title: saveError }
    else if (saving) saveStatus = { cls: '', text: '저장 중…' }
    else if (dirty) saveStatus = { cls: '', text: '저장 대기…' }
    else saveStatus = { cls: 'ok', text: '모두 저장됨' }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <button
            type="button"
            className={navOpen ? 'menu-btn on' : 'menu-btn'}
            disabled={!graph}
            onClick={() => setNavOpen(!navOpen)}
            aria-expanded={navOpen}
            aria-label="편집 메뉴"
            title={graph ? '편집 메뉴 열기·닫기' : '변전소를 선택하면 편집 메뉴를 쓸 수 있습니다'}
          >
            <span className="logo">⚡</span>
            <span className="menu-lines" aria-hidden="true">
              ☰
            </span>
          </button>
          <div>
            <h1>배전계통 통합 분석 플랫폼</h1>
            <small className={health.ok === false ? 'health bad' : 'health'}>{health.text}</small>
          </div>
        </div>
        <div className="actions">
          {saveStatus && (
            <span className={`save-status ${saveStatus.cls}`} title={saveStatus.title} role="status">
              {saveStatus.text}
            </span>
          )}
          <select value={isNew ? '' : (graph?.substation.id ?? '')} onChange={(e) => selectSubstation(e.target.value)}>
            <option value="" disabled>
              {isNew ? `${graph.substation.name} (새 변전소)` : '변전소 선택'}
            </option>
            {substations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={openNewSubstation}>
            + 새 변전소
          </button>
          <span className="sep" />
          <button type="button" className="primary" disabled={!graph || !!busy || saving} onClick={simulate}>
            {busy || '시뮬레이션'}
          </button>
        </div>
      </header>

      {/* 알림은 화면 아래에 띄워 단선도 위치가 밀리지 않게 한다 (위치가 밀리면 클릭 좌표가 어긋남) */}
      {message.text && (
        <div className={`toast ${message.kind}`} role="status">
          <span>{message.text}</span>
          <button type="button" onClick={() => info('')} aria-label="닫기">
            ✕
          </button>
        </div>
      )}

      {showNew && <NewSubstationDialog onCreate={createSubstation} onCancel={() => setShowNew(false)} />}

      <div className={navOpen ? 'workspace nav-open' : 'workspace'}>
        {navOpen && (
          <EditToolbar
            tool={tool}
            onTool={(t) => {
              setTool(t)
              info('')
            }}
            onDelete={deleteSelected}
            canDelete={selectedIds.length > 0}
            onClose={() => setNavOpen(false)}
          />
        )}
        <Diagram
          graph={graph}
          result={result}
          editing={editing}
          tool={tool}
          labelMode={labelMode}
          focus={focus}
          onLabelMode={setLabelMode}
          onChange={onChange}
          onSelect={onSelect}
          onMessage={info}
        />
        <aside className={tab === 'result' ? 'side wide' : 'side'}>
          <div className="seg seg-wide side-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'props'} className={tab === 'props' ? 'on' : ''} onClick={() => setSideTab('props')}>
              속성
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'result'}
              className={tab === 'result' ? 'on' : ''}
              disabled={!result}
              onClick={() => setSideTab('result')}
              title={result ? '' : '시뮬레이션을 실행하면 볼 수 있습니다'}
            >
              결과
            </button>
          </div>
          <div className="side-body">
            {tab === 'props' ? (
              <PropertyPanel graph={graph} selectedIds={selectedIds} result={result} editing={editing} onChange={onChange} />
            ) : (
              <ResultPanel
                graph={graph}
                result={result}
                plotUrl={plotUrl}
                plotMessage={plotMessage}
                report={report}
                reportMessage={reportMessage}
                onFocus={(id) => setFocus({ id })}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
