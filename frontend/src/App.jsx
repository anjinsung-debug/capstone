// 화면 전체 흐름과 상태 (제안서 3·4·5단계, FR-03~09). 담당: 프론트엔드 (고영민, 최민준)
//
// 데이터 흐름 (계통의 원본은 이 파일의 graph 상태 하나뿐):
//   변전소 선택 → GET /api/substations/{id} → graph → 바로 시뮬레이션
//   편집 → Diagram/PropertyPanel이 lib/graphEdit.js로 새 graph를 만들어 onChange로 올림 → graph 교체
//   자동 저장 → 편집이 멈추고 AUTOSAVE_DELAY_MS 뒤 toSnapshot(graph) → PUT /api/substations/{id} → 서버가 돌려준 graph로 교체
//            → 계산에 영향을 주는 값이 바뀌었으면(electricalKey) POST …/simulations → result
//   결과 그래프는 화면이 직접 그린다 (components/ProfileChart.jsx). 서버 PNG(POST /api/plots)는 쓰지 않는다
//   AI 리포트 → 결과 창의 버튼을 누를 때만 POST /api/reports (LLM 비용·시간 때문에 자동으로 부르지 않음)
// 서버 쪽 규칙은 cim/graph.py(조회·저장), simulation/dss.py(완성 검사), backend/main.py(오류 → 404·422·501)에 있다.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createReport,
  getHealth,
  getSubstation,
  listSubstations,
  runDaily,
  runSimulation,
  saveSubstation,
} from './api/client.js'
import Diagram from './components/Diagram.jsx'
import Modal from './components/Modal.jsx'
import NavDrawer from './components/NavDrawer.jsx'
import PopupWindow, { openPopup } from './components/PopupWindow.jsx'
import PropertyPanel from './components/PropertyPanel.jsx'
import { AiReportView, Legend, ResultView, SummaryStrip } from './components/ResultPanel.jsx'
import { NewSubstationDialog, RenameDialog } from './components/SubstationDialog.jsx'
import { electricalKey, emptyGraph, findDangling, removeElements, starterGraph, toSnapshot, updateSubstation } from './lib/graphEdit.js'
import { MODES, dailyPoints, historyPoint, sameHistoryValues } from './lib/overlay.js'

// ponytail: 되돌리기는 브라우저 메모리에 이전 계통을 최대 50개 통째로 보관한다 (새로고침하면 사라짐).
// 계통이 수천 개 노드로 커져 느려지면 바뀐 부분(diff)만 저장하는 방식으로 바꾼다
const HISTORY_LIMIT = 50
// 마지막 편집 후 이만큼 조용하면 자동 저장. 글자 입력·연속 드래그마다 서버를 부르지 않으려고 기다린다
const AUTOSAVE_DELAY_MS = 800
// ponytail: 결과 기록(시점별)도 메모리에 최대 100개만 둔다. 오래 남겨야 하면 서버(Neo4j)에 저장하는 API를 만든다
const RESULT_HISTORY_LIMIT = 100
const HEALTH_POLL_MS = 15000 // 서버·DB 연결 상태를 다시 확인하는 간격

const describe = (e) => e.message.replace(/^HTTP \d+: /, '')

export default function App() {
  // 연결 상태 (위 왼쪽 표시): server·db = true(연결) | false(끊김) | null(확인 중). db는 모의 서버면 'mock'
  const [health, setHealth] = useState({ server: null, db: null, detail: '확인 중' })
  const [substations, setSubstations] = useState([])
  const [graph, setGraph] = useState(null) // 화면에 있는 계통 (자동 저장 전 값일 수 있음)
  const [dirty, setDirty] = useState(false) // 아직 저장하지 않은 편집이 있는지
  const [save, setSave] = useState({ status: 'idle', text: '' }) // 자동 저장 상태: idle | pending | saving | saved | error
  const [navOpen, setNavOpen] = useState(false) // 왼쪽 편집 메뉴. 열려 있는 동안 노드 추가·이동·연결·삭제 가능
  const [tool, setTool] = useState('select')
  const [selectedIds, setSelectedIds] = useState([])
  const [mode, setMode] = useState('health') // 단선도 표시 모드: health | voltage | loading | reverse | fault (lib/overlay.js의 MODES)
  const [focus, setFocus] = useState(null) // 결과 창에서 누른 위치 { id, n }
  const [busy, setBusy] = useState('') // 진행 중인 계산 이름 (단선도 위 요약 줄에 표시)
  const [result, setResult] = useState(null)
  const [simNote, setSimNote] = useState('') // 결과가 없거나 옛 결과인 이유 (계통 미완성 등)
  const [report, setReport] = useState(null)
  const [reportMessage, setReportMessage] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const [resultHistory, setResultHistory] = useState([])
  const [historyNote, setHistoryNote] = useState('') // 마지막 계산을 기록하지 않은 이유 (연결 안 된 설비 등)
  const [dailyNote, setDailyNote] = useState('') // 하루(24시간) 계산을 못 하는 이유 (진짜 백엔드에 아직 없음 등)
  // 가운데 창: 'ai' = AI 리포트 (위 오른쪽 버튼) | 'detail' = 결과 자세히 (AI 리포트 창 오른쪽 위 버튼) | null = 닫힘
  const [resultOpen, setResultOpen] = useState(null)
  const [resultTab, setResultTab] = useState('health')
  const [popup, setPopup] = useState(null) // 브라우저 새 창 결과 { win, container }
  const [dialog, setDialog] = useState(null) // 'new' | 'rename' | null
  const [message, setMessage] = useState({ text: '', kind: 'info' })

  // 마지막 요청의 결과만 표시하기 위한 번호 (변전소 선택·계산마다 증가)
  const runId = useRef(0)
  const history = useRef([]) // 되돌리기용 이전 계통들
  const editRev = useRef(0) // 편집할 때마다 1씩 증가. 저장하는 동안 또 편집했는지 확인용
  const graphRef = useRef(graph)
  graphRef.current = graph
  const simulatedKey = useRef(null) // 마지막으로 계산한 계통의 electricalKey
  const historyRef = useRef([]) // resultHistory의 최신 값 (기록을 새로 쌓을지 판단할 때 씀)
  historyRef.current = resultHistory
  const pointSeq = useRef(0) // 기록 점 번호 (하루 계산 결과를 나중에 그 점에 붙이려고)
  const dailyAvailable = useRef(null) // 백엔드에 하루 계산이 있는지: null 모름 | true | false
  const changeLabel = useRef('') // 기록에 남길 "바뀐 내용"

  const info = useCallback((text) => setMessage({ text, kind: 'info' }), [])
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

  // GET /api/health → { status: 'ok', neo4j: 'connected' | 'unavailable' | 'mock' } (backend/api/health.py)
  // 응답이 오면 서버는 연결, neo4j 값으로 DB 연결을 판단. 응답이 없으면 둘 다 알 수 없으므로 서버 끊김으로 표시
  const checkHealth = useCallback(() => {
    getHealth()
      .then((h) =>
        setHealth({
          server: true,
          db: h.neo4j === 'connected' ? true : h.neo4j === 'mock' ? 'mock' : false,
          detail: `서버 ${h.status} · Neo4j ${h.neo4j}`,
        }),
      )
      .catch((e) => setHealth({ server: false, db: null, detail: `백엔드에 연결할 수 없습니다 (${e.message})` }))
  }, [])

  useEffect(() => {
    checkHealth()
    refreshList()
    const t = setInterval(checkHealth, HEALTH_POLL_MS)
    return () => clearInterval(t)
  }, [checkHealth])

  function resetResult() {
    ++runId.current
    simulatedKey.current = null
    setResult(null)
    setSimNote('')
    setReport(null)
    setReportMessage('')
    setResultHistory([])
    historyRef.current = []
    setHistoryNote('')
  }

  // 기록 점 하나에 하루(24시간) 곡선을 붙인다. 시간이 걸리므로 기록은 먼저 쌓고 결과는 나중에 채운다.
  // 진짜 백엔드에 아직 이 주소가 없으면(404·405·501) 다시 부르지 않고 기록 탭에 이유를 보여 준다
  function loadDaily(g, pid) {
    runDaily(g.substation.id)
      .then((d) => {
        dailyAvailable.current = true
        setDailyNote('')
        const daily = dailyPoints(g, d.hours)
        setResultHistory((h) => h.map((p) => (p.id === pid ? { ...p, daily, profile: d.profile } : p)))
      })
      .catch((e) => {
        if ([404, 405, 501].includes(e.status)) {
          dailyAvailable.current = false
          setDailyNote('백엔드에 하루(24시간) 계산이 없어 편집 시점 값만 보여 줍니다. 최신 코드를 받아 백엔드(uvicorn)를 다시 켜 주세요')
        } else {
          setResultHistory((h) => h.map((p) => (p.id === pid ? { ...p, dailyError: describe(e) } : p)))
        }
      })
  }

  // ── 시뮬레이션: 서버(Neo4j)에 저장된 계통으로 계산한다. 결과가 오면 그래프도 다시 그린다 ──
  async function simulateNow(g, label) {
    const id = ++runId.current
    setBusy('계산 중...')
    let res
    try {
      res = await runSimulation(g.substation.id)
    } catch (e) {
      if (id !== runId.current) return
      // 미완성 계통(422) 등: 옛 결과는 지금 계통과 맞지 않으므로 지우고 이유를 보여 준다.
      // 마지막 계산 기록도 지워서, 다음 저장 때는 값이 같아 보여도 반드시 다시 계산한다
      // (예: 계산 성공 → 부하 추가로 실패 → 되돌리기로 원래대로 돌아왔을 때 계산을 건너뛰지 않게)
      simulatedKey.current = null
      setResult(null)
      setSimNote(`결과 없음: ${describe(e)}`)
      return
    } finally {
      if (id === runId.current) setBusy('')
    }
    if (id !== runId.current) return
    simulatedKey.current = electricalKey(g)
    setResult(res)
    setSimNote('')
    setReport(null)
    setReportMessage('')
    // 결과 기록(시점별)에는 계통이 다 이어진 상태의 계산만 남긴다. 노드를 놓기만 하고 아직 연결하지 않은 중간 단계,
    // 그리고 지표가 직전 기록과 똑같은 계산은 건너뛴다 (편집할 때마다 점이 쌓여 보기 불편하다는 팀 피드백)
    const dangling = findDangling(g)
    if (dangling.length) {
      const names = dangling.slice(0, 3).join(', ') + (dangling.length > 3 ? ` 외 ${dangling.length - 3}개` : '')
      setHistoryNote(`연결되지 않은 설비가 있어 기록하지 않았습니다: ${names}`)
    } else {
      setHistoryNote('')
      const point = historyPoint(g, res, label)
      const last = historyRef.current[historyRef.current.length - 1]
      if (!last || !sameHistoryValues(last, point)) {
        const pid = ++pointSeq.current
        historyRef.current = [...historyRef.current.slice(-RESULT_HISTORY_LIMIT + 1), { ...point, id: pid }]
        setResultHistory(historyRef.current)
        if (dailyAvailable.current !== false) loadDaily(g, pid)
      }
    }
  }

  // ── 자동 저장 ──
  // 편집이 멈추면 저장 → (계산 값이 바뀌었으면) 시뮬레이션. 저장하는 동안 또 편집하면 끝난 뒤 한 번 더 저장한다
  const flushing = useRef(false)
  const again = useRef(false)
  const flush = useCallback(async () => {
    if (flushing.current) {
      again.current = true
      return
    }
    flushing.current = true
    try {
      do {
        again.current = false
        const g = graphRef.current
        if (!g) break
        const rev = editRev.current
        setSave({ status: 'saving', text: '저장 중...' })
        let saved
        try {
          saved = await saveSubstation(g.substation.id, toSnapshot(g))
        } catch (e) {
          // 실패해도 편집은 화면에 남아 있다. 다음 편집 때 다시 저장을 시도한다
          // (진짜 백엔드는 전원이 1개가 아니면 422, 없는 변전소면 404 — cim/graph.py)
          setSave({ status: 'error', text: describe(e) })
          break
        }
        if (rev !== editRev.current) {
          again.current = true // 저장하는 동안 또 편집함: 서버 값으로 덮어쓰지 않고 다시 저장
          continue
        }
        // 서버(cim/graph.py의 _prepare_snapshot)가 선로 방향·feeder_id를 다시 계산하므로 서버 값이 기준이다
        setGraph(saved.graph)
        setDirty(false)
        setSave({ status: 'saved', text: '저장됨' })
        if (!substations.some((s) => s.id === saved.graph.substation.id && s.name === saved.graph.substation.name)) refreshList()
        const label = changeLabel.current || '편집'
        changeLabel.current = ''
        if (electricalKey(saved.graph) !== simulatedKey.current) await simulateNow(saved.graph, label)
      } while (again.current)
    } finally {
      flushing.current = false
    }
  }, [substations])

  useEffect(() => {
    if (!dirty || !graph) return undefined
    setSave((s) => (s.status === 'saving' ? s : { status: 'pending', text: '저장 대기...' }))
    const t = setTimeout(flush, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(t)
  }, [graph, dirty, flush])

  // 단선도·속성 패널에서 편집이 일어날 때마다 호출. label은 결과 기록의 "바뀐 내용"
  const onChange = useCallback((g, label = '편집') => {
    if (graphRef.current) history.current = [...history.current.slice(-HISTORY_LIMIT + 1), graphRef.current]
    editRev.current += 1
    changeLabel.current = changeLabel.current && changeLabel.current !== label ? '여러 곳 편집' : label
    setGraph(g)
    setDirty(true)
  }, [])

  async function loadSubstation(substationId) {
    resetResult()
    setSelectedIds([])
    history.current = []
    try {
      const g = await getSubstation(substationId)
      setGraph(g)
      setDirty(false)
      setSave({ status: 'saved', text: '저장됨' })
      simulateNow(g, '불러옴')
    } catch (e) {
      fail(`계통을 불러오지 못했습니다 (${e.message})`)
    }
  }

  // 아직 저장 안 된 편집이 있으면 먼저 저장하고 넘어간다 (자동 저장이라 묻지 않음)
  async function selectSubstation(substationId) {
    if (dirty && save.status === 'error' && !window.confirm(`저장되지 않은 편집이 있습니다 (${save.text}). 버리고 넘어갈까요?`)) return
    if (dirty) await flush()
    loadSubstation(substationId)
  }

  // 새 변전소 (프론트가 UUID 발급).
  // 진짜 백엔드(cim/graph.py의 save_substation)는 없는 변전소 id면 새로 만든다. 이때만 이름·단락용량 등 변전소 속성을 받고,
  // 그 뒤로는 이름만 바뀐다. 전원(source) 노드가 정확히 1개가 될 때까지는 저장이 422로 실패한다 (빈 계통이면 전원부터 놓기)
  async function createSubstation({ name, template, short_circuit_mva }) {
    setDialog(null)
    if (dirty) await flush()
    resetResult()
    const patch = { short_circuit_mva }
    const g = template === 'starter' ? starterGraph(name, patch) : updateSubstation(emptyGraph(name), patch)
    history.current = []
    editRev.current += 1
    changeLabel.current = '새 변전소'
    setGraph(g)
    setDirty(true)
    setSelectedIds([])
    setNavOpen(true)
    setTool('select')
    info(template === 'starter' ? '기본 구성으로 만들었습니다. 왼쪽 메뉴에서 부하를 끌어다 접속점 근처에 놓고 연결하세요' : '왼쪽 메뉴에서 전원부터 끌어다 놓으세요')
  }

  function renameSubstation(name) {
    setDialog(null)
    onChange(updateSubstation(graph, { name }), '변전소 이름 변경')
  }

  async function makeReport() {
    if (!result) return
    const id = runId.current
    setReportBusy(true)
    setReportMessage('AI 리포트 생성 중... (수 초~수십 초)')
    try {
      const r = await createReport(result)
      if (id === runId.current) setReport(r)
    } catch (e) {
      if (id === runId.current) setReportMessage(`AI 리포트 실패 (${e.message})`)
    } finally {
      setReportBusy(false)
    }
  }

  const onPropChange = useCallback((g) => onChange(g, '속성 변경'), [onChange])

  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return
    onChange(removeElements(graph, selectedIds), '삭제')
    setSelectedIds([])
  }, [graph, selectedIds, onChange])

  const undo = useCallback(() => {
    const prev = history.current.pop()
    if (!prev) return
    editRev.current += 1
    changeLabel.current = '되돌리기'
    setGraph(prev)
    setDirty(true)
  }, [])

  // 단축키: Delete 삭제, Ctrl+Z 되돌리기, Esc 선택 도구 (편집 메뉴가 열려 있을 때만, 입력칸에 쓰는 중에는 무시)
  useEffect(() => {
    if (!navOpen || dialog || resultOpen) return undefined
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
  }, [navOpen, dialog, resultOpen, deleteSelected, undo])

  // 저장이 안 끝났는데 창을 닫으려 하면 경고
  useEffect(() => {
    if (!dirty) return undefined
    const warn = (e) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // 결과 창의 ⌖ 버튼: 가운데 창이면 닫고 단선도에서 그 위치로 이동. 새 창이면 원래 창을 앞으로
  const focusElement = useCallback((id) => {
    setResultOpen(null)
    setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }))
    window.focus()
  }, [])

  function showPopup() {
    if (popup && !popup.win.closed) {
      popup.win.focus()
      return
    }
    const p = openPopup(`결과 · ${graph?.substation.name ?? ''}`)
    if (!p) {
      fail('새 창이 차단되었습니다. 주소창 오른쪽의 팝업 차단 아이콘에서 허용해 주세요')
      return
    }
    setResultOpen(null)
    setPopup(p)
  }
  const onPopupClosed = useCallback(() => setPopup(null), [])

  const isNew = graph && !substations.some((s) => s.id === graph.substation.id)

  const resultView = (
    <ResultView
      graph={graph}
      result={result}
      tab={resultTab}
      onTab={setResultTab}
      history={resultHistory}
      historyNote={historyNote}
      dailyNote={dailyNote}
      onFocus={focusElement}
    />
  )

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <button
            type="button"
            className={navOpen ? 'edit-btn on' : 'edit-btn'}
            disabled={!graph}
            onClick={() => {
              setNavOpen(!navOpen)
              setTool('select')
            }}
            aria-pressed={navOpen}
            title={graph ? (navOpen ? '편집을 마치고 메뉴 닫기' : '편집 메뉴 열기 (설비 추가·연결·삭제)') : '변전소를 먼저 고르세요'}
          >
            {/* 연필 아이콘: 이 버튼이 '편집'이라는 걸 바로 알 수 있게 (예전 ☰ 메뉴 아이콘 대신) */}
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
            {navOpen ? '편집 중' : '편집'}
          </button>
          <div>
            <h1>배전계통 통합 분석 플랫폼</h1>
            <button type="button" className="conn" onClick={checkHealth} title={`${health.detail}\n누르면 다시 확인 (${HEALTH_POLL_MS / 1000}초마다 자동 확인)`}>
              <span className={`conn-item ${health.server === null ? 'wait' : health.server ? 'on' : 'off'}`}>
                <i />
                서버
              </span>
              <span className={`conn-item ${health.server === false ? 'unknown' : health.db === null ? 'wait' : health.db === false ? 'off' : 'on'}`}>
                <i />
                DB{health.db === 'mock' ? ' (모의)' : ''}
              </span>
            </button>
          </div>
        </div>
        <div className="actions">
          <button
            type="button"
            className="ai-btn"
            disabled={!result}
            onClick={() => setResultOpen('ai')}
            title={result ? 'AI 리포트 보기 (오른쪽 위 "결과 자세히"에서 표·그래프)' : '계산 결과가 나오면 열 수 있습니다'}
          >
            AI 리포트
          </button>
          <div className="sub-picker">
            <select value={isNew ? '' : (graph?.substation.id ?? '')} onChange={(e) => selectSubstation(e.target.value)}>
              <option value="" disabled>
                {isNew ? `${graph.substation.name} (저장 전)` : '변전소 선택'}
              </option>
              {substations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button type="button" className="icon-btn" disabled={!graph} onClick={() => setDialog('rename')} title="변전소 이름 바꾸기" aria-label="변전소 이름 바꾸기">
              ✎
            </button>
          </div>
          <button type="button" onClick={() => setDialog('new')}>
            + 새 변전소
          </button>
          {graph && (
            <button
              type="button"
              className={`save-state ${save.status}`}
              onClick={() => save.status === 'error' && flush()}
              title={save.status === 'error' ? `저장 실패: ${save.text}\n누르면 다시 시도` : '바꿀 때마다 자동으로 저장됩니다'}
            >
              <i />
              {save.status === 'error' ? '저장 실패' : save.text || '자동 저장'}
            </button>
          )}
        </div>
      </header>

      {message.text && (
        <div className={`toast ${message.kind}`} role="status">
          <span>{message.text}</span>
          <button type="button" onClick={() => info('')} aria-label="닫기">
            ✕
          </button>
        </div>
      )}

      <div className={navOpen ? 'workspace nav-open' : 'workspace'}>
        <NavDrawer
          open={navOpen}
          tool={tool}
          onTool={(t) => {
            setTool(t)
            info('')
          }}
          onUndo={undo}
          canUndo={history.current.length > 0}
          onDelete={deleteSelected}
          canDelete={selectedIds.length > 0}
          onClose={() => {
            setNavOpen(false)
            setTool('select')
          }}
        />
        <Diagram
          graph={graph}
          result={result}
          editing={navOpen}
          tool={tool}
          mode={mode}
          focus={focus}
          onChange={onChange}
          onSelect={setSelectedIds}
          onMessage={info}
        >
          {/* 단선도 위에 겹쳐 띄우는 것들 (위: 결과 요약 줄, 오른쪽 위: 표시 모드, 왼쪽 아래: 범례) */}
          {graph && (
            <div className="ov-top">
              <SummaryStrip
                graph={graph}
                result={result}
                note={save.status === 'error' ? `저장 실패: ${save.text}` : simNote}
                busy={busy}
                onRerun={() => simulateNow(graph, '다시 계산')}
              />
              {result && (
                <div className="seg">
                  {/* 4대 시뮬레이션 모드 (제안서 슬라이드 8) + 건강도 (슬라이드 10) */}
                  {MODES.map(([k, label]) => (
                    <button key={k} type="button" className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {result && (
            <div className="ov-bottom">
              <Legend mode={mode} />
            </div>
          )}
        </Diagram>
        {/* 속성은 편집 메뉴를 열지 않아도 고칠 수 있다 (자동 저장) */}
        <PropertyPanel graph={graph} selectedIds={selectedIds} result={result} editing={!!graph} onChange={onPropChange} />
      </div>

      {resultOpen === 'ai' && (
        <Modal
          title={`AI 리포트 · ${graph?.substation.name ?? ''}`}
          wide
          onClose={() => setResultOpen(null)}
          actions={
            <button type="button" className="mini primary-outline" onClick={() => setResultOpen('detail')}>
              결과 자세히 →
            </button>
          }
        >
          <AiReportView graph={graph} result={result} report={report} reportMessage={reportMessage} reportBusy={reportBusy} onMakeReport={makeReport} />
        </Modal>
      )}
      {resultOpen === 'detail' && (
        <Modal
          title={`결과 자세히 · ${graph?.substation.name ?? ''}`}
          wide
          onClose={() => setResultOpen(null)}
          actions={
            <>
              <button type="button" className="mini" onClick={() => setResultOpen('ai')}>
                ← AI 리포트
              </button>
              <button type="button" className="mini" onClick={showPopup}>
                새 창으로 ↗
              </button>
            </>
          }
        >
          {resultView}
        </Modal>
      )}
      {popup && (
        <PopupWindow popup={popup} onClosed={onPopupClosed}>
          <div className="popup-wrap">
            <h2 className="popup-title">결과 · {graph?.substation.name ?? ''}</h2>
            {resultView}
          </div>
        </PopupWindow>
      )}

      {dialog === 'new' && <NewSubstationDialog onCreate={createSubstation} onClose={() => setDialog(null)} />}
      {dialog === 'rename' && graph && <RenameDialog current={graph.substation.name} onRename={renameSubstation} onClose={() => setDialog(null)} />}
    </div>
  )
}
