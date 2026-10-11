// 시뮬레이션 결과 → 단선도 오버레이·건강도 진단 값 (제안서 3단계 "4대 시뮬레이션", 5단계 "계통건강도 진단")
// 화면 구성은 오프라인 미팅 자료(AI_22.9kV 배전선로 웹 시뮬레이터 제안서) 기준:
//   슬라이드 8  4대 시뮬레이션 모드: ① 전압 영향 ② 선로 과부하 ③ 역조류 ④ 단락용량 고장전류 + 피더별 MW/MVAr 황색 표시
//   슬라이드 10·12 계통건강도 진단표(항목·기준·최악 값·판정 정상/주의/위험), 문제별 대안 후보
//
// 정상 범위(VOLTAGE_MIN_PU, VOLTAGE_MAX_PU, OVERLOAD_PCT)는 simulation/models.py와 같아야 한다. 바꾸면 두 곳을 함께 고친다.
// ponytail: 색 구간(0.98 pu, 80%·50%, 300·100·50 MVA)과 판정 등급은 제안서 슬라이드 예시값을 프론트에만 두었다.
// 한전 자문으로 기준이 확정되면 simulation/models.py로 옮기고 API로 받아 오게 바꾼다
export const VOLTAGE_MIN_PU = 0.95
export const VOLTAGE_MAX_PU = 1.05
export const OVERLOAD_PCT = 100

export const VOLTAGE_WATCH_PU = 0.98 // 0.95~0.98: 정상 범위지만 낮은 편 (슬라이드 8 주황)
export const VOLTAGE_DANGER_LOW_PU = 0.9 // 이보다 낮거나 아래보다 높으면 '위험' (제안서에 없음, 팀 가정값)
export const VOLTAGE_DANGER_HIGH_PU = 1.1
export const LOADING_WATCH_PCT = 80 // 80~100% 주의 (슬라이드 8)
export const LOADING_LOW_PCT = 50 // 50% 미만은 회색 (여유)
export const FAULT_HIGH_MVA = 300 // 단락용량 300 MVA 초과 높음 (슬라이드 8), 진단표 '주의' (슬라이드 10: 350 MVA → 주의)
export const FAULT_MID_MVA = 100
export const FAULT_LOW_MVA = 50
export const BASE_KV = 22.9 // cim/models.py의 BASE_KV (선간 전압)

// 3상 단락용량(MVA) = √3 × 선간전압(kV) × 단락전류(kA)
export const mvaOf = (ka) => (ka == null ? null : Math.sqrt(3) * BASE_KV * ka)

export const COLORS = {
  red: '#ff5d5d',
  orange: '#ffb020',
  green: '#3ecf8e',
  blue: '#4da3ff',
  gray: '#7a8890',
  outage: '#4b555c', // 정전 (전원에서 끊김)
  feeder: '#ffd84d', // 피더 송출 전력 (황색)
  idle: '#5a6770', // 기본 선 색
  // 예전 이름 (PropertyPanel 등에서 사용)
  normal: '#3ecf8e',
  low: '#ff5d5d',
  high: '#4da3ff',
  overload: '#ff5d5d',
  reverse: '#ff5d5d',
}

// 건강도 판정 3단계 (슬라이드 10: 정상 ● 주의 ● 위험 ●)
export const LEVELS = {
  ok: { label: '정상', color: COLORS.green },
  warn: { label: '주의', color: COLORS.orange },
  danger: { label: '위험', color: COLORS.red },
}

// 단선도 표시 모드 (오른쪽 위 버튼). 건강도 = 문제 위치만 강조해서 한눈에, 나머지 넷 = 슬라이드 8의 4대 시뮬레이션
export const MODES = [
  ['health', '건강도'],
  ['voltage', '① 전압'],
  ['loading', '② 과부하'],
  ['reverse', '③ 역조류'],
  ['fault', '④ 단락용량'],
]

// 모드별 범례 (슬라이드 8의 범례와 같은 구간·색)
export const LEGENDS = {
  health: [
    ['정상', COLORS.green],
    ['주의', COLORS.orange],
    ['위험', COLORS.red],
    ['정전', COLORS.outage],
  ],
  voltage: [
    [`< ${VOLTAGE_MIN_PU} 저하`, COLORS.red],
    [`${VOLTAGE_MIN_PU}~${VOLTAGE_WATCH_PU}`, COLORS.orange],
    [`${VOLTAGE_WATCH_PU}~${VOLTAGE_MAX_PU} 정상`, COLORS.green],
    [`> ${VOLTAGE_MAX_PU} 상승`, COLORS.blue],
    ['정전', COLORS.outage],
  ],
  loading: [
    [`> ${OVERLOAD_PCT}% 과부하`, COLORS.red],
    [`${LOADING_WATCH_PCT}~${OVERLOAD_PCT}% 주의`, COLORS.orange],
    [`${LOADING_LOW_PCT}~${LOADING_WATCH_PCT}% 정상`, COLORS.green],
    [`< ${LOADING_LOW_PCT}%`, COLORS.gray],
  ],
  reverse: [
    ['정방향 (부하 방향)', COLORS.blue],
    ['역조류 (발전 → 변전소)', COLORS.red],
  ],
  fault: [
    [`> ${FAULT_HIGH_MVA} MVA 높음`, COLORS.red],
    [`${FAULT_MID_MVA}~${FAULT_HIGH_MVA} 주의`, COLORS.orange],
    [`${FAULT_LOW_MVA}~${FAULT_MID_MVA} 보통`, COLORS.green],
    [`< ${FAULT_LOW_MVA} 낮음`, COLORS.blue],
  ],
}

// 전압 판정 (속성 패널·요소별 표): 'outage' | 'low' | 'high' | 'normal'
export function voltageState(nr) {
  if (!nr.energized) return 'outage'
  if (nr.voltage_pu < VOLTAGE_MIN_PU) return 'low'
  if (nr.voltage_pu > VOLTAGE_MAX_PU) return 'high'
  return 'normal'
}

export function voltageColor(nr) {
  if (!nr.energized) return COLORS.outage
  const v = nr.voltage_pu
  if (v < VOLTAGE_MIN_PU) return COLORS.red
  if (v < VOLTAGE_WATCH_PU) return COLORS.orange
  if (v <= VOLTAGE_MAX_PU) return COLORS.green
  return COLORS.blue
}

export function loadingColor(pct) {
  if (pct == null) return COLORS.idle
  if (pct > OVERLOAD_PCT) return COLORS.red
  if (pct >= LOADING_WATCH_PCT) return COLORS.orange
  if (pct >= LOADING_LOW_PCT) return COLORS.green
  return COLORS.gray
}

export function faultColor(mva) {
  if (mva == null) return COLORS.outage
  if (mva > FAULT_HIGH_MVA) return COLORS.red
  if (mva >= FAULT_MID_MVA) return COLORS.orange
  if (mva >= FAULT_LOW_MVA) return COLORS.green
  return COLORS.blue
}

// 선로 두께(px): 부하율 0% → 1.5px, 50% → 6px, 100% → 10.5px, 150% 이상은 같은 굵기.
// (예전 2~8px는 한전 예시처럼 부하율이 10~30%대면 차이가 거의 안 보여서 범위를 넓혔다)
export const lineWidth = (loadingPct) => 1.5 + Math.min(Math.max(loadingPct, 0), 150) * 0.09

// 단자 1개 설비(부하·PV)는 자기 접속점의 전압을 쓰므로 결과에 없을 수도 있어 접속점 값으로 채운다
function nodeResultMap(graph, result) {
  const map = Object.fromEntries(result.nodes.map((r) => [r.node_id, r]))
  for (const n of graph.nodes) if (!map[n.id] && n.bus_id && map[n.bus_id]) map[n.id] = map[n.bus_id]
  return map
}

const fmtMw = (kw) => `${(Math.abs(kw) / 1000).toFixed(2)} MW`

// ── 계통건강도 진단 (슬라이드 10·13의 '계통건강도 지표' 표) ──
// 항목마다 기준, 최악 값과 그 위치, 해당 개수, 판정(ok·warn·danger)을 돌려준다
export function healthCheck(graph, result) {
  const names = Object.fromEntries(graph.nodes.map((n) => [n.id, n.name]))
  const lineName = (l) => l.name || `${names[l.from_node_id]} → ${names[l.to_node_id]}`
  const lineById = Object.fromEntries(graph.lines.map((l) => [l.id, l]))
  // 단자 1개 설비는 자기 접속점과 값이 같으므로 접속점(결과에 직접 있는 노드)만 본다
  const busRes = result.nodes.filter((r) => names[r.node_id] !== undefined)
  const energized = busRes.filter((r) => r.energized)

  // 1) 전압: 정상 범위에서 가장 멀리 벗어난 노드
  let vWorst = null
  for (const r of energized) {
    const dev = r.voltage_pu < 1 ? 1 - r.voltage_pu : r.voltage_pu - 1
    if (!vWorst || dev > vWorst.dev) vWorst = { r, dev }
  }
  const vBad = energized.filter((r) => r.voltage_pu < VOLTAGE_MIN_PU || r.voltage_pu > VOLTAGE_MAX_PU)
  const minV = energized.length ? Math.min(...energized.map((r) => r.voltage_pu)) : null
  const vw = vWorst?.r
  const vLevel = !vw
    ? 'ok'
    : vw.voltage_pu < VOLTAGE_DANGER_LOW_PU || vw.voltage_pu > VOLTAGE_DANGER_HIGH_PU
      ? 'danger'
      : vBad.length
        ? 'warn'
        : 'ok'
  const voltage = {
    key: 'voltage',
    label: '전압',
    standard: `${VOLTAGE_MIN_PU} ~ ${VOLTAGE_MAX_PU} pu`,
    worst: vw ? vw.voltage_pu : null,
    worstText: vw ? `${vw.voltage_pu.toFixed(3)} pu` : '-',
    whereId: vw?.node_id ?? null,
    whereName: vw ? names[vw.node_id] : '',
    problem: vw && vw.voltage_pu < VOLTAGE_MIN_PU ? '전압 저하' : vw && vw.voltage_pu > VOLTAGE_MAX_PU ? '전압 상승' : '',
    count: vBad.length,
    items: vBad.map((r) => ({ id: r.node_id, name: names[r.node_id], value: `${r.voltage_pu.toFixed(3)} pu` })),
    level: vLevel,
  }

  // 2) 선로 부하율: 가장 높은 선로
  const withLoad = result.lines.filter((r) => r.loading_pct != null && lineById[r.line_id])
  const lWorst = withLoad.reduce((a, r) => (!a || r.loading_pct > a.loading_pct ? r : a), null)
  const over = withLoad.filter((r) => r.loading_pct > OVERLOAD_PCT)
  const watch = withLoad.filter((r) => r.loading_pct >= LOADING_WATCH_PCT)
  const loading = {
    key: 'loading',
    label: '선로 부하율',
    standard: `≤ ${OVERLOAD_PCT}%`,
    worst: lWorst?.loading_pct ?? null,
    worstText: lWorst ? `${lWorst.loading_pct.toFixed(0)}%` : '-',
    whereId: lWorst?.line_id ?? null,
    whereName: lWorst ? lineName(lineById[lWorst.line_id]) : '',
    problem: over.length ? '선로 과부하' : '',
    count: watch.length,
    items: watch.map((r) => ({ id: r.line_id, name: lineName(lineById[r.line_id]), value: `${r.loading_pct.toFixed(0)}%` })),
    level: over.length ? 'danger' : watch.length ? 'warn' : 'ok',
  }

  // 3) 역조류: 거꾸로 흐르는 전력이 가장 큰 선로
  const rev = result.lines.filter((r) => r.reverse_flow && lineById[r.line_id])
  const rWorst = rev.reduce((a, r) => (!a || Math.abs(r.p_kw) > Math.abs(a.p_kw) ? r : a), null)
  const reverse = {
    key: 'reverse',
    label: '역조류',
    standard: '없음 (제한 내)',
    worst: rWorst ? Math.abs(rWorst.p_kw) / 1000 : 0,
    worstText: rWorst ? fmtMw(rWorst.p_kw) : '없음',
    whereId: rWorst?.line_id ?? null,
    whereName: rWorst ? lineName(lineById[rWorst.line_id]) : '',
    problem: rev.length ? '역조류' : '',
    count: rev.length,
    items: rev.map((r) => ({ id: r.line_id, name: lineName(lineById[r.line_id]), value: fmtMw(r.p_kw) })),
    level: rev.length ? 'warn' : 'ok',
  }

  // 4) 단락용량: 가장 큰 노드 (보통 변전소 모선)
  const withFault = energized.filter((r) => r.fault_current_ka != null)
  const fWorst = withFault.reduce((a, r) => (!a || r.fault_current_ka > a.fault_current_ka ? r : a), null)
  const fHigh = withFault.filter((r) => mvaOf(r.fault_current_ka) > FAULT_HIGH_MVA)
  const maxMva = fWorst ? mvaOf(fWorst.fault_current_ka) : null
  const fault = {
    key: 'fault',
    label: '단락용량',
    standard: `≤ ${FAULT_HIGH_MVA} MVA`,
    worst: maxMva,
    worstText: fWorst ? `${maxMva.toFixed(0)} MVA (${fWorst.fault_current_ka.toFixed(2)} kA)` : '-',
    whereId: fWorst?.node_id ?? null,
    whereName: fWorst ? names[fWorst.node_id] : '',
    problem: fHigh.length ? '단락용량 증가' : '',
    count: fHigh.length,
    items: fHigh.map((r) => ({ id: r.node_id, name: names[r.node_id], value: `${mvaOf(r.fault_current_ka).toFixed(0)} MVA` })),
    level: fHigh.length ? 'warn' : 'ok',
  }

  // (추가) 정전: 열린 개폐기 아래 전원에서 끊긴 노드
  const out = busRes.filter((r) => !r.energized)
  const outage = {
    key: 'outage',
    label: '정전 구간',
    standard: '없음',
    worst: out.length,
    worstText: out.length ? `${out.length}곳` : '없음',
    whereId: out[0]?.node_id ?? null,
    whereName: out[0] ? names[out[0].node_id] : '',
    problem: out.length ? '정전' : '',
    count: out.length,
    items: out.map((r) => ({ id: r.node_id, name: names[r.node_id], value: '정전' })),
    level: out.length ? 'danger' : 'ok',
  }

  const rows = [voltage, loading, reverse, fault, outage]
  const order = { ok: 0, warn: 1, danger: 2 }
  const overall = rows.reduce((a, r) => (order[r.level] > order[a] ? r.level : a), 'ok')
  return {
    rows,
    overall,
    problems: rows.filter((r) => r.level !== 'ok'),
    minV,
    maxLoading: lWorst?.loading_pct ?? null,
    reverseMw: reverse.worst,
    maxMva,
    maxFaultKa: fWorst?.fault_current_ka ?? 0,
    totalMw: result.feeders.reduce((a, f) => a + f.p_kw, 0) / 1000,
  }
}

// 문제별 대안 후보와 기대 효과 (제안서 슬라이드 12 '엔지니어링 솔루션 제언' 표 그대로).
// AI 리포트가 오기 전에 참고로 보여 주고, 실제 제언은 LLM 리포트(solutions)가 정한다
export const SOLUTION_CANDIDATES = {
  voltage: { problem: '전압 저하·상승', candidates: ['인버터 무효전력 제어', '콘덴서 투입', '선로 보강'], effect: '전압 회복·품질 개선' },
  loading: { problem: '선로 과부하', candidates: ['부하 분산', '선로 증설 / 병행선', '분산전원 출력 조정'], effect: '부하율 감소·사고위험 저감' },
  reverse: { problem: '역조류', candidates: ['출력 제한', 'ESS 충전 활용', '운전방식 조정'], effect: '보호협조·운영 유연성 확보' },
  fault: { problem: '단락용량 증가', candidates: ['차단기 정격 검토', '보호계전기 재설정', '계통 구성 변경'], effect: '차단 신뢰성·안전성 확보' },
  outage: { problem: '정전 구간', candidates: ['열린 개폐기 확인', '연계 선로로 절체', '계통 구성 변경'], effect: '공급 신뢰도 회복' },
}

// 원인 분석에서 LLM이 함께 보는 정보 (슬라이드 11) — 문제마다 어떤 질문을 보는지
export const CAUSE_QUESTIONS = {
  voltage: '어느 구간부터 전압이 떨어지는가? (전압 프로파일)',
  loading: '특정 구간에 부하가 집중되는가? (선로 부하)',
  reverse: '분산전원으로 역방향 흐름이 생기는가? (전력 흐름)',
  fault: '선로 길이·임피던스·접속점 영향은? (계통 구성)',
  outage: '어느 개폐기가 열려 있는가? (계통 구성)',
}

// ── 단선도 오버레이 ──
// mode: 'health' | 'voltage' | 'loading' | 'reverse' | 'fault'
// 반환: nodes {id: {color, fill, sub, dim}}, lines {id: {color, width, arrow: 'fwd'|'bwd'|null, sub}},
//       labels [{id, x, y, label, color, kind: 'feeder'|'callout'}] — 피더 송출 상자와 문제 위치 말풍선
export function buildOverlay(graph, result, mode) {
  const nodeRes = nodeResultMap(graph, result)
  const lineRes = Object.fromEntries(result.lines.map((r) => [r.line_id, r]))
  const pos = Object.fromEntries(graph.nodes.map((n) => [n.id, n]))
  const hc = healthCheck(graph, result)
  const flagged = {} // 건강도 모드: 문제 요소 id → level
  for (const row of hc.rows) {
    if (row.level === 'ok') continue
    for (const it of row.items) flagged[it.id] = flagged[it.id] === 'danger' ? 'danger' : row.level
  }

  const nodes = {}
  for (const n of graph.nodes) {
    const r = nodeRes[n.id]
    if (!r) continue
    const out = !r.energized
    const o = { color: COLORS.green, fill: null, sub: '', dim: out }
    if (mode === 'health') {
      o.color = out ? COLORS.outage : flagged[n.id] ? LEVELS[flagged[n.id]].color : COLORS.green
    } else if (mode === 'voltage') {
      o.color = voltageColor(r)
      if (n.type === 'bus') o.fill = o.color
      o.sub = out ? '정전' : `${r.voltage_pu.toFixed(3)} pu`
    } else if (mode === 'fault') {
      const mva = out ? null : mvaOf(r.fault_current_ka)
      o.color = faultColor(mva)
      if (n.type === 'bus') o.fill = o.color
      o.sub = mva == null ? '' : `${mva.toFixed(0)} MVA`
    } else {
      o.color = out ? COLORS.outage : COLORS.idle
    }
    if (out && mode !== 'voltage') o.sub = '정전'
    nodes[n.id] = o
  }

  const lines = {}
  for (const l of graph.lines) {
    const r = lineRes[l.id]
    if (!r) continue
    const off = Math.abs(r.p_kw) < 1e-6 && Math.abs(r.q_kvar) < 1e-6
    const width = r.loading_pct == null ? 3 : lineWidth(r.loading_pct)
    // 화살표는 실제 유효전력이 흐르는 방향 (p_kw는 저장된 from → to 기준 부호)
    const dir = r.p_kw >= 0 ? 'fwd' : 'bwd'
    const o = { color: COLORS.idle, width: 2.5, arrow: null, sub: '' }
    if (off) o.color = COLORS.outage
    else if (mode === 'health') {
      o.color = flagged[l.id] ? LEVELS[flagged[l.id]].color : COLORS.green
      o.width = width
    } else if (mode === 'loading') {
      o.color = loadingColor(r.loading_pct)
      o.width = width
      o.sub = r.loading_pct == null ? '' : `${r.loading_pct.toFixed(0)}%`
    } else if (mode === 'reverse') {
      o.color = r.reverse_flow ? COLORS.red : COLORS.blue
      o.width = r.reverse_flow ? 5 : 2.5
      o.arrow = dir
      if (l.kind === 'line') o.sub = `${Math.round(Math.abs(r.p_kw))} kW`
    }
    lines[l.id] = o
  }

  // 피더별 송출 전력: 그 피더의 출구 차단기 옆에 황색 표시 (모든 모드)
  // ponytail: 상자 위치는 차단기 오른쪽 90px 고정. 차단기 옆에 다른 설비가 있으면 겹칠 수 있으니 그때 위치 계산을 넣는다
  const labels = []
  for (const f of result.feeders) {
    const breaker = graph.nodes.find((n) => n.type === 'breaker' && n.feeder_id === f.feeder_id)
    if (!breaker) continue
    labels.push({
      id: `feeder:${f.feeder_id}`,
      x: breaker.x + 90,
      y: breaker.y,
      label: `${(f.p_kw / 1000).toFixed(2)} MW\n${(f.q_kvar / 1000).toFixed(2)} MVAr`,
      color: COLORS.feeder,
      kind: 'feeder',
    })
  }

  // 문제 위치 말풍선 (슬라이드 10 '계통 건강도 맵'의 "0.92 pu 전압저하" 상자): 모드에 맞는 항목의 최악 위치
  const show = mode === 'health' ? hc.problems : hc.rows.filter((r) => r.key === mode && r.whereId && (r.level !== 'ok' || mode === 'fault'))
  for (const row of show) {
    if (!row.whereId) continue
    let x
    let y
    if (pos[row.whereId]) {
      x = pos[row.whereId].x + 70
      y = pos[row.whereId].y - 34
    } else {
      const l = graph.lines.find((ln) => ln.id === row.whereId)
      if (!l || !pos[l.from_node_id] || !pos[l.to_node_id]) continue
      x = (pos[l.from_node_id].x + pos[l.to_node_id].x) / 2 + 60
      y = (pos[l.from_node_id].y + pos[l.to_node_id].y) / 2 - 30
    }
    const head = row.key === 'fault' ? `${row.worst.toFixed(0)} MVA` : row.worstText
    labels.push({
      id: `callout:${row.key}`,
      x,
      y,
      label: `${head}\n${row.problem || row.label}`,
      color: row.level === 'ok' ? COLORS.gray : LEVELS[row.level].color,
      kind: 'callout',
    })
  }

  return { nodes, lines, labels }
}

// 결과 창 "요소별 결과" 표: 모든 설비·선로를 한 줄씩. problem이 있으면 문제 줄
const TYPE_LABEL = { source: '전원', breaker: '차단기', switch: '개폐기', bus: '접속점', load: '부하', pv: '태양광', wind: '풍력' }
export function elementRows(graph, result) {
  const nodeRes = nodeResultMap(graph, result)
  const names = Object.fromEntries(graph.nodes.map((n) => [n.id, n.name]))
  const nodes = graph.nodes.map((n) => {
    const r = nodeRes[n.id]
    const state = r ? voltageState(r) : null
    const power = ['load', 'pv', 'wind'].includes(n.type) && n.p_kw != null ? `${n.p_kw} kW` : ''
    return {
      id: n.id,
      group: 'node',
      type: n.type,
      typeLabel: TYPE_LABEL[n.type],
      name: n.name,
      voltage: r?.energized ? r.voltage_pu : null,
      voltageColor: r ? voltageColor(r) : null,
      fault: r?.energized ? r.fault_current_ka : null,
      mva: r?.energized ? mvaOf(r.fault_current_ka) : null,
      power,
      state: state ?? 'none',
      problem: state === 'low' ? '전압 저하' : state === 'high' ? '전압 상승' : state === 'outage' ? '정전' : '',
    }
  })
  const lineRes = Object.fromEntries(result.lines.map((r) => [r.line_id, r]))
  const lines = graph.lines.map((l) => {
    const r = lineRes[l.id]
    const overload = r?.loading_pct != null && r.loading_pct > OVERLOAD_PCT
    return {
      id: l.id,
      group: 'line',
      type: l.kind === 'switch' ? 'switch-link' : 'line',
      typeLabel: l.kind === 'switch' ? '차단기·개폐기 연결' : '선로',
      name: l.name || `${names[l.from_node_id]} → ${names[l.to_node_id]}`,
      p: r?.p_kw ?? null,
      q: r?.q_kvar ?? null,
      loading: r?.loading_pct ?? null,
      loadingColor: loadingColor(r?.loading_pct),
      reverse: Boolean(r?.reverse_flow),
      problem: overload ? '과부하' : r?.reverse_flow ? '역조류' : '',
    }
  })
  return { nodes, lines }
}

// 결과 기록(시점별) 한 점: 편집해서 다시 계산할 때마다 하나씩 쌓는다
export function historyPoint(graph, result, label) {
  const hc = healthCheck(graph, result)
  return {
    at: new Date(),
    label,
    minV: hc.minV,
    maxLoading: hc.maxLoading,
    reverseMw: hc.reverseMw,
    maxMva: hc.maxMva,
    lossKw: result.loss_kw,
    totalMw: hc.totalMw,
    overall: hc.overall,
  }
}
