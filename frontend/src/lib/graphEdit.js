// 단선도 편집 로직 (제안서 4단계, FR-06, FR-07). 담당: 프론트엔드
// 화면(Cytoscape)과 분리된 순수 함수 모음. 모든 함수는 계통(SubstationGraph)을 고치지 않고 새 계통을 돌려준다.
// 형식은 cim/models.py와 같다: { substation, feeders, nodes, lines }

export const GRID = 20 // 단선도 격자 간격 (cim/load.py의 자동 배치 간격 120·100의 약수)

// 설비 종류 7가지 (cim/models.py의 NodeType). oneTerminal: 선로가 아니라 bus_id로 접속점에 붙는 설비
export const NODE_TYPES = {
  source: { label: '변전소 전원', short: '전원', oneTerminal: true },
  breaker: { label: '출구 차단기', short: '차단기', oneTerminal: false },
  switch: { label: '개폐기', short: '개폐기', oneTerminal: false },
  bus: { label: '접속점', short: '접속점', oneTerminal: false },
  load: { label: '부하', short: '부하', oneTerminal: true },
  pv: { label: '태양광', short: '태양광', oneTerminal: true },
  wind: { label: '풍력', short: '풍력', oneTerminal: true },
}

// 새 선로 기본값. 한전 데이터의 가는 선로(0.32+j0.38 Ω/km) 기준, 길이는 편집 후 고친다
// ponytail: 선종 구분 없이 한 값만 쓴다. 선종(ACSR 160·58 등) 목록이 생기면 선택 목록으로 바꾼다
export const DEFAULT_LINE = { length_km: 1.0, r_ohm_per_km: 0.32, x_ohm_per_km: 0.38 }

export const newId = () => crypto.randomUUID()
export const snap = (v) => Math.round(v / GRID) * GRID

// cim/graph.py의 classify_connection과 같은 규칙: 차단기·개폐기에 닿으면 switch, 그 외 line
// (저장하면 서버가 다시 계산하므로, 여기 값은 저장 전 화면 표시용이다. 규칙이 바뀌면 두 곳을 같이 고친다)
export function classifyConnection(a, b) {
  return a.type === 'breaker' || a.type === 'switch' || b.type === 'breaker' || b.type === 'switch' ? 'switch' : 'line'
}

export function emptyGraph(name) {
  return {
    substation: { id: newId(), name, source_voltage_pu: 1.0, short_circuit_mva: null, x_r_ratio: null },
    feeders: [],
    nodes: [],
    lines: [],
  }
}

function nextName(graph, type) {
  const short = NODE_TYPES[type].short
  const used = new Set(graph.nodes.map((n) => n.name))
  let i = graph.nodes.filter((n) => n.type === type).length + 1
  while (used.has(`${short} ${i}`)) i++
  return `${short} ${i}`
}

// 노드 추가. 차단기를 추가하면 그 차단기에서 시작하는 피더도 함께 만든다
// 부하 1000 kW·300 kvar, 분산전원 500 kW는 바로 시뮬레이션해 볼 수 있게 넣은 예시값 (속성 패널에서 고침)
export function addNode(graph, type, x, y) {
  const sid = graph.substation.id
  const node = {
    id: newId(),
    substation_id: sid,
    feeder_id: null,
    name: nextName(graph, type),
    type,
    x: snap(x),
    y: snap(y),
    p_kw: type === 'load' ? 1000 : type === 'pv' || type === 'wind' ? 500 : null,
    q_kvar: type === 'load' ? 300 : type === 'pv' || type === 'wind' ? 0 : null,
    is_open: false,
    bus_id: null,
  }
  let feeders = graph.feeders
  if (type === 'breaker') {
    const feeder = { id: newId(), substation_id: sid, name: node.name }
    node.feeder_id = feeder.id
    feeders = [...feeders, feeder]
  }
  return { graph: { ...graph, feeders, nodes: [...graph.nodes, node] }, node }
}

// 두 노드 연결. 단자 1개 설비(전원·부하·태양광·풍력)는 접속점에 bus_id로 붙이고, 나머지는 선로를 만든다.
// 반환: { graph, error } (error가 있으면 graph는 그대로)
export function connect(graph, aId, bId) {
  if (aId === bId) return { graph, error: '같은 노드끼리는 연결할 수 없습니다' }
  const a = graph.nodes.find((n) => n.id === aId)
  const b = graph.nodes.find((n) => n.id === bId)
  if (!a || !b) return { graph, error: '노드를 찾을 수 없습니다' }

  const aOne = NODE_TYPES[a.type].oneTerminal
  const bOne = NODE_TYPES[b.type].oneTerminal
  if (aOne || bOne) {
    if (aOne && bOne) return { graph, error: `${a.name}·${b.name}: 부하·전원·분산전원끼리는 직접 연결할 수 없습니다. 접속점에 붙이세요` }
    const [device, bus] = aOne ? [a, b] : [b, a]
    if (bus.type !== 'bus') return { graph, error: `${device.name}은(는) 접속점(bus)에만 붙일 수 있습니다` }
    return { graph: updateNode(graph, device.id, { bus_id: bus.id }), error: null }
  }

  const exists = graph.lines.some(
    (l) => (l.from_node_id === aId && l.to_node_id === bId) || (l.from_node_id === bId && l.to_node_id === aId),
  )
  if (exists) return { graph, error: `${a.name}과(와) ${b.name}은(는) 이미 연결되어 있습니다` }

  const kind = classifyConnection(a, b)
  const line = {
    id: newId(),
    substation_id: graph.substation.id,
    feeder_id: null,
    name: `${a.name}-${b.name}`,
    kind,
    from_node_id: aId, // 먼저 누른 쪽. 저장할 때 orientLines가 전원 쪽으로 바로잡는다
    to_node_id: bId,
    ...(kind === 'switch' ? { length_km: 0, r_ohm_per_km: 0, x_ohm_per_km: 0 } : DEFAULT_LINE),
    rated_current_a: null,
  }
  return { graph: { ...graph, lines: [...graph.lines, line] }, error: null }
}

export function updateNode(graph, id, patch) {
  const nodes = graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n))
  let feeders = graph.feeders
  const node = nodes.find((n) => n.id === id)
  // 차단기 이름이 바뀌면 피더 이름도 같이 바꾼다 (피더 이름 = 출구 차단기 이름)
  if (node?.type === 'breaker' && patch.name !== undefined) {
    feeders = feeders.map((f) => (f.id === node.feeder_id ? { ...f, name: patch.name } : f))
  }
  return { ...graph, nodes, feeders }
}

export function updateLine(graph, id, patch) {
  return { ...graph, lines: graph.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }
}

export function updateSubstation(graph, patch) {
  return { ...graph, substation: { ...graph.substation, ...patch } }
}

export const attachEdgeId = (nodeId) => `attach:${nodeId}`

// 선택한 요소 삭제. ids에는 노드 id, 선로 id, 붙임선(attach:<노드 id>)이 섞여 올 수 있다.
// 노드를 지우면 닿은 선로·거기 붙은 설비의 bus_id도 정리하고, 차단기를 지우면 그 피더도 지운다.
export function removeElements(graph, ids) {
  const idSet = new Set(ids)
  const removedNodes = new Set(graph.nodes.filter((n) => idSet.has(n.id)).map((n) => n.id))
  const detach = new Set(ids.filter((i) => i.startsWith('attach:')).map((i) => i.slice('attach:'.length)))
  const removedFeeders = new Set(
    graph.nodes.filter((n) => removedNodes.has(n.id) && n.type === 'breaker').map((n) => n.feeder_id),
  )
  const nodes = graph.nodes
    .filter((n) => !removedNodes.has(n.id))
    .map((n) => (detach.has(n.id) || removedNodes.has(n.bus_id) ? { ...n, bus_id: null } : n))
  const lines = graph.lines.filter(
    (l) => !idSet.has(l.id) && !removedNodes.has(l.from_node_id) && !removedNodes.has(l.to_node_id),
  )
  const feeders = graph.feeders.filter((f) => !removedFeeders.has(f.id))
  return { ...graph, nodes, lines, feeders }
}

// 저장 직전 정리 (cim/topology.py의 trace_feeders와 같은 규칙):
// ponytail: 서버(cim/graph.py의 _prepare_snapshot)도 같은 계산을 다시 하므로 진짜 백엔드에서는 결과가 덮어써진다.
// 모의 서버와 저장 전 화면 표시를 위해 남겨 둔 것. 규칙이 어긋나 헷갈리면 이 함수는 피더 정리만 남기고 줄인다
// - 차단기마다 피더가 하나씩 있게 맞춘다
// - 전원 접속점에서 선로를 따라가며 선로 방향을 전원 쪽 → 반대쪽으로 바로잡고 (Neo4j에서 아래쪽 탐색이 맞게)
// - 지나간 차단기의 피더를 아래쪽 노드·선로의 feeder_id로 채운다. 열린 개폐기 너머로는 내려가지 않는다
// 전원이 없거나 아직 bus_id가 없으면(미완성 계통) 피더 정리만 하고 나머지는 그대로 둔다
export function prepareForSave(graph) {
  const sid = graph.substation.id
  // 1) 차단기 ↔ 피더 1:1
  const claimed = new Set()
  let feeders = [...graph.feeders]
  let nodes = graph.nodes.map((n) => {
    if (n.type !== 'breaker') return n
    const f = feeders.find((x) => x.id === n.feeder_id)
    if (f && !claimed.has(f.id)) {
      claimed.add(f.id)
      return n
    }
    const nf = { id: newId(), substation_id: sid, name: n.name }
    feeders.push(nf)
    claimed.add(nf.id)
    return { ...n, feeder_id: nf.id }
  })
  feeders = feeders.filter((f) => claimed.has(f.id))

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const source = nodes.find((n) => n.type === 'source' && n.bus_id && byId[n.bus_id])
  if (!source) return { ...graph, nodes, feeders }

  // 2) 너비 우선 탐색
  const adj = {}
  for (const l of graph.lines) {
    ;(adj[l.from_node_id] ??= []).push(l)
    ;(adj[l.to_node_id] ??= []).push(l)
  }
  const feederOf = { [source.bus_id]: null }
  const lineFix = {}
  const queue = [source.bus_id]
  const used = new Set()
  while (queue.length) {
    const cur = queue.shift()
    if (byId[cur].type === 'switch' && byId[cur].is_open) continue
    for (const l of adj[cur] ?? []) {
      if (used.has(l.id)) continue
      used.add(l.id)
      const nxt = l.from_node_id === cur ? l.to_node_id : l.from_node_id
      if (nxt in feederOf) continue // 루프: 방향은 그대로 두고 시뮬레이션이 422로 알려 준다
      const fid = byId[nxt].type === 'breaker' ? byId[nxt].feeder_id : feederOf[cur]
      feederOf[nxt] = fid
      lineFix[l.id] = { from_node_id: cur, to_node_id: nxt, feeder_id: fid }
      queue.push(nxt)
    }
  }
  nodes = nodes.map((n) => {
    const key = NODE_TYPES[n.type].oneTerminal ? n.bus_id : n.id
    if (n.type === 'breaker' || n.type === 'source') return n.type === 'source' ? { ...n, feeder_id: null } : n
    return { ...n, feeder_id: key in feederOf ? feederOf[key] : null }
  })
  const lines = graph.lines.map((l) => (lineFix[l.id] ? { ...l, ...lineFix[l.id] } : l))
  return { ...graph, nodes, lines, feeders }
}

// 시뮬레이션 전에 화면에서 미리 알려 줄 빠진 항목 (simulation/dss.py의 check_complete와 같은 규칙)
// 진짜 백엔드는 저장할 때도 전원 1개를 요구한다 (cim/graph.py). 규칙이 바뀌면 여기도 고친다
export function findIssues(graph) {
  if (!graph) return []
  const issues = []
  const sources = graph.nodes.filter((n) => n.type === 'source').length
  if (sources !== 1) issues.push(`변전소 전원이 ${sources}개입니다 (1개 필요)`)
  if (!graph.nodes.some((n) => n.type === 'breaker')) issues.push('출구 차단기가 없습니다')
  for (const n of graph.nodes) {
    const t = NODE_TYPES[n.type]
    if (['load', 'pv', 'wind'].includes(n.type) && (n.p_kw === null || n.p_kw === undefined))
      issues.push(`${n.name}: 출력(kW)이 없습니다`)
    if (t.oneTerminal && !n.bus_id) issues.push(`${n.name}: 접속점에 연결되지 않았습니다`)
  }
  return issues
}

// PUT /api/substations/{id}로 보낼 스냅샷. 화면 전용 값은 빼고 cim/models.py 필드만 보낸다
export function toSnapshot(graph) {
  const g = prepareForSave(graph)
  return {
    substation: g.substation,
    feeders: g.feeders,
    nodes: g.nodes.map(({ id, substation_id, feeder_id, name, type, x, y, p_kw, q_kvar, is_open, bus_id }) => ({
      id, substation_id, feeder_id, name, type, x, y, p_kw, q_kvar,
      is_open: type === 'switch' ? Boolean(is_open) : false,
      bus_id: NODE_TYPES[type].oneTerminal ? bus_id : null,
    })),
    lines: g.lines.map(({ id, substation_id, feeder_id, name, kind, from_node_id, to_node_id, length_km, r_ohm_per_km, x_ohm_per_km, rated_current_a }) => ({
      id, substation_id, feeder_id, name, kind, from_node_id, to_node_id, length_km, r_ohm_per_km, x_ohm_per_km, rated_current_a,
    })),
  }
}
