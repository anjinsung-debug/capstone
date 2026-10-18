// 시뮬레이션 결과 화면 (제안서 3·5단계). 구성은 오프라인 미팅 자료(제안서 슬라이드 8, 10~13) 기준
// - Legend: 단선도 안 왼쪽 아래 범례 (표시 모드마다 슬라이드 8의 구간·색)
// - SummaryStrip: 단선도 위 요약 줄 = 변전소 계통 전체에서 항목별 가장 나쁜 값 4개 + 모든 피더 송출 합계
// - AiReportView: 위 오른쪽 "AI 리포트" 버튼으로 여는 창. 진단·원인·솔루션 해설을 한 화면에 모아 보여 주고, 창 오른쪽 위 "결과 자세히"로 ResultView로 넘어간다
// - ResultView: 결과 창 (가운데 창 또는 브라우저 새 창에 같은 내용). 슬라이드 12의 활용 흐름 순서대로 탭:
//     ① 건강도 진단 '어디가 문제인가?' → ② 원인 분석 '왜 발생했는가?' → ③ 솔루션 제언 '어떻게 해결할까?'
//     + 요소별 결과(모든 설비·선로 값), 기록(시점별)
// AI 리포트(ai_report/models.py의 Report: diagnosis, causes, solutions)는 AiReportView에만 보여 준다 (결과 탭에는 없음, 팀 피드백).
// 형식이 바뀌면 AiReportView를 고친다. 원인 분석 탭 그래프는 ProfileChart.jsx가 그린다 (전압 프로파일 + 선로 조류)
import { useState } from 'react'
import NodeIcon from './NodeIcon.jsx'
import HistoryChart from './HistoryChart.jsx'
import ProfileCharts from './ProfileChart.jsx'
import {
  CAUSE_QUESTIONS,
  COLORS,
  LEGENDS,
  LEVELS,
  SOLUTION_CANDIDATES,
  elementRows,
  healthCheck,
  lineWidth,
} from '../lib/overlay.js'

export function Legend({ mode }) {
  return (
    <div className="legend">
      {LEGENDS[mode].map(([label, color]) => (
        <span key={label}>
          <i style={{ background: color }} />
          {label}
        </span>
      ))}
      <span>
        <i style={{ background: COLORS.feeder }} />
        피더 송출
      </span>
      {(mode === 'loading' || mode === 'health') && (
        <span className="legend-width" title="선 굵기 = 부하율 (허용전류 정보가 없으면 400 A 가정)">
          {[0, 50, 100].map((p) => (
            <em key={p}>
              <i style={{ height: lineWidth(p) }} />
              {p}%
            </em>
          ))}
          <small>부하율</small>
        </span>
      )}
    </div>
  )
}

function LevelBadge({ level }) {
  return (
    <span className={`badge ${level}`} style={{ color: LEVELS[level].color, borderColor: LEVELS[level].color }}>
      {LEVELS[level].label}
    </span>
  )
}

// 단선도 위 요약 줄. 결과가 없으면 왜 없는지(계산 중, 계통 미완성 등) 보여 준다
// 요약 줄 이름: 결과 창의 진단표(healthCheck rows)와 같은 값이지만, 계통 전체의 최악값이라는 걸 이름에 드러낸다
// 값은 모두 변전소 계통 전체(모든 피더)에서 가장 나쁜 지점이다. 위치는 마우스를 올리면 보인다
const STRIP_LABELS = { voltage: '전압', loading: '부하율', reverse: '역조류', fault: '단락용량', outage: '정전' }

export function SummaryStrip({ graph, result, note, busy, onRerun }) {
  if (!result) {
    return (
      <div className="strip">
        <span className={note ? 'strip-note warn' : 'strip-note'}>{busy || note || '계통을 고치면 자동 저장되고 결과가 다시 계산됩니다'}</span>
        {graph && !busy && (
          <button type="button" className="mini" onClick={onRerun}>
            다시 계산
          </button>
        )}
      </div>
    )
  }
  const hc = healthCheck(graph, result)
  const chips = hc.rows.filter((r) => r.key !== 'outage' || r.level !== 'ok')
  return (
    <div className="strip">
      <span className="overall" style={{ color: LEVELS[hc.overall].color }} title={`${graph.substation.name} 계통 전체(피더 ${result.feeders.length}개)에서 항목마다 가장 나쁜 값으로 판정합니다`}>
        ● 전체 계통 {LEVELS[hc.overall].label}
      </span>
      {chips.map((r) => (
        <span key={r.key} className="kv" title={r.whereName ? `전체 계통에서 가장 나쁜 곳: ${r.whereName} (기준 ${r.standard})` : `기준 ${r.standard}`}>
          {STRIP_LABELS[r.key]} <b style={{ color: r.level === 'ok' ? undefined : LEVELS[r.level].color }}>{r.key === 'fault' && r.worst != null ? `${r.worst.toFixed(0)} MVA` : r.worstText}</b>
        </span>
      ))}
      <span className="kv" title={`피더 ${result.feeders.length}개의 송출 전력 합계`}>
        총 송출 <b className="feeder">{hc.totalMw.toFixed(2)}</b> MW
      </span>
      {(busy || note) && <span className={note ? 'strip-note warn' : 'strip-note'}>{busy || note}</span>}
    </div>
  )
}

function FocusBtn({ id, onFocus, label }) {
  if (!id) return null
  return (
    <button type="button" className={label ? 'chip' : 'focus-btn'} onClick={() => onFocus(id)} title="단선도에서 이 위치로 이동">
      ⌖{label ? ` ${label}` : ''}
    </button>
  )
}

function ReportBox({ title, report, children, reportMessage, reportBusy, onMakeReport }) {
  return (
    <div className="ai-box">
      <div className="ai-head">
        <b>{title}</b>
        <button type="button" className="mini primary-outline" disabled={reportBusy} onClick={onMakeReport}>
          {reportBusy ? '만드는 중...' : report ? '지금 결과로 다시 만들기' : 'AI 해설 만들기'}
        </button>
      </div>
      {report ? children : <p className="muted small">{reportMessage || 'LLM 호출은 비용·시간이 들어서 자동으로 만들지 않습니다. 버튼을 누르면 ①②③ 해설이 한 번에 만들어집니다.'}</p>}
    </div>
  )
}

// ① 계통건강도 진단 (슬라이드 10·13): 진단표 + 피더 송출 + LLM 요약
function HealthTab({ graph, result, onFocus }) {
  const hc = healthCheck(graph, result)
  const feederName = (id) => graph.feeders.find((f) => f.id === id)?.name ?? id
  return (
    <>
      <p className="lead">
        여러 시뮬레이션 결과를 하나로 묶어 <b>어디가 문제인지</b> 보여 줍니다. 계통 전체 판정: <LevelBadge level={hc.overall} />
      </p>
      <table className="rtable health">
        <thead>
          <tr>
            <th>항목</th>
            <th>기준</th>
            <th className="num">최악 값</th>
            <th>위치</th>
            <th className="num">해당</th>
            <th>판정</th>
          </tr>
        </thead>
        <tbody>
          {hc.rows.map((r) => (
            <tr key={r.key} className={r.level === 'ok' ? '' : r.level}>
              <td>{r.label}</td>
              <td className="muted">{r.standard}</td>
              <td className="num">
                <b>{r.worstText}</b>
              </td>
              <td>{r.whereId ? <FocusBtn id={r.whereId} onFocus={onFocus} label={r.whereName} /> : '-'}</td>
              <td className="num">{r.count ? `${r.count}곳` : '-'}</td>
              <td>
                <LevelBadge level={r.level} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        판정 기준은 제안서 예시값입니다 (전압 0.90 미만·1.10 초과는 &lsquo;위험&rsquo;으로 팀이 가정). 한전 자문 후 lib/overlay.js에서 고칩니다.
      </p>
      <div className="cards">
        {result.feeders.map((f) => (
          <div className="card feeder" key={f.feeder_id}>
            <span>{feederName(f.feeder_id)} 송출</span>
            <b>
              {(f.p_kw / 1000).toFixed(2)} MW / {(f.q_kvar / 1000).toFixed(2)} MVAr
            </b>
          </div>
        ))}
        <div className="card">
          <span>선로 손실</span>
          <b>{result.loss_kw.toFixed(1)} kW</b>
        </div>
      </div>
    </>
  )
}

// ② 물리적 원인 분석 (슬라이드 11·13): 관측 현상 → (LLM) 물리적 원인 → 계통 영향, LLM이 함께 보는 정보(전압 프로파일·선로 부하)
function CauseTab({ graph, result, onFocus }) {
  const hc = healthCheck(graph, result)
  return (
    <>
      <p className="lead">
        이상 위치를 넘어 <b>왜 발생했는지</b> 봅니다. 관측 현상은 시뮬레이션 값입니다. 물리적 원인에 대한 AI 해설은 위 오른쪽 &ldquo;AI 리포트&rdquo;에서 봅니다.
      </p>
      {hc.problems.length === 0 ? (
        <p className="ok">주의·위험 항목이 없습니다.</p>
      ) : (
        <div className="cause-list">
          {hc.problems.map((r) => (
            <div key={r.key} className="cause" style={{ borderColor: LEVELS[r.level].color }}>
              <div className="cause-obs">
                <small>관측 현상</small>
                <b style={{ color: LEVELS[r.level].color }}>
                  {r.problem} {r.key === 'fault' ? `${r.worst.toFixed(0)} MVA` : r.worstText}
                </b>
                <FocusBtn id={r.whereId} onFocus={onFocus} label={r.whereName} />
                {r.count > 1 && <small className="muted">외 {r.count - 1}곳</small>}
              </div>
              <span className="arrow">→</span>
              <div className="cause-q">
                <small>함께 볼 정보</small>
                <span>{CAUSE_QUESTIONS[r.key]}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <h3 className="sub">LLM이 함께 보는 정보: 전압 프로파일 · 선로 부하 · 전력 흐름</h3>
      <ProfileCharts graph={graph} result={result} />
    </>
  )
}

// ③ 엔지니어링 솔루션 제언 (슬라이드 12): 문제별 대안 후보·기대 효과 + LLM 제언
function SolutionTab({ graph, result }) {
  const hc = healthCheck(graph, result)
  return (
    <>
      <p className="lead">
        진단·원인 분석을 바탕으로 <b>어떻게 해결할지</b> 운전 조치부터 설비 보강까지 대안을 제시합니다.
      </p>
      {hc.problems.length > 0 && (
        <>
          <h3 className="sub">참고: 제안서의 문제별 대안 후보 (발견된 문제만)</h3>
          <table className="rtable">
            <thead>
              <tr>
                <th>문제</th>
                <th>대안 후보</th>
                <th>기대 효과</th>
              </tr>
            </thead>
            <tbody>
              {hc.problems.map((r) => (
                <tr key={r.key}>
                  <td>
                    <b style={{ color: LEVELS[r.level].color }}>{SOLUTION_CANDIDATES[r.key].problem}</b>
                  </td>
                  <td>
                    {SOLUTION_CANDIDATES[r.key].candidates.map((c, i) => (
                      <div key={c}>
                        {'①②③'[i]} {c}
                      </div>
                    ))}
                  </td>
                  <td>{SOLUTION_CANDIDATES[r.key].effect}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="flow">
        {['시뮬레이션', '건강도 진단', '원인 분석', '대안 제시', '엔지니어 검토'].map((s, i) => (
          <span key={s}>
            {i > 0 && <i>→</i>}
            {s}
          </span>
        ))}
      </div>
    </>
  )
}

const STATE_TEXT = { normal: '정상', low: '전압 저하', high: '전압 상승', outage: '정전', none: '-' }

function ElementsTab({ graph, result, onFocus }) {
  const [only, setOnly] = useState(false)
  const [group, setGroup] = useState('node')
  const rows = elementRows(graph, result)
  const list = (group === 'node' ? rows.nodes : rows.lines).filter((r) => !only || r.problem)
  const problemCount = [...rows.nodes, ...rows.lines].filter((r) => r.problem).length
  return (
    <>
      <div className="filters">
        <div className="seg">
          <button type="button" className={group === 'node' ? 'on' : ''} onClick={() => setGroup('node')}>
            설비 {rows.nodes.length}
          </button>
          <button type="button" className={group === 'line' ? 'on' : ''} onClick={() => setGroup('line')}>
            선로 {rows.lines.length}
          </button>
        </div>
        <label className="field checkbox">
          <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />
          <span>문제만 보기 (전체 {problemCount}건)</span>
        </label>
      </div>
      {list.length === 0 ? (
        <p className="muted">표시할 항목이 없습니다.</p>
      ) : group === 'node' ? (
        <table className="rtable">
          <thead>
            <tr>
              <th />
              <th>종류</th>
              <th>이름</th>
              <th className="num">① 전압 (pu)</th>
              <th className="num">④ 단락전류 (kA)</th>
              <th className="num">④ 단락용량 (MVA)</th>
              <th className="num">출력</th>
              <th>판정</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className={r.problem ? 'warn' : ''}>
                <td>
                  <FocusBtn id={r.id} onFocus={onFocus} />
                </td>
                <td>
                  <NodeIcon type={r.type} size={13} /> {r.typeLabel}
                </td>
                <td>{r.name}</td>
                <td className="num" style={{ color: r.voltageColor ?? undefined }}>
                  {r.voltage == null ? '-' : r.voltage.toFixed(4)}
                </td>
                <td className="num">{r.fault == null ? '-' : r.fault.toFixed(2)}</td>
                <td className="num">{r.mva == null ? '-' : r.mva.toFixed(0)}</td>
                <td className="num">{r.power || '-'}</td>
                <td>
                  <span className="state" style={{ color: r.problem ? COLORS.orange : COLORS.green }}>
                    {STATE_TEXT[r.state]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="rtable">
          <thead>
            <tr>
              <th />
              <th>종류</th>
              <th>이름</th>
              <th className="num">③ 유효전력 (kW)</th>
              <th className="num">무효전력 (kvar)</th>
              <th className="num">② 부하율 (%)</th>
              <th>판정</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className={r.problem ? 'warn' : ''}>
                <td>
                  <FocusBtn id={r.id} onFocus={onFocus} />
                </td>
                <td>{r.typeLabel}</td>
                <td>{r.name}</td>
                <td className="num" style={{ color: r.reverse ? COLORS.red : undefined }}>
                  {r.p == null ? '-' : r.p.toFixed(0)}
                </td>
                <td className="num">{r.q == null ? '-' : r.q.toFixed(0)}</td>
                <td className="num" style={{ color: r.loading == null ? undefined : r.loadingColor }}>
                  {r.loading == null ? '-' : r.loading.toFixed(1)}
                </td>
                <td>
                  <span className="state" style={{ color: r.problem ? COLORS.red : COLORS.green }}>
                    {r.problem || '정상'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

export const RESULT_TABS = [
  ['health', '① 건강도 진단'],
  ['cause', '② 원인 분석'],
  ['solution', '③ 솔루션 제언'],
  ['elements', '요소별 결과'],
  ['history', '기록 (시점별)'],
]

// 결과 창 내용. 가운데 창과 새 창이 같은 컴포넌트를 쓴다
export function ResultView({ graph, result, tab, onTab, history, historyNote, dailyNote, onFocus }) {
  return (
    <div className="rview">
      <nav className="tabs">
        {RESULT_TABS.map(([k, label]) => (
          <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => onTab(k)}>
            {label}
            {k === 'history' && history.length > 0 && <small> {history.length}</small>}
          </button>
        ))}
      </nav>
      <div className="tab-body">
        {!result && tab !== 'history' ? (
          <p className="muted">결과가 없습니다. 계통이 완성되면 자동으로 계산됩니다.</p>
        ) : tab === 'health' ? (
          <HealthTab graph={graph} result={result} onFocus={onFocus} />
        ) : tab === 'cause' ? (
          <CauseTab graph={graph} result={result} onFocus={onFocus} />
        ) : tab === 'solution' ? (
          <SolutionTab graph={graph} result={result} />
        ) : tab === 'elements' ? (
          <ElementsTab graph={graph} result={result} onFocus={onFocus} />
        ) : (
          <>
            {historyNote && <p className="muted history-note">{historyNote}</p>}
            {dailyNote && <p className="muted history-note">{dailyNote}</p>}
            <HistoryChart points={history} />
          </>
        )}
      </div>
    </div>
  )
}

// AI 리포트 창 (위 오른쪽 "AI 리포트" 버튼). ai_report/models.py의 Report(diagnosis, causes, solutions)를 한 화면에 모은다.
// 수치·표는 창 오른쪽 위 "결과 자세히"(ResultView)에서 본다
export function AiReportView({ graph, result, report, reportMessage, reportBusy, onMakeReport }) {
  if (!result) return <p className="muted">결과가 없습니다. 계통이 완성되면 자동으로 계산됩니다.</p>
  const hc = healthCheck(graph, result)
  return (
    <div className="ai-report">
      <p className="lead">
        시뮬레이션 결과를 AI가 쉬운 말로 풀어 줍니다. 계통 전체 판정: <LevelBadge level={hc.overall} />
        {hc.problems.length > 0 && <span className="muted"> · 확인할 항목 {hc.problems.map((r) => r.label).join(', ')}</span>}
      </p>
      <ReportBox title="AI 리포트" report={report} reportMessage={reportMessage} reportBusy={reportBusy} onMakeReport={onMakeReport}>
        <section className="ai-sec">
          <h4>① 건강도 진단 · 어디가 문제인가?</h4>
          <p>{report?.diagnosis}</p>
        </section>
        <section className="ai-sec">
          <h4>② 원인 분석 · 왜 발생했는가?</h4>
          <ul>
            {report?.causes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
        <section className="ai-sec">
          <h4>③ 솔루션 제언 · 어떻게 해결할까?</h4>
          <ol>
            {report?.solutions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
        </section>
      </ReportBox>
      <p className="muted small">AI 해설은 참고용입니다. 판정 등급과 수치는 화면이 기준으로 계산한 값이며, 표와 그래프는 오른쪽 위 &ldquo;결과 자세히&rdquo;에서 볼 수 있습니다.</p>
    </div>
  )
}
