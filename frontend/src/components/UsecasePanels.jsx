// AI 추천·권고 화면 (한승우 유스케이스 시나리오, 11/4). 담당: 최민준 (frontend·ai_report)
// - HostingAi: 유스케이스 1 ⑤ "AI 추천". 영민이형의 태양광 연계 검토(PropertyPanel.jsx의 HostingSection) 결과 아래에 붙는다
// - DailyAiBox: 유스케이스 2 ⑥ "AI 운영 권고" (고른 날 24시간 결과 → 시간대별 위험과 대비 조치)
// - ReinforceBox: 유스케이스 3 "설비 보강 우선순위" (여러 날 24시간 결과 → 선로 순위 → AI 정리)
// 계산은 진짜 백엔드(simulation/der.py, simulation/daily.py)가 하고, AI 문장은 ai_report/report.py가 만든다
// (전문가용 설명: 한전 담당자용 화면). 모의 백엔드에는 이 주소들이 없다 (진짜 백엔드로 확인)
import { useCallback, useEffect, useState } from 'react'
import { createDailyReport, createHostingReport, createReinforcementReport } from '../api/client.js'

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
