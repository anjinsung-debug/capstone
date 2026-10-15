// 원인 분석 탭의 그래프 두 개: 전압 프로파일, 선로별 유효전력 조류.
// 예전에는 서버(simulation/plot.py)가 그린 흰 바탕 PNG를 받아 보여 줬는데, 기록 탭 그래프(HistoryChart)와 같은
// 어두운 색 계열로 맞추려고 화면에서 직접 그린다. 그리는 규칙은 simulation/plot.py와 같다:
//   전압 프로파일 = 가로축 변전소로부터 선로를 따라 잰 거리(km), 세로축 전압(pu), 선로마다 양 끝 전압을 선으로 잇고
//                   정상 범위 밖 점은 빨강
//   선로 조류     = 선로(차단기·개폐기 연결 제외)별 유효전력 kW 막대, 역조류 주황 · 과부하 빨강 · 막대 끝에 부하율
// 거리 계산은 simulation/dss.py의 trace와 같은 규칙 (전원 접속점에서 출발, 열린 개폐기에 닿은 선로는 건너뜀)
import { useState } from 'react'
import { COLORS, OVERLOAD_PCT, VOLTAGE_MAX_PU, VOLTAGE_MIN_PU } from '../lib/overlay.js'

// 전원에서 닿는 노드 id → 거리(km)
function distances(graph) {
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]))
  const source = graph.nodes.find((n) => n.type === 'source')
  if (!source?.bus_id) return {}
  const isOpen = (id) => byId[id]?.type === 'switch' && byId[id].is_open
  const adj = {}
  for (const l of graph.lines) {
    if (isOpen(l.from_node_id) || isOpen(l.to_node_id)) continue
    ;(adj[l.from_node_id] ??= []).push(l)
    ;(adj[l.to_node_id] ??= []).push(l)
  }
  const dist = { [source.bus_id]: 0 }
  const queue = [source.bus_id]
  while (queue.length) {
    const cur = queue.shift()
    for (const l of adj[cur] ?? []) {
      const other = l.from_node_id === cur ? l.to_node_id : l.from_node_id
      if (other in dist) continue
      dist[other] = dist[cur] + (l.length_km || 0)
      queue.push(other)
    }
  }
  return dist
}

const fmtTick = (v, d) => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(d))

function VoltageProfile({ graph, result }) {
  const [hover, setHover] = useState(null)
  const W = 640
  const H = 240
  const P = { l: 46, r: 14, t: 14, b: 32 }
  const dist = distances(graph)
  const volt = Object.fromEntries(result.nodes.filter((r) => r.energized).map((r) => [r.node_id, r.voltage_pu]))
  const names = Object.fromEntries(graph.nodes.map((n) => [n.id, n.name]))
  const pts = Object.keys(dist)
    .filter((id) => volt[id] != null)
    .map((id) => ({ id, d: dist[id], v: volt[id], name: names[id] }))
  if (!pts.length) return <p className="muted">전원에서 닿는 지점이 없어 그릴 수 없습니다.</p>

  const maxD = Math.max(...pts.map((p) => p.d), 0.1)
  let lo = Math.min(VOLTAGE_MIN_PU, ...pts.map((p) => p.v))
  let hi = Math.max(VOLTAGE_MAX_PU, ...pts.map((p) => p.v))
  const pad = (hi - lo) * 0.08
  lo -= pad
  hi += pad
  const x = (d) => P.l + (d / maxD) * (W - P.l - P.r)
  const y = (v) => P.t + ((hi - v) * (H - P.t - P.b)) / (hi - lo)
  const bad = (v) => v < VOLTAGE_MIN_PU || v > VOLTAGE_MAX_PU
  const segs = graph.lines.filter((l) => dist[l.from_node_id] != null && dist[l.to_node_id] != null && volt[l.from_node_id] != null && volt[l.to_node_id] != null)
  const yTicks = [VOLTAGE_MIN_PU, 1.0, VOLTAGE_MAX_PU]
  const step = maxD > 8 ? 2 : maxD > 3 ? 1 : 0.5
  const xTicks = Array.from({ length: Math.floor(maxD / step) + 1 }, (_, i) => i * step)
  const shown = hover ?? pts.reduce((a, p) => (Math.abs(p.v - 1) > Math.abs(a.v - 1) ? p : a))

  return (
    <figure className="hchart wide-chart">
      <figcaption>
        <span>전압 프로파일 (변전소로부터 거리별)</span>
        <b>
          {shown.name} · {shown.v.toFixed(3)} pu · {shown.d.toFixed(2)} km
        </b>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="전압 프로파일" onMouseLeave={() => setHover(null)}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className={v === 1 ? 'hgrid' : 'hlimit'} />
            <text x={P.l - 6} y={y(v) + 3} className="htick" textAnchor="end">
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        <text x={W - P.r} y={y(VOLTAGE_MIN_PU) - 4} className="htick" textAnchor="end">
          기준 {VOLTAGE_MIN_PU}
        </text>
        <text x={W - P.r} y={y(VOLTAGE_MAX_PU) - 4} className="htick" textAnchor="end">
          기준 {VOLTAGE_MAX_PU}
        </text>
        {xTicks.map((d) => (
          <text key={d} x={x(d)} y={H - P.b + 14} className="htick" textAnchor="middle">
            {fmtTick(d, step < 1 ? 1 : 0)}
          </text>
        ))}
        <text x={(P.l + W - P.r) / 2} y={H - 4} className="htick" textAnchor="middle">
          변전소로부터 거리 (km)
        </text>
        {segs.map((l) => (
          <line
            key={l.id}
            x1={x(dist[l.from_node_id])}
            y1={y(volt[l.from_node_id])}
            x2={x(dist[l.to_node_id])}
            y2={y(volt[l.to_node_id])}
            className="hline"
          />
        ))}
        {pts.map((p) => (
          <circle
            key={p.id}
            cx={x(p.d)}
            cy={y(p.v)}
            r={hover?.id === p.id ? 5 : 3.5}
            className={hover?.id === p.id ? 'hdot on' : 'hdot'}
            style={bad(p.v) ? { fill: COLORS.red } : undefined}
            onMouseEnter={() => setHover(p)}
          >
            <title>{`${p.name}: ${p.v.toFixed(3)} pu, ${p.d.toFixed(2)} km`}</title>
          </circle>
        ))}
      </svg>
    </figure>
  )
}

function LineFlowChart({ graph, result }) {
  const flows = Object.fromEntries(result.lines.map((r) => [r.line_id, r]))
  const names = Object.fromEntries(graph.nodes.map((n) => [n.id, n.name]))
  const lines = graph.lines
    .filter((l) => l.kind === 'line' && flows[l.id])
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  if (!lines.length) return null
  const ROW = 22
  const W = 640
  const P = { l: 170, r: 46, t: 8, b: 28 }
  const H = P.t + P.b + lines.length * ROW
  const ps = lines.map((l) => flows[l.id].p_kw)
  const lo = Math.min(0, ...ps)
  const hi = Math.max(0, ...ps)
  const span = hi - lo || 1
  const x = (v) => P.l + ((v - lo) / span) * (W - P.l - P.r)
  const color = (r) => ((r.loading_pct ?? 0) > OVERLOAD_PCT ? COLORS.red : r.reverse_flow ? COLORS.orange : 'var(--accent)')
  const label = (l) => l.name || `${names[l.from_node_id]} → ${names[l.to_node_id]}`
  const short = (s) => (s.length > 22 ? `${s.slice(0, 21)}…` : s)

  return (
    <figure className="hchart wide-chart">
      <figcaption>
        <span>선로 유효전력 조류 (주황: 역조류, 빨강: 과부하, 막대 끝: 부하율)</span>
        <b>{lines.length}개 선로</b>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="선로별 유효전력 조류">
        <line x1={x(0)} x2={x(0)} y1={P.t} y2={H - P.b} className="hcross" />
        {lines.map((l, i) => {
          const r = flows[l.id]
          const yy = P.t + i * ROW
          const x0 = x(Math.min(0, r.p_kw))
          const w = Math.max(Math.abs(x(r.p_kw) - x(0)), 1)
          const end = r.p_kw >= 0 ? x(r.p_kw) + 4 : x(r.p_kw) - 4
          return (
            <g key={l.id}>
              <text x={P.l - 8} y={yy + ROW / 2 + 3} className="htick" textAnchor="end">
                <title>{label(l)}</title>
                {short(label(l))}
              </text>
              <rect x={x0} y={yy + 4} width={w} height={ROW - 8} rx={2} style={{ fill: color(r) }}>
                <title>{`${label(l)}: ${r.p_kw.toFixed(0)} kW${r.loading_pct == null ? '' : `, 부하율 ${r.loading_pct.toFixed(0)}%`}`}</title>
              </rect>
              {r.loading_pct != null && (
                <text x={end} y={yy + ROW / 2 + 3} className="htick" textAnchor={r.p_kw >= 0 ? 'start' : 'end'}>
                  {r.loading_pct.toFixed(0)}%
                </text>
              )}
            </g>
          )
        })}
        <text x={x(lo)} y={H - 12} className="htick" textAnchor="start">
          {lo.toFixed(0)}
        </text>
        <text x={x(hi)} y={H - 12} className="htick" textAnchor="end">
          {hi.toFixed(0)}
        </text>
        <text x={(P.l + W - P.r) / 2} y={H - 2} className="htick" textAnchor="middle">
          유효전력 (kW, 전원 → 말단 방향이 +)
        </text>
      </svg>
    </figure>
  )
}

export default function ProfileCharts({ graph, result }) {
  return (
    <div className="profile-charts">
      <VoltageProfile graph={graph} result={result} />
      <LineFlowChart graph={graph} result={result} />
    </div>
  )
}
