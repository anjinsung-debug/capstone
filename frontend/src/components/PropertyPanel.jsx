// 선택한 설비·선로의 속성 보기·고치기 (FR-06). 아무것도 선택하지 않으면 변전소 속성과 빠진 항목을 보여 준다.
// 시뮬레이션 결과가 있으면 그 설비의 계산값(전압, 고장전류, 조류, 부하율)도 함께 보여 준다.
import { useState } from 'react'
import { NODE_TYPES, findIssues, updateLine, updateNode, updateSubstation } from '../lib/graphEdit.js'
import { COLORS, voltageState } from '../lib/overlay.js'

// 숫자 입력: 입력 중에는 글자 그대로 두고, 포커스를 잃거나 Enter일 때 숫자로 반영 (빈칸 = 값 없음)
// 빈칸(null)은 "데이터 없음"이라 시뮬레이션이 가정값을 쓴다 (단락용량 300 MVA, X/R 10, 허용전류 400 A — simulation/dss.py의 DEFAULT_*)
// 한 글자 칠 때마다 계통을 바꾸면 되돌리기 기록이 글자 수만큼 쌓이므로 확정 시점에만 반영한다
function NumberField({ label, unit, value, onCommit, disabled, required }) {
  const [text, setText] = useState(null) // null이면 value를 그대로 보여 줌
  const shown = text ?? (value === null || value === undefined ? '' : String(value))
  const commit = () => {
    if (text === null) return
    const t = text.trim()
    const v = t === '' ? null : Number(t)
    setText(null)
    if (t !== '' && Number.isNaN(v)) return
    if (v !== value) onCommit(v)
  }
  return (
    <label className="field">
      <span>
        {label}
        {required && shown === '' && <em className="req"> 필요</em>}
      </span>
      <div className="field-input">
        <input
          type="text"
          inputMode="decimal"
          value={shown}
          disabled={disabled}
          placeholder={required ? '' : '없음 (가정값)'}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {unit && <i>{unit}</i>}
      </div>
    </label>
  )
}

function TextField({ label, value, onCommit, disabled }) {
  const [text, setText] = useState(null)
  const commit = () => {
    if (text !== null && text.trim() && text !== value) onCommit(text.trim())
    setText(null)
  }
  return (
    <label className="field">
      <span>{label}</span>
      <div className="field-input">
        <input
          type="text"
          value={text ?? value}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>
    </label>
  )
}

function Stat({ label, value, color }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b style={color ? { color } : undefined}>{value}</b>
    </div>
  )
}

function NodeProps({ graph, node, result, editing, onChange }) {
  const set = (patch) => onChange(updateNode(graph, node.id, patch))
  const info = NODE_TYPES[node.type]
  const bus = graph.nodes.find((n) => n.id === node.bus_id)
  const feeder = graph.feeders.find((f) => f.id === node.feeder_id)
  const r = result?.nodes.find((x) => x.node_id === node.id) ?? (bus && result?.nodes.find((x) => x.node_id === bus.id))
  const power = ['load', 'pv', 'wind'].includes(node.type)
  return (
    <>
      <h3>
        <span className={`type-dot t-${node.type}`} /> {info.label}
      </h3>
      {/* key: 다른 노드를 고르면 입력칸을 새로 만든다 */}
      <TextField key={`${node.id}-name`} label="이름" value={node.name} disabled={!editing} onCommit={(v) => set({ name: v })} />
      {power && (
        <>
          <NumberField key={`${node.id}-p`} label={node.type === 'load' ? '소비 전력' : '발전 출력'} unit="kW" value={node.p_kw} disabled={!editing} required onCommit={(v) => set({ p_kw: v })} />
          <NumberField key={`${node.id}-q`} label="무효 전력" unit="kvar" value={node.q_kvar} disabled={!editing} onCommit={(v) => set({ q_kvar: v })} />
        </>
      )}
      {node.type === 'switch' && (
        <label className="field checkbox">
          <input type="checkbox" checked={node.is_open} disabled={!editing} onChange={(e) => set({ is_open: e.target.checked })} />
          <span>열림 (이 개폐기 아래는 정전)</span>
        </label>
      )}
      <dl className="meta">
        {info.oneTerminal && (
          <>
            <dt>접속점</dt>
            <dd className={bus ? '' : 'warn'}>{bus ? bus.name : '연결 안 됨 (연결 도구로 접속점에 붙이세요)'}</dd>
          </>
        )}
        <dt>피더</dt>
        <dd>{feeder ? feeder.name : '-'}</dd>
      </dl>
      {r && (
        <div className="stats">
          {r.energized ? (
            <>
              <Stat label="전압" value={`${r.voltage_pu.toFixed(4)} pu`} color={COLORS[voltageState(r)]} />
              <Stat label="3상 단락전류" value={r.fault_current_ka != null ? `${r.fault_current_ka.toFixed(2)} kA` : '-'} />
            </>
          ) : (
            <Stat label="상태" value="정전 (전원에서 끊김)" color={COLORS.outage} />
          )}
        </div>
      )}
    </>
  )
}

function LineProps({ graph, line, result, editing, onChange }) {
  const set = (patch) => onChange(updateLine(graph, line.id, patch))
  const name = (id) => graph.nodes.find((n) => n.id === id)?.name ?? id
  const r = result?.lines.find((x) => x.line_id === line.id)
  const isSwitch = line.kind === 'switch'
  return (
    <>
      <h3>{isSwitch ? '차단기·개폐기 연결' : '선로'}</h3>
      <TextField key={`${line.id}-name`} label="이름" value={line.name} disabled={!editing} onCommit={(v) => set({ name: v })} />
      <dl className="meta">
        <dt>구간</dt>
        <dd>
          {name(line.from_node_id)} → {name(line.to_node_id)}
        </dd>
      </dl>
      {!isSwitch && (
        <>
          <NumberField key={`${line.id}-len`} label="길이" unit="km" value={line.length_km} disabled={!editing} required onCommit={(v) => set({ length_km: v ?? 0 })} />
          <NumberField key={`${line.id}-r`} label="저항 R1" unit="Ω/km" value={line.r_ohm_per_km} disabled={!editing} required onCommit={(v) => set({ r_ohm_per_km: v ?? 0 })} />
          <NumberField key={`${line.id}-x`} label="리액턴스 X1" unit="Ω/km" value={line.x_ohm_per_km} disabled={!editing} required onCommit={(v) => set({ x_ohm_per_km: v ?? 0 })} />
        </>
      )}
      <NumberField key={`${line.id}-amp`} label="허용전류" unit="A" value={line.rated_current_a} disabled={!editing} onCommit={(v) => set({ rated_current_a: v })} />
      {r && (
        <div className="stats">
          <Stat label="유효전력" value={`${r.p_kw.toFixed(0)} kW`} />
          <Stat label="무효전력" value={`${r.q_kvar.toFixed(0)} kvar`} />
          <Stat label="부하율" value={r.loading_pct != null ? `${r.loading_pct.toFixed(1)} %` : '-'} color={r.loading_pct > 100 ? COLORS.overload : undefined} />
          <Stat label="역조류" value={r.reverse_flow ? '있음' : '없음'} color={r.reverse_flow ? COLORS.reverse : undefined} />
        </div>
      )}
    </>
  )
}

function SubstationProps({ graph, editing, onChange }) {
  const s = graph.substation
  const set = (patch) => onChange(updateSubstation(graph, patch))
  const issues = findIssues(graph)
  return (
    <>
      <h3>변전소</h3>
      <TextField key={`${s.id}-name`} label="이름" value={s.name} disabled={!editing} onCommit={(v) => set({ name: v })} />
      <NumberField key={`${s.id}-v`} label="모선 전압" unit="pu" value={s.source_voltage_pu} disabled={!editing} required onCommit={(v) => set({ source_voltage_pu: v ?? 1 })} />
      <NumberField key={`${s.id}-sc`} label="3상 단락용량" unit="MVA" value={s.short_circuit_mva} disabled={!editing} onCommit={(v) => set({ short_circuit_mva: v })} />
      <NumberField key={`${s.id}-xr`} label="X/R" value={s.x_r_ratio} disabled={!editing} onCommit={(v) => set({ x_r_ratio: v })} />
      <dl className="meta">
        <dt>규모</dt>
        <dd>
          피더 {graph.feeders.length} · 설비 {graph.nodes.length} · 선로 {graph.lines.length}
        </dd>
      </dl>
      <h4>시뮬레이션 전 확인</h4>
      {issues.length === 0 ? (
        <p className="ok">빠진 항목 없음</p>
      ) : (
        <ul className="issues">
          {issues.slice(0, 12).map((t) => (
            <li key={t}>{t}</li>
          ))}
          {issues.length > 12 && <li>외 {issues.length - 12}건</li>}
        </ul>
      )}
    </>
  )
}

export default function PropertyPanel({ graph, selectedIds, result, editing, onChange }) {
  if (!graph) return <aside className="props" />
  const id = selectedIds.length === 1 ? selectedIds[0] : null
  const node = id && graph.nodes.find((n) => n.id === id)
  const line = id && graph.lines.find((l) => l.id === id)
  let body
  if (selectedIds.length > 1) body = <p className="muted">{selectedIds.length}개 선택됨 (Delete로 삭제, 끌어서 함께 이동)</p>
  else if (node) body = <NodeProps graph={graph} node={node} result={result} editing={editing} onChange={onChange} />
  else if (line) body = <LineProps graph={graph} line={line} result={result} editing={editing} onChange={onChange} />
  else if (id?.startsWith('attach:')) body = <p className="muted">접속점 붙임 (bus_id). 지우면 설비가 접속점에서 떨어집니다</p>
  else body = <SubstationProps graph={graph} editing={editing} onChange={onChange} />
  return <aside className="props">{body}</aside>
}
