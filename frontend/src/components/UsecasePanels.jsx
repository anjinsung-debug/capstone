// AI 추천·권고 화면 (한승우 유스케이스 시나리오, 11/4). 담당: 최민준 (frontend·ai_report)
// - CapacityPanel: AI 리포트 창 "여유 용량" 탭. 접속점마다 신재생·부하를 얼마나 더 붙일 수 있는지 + AI 설명(쉬운 설명) (진성이 피드백 11/5, 11/10 정리)
// - HostingAi: 유스케이스 1 ⑤ "AI 추천". 영민이형의 태양광 연계 검토(PropertyPanel.jsx의 HostingSection) 결과 아래에 붙는다
// - DailyAiBox: 유스케이스 2 ⑥ "AI 운영 권고" (고른 날 24시간 결과 → 시간대별 위험과 대비 조치)
// - ReinforceBox: 유스케이스 3 "설비 보강 우선순위" (여러 날 24시간 결과 → 선로 순위 → AI 정리)
// - SeasonalBox: AI 리포트 창 "계절별 위험도" 탭 (1년 365일 × 24시간 → 봄·여름·가을·겨울 위험도, 숫자·등급만, 11/23)
// 계산은 진짜 백엔드(simulation/der.py, simulation/daily.py)가 하고, AI 문장은 ai_report/report.py가 만든다
// (전문가용 설명: 한전 담당자용 화면). 모의 백엔드에는 이 주소들이 없다 (진짜 백엔드로 확인)
import { useCallback, useEffect, useState } from 'react'
import { createCapacityReport, createDailyReport, createHostingReport, createReinforcementReport, getReinforceDates, getSeasonal, runCapacity, startSeasonal } from '../api/client.js'

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

// AI 챗봇(ChatBot.jsx)에 보낼, 화면에서 이미 계산한 결과 (11/20). 계산 안 했으면 null
const atLabel = (at) => (at ? `${at.date} ${at.hour}시` : null)
export function chatExtras(sid, at) {
  if (!sid) return {}
  const table = store.get(`cap:${sid}:table`)
  const rf = store.get(`reinforce:${sid}:data`)
  return {
    capacity: table ? { table: table.data, at: atLabel(table.at), stale: atLabel(table.at) !== atLabel(at) } : null,
    reinforce: rf?.ranking ? { ranking: rf.ranking, dates: (store.get(`reinforce:${sid}:dates`) ?? DEFAULT_DATES).filter(Boolean) } : null,
  }
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

// ── 유스케이스 1 ⑤: 태양광 연계 검토 AI 추천 ──
// hosting = App.jsx의 hosting 상태 { busId, targetKw, at, status, data } (영민이형 checkHosting). stale이면 계통·시각이 바뀐 옛 결과라 버튼을 막는다
// 추천은 접속점·목표 용량·시각마다 따로 남긴다 (다른 접속점을 봤다 돌아와도 그대로)
export function HostingAi({ graph, hosting, stale }) {
  const sid = graph.substation.id
  const key = `hostingAi:${sid}:${hosting.busId}:${hosting.targetKw ?? ''}:${hosting.at ? `${hosting.at.date}|${hosting.at.hour}` : 'max'}`
  const [report, setReport] = usePersisted(`${key}:report`, null)
  const [busy, setBusy] = usePersisted(`${key}:busy`, false)
  const [error, setError] = usePersisted(`${key}:error`, '')

  async function make() {
    setBusy(true)
    setError('')
    try {
      setReport(await createHostingReport({ substation_id: sid, hosting: hosting.data }, hosting.at))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="uc-ai">
      <button type="button" className="primary-outline mini" disabled={busy || stale} onClick={make}>
        {busy ? 'AI가 쓰는 중...' : report ? 'AI 추천 다시 만들기' : 'AI 추천 (연계 가능 여부·보강 방법)'}
      </button>
      <Fail error={error} />
      {report && <ReportCards report={report} titles={['연계 가능 여부', '막히는 원인', '보강 추천']} />}
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
// 기본 점검 날짜 (11/20): 서버가 이 계통에 가장 불리한 두 날(순부하 최대일·최소일)을 골라 준다 (ai_report/report.py critical_dates).
// 서버에 못 물어봤을 때만 아래 값을 쓴다 (원본 계통 기준으로 고른 날. 예전 기본값 8/1·1/15는 겨울이라 역조류를 못 봤음)
// 날짜 입력칸은 없앴다 (11/22 피드백: 어차피 자동으로 고르므로 사용자는 증강할 선로 수만 정한다)
const DEFAULT_DATES = ['2025-07-29', '2025-05-10']

export function ReinforceBox({ graph, onFocus }) {
  const sid = graph.substation.id
  const k = (name) => `reinforce:${sid}:${name}`
  const [dates, setDates] = usePersisted(k('dates'), DEFAULT_DATES)
  const [count, setCount] = usePersisted(k('count'), '2')
  const [data, setData] = usePersisted(k('data'), null)
  const [busy, setBusy] = usePersisted(k('busy'), false)
  const [error, setError] = usePersisted(k('error'), '')
  const [why, setWhy] = usePersisted(k('why'), null) // 서버가 고른 날의 이름·이유 { 날짜: { label, reason } }

  // 처음 열 때 이 계통에 맞는 점검 날짜를 받아 온다
  useEffect(() => {
    if (why) {
      setDates(Object.keys(why)) // 예전에 직접 바꿔 둔 날짜가 남아 있어도 자동으로 고른 날로
      return
    }
    let alive = true
    getReinforceDates(sid)
      .then((list) => {
        if (!alive) return
        setWhy(Object.fromEntries(list.map((x) => [x.date, { label: x.label, reason: x.reason }])))
        setDates(list.map((x) => x.date))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid])

  async function make() {
    setBusy(true)
    setError('')
    try {
      setData({ ...(await createReinforcementReport(sid, { dates: dates.filter(Boolean), budget_lines: Number(count) || 2 })), dates: dates.filter(Boolean) })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="uc-result">
      <h4>설비 보강 우선순위</h4>
      <p className="muted small">
        1년 중 이 계통에 가장 불리한 두 날(부하가 가장 무거운 날, 태양광이 부하를 가장 많이 덮는 날)을 자동으로 골라 24시간씩 계산하고, 선로마다 최대
        부하율과 기준을 넘는 시간을 세어 순위를 매긴 뒤 AI가 증강 순서를 정리합니다.
      </p>
      <div className="uc-controls">
        <label className="field">
          증강할 선로 수
          <span className="field-input">
            <input type="number" min="1" max="10" value={count} disabled={busy} onChange={(e) => setCount(e.target.value)} />
            <i>개</i>
          </span>
        </label>
        <button type="button" className="primary" disabled={busy || !dates.some(Boolean)} onClick={make}>
          순위 계산 + AI 정리
        </button>
      </div>
      {/* 자동으로 고른 날과 그 이유 (서버 응답 전이거나 못 받았으면 기본 날만) */}
      <ul className="uc-date-why">
        {dates.map((d, i) =>
          d ? (
            <li key={i}>
              <b>점검한 날 {i + 1}</b> {d}{why?.[d] ? ` · ${why[d].label}: ${why[d].reason}` : ''}
            </li>
          ) : null,
        )}
      </ul>
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
          <p className="muted small">
            시간 수는 고른 {data.dates?.length ?? dates.filter(Boolean).length}일({(data.dates ?? dates.filter(Boolean)).join(', ')})의 24시간을 합한 값입니다. 1년 전체 시간 수가 아닙니다.
          </p>
          <ReportCards report={data.report} titles={['요약', '선로별 위험', '증강 순서 권고']} />
        </>
      )}
    </section>
  )
}

// "가장 빡빡한 곳"을 빨간색으로 보일 기준 (11/11 점검 8번: 예전에는 16,630 kW처럼 넉넉해도 늘 빨간색이었음). 팀 가정값
const TIGHT_KW = 1000

// ── 여유 용량 (화면 이름, 11/10 '추가 가능량'에서 바꿈. 한전 '배전선로 여유용량'과 같은 말) (진성이 피드백 11/5, 10/26 차장님 요청): 지금 계통에서 신재생·부하를 얼마나 더 붙일 수 있나 ──
// 계산은 ai_report/capacity.py (신재생은 simulation/der.py의 hosting_capacity, 부하는 같은 방식으로 새로 계산)
const KIND_KO = { overload: '선로 과부하', overvoltage: '과전압', undervoltage: '저전압', breaker: '차단기 차단 불가' }
const kwText = (v, top) => (v >= top ? `${Math.round(top).toLocaleString('ko-KR')}+` : Math.round(v).toLocaleString('ko-KR'))
const atText = (at) => (at ? `${at.date} ${at.hour}시 기준` : '최대 조건 기준 (부하 최대 + 태양광 설비용량)')

// 막는 것 한 줄: 이름 + 종류 + 값, 단선도로 갈 요소 id (차단기는 그 피더의 차단기 노드)
function limitInfo(graph, v) {
  const name = [...graph.nodes, ...graph.lines, ...graph.feeders].find((x) => x.id === v.element_id)?.name ?? v.element_id
  const near = Math.abs(v.value - v.limit) < (v.kind === 'overload' ? 1 : 0.001)
  const val =
    v.kind === 'overload'
      ? `${near ? v.value.toFixed(2) : v.value.toFixed(0)}%`
      : v.kind === 'breaker'
        ? `${v.value.toFixed(1)} kA`
        : `${near ? v.value.toFixed(4) : v.value.toFixed(3)} pu`
  const need = v.required_rated_current_a ? ` → ${Math.ceil(v.required_rated_current_a)} A 이상` : ''
  const id = v.kind === 'breaker' ? graph.nodes.find((n) => n.type === 'breaker' && n.feeder_id === v.element_id)?.id : v.element_id
  return { id, text: `${name} ${KIND_KO[v.kind] ?? v.kind} ${val}${need}` }
}

function LimitCell({ graph, items, onFocus }) {
  if (!items.length) return <span className="muted">상한까지 기준 안</span>
  return items.map((v, i) => {
    const d = limitInfo(graph, v)
    return (
      <div key={i} className="cap-limit">
        {d.text}{' '}
        {d.id && onFocus && (
          <button type="button" className="focus-btn" onClick={() => onFocus(d.id)} title="단선도에서 이 위치로 이동">
            ⌖
          </button>
        )}
      </div>
    )
  })
}

export function CapacityPanel({ graph, at, onFocus }) {
  const sid = graph.substation.id
  const atKey = at ? `${at.date}|${at.hour}` : 'max'
  const [table, setTable] = usePersisted(`cap:${sid}:table`, null) // { data, at, atKey }
  const [report, setReport] = usePersisted(`cap:${sid}:report`, null)
  const [busy, setBusy] = usePersisted(`cap:${sid}:busy`, '')
  const [error, setError] = usePersisted(`cap:${sid}:error`, '')

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
  const calc = () =>
    run('접속점마다 신재생·부하 여유 용량을 계산하는 중... (수 초~수십 초)', async () => {
      setTable({ data: await runCapacity(sid, at), at, atKey })
      setReport(null)
    })
  const explain = () => run('AI가 설명을 쓰고 있습니다... (수 초~수십 초)', async () => setReport(await createCapacityReport(sid, table.data, table.at)))

  const rows = table?.data.rows ?? []
  const top = table?.data.max_search_kw ?? 20000
  const best = (key) => rows.reduce((a, r) => (!a || r[key] > a[key] ? r : a), null)
  const worst = (key) => rows.reduce((a, r) => (!a || r[key] < a[key] ? r : a), null)
  const stale = table && table.atKey !== atKey

  // 순서 (11/10 피드백, 11/15 수정): 맨 위 요약 칸(AI 리포트 탭과 같은 모양, 오른쪽에 버튼) → 큰 숫자 요약 → 접속점별 세부 표(접었다 펴기) → AI 설명
  // (AI 설명이 생겨도 숫자 카드가 밀려 내려가지 않게 맨 아래에 붙인다)
  return (
    <div className="uc-panel">
      <div className="rp-summary">
        <div className="rp-overall">
          <small>여유 용량 · {atText(at)}</small>
          <span className="cap-question">태양광을 얼마나 더 설치하고, 부하를 얼마나 더 늘릴 수 있는지</span>
        </div>
        <div className="rp-controls">
          {table && (
            <button type="button" disabled={!!busy || stale} onClick={explain}>
              {report ? 'AI 설명 다시 만들기' : 'AI 설명 보기'}
            </button>
          )}
          <button type="button" className="primary rp-make" disabled={!!busy} onClick={calc}>
            {table ? '다시 계산' : '여유 용량 계산'}
          </button>
        </div>
      </div>
      {busy && <Busy text={busy} />}
      <Fail error={error} />
      {stale && <p className="warn small">화면 시각이 바뀌었습니다. 아래는 {atText(table.at)} 결과이니 &ldquo;다시 계산&rdquo;을 눌러 주세요.</p>}

      {rows.length > 0 && (
        <>
          <div className="cap-cards">
            {[
              ['신재생 여유 용량', 'pv_max_kw', 'pv'],
              ['부하 여유 용량', 'load_max_kw', 'load'],
            ].map(([title, key, cls]) => {
              const b = best(key)
              const w = worst(key)
              return (
                <div key={key} className={`cap-card ${cls}`}>
                  <span className="cap-title">{title}</span>
                  <div className="cap-pair">
                    <div>
                      <small>가장 여유 있는 곳 · {b.name}</small>
                      <b>{kwText(b[key], top)} kW</b>
                    </div>
                    <div>
                      <small>가장 빡빡한 곳 · {w.name}</small>
                      <b className={w[key] < TIGHT_KW ? 'tight' : ''} title={w[key] < TIGHT_KW ? `${TIGHT_KW.toLocaleString()} kW 미만이라 빨간색` : undefined}>
                        {kwText(w[key], top)} kW
                      </b>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <details className="uc-acc">
            <summary>
              접속점별 세부 결과 ({rows.length}곳) · {atText(table.at)}
            </summary>
            <p className="muted small">
              신재생: 전압 1.05 pu 이하·선로 부하율 100% 이하·출구 차단기 차단 가능 / 부하: 전압 0.95 pu 이상·선로 부하율 100% 이하·차단 가능. 접속점마다 따로
              계산한 값이라 여러 곳에 동시에 붙인 합은 아닙니다. ⌖를 누르면 단선도에서 위치를 보여 줍니다.
            </p>
            <table className="rtable cap-table">
              <thead>
                <tr>
                  <th>접속점</th>
                  <th className="num">신재생 여유</th>
                  <th>신재생을 막는 것</th>
                  <th className="num">부하 여유</th>
                  <th>부하를 막는 것</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.bus_id}>
                    <td>
                      {r.name}{' '}
                      {onFocus && (
                        <button type="button" className="focus-btn" onClick={() => onFocus(r.bus_id)} title="단선도에서 이 위치로 이동">
                          ⌖
                        </button>
                      )}
                    </td>
                    <td className="num cap-num pv">{kwText(r.pv_max_kw, top)} kW</td>
                    <td>
                      <LimitCell graph={graph} items={r.pv_limited_by} onFocus={onFocus} />
                    </td>
                    <td className="num cap-num load">{kwText(r.load_max_kw, top)} kW</td>
                    <td>
                      <LimitCell graph={graph} items={r.load_limited_by} onFocus={onFocus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}

      {report && <ReportCards report={report} titles={['계통 전체 요약', '막는 요인', '늘리는 방법']} />}
    </div>
  )
}

// ── 계절별 위험도 (11/23): 1년치(365일 × 24시간)를 계산해 봄·여름·가을·겨울로 나눠 센다 (ai_report/seasonal.py). AI 없음, 숫자·등급만 ──
// 오래 걸려서 서버가 백그라운드로 돌리고 여기서는 2초마다 진행률을 받아 온다. 같은 계통은 서버가 결과를 남겨 두어 바로 나온다
const SEASON_POLL_MS = 2000
const GRADE_CLASS = { 정상: 'ok', 주의: 'warn', 위험: 'danger' }
const monthsText = (ms) => (ms[0] === 12 ? '12·1·2월' : `${ms[0]}~${ms[ms.length - 1]}월`)
const whenText = (x) => (x ? `${x.date.slice(5).replace('-', '/')} ${x.hour}시` : '')
const hoursText = (n, total) => (total ? `${n.toLocaleString('ko-KR')}시간 (${((n / total) * 100).toFixed(n && n / total < 0.001 ? 2 : 1)}%)` : '-')

function GradeBadge({ grade }) {
  return <span className={`badge season-grade ${GRADE_CLASS[grade]}`}>{grade}</span>
}

// 표의 한 줄: [이름, 계절 → 칸 내용, 계절 → 칸 class (기준을 넘은 시간이 있으면 위험 항목은 빨강, 주의 항목은 주황)]
function seasonRows(onFocus) {
  const hrs = (key, cls = 'bad-cell') => [(s) => hoursText(s[key], s.hours), (s) => (cls && s[key] > 0 ? cls : '')]
  const worst = (key, digits, unit, focus = false) => [
    (s) =>
      s[key] ? (
        <>
          <b>{s[key].value.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}{unit}</b>
          <small className="muted">
            {' '}
            {s[key].where} · {whenText(s[key])}
          </small>
          {focus && onFocus && s[key].line_id && (
            <button type="button" className="focus-btn" onClick={() => onFocus(s[key].line_id)} title="단선도에서 이 위치로 이동">
              ⌖
            </button>
          )}
        </>
      ) : (
        '-'
      ),
    () => '',
  ]
  return [
    ['위험 시간', ...hrs('_danger')],
    ['주의 시간', ...hrs('_caution', 'warn-cell')],
    ['선로 과부하 (100% 초과)', ...hrs('overload_hours')],
    ['선로 부하율 80~100%', ...hrs('watch_hours', 'warn-cell')],
    ['저전압 (0.95 pu 미만)', ...hrs('low_v_hours', 'warn-cell')],
    ['과전압 (1.05 pu 초과)', ...hrs('high_v_hours', 'warn-cell')],
    ['정전', ...hrs('outage_hours')],
    ['비정상 역조류', ...hrs('reverse_bad_hours')],
    ['정상 역조류 (참고)', ...hrs('reverse_ok_hours', '')],
    ['단락용량 300 MVA 초과', ...hrs('fault_hours', 'warn-cell')],
    ['최대 부하율', ...worst('max_loading', 0, '%', true)],
    ['최저 전압', ...worst('min_v', 3, ' pu')],
    ['최고 전압', ...worst('max_v', 3, ' pu')],
    ['최대 역조류', ...worst('max_reverse_kw', 0, ' kW', true)],
    ['최대 단락용량', ...worst('max_fault_mva', 0, ' MVA')],
  ]
}

export function SeasonalBox({ graph, onFocus }) {
  const sid = graph.substation.id
  const [job, setJob] = usePersisted(`season:${sid}:job`, null) // 서버 상태 { state, done, total, result, error }
  const [error, setError] = usePersisted(`season:${sid}:error`, '')
  const running = job?.state === 'running'

  // 처음 열 때 지금 상태(예전에 계산해 둔 결과가 있으면 바로 done), 계산 중이면 2초마다 다시
  useEffect(() => {
    let alive = true
    let timer = null
    const poll = () =>
      getSeasonal(sid)
        .then((j) => {
          if (!alive) return
          setJob(j)
          setError('')
          if (j.state === 'running') timer = setTimeout(poll, SEASON_POLL_MS)
        })
        .catch((e) => alive && setError(e.message))
    poll()
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, running])

  async function begin(again) {
    setError('')
    try {
      setJob(await startSeasonal(sid, again))
    } catch (e) {
      setError(e.message)
    }
  }

  const result = job?.state === 'done' ? job.result : null
  const seasons = (result?.seasons ?? []).map((s) => ({ ...s, _danger: s.grade_hours['위험'], _caution: s.grade_hours['주의'] }))
  const pct = job?.total ? Math.round((job.done / job.total) * 100) : 0
  return (
    <section className="uc-result">
      <h4>계절별 위험도</h4>
      <div className="uc-controls">
        {!running && (
          <button type="button" className="primary" disabled={!job} onClick={() => begin(job?.state === 'done')}>
            {job?.state === 'done' ? '다시 계산' : '1년 계산 시작'}
          </button>
        )}
        {result && <span className="muted small">계산한 때 {result.computed_at.replace('T', ' ')}</span>}
      </div>
      {running && (
        <div className="season-progress" role="progressbar" aria-valuemin={0} aria-valuemax={job.total} aria-valuenow={job.done}>
          <div className="season-bar">
            <i style={{ width: `${pct}%` }} />
          </div>
          <span>
            {job.done} / {job.total}일 계산 중 ({pct}%) · 창을 닫아도 서버에서 계속 계산합니다
          </span>
        </div>
      )}
      {job?.state === 'error' && <Fail error={job.error} />}
      <Fail error={error} />
      {result && (
        <>
          <div className="season-cards">
            {seasons.map((s) => (
              <div key={s.season} className={`season-card ${GRADE_CLASS[s.grade]}`}>
                <header>
                  <strong>{s.season}</strong>
                  <small className="muted">{monthsText(s.months)} · {s.days}일</small>
                  <GradeBadge grade={s.grade} />
                </header>
                <div className="season-hours" title="등급별 시간 (계산한 시간 기준)">
                  {['위험', '주의', '정상'].map((g) => (
                    <i key={g} className={GRADE_CLASS[g]} style={{ flexGrow: s.grade_hours[g] }} />
                  ))}
                </div>
                <dl>
                  <dt>위험</dt>
                  <dd>{s._danger.toLocaleString('ko-KR')}시간</dd>
                  <dt>주의</dt>
                  <dd>{s._caution.toLocaleString('ko-KR')}시간</dd>
                  <dt>정상</dt>
                  <dd>{s.grade_hours['정상'].toLocaleString('ko-KR')}시간</dd>
                  <dt>최대 부하율</dt>
                  <dd>{s.max_loading ? `${s.max_loading.value.toFixed(0)}% (${whenText(s.max_loading)})` : '-'}</dd>
                  <dt>최저 전압</dt>
                  <dd>{s.min_v ? `${s.min_v.value.toFixed(3)} pu` : '-'}</dd>
                </dl>
                {s.failed_hours > 0 && <small className="muted">계산 안 된 {s.failed_hours}시간은 빼고 셌습니다</small>}
              </div>
            ))}
          </div>
          <table className="rtable season-table">
            <thead>
              <tr>
                <th>항목</th>
                {seasons.map((s) => (
                  <th key={s.season}>
                    {s.season} <GradeBadge grade={s.grade} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {seasonRows(onFocus).map(([label, cell, bad]) => (
                <tr key={label}>
                  <td>{label}</td>
                  {seasons.map((s) => (
                    <td key={s.season} className={bad(s)}>
                      {cell(s)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td>가장 나쁜 날</td>
                {seasons.map((s) => (
                  <td key={s.season}>
                    {s.worst_days.length === 0
                      ? '없음'
                      : s.worst_days.map((d) => (
                          <div key={d.date}>
                            {d.date.slice(5).replace('-', '/')} ({d.weekday}) <span className={`season-dot ${GRADE_CLASS[d.grade]}`}>{d.grade}</span>{' '}
                            <small className="muted">
                              {d.danger_hours ? `위험 ${d.danger_hours}시간` : `주의 ${d.caution_hours}시간`}
                            </small>
                          </div>
                        ))}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="muted small">시간 수는 그 계절의 모든 시간 중 기준을 넘은 시간입니다. 한 시간에 여러 항목이 겹칠 수 있어 항목별 시간을 더하면 위험·주의 시간보다 클 수 있습니다.</p>
        </>
      )}
    </section>
  )
}
