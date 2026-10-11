// 시뮬레이션 결과 → 단선도 오버레이 값 (제안서 3단계, 4대 시뮬레이션)
// 판정 기준은 simulation/models.py와 같아야 한다. 바꾸면 두 곳을 함께 고친다.
// ponytail: 기준값을 프론트에 복사해 두었다. 기준을 화면에서 바꾸게 하거나 자주 바뀌면 API로 받아 오게 바꾼다
export const VOLTAGE_MIN_PU = 0.95
export const VOLTAGE_MAX_PU = 1.05
export const OVERLOAD_PCT = 100

export const COLORS = {
  normal: '#3ecf8e', // 정상
  low: '#4da3ff', // 저전압
  high: '#ff9f43', // 과전압
  outage: '#4b555c', // 정전 (전원에서 끊김)
  overload: '#ff5d5d', // 과부하
  reverse: '#ffb020', // 역조류
  feeder: '#ffd84d', // 피더 송출 전력 (황색)
  idle: '#5a6770', // 결과 없음
}

// 전압 판정: 'outage' | 'low' | 'high' | 'normal'
export function voltageState(nr) {
  if (!nr.energized) return 'outage'
  if (nr.voltage_pu < VOLTAGE_MIN_PU) return 'low'
  if (nr.voltage_pu > VOLTAGE_MAX_PU) return 'high'
  return 'normal'
}

// 단자 1개 설비(부하·PV)는 자기 접속점의 전압을 쓰므로 결과에 없을 수도 있어 접속점 값으로 채운다
function nodeResultMap(graph, result) {
  const map = Object.fromEntries(result.nodes.map((r) => [r.node_id, r]))
  for (const n of graph.nodes) if (!map[n.id] && n.bus_id && map[n.bus_id]) map[n.id] = map[n.bus_id]
  return map
}

// Cytoscape data에 넣을 값. labelMode: 'voltage' | 'fault' | 'name'
export function buildOverlay(graph, result, labelMode) {
  const nodeRes = nodeResultMap(graph, result)
  const nodes = {}
  for (const n of graph.nodes) {
    const r = nodeRes[n.id]
    if (!r) continue
    const state = voltageState(r)
    let sub = ''
    if (state === 'outage') sub = '정전'
    else if (labelMode === 'voltage') sub = `${r.voltage_pu.toFixed(3)} pu`
    else if (labelMode === 'fault' && r.fault_current_ka != null) sub = `${r.fault_current_ka.toFixed(2)} kA`
    nodes[n.id] = { state, color: COLORS[state], sub }
  }

  const lines = {}
  for (const r of result.lines) {
    const overload = r.loading_pct != null && r.loading_pct > OVERLOAD_PCT
    const off = Math.abs(r.p_kw) < 1e-6 && Math.abs(r.q_kvar) < 1e-6
    const state = overload ? 'overload' : r.reverse_flow ? 'reverse' : off ? 'outage' : 'normal'
    // 두께: 부하율 0% → 2px, 100% → 8px, 150% 이상은 같은 굵기 (부하율이 없으면 기본 3px)
    // 부하율은 허용전류 기준인데 한전 데이터에 허용전류가 없어 400 A 가정값(simulation/dss.py)으로 계산된 값이다
    const width = r.loading_pct == null ? 3 : 2 + Math.min(r.loading_pct, 150) * 0.06
    lines[r.line_id] = {
      state,
      color: COLORS[state],
      width,
      // 화살표는 실제 유효전력이 흐르는 방향 (p_kw는 저장된 from → to 기준 부호)
      forward: r.p_kw >= 0,
      sub: r.loading_pct == null ? `${Math.round(Math.abs(r.p_kw))} kW` : `${r.loading_pct.toFixed(0)}%`,
    }
  }

  // 피더별 송출 전력: 그 피더의 출구 차단기 옆에 황색 표시
  // ponytail: 상자 위치는 차단기 오른쪽 90px 고정. 차단기 옆에 다른 설비가 있으면 겹칠 수 있으니 그때 위치 계산을 넣는다
  const feederLabels = result.feeders
    .map((f) => {
      const breaker = graph.nodes.find((n) => n.type === 'breaker' && n.feeder_id === f.feeder_id)
      if (!breaker) return null
      return {
        id: `feeder:${f.feeder_id}`,
        breakerId: breaker.id,
        x: breaker.x + 90,
        y: breaker.y,
        label: `${(f.p_kw / 1000).toFixed(2)} MW\n${(f.q_kvar / 1000).toFixed(2)} MVAr`,
      }
    })
    .filter(Boolean)

  return { nodes, lines, feederLabels }
}

// 결과 요약 (상단 카드용): 문제 항목 개수
export function summarize(graph, result) {
  const nodeRes = result.nodes
  const names = Object.fromEntries(graph.nodes.map((n) => [n.id, n.name]))
  const lineNames = Object.fromEntries(graph.lines.map((l) => [l.id, l.name]))
  const low = nodeRes.filter((r) => voltageState(r) === 'low')
  const high = nodeRes.filter((r) => voltageState(r) === 'high')
  const outage = nodeRes.filter((r) => !r.energized)
  const overload = result.lines.filter((r) => r.loading_pct != null && r.loading_pct > OVERLOAD_PCT)
  const reverse = result.lines.filter((r) => r.reverse_flow)
  const energized = nodeRes.filter((r) => r.energized)
  const minV = energized.length ? Math.min(...energized.map((r) => r.voltage_pu)) : null
  const maxFault = Math.max(0, ...nodeRes.map((r) => r.fault_current_ka ?? 0))
  return {
    minV,
    maxFault,
    // refs: 단선도에서 그 위치로 이동하기 위한 { id, name } (결과 패널의 위치 버튼이 씀)
    items: [
      { key: 'low', label: '저전압', color: COLORS.low, refs: low.map((r) => ({ id: r.node_id, name: names[r.node_id] })) },
      { key: 'high', label: '과전압', color: COLORS.high, refs: high.map((r) => ({ id: r.node_id, name: names[r.node_id] })) },
      { key: 'overload', label: '과부하 선로', color: COLORS.overload, refs: overload.map((r) => ({ id: r.line_id, name: lineNames[r.line_id] })) },
      { key: 'reverse', label: '역조류 선로', color: COLORS.reverse, refs: reverse.map((r) => ({ id: r.line_id, name: lineNames[r.line_id] })) },
      { key: 'outage', label: '정전 지점', color: COLORS.outage, refs: outage.map((r) => ({ id: r.node_id, name: names[r.node_id] })) },
    ].map((it) => ({ ...it, count: it.refs.length })),
    // 지점별 결과 (전압 낮은 순). 정전 지점은 전압 0이라 맨 앞에 온다
    nodes: nodeRes
      .map((r) => ({ id: r.node_id, name: names[r.node_id], voltage: r.energized ? r.voltage_pu : null, fault: r.fault_current_ka, state: voltageState(r) }))
      .filter((r) => r.name)
      .sort((a, b) => (a.voltage ?? -1) - (b.voltage ?? -1)),
  }
}
