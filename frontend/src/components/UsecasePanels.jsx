// 유스케이스 화면 (한승우 시나리오 문서, 11/4). 담당: 최민준 (frontend·ai_report)
// - HostingPanel: 유스케이스 1 "신규 태양광 연계 검토" ②가능량 ③막히는 원인 ④신청 용량 붙여 보기(전후 비교) ⑤AI 추천
//     + 차장님 요청 "태양광 들어오기 전과 후 비교" (분산전원 전체 연결 전후)
// - DailyAiBox: 유스케이스 2 ⑥ "AI 운영 권고" (고른 날 24시간 결과 → 시간대별 위험과 대비 조치)
// - ReinforceBox: 유스케이스 3 "설비 보강 우선순위" (여러 날 24시간 결과 → 선로 순위 → AI 정리)
// 계산은 진짜 백엔드(simulation/der.py, simulation/daily.py)가 하고, 이 화면은 결과를 보여 주기만 한다.
// AI 문장은 ai_report/report.py가 만든다 (전문가용 설명: 이 화면들은 한전 담당자용이라 용어를 그대로 씀, 11/4). 모의 백엔드에는 이 주소들이 없다 (진짜 백엔드로 확인)
import { useCallback, useEffect, useState } from 'react'
import {
  createDailyReport,
  createHostingReport,
  createReinforcementReport,
  runDerComparison,
  runHostingCapacity,
  runPvTrial,
} from '../api/client.js'
import { LEVELS } from '../lib/overlay.js'

const SEARCH_MAX_KW = 20000 // simulation/der.py의 MAX_SEARCH_KW (검토 상한)

// 화면을 닫거나 다른 탭에 갔다 와도 마지막 결과가 남도록 값을 컴포넌트 밖(모듈)에 둔다 (새로고침하면 지워짐).
// 계산 중에 창을 닫아도 응답이 오면 여기에 저장되고, 다시 열면 그대로 보인다.
// ponytail: 변전소 id를 키에 넣어 변전소마다 따로 둔다. 다른 사람과 공유하거나 새로고침 뒤에도 남겨야 하면 App 상태나 localStorage로 옮긴다
const store = new Map()
const listeners = new Set()
function usePersisted(key, initial) {
  const [, rerender] = useState(0)
  useEffect(() => {
    const f = () => rerender((n) => n + 1)
    listeners.add(f)
    return () => listeners.delete(f)
  }, [])
  const value = store.has(key) ? store.get(key) : initial
  const set = useCallback(
    (v) => {
      store.set(key, typeof v === 'function' ? v(store.has(key) ? store.get(key) : initial) : v)
      listeners.forEach((f) => f())
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  return [value, set]
}

const fmtKw = (v) => `${Math.round(v).toLocaleString('ko-KR')} kW`

// simulation/der.py의 DerSummary 항목 (ai_report/report.py의 _SUMMARY_ROWS와 같은 순서)
const SUMMARY_ROWS = [
  ['분산전원 출력 합', 'der_kw', (v) => fmtKw(v)],
  ['피더 송출 합 (음수면 역송)', 'feeder_kw', (v) => fmtKw(v)],
  ['선로 손실', 'loss_kw', (v) => `${v.toFixed(1)} kW`],
  ['최저 전압', 'min_voltage_pu', (v) => `${v.toFixed(3)} pu`],
  ['최고 전압', 'max_voltage_pu', (v) => `${v.toFixed(3)} pu`],
  ['최대 선로 부하율', 'max_loading_pct', (v) => `${v.toFixed(0)}%`],
  ['역조류 선로 수', 'reverse_flow_lines', (v) => `${v}개`],
  ['최대 고장전류', 'max_fault_ka', (v) => `${v.toFixed(2)} kA`],
]

function CompareTable({ before, after, left, right }) {
  return (
    <table className="rtable">
      <thead>
        <tr>
          <th>항목</th>
          <th className="num">{left}</th>
          <th className="num">{right}</th>
        </tr>
      </thead>
      <tbody>
        {SUMMARY_ROWS.map(([label, key, fmt]) => (
          <tr key={key} className={before[key] !== after[key] ? 'hl' : ''}>
            <td>{label}</td>
            <td className="num">{fmt(before[key])}</td>
            <td className="num">
              <b>{fmt(after[key])}</b>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// 이름 찾기 (노드·선로·피더)
function namer(graph) {
  const m = {}
  for (const x of [...graph.nodes, ...graph.lines, ...graph.feeders]) m[x.id] = x.name
  return (id) => m[id] ?? id
}

// simulation/der.py의 Violation 하나 → 문장 + 단선도에서 볼 요소 id (차단기는 그 피더의 차단기 노드)
function describeViolation(graph, v) {
  const name = namer(graph)(v.element_id)
  if (v.kind === 'overload') {
    const line = graph.lines.find((l) => l.id === v.element_id)
    const now = line?.rated_current_a != null ? `${Math.round(line.rated_current_a)} A` : '400 A (가정값)'
    const need = v.required_rated_current_a ? ` → 허용전류 ${Math.ceil(v.required_rated_current_a).toLocaleString('ko-KR')} A 이상 필요` : ''
    const pct = v.value < v.limit + 1 ? v.value.toFixed(2) : v.value.toFixed(0) // 100.02%가 "100%"로 보여 기준 안처럼 읽히지 않게
    return { id: v.element_id, text: `${name}: 선로 과부하 ${pct}% (기준 ${v.limit}% 초과), 지금 허용전류 ${now}${need}` }
  }
  if (v.kind === 'overvoltage') {
    return { id: v.element_id, text: `${name}: 접속점 과전압 ${v.value.toFixed(3)} pu (기준 ${v.limit} pu 초과)` }
  }
  const cb = graph.nodes.find((n) => n.type === 'breaker' && n.feeder_id === v.element_id)
  return { id: cb?.id ?? null, text: `${name}: 출구 차단기 차단 불가, 고장전류 ${v.value.toFixed(2)} kA > 정격 ${v.limit} kA (가정값)` }
}

function ViolationList({ graph, items, onFocus }) {
  return (
    <ul className="uc-list">
      {items.map((v, i) => {
        const d = describeViolation(graph, v)
        return (
          <li key={i}>
            {d.text}{' '}
            {d.id && onFocus && (
              <button type="button" className="focus-btn" onClick={() => onFocus(d.id)} title="단선도에서 이 위치로 이동">
                ⌖
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// AI 리포트(ai_report/models.py의 Report)를 AI 리포트 창과 같은 카드 모양으로
function ReportCards({ report, titles }) {
  const [t1, t2, t3] = titles
  return (
    <div className="rp-body">
      {[
        ['1', t1, <p key="d">{report.diagnosis}</p>],
        ['2', t2, <ol key="c" className="rp-list">{report.causes.map((c, i) => <li key={i}>{c}</li>)}</ol>],
        ['3', t3, <ol key="s" className="rp-list solution">{report.solutions.map((c, i) => <li key={i}>{c}</li>)}</ol>],
      ].map(([no, title, body]) => (
        <section key={no} className="rp-card">
          <header className="rp-card-head">
            <span className="rp-no">{no}</span>
            <div>
              <h4>{title}</h4>
            </div>
          </header>
          {body}
        </section>
      ))}
    </div>
  )
}

function Busy({ text }) {
  return (
    <div className="rp-state">
      <span className="spinner" aria-hidden="true" />
      <div>
        <b>{text}</b>
      </div>
    </div>
  )
}

function Fail({ error }) {
  if (!error) return null
  return (
    <div className="rp-state error">
      <b>실패했습니다</b>
      <small>{error}</small>
    </div>
  )
}

const atLabel = (at) => (at ? `${at.date} ${at.hour}시 기준` : '최대 조건 기준')

// ── 유스케이스 1: 신규 태양광 연계 검토 ──
// at = { date, hour } | null: 지금 결과를 계산한 시각 (App의 resultAt). 연계 검토도 같은 시각으로 계산한다
export function HostingPanel({ graph, at, onFocus }) {
  const buses = graph.nodes.filter((n) => n.type === 'bus')
  const sid = graph.substation.id
  const k = (name) => `hosting:${sid}:${name}`
  const [busId, setBusId] = usePersisted(k('bus'), buses[buses.length - 1]?.id ?? '')
  const [targetKw, setTargetKw] = usePersisted(k('kw'), '3000')
  // 결과마다 계산한 조건(접속점·용량·시각)을 같이 둔다. 다른 접속점을 고르기만 해서는 안 바뀌고, 버튼을 눌러야 새 결과로 바뀐다
  const [hosting, setHosting] = usePersisted(k('hosting'), null) // { data, bus, kw, at }
  const [trial, setTrial] = usePersisted(k('trial'), null) // { data, at }
  const [der, setDer] = usePersisted(k('der'), null) // { data, at }
  const [report, setReport] = usePersisted(k('report'), null)
  const [busy, setBusy] = usePersisted(k('busy'), '')
  const [error, setError] = usePersisted(k('error'), '')
  // 변전소를 바꾸거나 고른 접속점이 지워지면 마지막 접속점(보통 말단)으로
  const busKey = buses.map((b) => b.id).join(',')
  useEffect(() => {
    if (!buses.some((b) => b.id === busId)) setBusId(buses[buses.length - 1]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busKey])

  const kw = Number(targetKw)
  const validKw = Number.isFinite(kw) && kw > 0

  async function run(label, fn) {
    setBusy(label)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  // 새로 확인하면 그 접속점의 이전 붙여 보기·AI 추천은 다른 조건이라 지운다
  const check = () =>
    run('연계 가능량 계산 중... (수 초)', async () => {
      const data = await runHostingCapacity(sid, busId, validKw ? kw : null, at)
      setHosting({ data, bus: busId, kw: validKw ? kw : null, at })
      setTrial(null)
      setReport(null)
    })
  const tryPv = () => run('신청 용량을 붙여 계산 중...', async () => setTrial({ data: await runPvTrial(sid, busId, kw, at), at }))
  const compareAll = () => run('분산전원 연결 전후 계산 중...', async () => setDer({ data: await runDerComparison(sid, at), at }))
  const recommend = () =>
    run('AI가 추천을 쓰고 있습니다... (수 초~수십 초)', async () =>
      setReport(
        await createHostingReport(
          {
            substation_id: sid,
            hosting: hosting.data,
            // 붙여 보기는 같은 접속점일 때만 같이 보낸다
            trial_before: trial?.data.bus_id === hosting.bus ? trial.data.before : null,
            trial_after: trial?.data.bus_id === hosting.bus ? trial.data.after : null,
            der_before: der?.data.before ?? null,
            der_after: der?.data.after ?? null,
          },
          hosting.at,
        ),
      ),
    )

  const h = hosting?.data
  const targetOk = h && h.target_kw != null ? h.target_violations.length === 0 : null
  const busName = namer(graph)

  return (
    <div className="uc-panel">
      <p className="lead">
        고객이 접속점에 태양광을 붙이고 싶을 때 <b>얼마까지 되는지, 무엇 때문에 안 되는지, 무엇을 보강하면 되는지</b> 봅니다. ({atLabel(at)}, 기준: 접속점 전압 1.05 pu
        이하·선로 부하율 100% 이하·출구 차단기 차단 가능. 역조류 자체는 문제 아님)
      </p>

      <div className="uc-controls">
        <label className="field">
          접속점
          <select value={busId} onChange={(e) => setBusId(e.target.value)} disabled={!!busy}>
            {buses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          신청 용량 (kW)
          <span className="field-input">
            <input type="number" min="0" step="100" value={targetKw} onChange={(e) => setTargetKw(e.target.value)} disabled={!!busy} />
            <i>kW</i>
          </span>
        </label>
        <button type="button" className="primary" disabled={!!busy || !busId} onClick={check}>
          연계 가능량 확인
        </button>
        <button type="button" className="mini" disabled={!!busy || !busId || !validKw} onClick={tryPv}>
          신청 용량 붙여 보기
        </button>
      </div>

      {busy && <Busy text={busy} />}
      <Fail error={error} />

      {h && (
        <section className="uc-result">
          <p className="muted small">
            마지막 확인: {busName(hosting.bus)} · {hosting.kw != null ? `신청 ${fmtKw(hosting.kw)}` : '신청 용량 없음'} · {atLabel(hosting.at)}
          </p>
          <h4>
            {h.limited_by.length === 0 && h.max_kw >= SEARCH_MAX_KW
              ? `${fmtKw(SEARCH_MAX_KW)} 이상 가능 (검토 상한까지 기준 안)`
              : h.max_kw <= 0
                ? '더 붙일 수 없음 (지금 계통이 이미 기준을 넘음)'
                : `최대 ${fmtKw(h.max_kw)}까지 더 붙일 수 있음`}
            {targetOk != null && (
              <span className="badge" style={{ marginLeft: 8, color: LEVELS[targetOk ? 'ok' : 'danger'].color, borderColor: LEVELS[targetOk ? 'ok' : 'danger'].color }}>
                신청 {fmtKw(h.target_kw)} {targetOk ? '연계 가능' : '연계 불가'}
              </span>
            )}
          </h4>
          {h.limited_by.length > 0 && (
            <>
              <p className="muted small">막히는 원인 (최대치를 넘기면 처음 생기는 위반, ⌖를 누르면 단선도에서 위치를 보여 줍니다)</p>
              <ViolationList graph={graph} items={h.limited_by} onFocus={onFocus} />
            </>
          )}
          {h.target_violations.length > 0 && (
            <>
              <p className="muted small">신청 용량을 붙이면 생기는 위반과 필요한 보강</p>
              <ViolationList graph={graph} items={h.target_violations} onFocus={onFocus} />
            </>
          )}
        </section>
      )}

      {trial && (
        <section className="uc-result">
          <h4>
            {busName(trial.data.bus_id)}에 {fmtKw(trial.data.kw)} 붙였을 때 <small className="muted">({atLabel(trial.at)})</small>
          </h4>
          <CompareTable before={trial.data.before} after={trial.data.after} left="지금" right="붙인 뒤" />
        </section>
      )}

      <section className="uc-result">
        <h4>
          지금 태양광·풍력 전체의 연결 전후{der && <small className="muted"> ({atLabel(der.at)})</small>}{' '}
          <button type="button" className="mini" disabled={!!busy} onClick={compareAll}>
            {der ? '다시 계산' : '계산'}
          </button>
        </h4>
        {der ? (
          <CompareTable before={der.data.before} after={der.data.after} left="분산전원 없음" right="지금" />
        ) : (
          <p className="muted small">태양광·풍력이 들어오기 전과 후에 전압·부하율·역조류·고장전류가 어떻게 달라지는지 봅니다.</p>
        )}
      </section>

      <section className="uc-result">
        <h4>
          AI 추천{' '}
          <button type="button" className="primary-outline mini" disabled={!!busy || !h} onClick={recommend}>
            {report ? '다시 만들기' : 'AI 추천 만들기'}
          </button>
        </h4>
        {!h && <p className="muted small">먼저 &ldquo;연계 가능량 확인&rdquo;을 누르세요. 신청 용량 붙여 보기와 전체 연결 전후를 계산해 두면 AI가 같이 참고합니다.</p>}
        {report && <ReportCards report={report} titles={['연계 가능 여부', '막히는 원인', '보강 추천']} />}
      </section>
    </div>
  )
}

// ── 유스케이스 2: 고른 날 24시간 AI 운영 권고 ──
// date: 기록 탭에서 고른 날 ('YYYY-MM-DD'). 계산은 지금 저장된 계통으로 백엔드가 다시 한다
export function DailyAiBox({ graph, date }) {
  const sid = graph.substation.id
  // 날짜마다 따로 남긴다 (다른 날을 골랐다 돌아오면 그날 권고가 다시 보임)
  const [report, setReport] = usePersisted(`daily:${sid}:${date}:report`, null)
  const [busy, setBusy] = usePersisted(`daily:${sid}:${date}:busy`, false)
  const [error, setError] = usePersisted(`daily:${sid}:${date}:error`, '')

  async function make() {
    setBusy(true)
    setError('')
    try {
      setReport(await createDailyReport(sid, { date }))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="uc-result">
      <h4>
        AI 운영 권고 · {date}{' '}
        <button type="button" className="primary-outline mini" disabled={busy || !date} onClick={make}>
          {report ? '다시 만들기' : 'AI 운영 권고 만들기'}
        </button>
      </h4>
      <p className="muted small">
        고른 날 0~23시 결과에서 언제·어디서·어떤 문제가 생기는지 시간대별로 정리하고 대비 조치를 권고합니다. 조치는 시뮬레이션으로 확인한 것이 아니라 검토 대상입니다.
      </p>
      {busy && <Busy text="24시간 계산 후 AI가 권고를 쓰고 있습니다... (수십 초)" />}
      <Fail error={error} />
      {report && <ReportCards report={report} titles={['하루 요약', '시간대별 위험', '대비 조치 (검토 대상)']} />}
    </section>
  )
}

// ── 유스케이스 3: 설비 보강 우선순위 ──
const DEFAULT_DATES = ['2025-08-01', '2025-01-15'] // 여름·겨울 대표일 (2025년 가상 패턴)

export function ReinforceBox({ graph, onFocus }) {
  const sid = graph.substation.id
  const k = (name) => `reinforce:${sid}:${name}`
  const [dates, setDates] = usePersisted(k('dates'), DEFAULT_DATES)
  const [count, setCount] = usePersisted(k('count'), '2')
  const [data, setData] = usePersisted(k('data'), null)
  const [busy, setBusy] = usePersisted(k('busy'), false)
  const [error, setError] = usePersisted(k('error'), '')

  async function make() {
    setBusy(true)
    setError('')
    try {
      setData(await createReinforcementReport(sid, { dates: dates.filter(Boolean), budget_lines: Number(count) || 2 }))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="uc-result">
      <h4>설비 보강 우선순위</h4>
      <p className="muted small">여러 날의 24시간 결과에서 선로마다 최대 부하율과 기준을 넘는 시간을 세어 순위를 매기고, AI가 증강 순서를 정리합니다.</p>
      <div className="uc-controls">
        {dates.map((d, i) => (
          <label key={i} className="field">
            점검 날짜 {i + 1}
            <span className="field-input">
              <input type="date" min="2025-01-01" value={d} disabled={busy} onChange={(e) => setDates(dates.map((x, j) => (j === i ? e.target.value : x)))} />
            </span>
          </label>
        ))}
        <label className="field">
          증강할 선로 수
          <span className="field-input">
            <input type="number" min="1" max="10" value={count} disabled={busy} onChange={(e) => setCount(e.target.value)} />
            <i>개</i>
          </span>
        </label>
        <button type="button" className="primary-outline mini" disabled={busy || !dates.some(Boolean)} onClick={make}>
          순위 계산 + AI 정리
        </button>
      </div>
      {busy && <Busy text="날짜마다 24시간 계산 후 AI가 정리하고 있습니다... (수십 초)" />}
      <Fail error={error} />
      {data && (
        <>
          <table className="rtable">
            <thead>
              <tr>
                <th className="num">순위</th>
                <th>선로</th>
                <th className="num">최대 부하율</th>
                <th>그때</th>
                <th className="num">100% 초과 시간</th>
                <th className="num">80% 이상 시간</th>
                <th className="num">지금 허용전류</th>
              </tr>
            </thead>
            <tbody>
              {data.ranking.map((r, i) => (
                <tr key={r.line_id} className={r.hours_over > 0 ? 'danger' : r.hours_watch > 0 ? 'warn' : ''}>
                  <td className="num">{i + 1}</td>
                  <td>
                    {r.name}{' '}
                    {onFocus && (
                      <button type="button" className="focus-btn" onClick={() => onFocus(r.line_id)} title="단선도에서 이 위치로 이동">
                        ⌖
                      </button>
                    )}
                  </td>
                  <td className="num">
                    <b>{r.max_loading_pct.toFixed(0)}%</b>
                  </td>
                  <td>
                    {r.worst_date} {r.worst_hour}시
                  </td>
                  <td className="num">{r.hours_over}시간</td>
                  <td className="num">{r.hours_watch}시간</td>
                  <td className="num">{r.rated_current_a == null ? '400 A (가정값)' : `${Math.round(r.rated_current_a)} A`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ReportCards report={data.report} titles={['요약', '선로별 위험', '증강 순서 권고']} />
        </>
      )}
    </section>
  )
}
