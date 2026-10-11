// 결과 기록(시점별) 그래프: 편집 후 다시 계산할 때마다 쌓인 값을 시간 순서로 보여 준다.
// 단위가 다른 값은 한 축에 겹치지 않고 작은 그래프 여러 개로 나눈다. 마우스를 올리면 그 시점 값이 보인다.
// ponytail: 지금 "시점"은 편집해서 다시 계산한 순간이고, 기록은 브라우저 메모리에만 있다(새로고침하면 사라짐).
// 제안서 슬라이드 13의 원인 분석 그래프는 하루 시간대별 값으로 보인다. 그 뜻이면 백엔드에 시계열 시뮬레이션
// (OpenDSS daily 모드 + 부하·태양광 시간대 패턴)을 추가하고, 같은 형식의 점 목록을 이 그래프에 넣으면 된다
import { useState } from 'react'
import { FAULT_HIGH_MVA, OVERLOAD_PCT, VOLTAGE_MIN_PU } from '../lib/overlay.js'

const W = 320
const H = 120
const PAD = { l: 44, r: 10, t: 12, b: 22 }

const METRICS = [
  { key: 'minV', label: '① 최저 전압', unit: 'pu', fmt: (v) => v.toFixed(3), limit: VOLTAGE_MIN_PU },
  { key: 'maxLoading', label: '② 최대 부하율', unit: '%', fmt: (v) => v.toFixed(0), limit: OVERLOAD_PCT },
  { key: 'reverseMw', label: '③ 최대 역조류', unit: 'MW', fmt: (v) => v.toFixed(2) },
  { key: 'maxMva', label: '④ 최대 단락용량', unit: 'MVA', fmt: (v) => v.toFixed(0), limit: FAULT_HIGH_MVA },
  { key: 'totalMw', label: '총 송출', unit: 'MW', fmt: (v) => v.toFixed(2) },
  { key: 'lossKw', label: '선로 손실', unit: 'kW', fmt: (v) => v.toFixed(1) },
]

const time = (d) => d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function Small({ metric, points, hover, setHover }) {
  const vals = points.map((p) => p[metric.key]).filter((v) => v != null)
  if (!vals.length) return null
  let lo = Math.min(...vals, metric.limit ?? Infinity)
  let hi = Math.max(...vals, metric.limit ?? -Infinity)
  if (hi - lo < 1e-9) {
    lo -= metric.key === 'minV' ? 0.01 : metric.key === 'reverseMw' ? 0.1 : 1
    hi += metric.key === 'minV' ? 0.01 : metric.key === 'reverseMw' ? 0.1 : 1
  }
  const pad = (hi - lo) * 0.12
  lo -= pad
  hi += pad
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
          p[metric.key] == null ? null : (
            <circle key={i} cx={x(i)} cy={y(p[metric.key])} r={i === shown ? 5 : 4} className={i === shown ? 'hdot on' : 'hdot'} />
          ),
        )}
        {/* 마우스 감지 영역: 점보다 넓게 */}
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

export default function HistoryChart({ points }) {
  const [hover, setHover] = useState(null)
  if (!points.length) return <p className="muted">아직 기록이 없습니다. 계통을 고치면 다시 계산될 때마다 여기에 쌓입니다.</p>
  const shown = points[hover ?? points.length - 1]
  return (
    <div className="history">
      <p className="muted small">
        {hover == null ? '마지막 계산' : `${hover + 1}번째 계산`} · {time(shown.at)} · {shown.label}
      </p>
      <div className="hcharts">
        {METRICS.map((m) => (
          <Small key={m.key} metric={m} points={points} hover={hover} setHover={setHover} />
        ))}
      </div>
      <table className="rtable">
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
            <tr key={i} className={hover === i ? 'hl' : ''} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <td>{i + 1}</td>
              <td>{time(p.at)}</td>
              <td>{p.label}</td>
              {METRICS.map((m) => (
                <td key={m.key} className="num">
                  {p[m.key] == null ? '-' : m.fmt(p[m.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
