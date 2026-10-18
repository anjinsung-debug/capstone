// 결과 기록 그래프: "편집 기록 × 하루 시간대"를 합쳐 보여 준다 (미팅 자료 슬라이드 13의 시간대별 그래프 + 편집 전후 비교).
// - 기록 한 줄 = 계통을 고쳐서 다시 계산한 한 번. 기록마다 대표일 하루(0~23시)를 계산한 곡선이 붙는다 (App.jsx의 loadDaily)
// - 그래프 가로축 = 하루 시각. 선택한 기록은 초록 실선, 바로 전 기록은 회색 점선(편집 전), 그 밖의 기록은 옅은 선
// - 아래 표 = 기록 목록. 하루 곡선이 있으면 지표마다 하루 중 가장 나쁜 값과 그 시각, 없으면 편집 시점 값
// 하루 곡선은 data/daily_profile.csv의 가상 패턴(부하·태양광 배율) 기준이라 화면에 그렇게 밝힌다.
// 백엔드에 하루 계산이 없으면(진짜 백엔드는 아직) 예전처럼 가로축 = 기록 순서인 그래프를 보여 준다.
// ponytail: 기록은 브라우저 메모리에만 있다(새로고침하면 사라짐). 대표일은 하나(봄철 평일)만 쓴다. 여름 피크일 등을 고르게 하려면
//   data/daily_profile.csv에 날을 추가하고 runDaily에 날 선택을 넘긴다
import { useState } from 'react'
import { FAULT_HIGH_MVA, OVERLOAD_PCT, VOLTAGE_MIN_PU } from '../lib/overlay.js'

const W = 320
const H = 130
const PAD = { l: 44, r: 10, t: 12, b: 24 }

// worst: 하루 중 가장 나쁜 값을 고르는 방향 (최저 전압은 작을수록, 나머지는 클수록 나쁨)
const METRICS = [
  { key: 'minV', label: '① 최저 전압', unit: 'pu', fmt: (v) => v.toFixed(3), limit: VOLTAGE_MIN_PU, worst: 'min' },
  { key: 'maxLoading', label: '② 최대 부하율', unit: '%', fmt: (v) => v.toFixed(0), limit: OVERLOAD_PCT, worst: 'max' },
  { key: 'reverseMw', label: '③ 최대 역조류', unit: 'MW', fmt: (v) => v.toFixed(2), worst: 'max' },
  { key: 'maxMva', label: '④ 최대 단락용량', unit: 'MVA', fmt: (v) => v.toFixed(0), limit: FAULT_HIGH_MVA, worst: 'max' },
  { key: 'totalMw', label: '총 송출', unit: 'MW', fmt: (v) => v.toFixed(2), worst: 'max' },
  { key: 'lossKw', label: '선로 손실', unit: 'kW', fmt: (v) => v.toFixed(1), worst: 'max' },
]

const time = (d) => d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

// 하루 곡선에서 가장 나쁜 값과 그 시각
function worstOf(daily, metric) {
  let best = null
  for (const p of daily) {
    const v = p[metric.key]
    if (v == null) continue
    if (!best || (metric.worst === 'min' ? v < best.v : v > best.v)) best = { v, hour: p.hour }
  }
  return best
}

// 세로축 최소 폭: 차이가 이보다 작으면 축을 이만큼 벌린다. 표시 자릿수보다 작은 차이(예: 1.104 → 1.096 MW)가
// 그래프에서 크게 오르내리는 것처럼 보이지 않게 하려는 것
const MIN_SPAN = { minV: 0.02, maxLoading: 10, reverseMw: 0.2, maxMva: 10, totalMw: 0.2, lossKw: 2 }

// 세로축 범위: 보이는 값 + 기준선이 다 들어가게, 차이가 너무 작으면 MIN_SPAN만큼 벌린다
function yRange(values, metric) {
  let lo = Math.min(...values, metric.limit ?? Infinity)
  let hi = Math.max(...values, metric.limit ?? -Infinity)
  const min = MIN_SPAN[metric.key] ?? 1
  if (hi - lo < min) {
    const mid = (hi + lo) / 2
    lo = mid - min / 2
    hi = mid + min / 2
  }
  const pad = (hi - lo) * 0.12
  return { lo: lo - pad, hi: hi + pad, pad }
}

// ── 하루 곡선 그래프 (가로축 0~23시) ──
function DailySmall({ metric, points, sel, hour, setHour }) {
  const cur = points[sel]
  const prev = sel > 0 ? points[sel - 1] : null
  const withDaily = points.filter((p) => p.daily)
  const values = withDaily.flatMap((p) => p.daily.map((d) => d[metric.key])).filter((v) => v != null)
  if (!values.length) return null
  const { lo, hi, pad } = yRange(values, metric)
  const x = (h) => PAD.l + (h * (W - PAD.l - PAD.r)) / 23
  const y = (v) => PAD.t + ((hi - v) * (H - PAD.t - PAD.b)) / (hi - lo)
  const path = (daily) =>
    daily
      .filter((d) => d[metric.key] != null)
      .map((d) => `${x(d.hour)},${y(d[metric.key])}`)
      .join(' ')
  const worst = cur.daily ? worstOf(cur.daily, metric) : null
  const atHour = hour != null && cur.daily ? cur.daily.find((d) => d.hour === hour)?.[metric.key] : null
  return (
    <figure className="hchart">
      <figcaption>
        <span>{metric.label}</span>
        <b>
          {!cur.daily
            ? cur.dailyError
              ? '하루 계산 실패'
              : '하루 계산 중...'
            : hour != null
              ? `${hour}시 ${atHour == null ? '-' : `${metric.fmt(atHour)} ${metric.unit}`}`
              : worst
                ? `${metric.worst === 'min' ? '최저' : '최대'} ${metric.fmt(worst.v)} ${metric.unit} · ${worst.hour}시`
                : '-'}
        </b>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${metric.label} 하루 변화`} onMouseLeave={() => setHour(null)}>
        {[lo + pad, hi - pad].map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="hgrid" />
            <text x={PAD.l - 6} y={y(v) + 3} className="htick" textAnchor="end">
              {metric.fmt(v)}
            </text>
          </g>
        ))}
        {metric.limit != null && (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(metric.limit)} y2={y(metric.limit)} className="hlimit" />
            <text x={W - PAD.r} y={y(metric.limit) - 3} className="htick" textAnchor="end">
              기준 {metric.limit}
            </text>
          </g>
        )}
        {[0, 6, 12, 18, 23].map((h) => (
          <text key={h} x={x(h)} y={H - 8} className="htick" textAnchor="middle">
            {h}시
          </text>
        ))}
        {hour != null && <line x1={x(hour)} x2={x(hour)} y1={PAD.t} y2={H - PAD.b} className="hcross" />}
        {/* 그 밖의 기록 (옅게) → 바로 전 기록 (회색 점선) → 선택한 기록 (초록) 순서로 겹쳐 그린다 */}
        {points.map((p, i) => (p.daily && i !== sel && i !== sel - 1 ? <polyline key={p.id ?? i} points={path(p.daily)} className="dline other" /> : null))}
        {prev?.daily && <polyline points={path(prev.daily)} className="dline prev" />}
        {cur.daily && <polyline points={path(cur.daily)} className="hline" />}
        {/* 점은 가리키는 시각(없으면 하루 중 가장 나쁜 시각)에만 */}
        {cur.daily &&
          (() => {
            const h = hour ?? worst?.hour
            const v = cur.daily.find((d) => d.hour === h)?.[metric.key]
            return v == null ? null : <circle cx={x(h)} cy={y(v)} r={4} className={hour != null ? 'hdot on' : 'hdot'} />
          })()}
        {/* 마우스 감지 영역: 시각마다 한 칸 */}
        {Array.from({ length: 24 }, (_, h) => (
          <rect key={h} x={x(h) - (W - PAD.l - PAD.r) / 46} y={0} width={(W - PAD.l - PAD.r) / 23} height={H} fill="transparent" onMouseEnter={() => setHour(h)} />
        ))}
      </svg>
    </figure>
  )
}

// ── 하루 곡선이 없을 때 (진짜 백엔드에 하루 계산이 아직 없을 때): 가로축 = 기록 순서 ──
function SeqSmall({ metric, points, hover, setHover }) {
  const vals = points.map((p) => p[metric.key]).filter((v) => v != null)
  if (!vals.length) return null
  const { lo, hi, pad } = yRange(vals, metric)
  const n = points.length
  const x = (i) => PAD.l + (n === 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (n - 1))
  const y = (v) => PAD.t + ((hi - v) * (H - PAD.t - PAD.b)) / (hi - lo)
  const path = points
    .map((p, i) => (p[metric.key] == null ? null : `${x(i)},${y(p[metric.key])}`))
    .filter(Boolean)
    .join(' ')
  const shown = hover ?? n - 1
  const cur = points[shown]?.[metric.key]
  return (
    <figure className="hchart">
      <figcaption>
        <span>{metric.label}</span>
        <b>{cur == null ? '-' : `${metric.fmt(cur)} ${metric.unit}`}</b>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${metric.label} 기록`} onMouseLeave={() => setHover(null)}>
        {[lo + pad, hi - pad].map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="hgrid" />
            <text x={PAD.l - 6} y={y(v) + 3} className="htick" textAnchor="end">
              {metric.fmt(v)}
            </text>
          </g>
        ))}
        {metric.limit != null && (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(metric.limit)} y2={y(metric.limit)} className="hlimit" />
            <text x={W - PAD.r} y={y(metric.limit) - 3} className="htick" textAnchor="end">
              기준 {metric.limit}
            </text>
          </g>
        )}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="hcross" />}
        {n > 1 && <polyline points={path} className="hline" />}
        {points.map((p, i) =>
          p[metric.key] == null ? null : <circle key={i} cx={x(i)} cy={y(p[metric.key])} r={i === shown ? 5 : 4} className={i === shown ? 'hdot on' : 'hdot'} />,
        )}
        {points.map((_, i) => (
          <rect
            key={i}
            x={x(i) - (W - PAD.l - PAD.r) / Math.max(n - 1, 1) / 2}
            y={0}
            width={(W - PAD.l - PAD.r) / Math.max(n - 1, 1)}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
        <text x={PAD.l} y={H - 6} className="htick">
          {time(points[0].at)}
        </text>
        {n > 1 && (
          <text x={W - PAD.r} y={H - 6} className="htick" textAnchor="end">
            {time(points[n - 1].at)}
          </text>
        )}
      </svg>
    </figure>
  )
}

// 칸 색: 기준을 넘으면 빨강·주황 (lib/overlay.js의 판정 기준과 같은 구간)
function cellLevel(key, v) {
  if (v == null) return ''
  if (key === 'minV') return v < VOLTAGE_MIN_PU ? 'bad' : ''
  if (key === 'maxLoading') return v > OVERLOAD_PCT ? 'bad' : v >= 80 ? 'warn' : ''
  if (key === 'reverseMw') return v > 0.0005 ? 'warn' : ''
  if (key === 'maxMva') return v > FAULT_HIGH_MVA ? 'warn' : ''
  return ''
}

// 한 시간 단위 표: 선택한 기록의 0~23시를 한 줄씩. 바로 전 기록이 있으면 칸마다 차이(▲▼)를 같이 보여 준다.
// 줄에 마우스를 올리면 위 그래프의 같은 시각에 세로선이 생긴다 (hour를 같이 씀)
function HourlyTable({ cur, prev, sel, hour, setHour }) {
  const worstHour = Object.fromEntries(METRICS.map((m) => [m.key, worstOf(cur.daily, m)?.hour]))
  const prevByHour = prev?.daily ? Object.fromEntries(prev.daily.map((d) => [d.hour, d])) : null
  return (
    <div className="hourly">
      <h3 className="sub">
        시간대별 값 · {sel + 1}번째 기록 ({cur.label})
        {prevByHour && <span className="muted"> · 작은 글씨는 바로 전 기록({sel}번째)과의 차이</span>}
      </h3>
      <div className="hourly-scroll">
        <table className="rtable hourly-table" onMouseLeave={() => setHour(null)}>
          <thead>
            <tr>
              <th>시각</th>
              <th className="num">부하 배율</th>
              <th className="num">태양광 배율</th>
              {METRICS.map((m) => (
                <th key={m.key} className="num">
                  {m.label} ({m.unit})
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cur.daily.map((d) => (
              <tr key={d.hour} className={d.hour === hour ? 'hl' : ''} onMouseEnter={() => setHour(d.hour)}>
                <td>{String(d.hour).padStart(2, '0')}시</td>
                <td className="num muted">{d.loadMult.toFixed(2)}</td>
                <td className="num muted">{d.pvMult.toFixed(2)}</td>
                {METRICS.map((m) => {
                  const v = d[m.key]
                  const pv = prevByHour?.[d.hour]?.[m.key]
                  const diff = v != null && pv != null ? v - pv : null
                  const shown = diff != null && m.fmt(Math.abs(diff)) !== m.fmt(0) // 표시 자릿수로 0이 아닐 때만
                  return (
                    <td key={m.key} className={`num ${cellLevel(m.key, v)} ${worstHour[m.key] === d.hour ? 'worst' : ''}`}>
                      {v == null ? '-' : m.fmt(v)}
                      {shown && (
                        <small className={diff > 0 ? 'up' : 'down'}>
                          {diff > 0 ? ' ▲' : ' ▼'}
                          {m.fmt(Math.abs(diff))}
                        </small>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">굵은 글씨 = 하루 중 가장 나쁜 시각 · 빨강 = 기준 넘음 · 주황 = 주의 (부하율 80% 이상, 역조류 있음, 단락용량 300 MVA 초과)</p>
    </div>
  )
}

export default function HistoryChart({ points }) {
  const [picked, setPicked] = useState(null) // 표에서 고른 기록 번호 (없으면 마지막 기록)
  const [hour, setHour] = useState(null) // 하루 그래프에서 마우스가 가리키는 시각
  const [hover, setHover] = useState(null) // 기록 순서 그래프에서 마우스가 가리키는 기록
  if (!points.length) return <p className="muted">아직 기록이 없습니다. 계통을 고쳐서 결과가 바뀔 때마다 여기에 쌓입니다 (연결 안 된 설비가 있는 중간 단계는 빼고).</p>
  const sel = picked != null && picked < points.length ? picked : points.length - 1
  const profile = points.find((p) => p.profile)?.profile
  const cur = points[sel]
  const hasDaily = points.some((p) => p.daily)

  return (
    <div className="history">
      {hasDaily ? (
        <>
          <div className="history-head">
            <p className="muted small">
              <b>{sel + 1}번째 기록</b> · {time(cur.at)} · {cur.label}
              {profile && (
                <>
                  {' '}
                  · 하루 변화: <b>{profile.name}</b> <span className="tag">가상 패턴 기준</span>
                </>
              )}
            </p>
            <p className="hlegend">
              <span>
                <i className="sw sel" /> 선택한 기록
              </span>
              {sel > 0 && (
                <span>
                  <i className="sw prev" /> 바로 전 기록 (편집 전)
                </span>
              )}
              {points.length > 2 && (
                <span>
                  <i className="sw other" /> 그 밖의 기록
                </span>
              )}
            </p>
          </div>
          <div className="hcharts">
            {METRICS.map((m) => (
              <DailySmall key={m.key} metric={m} points={points} sel={sel} hour={hour} setHour={setHour} />
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            {hover == null ? '마지막 계산' : `${hover + 1}번째 계산`} · {time(points[hover ?? points.length - 1].at)} · {points[hover ?? points.length - 1].label}
          </p>
          <div className="hcharts">
            {METRICS.map((m) => (
              <SeqSmall key={m.key} metric={m} points={points} hover={hover} setHover={setHover} />
            ))}
          </div>
        </>
      )}
      {hasDaily && <p className="muted small table-note">표의 값은 기록마다 하루 중 가장 나쁜 값과 그 시각입니다. 줄을 누르면 그 기록의 하루 곡선을 위 그래프에서 강조합니다.</p>}
      <table className="rtable history-table">
        <thead>
          <tr>
            <th>#</th>
            <th>시각</th>
            <th>바뀐 내용</th>
            {METRICS.map((m) => (
              <th key={m.key} className="num">
                {m.label} ({m.unit})
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr
              key={p.id ?? i}
              className={`${i === sel && hasDaily ? 'hl sel' : hover === i ? 'hl' : ''} clickable`}
              onClick={() => setPicked(i)}
              onMouseEnter={() => !hasDaily && setHover(i)}
              onMouseLeave={() => !hasDaily && setHover(null)}
              title={hasDaily ? '누르면 이 기록의 하루 곡선을 그래프에서 강조합니다' : undefined}
            >
              <td>{i + 1}</td>
              <td>{time(p.at)}</td>
              <td>{p.label}</td>
              {METRICS.map((m) => {
                if (p.daily) {
                  const w = worstOf(p.daily, m)
                  return (
                    <td key={m.key} className="num">
                      {w ? (
                        <>
                          {m.fmt(w.v)} <small className="muted">{w.hour}시</small>
                        </>
                      ) : (
                        '-'
                      )}
                    </td>
                  )
                }
                return (
                  <td key={m.key} className="num">
                    {p[m.key] == null ? '-' : m.fmt(p[m.key])}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {hasDaily && cur.daily && <HourlyTable cur={cur} prev={sel > 0 ? points[sel - 1] : null} sel={sel} hour={hour} setHour={setHour} />}
      {hasDaily && (
        <p className="muted small">
          하루 곡선은 data/daily_profile.csv의 시간대별 배율(가상 패턴, 실측 아님)을 계통의 부하·태양광 값에 곱해 시간마다 다시 계산한 값입니다. 계통 데이터의 부하는
          최대부하, 태양광은 설비용량으로 보았습니다.
        </p>
      )}
    </div>
  )
}
