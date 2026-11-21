// cim/export.py의 내보내기 조건을 편집 중에도 안내한다. 서버 검증은 그대로 유지한다.
export function cimExportIssues(graph) {
  if (!graph) return []
  const issues = []
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]))
  const switches = new Set(['breaker', 'switch'])
  for (const n of graph.nodes) {
    const add = (message) => issues.push({ id: n.id, name: n.name, message })
    if (switches.has(n.type)) {
      const count = graph.lines.filter((l) =>
        (l.from_node_id === n.id || l.to_node_id === n.id) &&
        (l.kind || (switches.has(nodes.get(l.from_node_id)?.type) || switches.has(nodes.get(l.to_node_id)?.type) ? 'switch' : 'line')) === 'switch',
      ).length
      if (count !== 2) add(`연결이 ${count}개입니다. 양쪽에 하나씩, 총 2개가 되도록 연결을 수정하세요.`)
    } else if (['source', 'load', 'pv', 'wind'].includes(n.type)) {
      if (nodes.get(n.bus_id)?.type !== 'bus') add('접속점에 연결하세요.')
      if (n.type !== 'source' && n.p_kw == null) add(n.type === 'load' ? '소비 전력(kW)을 입력하세요.' : '출력(kW)을 입력하세요.')
    }
  }
  for (const l of graph.lines) {
    const kind = l.kind || (switches.has(nodes.get(l.from_node_id)?.type) || switches.has(nodes.get(l.to_node_id)?.type) ? 'switch' : 'line')
    if (kind === 'line' && l.length_km <= 0) issues.push({ id: l.id, name: l.name, message: '선로 길이를 0보다 크게 입력하세요.' })
  }
  return issues
}
