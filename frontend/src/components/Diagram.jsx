// 단선도 뷰어·편집기 (제안서 3·4단계, FR-05, FR-06)
// 변전소 계통(SubstationGraph)을 Cytoscape.js 다크모드 단선도로 그리고, 편집과 시뮬레이션 결과 오버레이를 맡는다.
//
// 담당: 프론트엔드. Cytoscape.js 문서: https://js.cytoscape.org
// 데이터 흐름: 계통의 원본은 App의 graph 상태 하나뿐이다.
//   화면 조작(노드 추가·이동·연결) → lib/graphEdit.js 함수로 새 계통을 만들어 onChange로 App에 올림
//   → App이 graph를 바꾸면 아래 동기화 effect가 Cytoscape 요소를 추가·수정·삭제한다 (단선도를 새로 그리지 않음)
import cytoscape from 'cytoscape'
import { useEffect, useRef, useState } from 'react'
import { NODE_TYPES, addNode, attachEdgeId, connect, snap, updateNode } from '../lib/graphEdit.js'
import { COLORS, buildOverlay } from '../lib/overlay.js'
import Legend from './Legend.jsx'

const LABEL_MODES = [
  ['voltage', '전압'],
  ['fault', '고장전류'],
  ['name', '이름만'],
]

const TYPE_STYLE = {
  source: { shape: 'round-rectangle', color: '#b388ff', size: 34 },
  breaker: { shape: 'rectangle', color: '#ff7a7a', size: 22 },
  switch: { shape: 'diamond', color: '#7fd1ff', size: 22 },
  bus: { shape: 'ellipse', color: '#8c979d', size: 12 },
  load: { shape: 'triangle', color: '#c9d1d5', size: 22 },
  pv: { shape: 'hexagon', color: '#f5c542', size: 24 },
  wind: { shape: 'pentagon', color: '#5ee0c8', size: 24 },
}

const STYLE = [
  {
    selector: 'node',
    style: {
      label: (ele) => (ele.data('ovSub') ? `${ele.data('name')}\n${ele.data('ovSub')}` : ele.data('name')),
      'text-wrap': 'wrap',
      'font-size': 9,
      'font-family': 'Pretendard, "Noto Sans KR", system-ui, sans-serif',
      color: '#dfe6e9',
      'text-valign': 'bottom',
      'text-margin-y': 4,
      'text-outline-color': '#0d1316',
      'text-outline-width': 2,
      'border-width': 0,
    },
  },
  ...Object.entries(TYPE_STYLE).map(([type, s]) => ({
    selector: `node[type="${type}"]`,
    style: { shape: s.shape, 'background-color': s.color, width: s.size, height: s.size },
  })),
  // 열린 개폐기: 속을 비운다
  { selector: 'node[type="switch"][?isOpen]', style: { 'background-opacity': 0.1, 'border-width': 2, 'border-color': '#7fd1ff' } },
  // 오버레이: 전압 판정 색으로 테두리 (설비 종류 색은 유지해서 모양·색으로 종류를 구분)
  { selector: 'node.ov', style: { 'border-width': 3, 'border-color': 'data(ovColor)' } },
  { selector: 'node.ov-outage', style: { opacity: 0.45 } },
  // 결과 패널의 위치 버튼으로 이동했을 때 잠깐 강조
  { selector: '.flash', style: { 'overlay-color': '#ffffff', 'overlay-opacity': 0.35, 'overlay-padding': 10 } },
  { selector: 'node.pending', style: { 'border-width': 3, 'border-color': '#ffffff', 'border-style': 'dashed' } },
  { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#ffffff' } },
  // 피더 송출 전력 (차단기 옆 황색 글자)
  {
    selector: 'node.annot',
    style: {
      shape: 'round-rectangle',
      'background-color': '#2a2410',
      'background-opacity': 0.9,
      'border-width': 1,
      'border-color': COLORS.feeder,
      width: 86,
      height: 34,
      label: 'data(name)',
      color: COLORS.feeder,
      'font-size': 11,
      'font-weight': 'bold',
      'text-valign': 'center',
      'text-margin-y': 0,
      'text-outline-width': 0,
      events: 'no',
    },
  },
  {
    selector: 'edge',
    style: {
      width: 2,
      'line-color': '#5a6770',
      'curve-style': 'taxi',
      'taxi-direction': 'vertical',
      'taxi-turn': '50%',
      'font-size': 9,
      color: '#dfe6e9',
      'text-outline-color': '#0d1316',
      'text-outline-width': 2,
      'text-rotation': 'none',
    },
  },
  { selector: 'edge[ovSub]', style: { label: 'data(ovSub)' } },
  { selector: 'edge[kind="switch"]', style: { 'line-color': '#7a8890', width: 2 } },
  // 붙임선: 부하·PV·전원이 접속점에 붙은 관계 (선로가 아님, bus_id)
  { selector: 'edge.attach', style: { 'line-style': 'dashed', 'line-dash-pattern': [4, 3], width: 1, 'line-color': '#6b7a83', 'curve-style': 'straight' } },
  { selector: 'edge.ov', style: { 'line-color': 'data(ovColor)', width: 'data(ovWidth)', 'arrow-scale': 0.9 } },
  { selector: 'edge.ov.fwd', style: { 'target-arrow-shape': 'triangle', 'target-arrow-color': 'data(ovColor)' } },
  { selector: 'edge.ov.bwd', style: { 'source-arrow-shape': 'triangle', 'source-arrow-color': 'data(ovColor)' } },
  { selector: 'edge:selected', style: { 'line-color': '#ffffff', 'target-arrow-color': '#ffffff', 'source-arrow-color': '#ffffff' } },
]

// 계통 → Cytoscape 요소 (선로 + 붙임선)
function toElements(graph) {
  const nodes = graph.nodes.map((n) => ({
    group: 'nodes',
    data: { id: n.id, name: n.name, type: n.type, isOpen: Boolean(n.is_open) },
    position: { x: n.x, y: n.y },
  }))
  const lines = graph.lines.map((l) => ({
    group: 'edges',
    data: { id: l.id, source: l.from_node_id, target: l.to_node_id, kind: l.kind ?? 'line' },
  }))
  const attaches = graph.nodes
    .filter((n) => n.bus_id && NODE_TYPES[n.type].oneTerminal && graph.nodes.some((b) => b.id === n.bus_id))
    .map((n) => ({ group: 'edges', classes: 'attach', data: { id: attachEdgeId(n.id), source: n.bus_id, target: n.id, kind: 'attach' } }))
  return [...nodes, ...lines, ...attaches]
}

// 끄는 중인 노드와 가로·세로로 맞출 수 있는 다른 노드 좌표 (가이드라인 정렬)
function findAlign(cy, node, pos) {
  const tol = 10 / cy.zoom()
  let ax = null
  let ay = null
  cy.nodes().not('.annot').forEach((o) => {
    if (o.id() === node.id()) return
    const p = o.position()
    if (ax === null && Math.abs(p.x - pos.x) < tol) ax = p.x
    if (ay === null && Math.abs(p.y - pos.y) < tol) ay = p.y
  })
  return { ax, ay }
}

export default function Diagram({ graph, result, editing, tool, labelMode, focus, onLabelMode, onChange, onSelect, onMessage }) {
  const containerRef = useRef(null)
  const cyRef = useRef(null)
  const pendingRef = useRef(null) // 연결 모드에서 먼저 누른 노드 id
  const subIdRef = useRef(null)
  const [guides, setGuides] = useState({ x: null, y: null }) // 화면 좌표 (px)

  // 이벤트 핸들러가 항상 최신 props를 보도록
  const props = useRef({})
  props.current = { graph, editing, tool, onChange, onSelect, onMessage }

  // Cytoscape는 한 번만 만든다. 계통이 바뀔 때마다 새로 만들면 확대·이동 상태가 초기화되고 깜빡이기 때문
  // 이벤트 핸들러 안에서는 props 대신 props.current(최신 값)를 읽는다 (한 번 만든 핸들러가 옛 값을 보지 않도록)
  useEffect(() => {
    const cy = cytoscape({
      container: containerRef.current,
      style: STYLE,
      layout: { name: 'preset' },
      minZoom: 0.2,
      maxZoom: 3,
      boxSelectionEnabled: true,
    })
    cyRef.current = cy

    const reportSelection = () => {
      props.current.onSelect(cy.$(':selected').not('.annot').map((e) => e.id()))
    }
    cy.on('select unselect', reportSelection)

    // 빈 곳 클릭: 노드 추가 도구면 그 자리에 노드 추가
    cy.on('tap', (evt) => {
      const p = props.current
      if (evt.target !== cy || !p.editing) return
      if (NODE_TYPES[p.tool]) {
        const { graph: g, node } = addNode(p.graph, p.tool, evt.position.x, evt.position.y)
        p.onChange(g)
        setTimeout(() => cy.$id(node.id).select(), 0)
      }
      if (pendingRef.current) {
        cy.$id(pendingRef.current).removeClass('pending')
        pendingRef.current = null
      }
    })

    // 노드 클릭: 연결 모드면 두 번 눌러 연결
    cy.on('tap', 'node', (evt) => {
      const p = props.current
      if (!p.editing || p.tool !== 'connect' || evt.target.hasClass('annot')) return
      const id = evt.target.id()
      if (!pendingRef.current) {
        pendingRef.current = id
        evt.target.addClass('pending')
        p.onMessage('연결할 두 번째 노드를 누르세요 (빈 곳을 누르면 취소)')
        return
      }
      const first = pendingRef.current
      cy.$id(first).removeClass('pending')
      pendingRef.current = null
      const { graph: g, error } = connect(p.graph, first, id)
      if (error) p.onMessage(error)
      else {
        p.onMessage('')
        p.onChange(g)
      }
    })

    // 끄는 중: 가이드라인 표시
    cy.on('drag', 'node', (evt) => {
      const { ax, ay } = findAlign(cy, evt.target, evt.target.position())
      const pan = cy.pan()
      const z = cy.zoom()
      setGuides({ x: ax === null ? null : ax * z + pan.x, y: ay === null ? null : ay * z + pan.y })
    })

    // 놓으면: 가이드라인에 맞추거나 격자에 붙이고 좌표 저장.
    // 여러 노드를 함께 끌면 노드마다 dragfree가 오므로 모아서 한 번에 반영한다
    const moved = new Set()
    cy.on('dragfree', 'node', (evt) => {
      moved.add(evt.target.id())
      if (moved.size > 1) return
      queueMicrotask(() => {
        const p = props.current
        setGuides({ x: null, y: null })
        let g = p.graph
        for (const id of moved) {
          const n = cy.getElementById(id)
          if (n.empty()) continue
          const pos = n.position()
          const { ax, ay } = moved.size === 1 ? findAlign(cy, n, pos) : { ax: null, ay: null }
          const x = ax ?? snap(pos.x)
          const y = ay ?? snap(pos.y)
          n.position({ x, y })
          g = updateNode(g, id, { x, y })
        }
        moved.clear()
        p.onChange(g)
      })
    })

    // 편집 도구가 열리고 닫히면 단선도 크기가 바뀌므로 Cytoscape에 알린다
    const ro = new ResizeObserver(() => cy.resize())
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      cy.destroy()
      cyRef.current = null
    }
  }, [])

  // 편집 모드일 때만 노드를 끌 수 있다
  useEffect(() => {
    const cy = cyRef.current
    cy.autoungrabify(!editing)
    containerRef.current.style.cursor = editing && NODE_TYPES[tool] ? 'crosshair' : 'default'
    if (pendingRef.current && tool !== 'connect') {
      cy.$id(pendingRef.current).removeClass('pending')
      pendingRef.current = null
    }
  }, [editing, tool])

  // 계통 → Cytoscape 동기화 (바뀐 것만 반영)
  // 붙임선(attach:<노드 id>)은 화면 전용 가짜 선이다. 실제 데이터는 노드의 bus_id이고 Neo4j에서는 CONNECTED_TO 관계
  useEffect(() => {
    const cy = cyRef.current
    if (!graph) {
      cy.elements().remove()
      subIdRef.current = null
      return
    }
    const elements = toElements(graph)
    const keep = new Set(elements.map((e) => e.data.id))
    cy.batch(() => {
      cy.elements().filter((e) => !e.hasClass('annot') && !keep.has(e.id())).remove()
      for (const el of elements) {
        const cur = cy.getElementById(el.data.id)
        if (cur.empty()) {
          cy.add(el)
        } else if (el.group === 'edges' && (cur.data('source') !== el.data.source || cur.data('target') !== el.data.target)) {
          cur.remove() // 방향이 바뀐 선로는 다시 만든다 (Cytoscape는 끝점 수정 불가)
          cy.add(el)
        } else {
          cur.data(el.data)
          if (el.position && !cur.grabbed()) {
            const p = cur.position()
            if (p.x !== el.position.x || p.y !== el.position.y) cur.position(el.position)
          }
        }
      }
    })
    // 다른 변전소로 바뀌면 화면에 맞춘다
    if (subIdRef.current !== graph.substation.id) {
      subIdRef.current = graph.substation.id
      if (graph.nodes.length) cy.fit(undefined, 40)
      else {
        cy.zoom(1)
        cy.pan({ x: 80, y: 80 })
      }
    }
  }, [graph])

  // 시뮬레이션 결과 오버레이 (결과가 없으면 지운다)
  useEffect(() => {
    const cy = cyRef.current
    cy.batch(() => {
      cy.$('.annot').remove()
      cy.elements().removeClass('ov ov-outage fwd bwd').removeData('ovColor ovWidth ovSub')
      if (!graph || !result) return
      const ov = buildOverlay(graph, result, labelMode)
      for (const [id, o] of Object.entries(ov.nodes)) {
        const n = cy.getElementById(id)
        if (n.empty()) continue
        n.addClass('ov').data({ ovColor: o.color, ovSub: o.sub })
        if (o.state === 'outage') n.addClass('ov-outage')
      }
      for (const [id, o] of Object.entries(ov.lines)) {
        const e = cy.getElementById(id)
        if (e.empty()) continue
        e.addClass(`ov ${o.forward ? 'fwd' : 'bwd'}`).data({ ovColor: o.color, ovWidth: o.width, ovSub: labelMode === 'name' ? '' : o.sub })
      }
      for (const f of ov.feederLabels) {
        cy.add({ group: 'nodes', classes: 'annot', data: { id: f.id, name: f.label }, position: { x: f.x, y: f.y }, selectable: false, grabbable: false })
      }
    })
  }, [graph, result, labelMode])

  // 결과 패널에서 위치 버튼을 누르면 그 설비·선로로 화면을 옮기고 잠깐 강조한다 (focus.nonce가 바뀔 때마다)
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !focus) return undefined
    const el = cy.getElementById(focus.id)
    if (el.empty()) return undefined
    cy.animate({ center: { eles: el }, zoom: Math.max(cy.zoom(), 1.2) }, { duration: 350 })
    el.addClass('flash')
    const t = setTimeout(() => el.removeClass('flash'), 1800)
    return () => {
      clearTimeout(t)
      el.removeClass('flash')
    }
  }, [focus])

  const fit = () => cyRef.current.fit(undefined, 40)

  return (
    <div className="diagram">
      <div ref={containerRef} className="diagram-canvas" />
      {/* 범례·표시 전환은 단선도 위에 겹쳐 둔다 */}
      <div className="diagram-hud">
        {result ? <Legend /> : <span className="muted">{editing ? '편집 중 · Delete 삭제 · Ctrl+Z 되돌리기 · Esc 선택 도구' : '시뮬레이션을 실행하면 결과가 단선도에 표시됩니다'}</span>}
        {result && (
          <div className="seg">
            {LABEL_MODES.map(([k, label]) => (
              <button key={k} type="button" className={labelMode === k ? 'on' : ''} onClick={() => onLabelMode(k)}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {guides.x !== null && <div className="guide guide-v" style={{ left: guides.x }} />}
      {guides.y !== null && <div className="guide guide-h" style={{ top: guides.y }} />}
      {!graph && <div className="diagram-empty">변전소를 선택하거나 새 변전소를 만드세요</div>}
      {graph && graph.nodes.length === 0 && (
        <div className="diagram-empty">
          빈 계통입니다. 편집을 켜고 왼쪽 도구에서 전원 → 접속점 → 차단기 순서로 추가해 보세요
        </div>
      )}
      <button type="button" className="fit-btn" onClick={fit} title="화면에 맞추기">
        ⤢
      </button>
    </div>
  )
}
