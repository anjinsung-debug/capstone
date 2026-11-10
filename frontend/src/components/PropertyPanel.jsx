// 선택한 설비·선로의 속성 보기·고치기 (FR-06). 아무것도 선택하지 않으면 변전소 속성과 빠진 항목을 보여 준다.
// 시뮬레이션 결과가 있으면 그 설비의 계산값(전압, 고장전류, 조류, 부하율)도 함께 보여 준다.
// 설비를 고르면 맨 위에 그 설비의 3D 미리보기 (Diagram3D.jsx의 Equipment3D, three.js가 커서 처음 고를 때 불러옴)
import { Suspense, lazy, useState } from 'react'
import { NODE_TYPES, electricalKey, findIssues, updateLine, updateNode, updateSubstation } from '../lib/graphEdit.js'
import { COLORS, OVERLOAD_PCT, loadingColor, mvaOf, voltageColor } from '../lib/overlay.js'
import { HostingAi } from './UsecasePanels.jsx'

const Equipment3D = lazy(() => import('./Diagram3D.jsx').then((m) => ({ default: m.Equipment3D })))

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

// ── 태양광 연계 검토 (접속점만): "이 접속점에 태양광을 몇 kW까지 더 붙일 수 있나, 무엇 때문에 막히나, 목표만큼 붙이려면 무엇을 늘려야 하나" ──
// 백엔드 simulation/der.py의 hosting_capacity (유스케이스 1, 10/26 중간 발표 요청). 기준: 접속점 전압 ≤ 1.05 pu, 선로 부하율 ≤ 100%, 출구 차단기 차단 가능
// 결과는 App.jsx의 hosting 상태에 있어서, 막는 선로로 이동했다가 이 접속점으로 돌아와도 남아 있다
const VIOLATION_TEXT = { overvoltage: '전압 상승', undervoltage: '전압 저하', overload: '선로 과부하', breaker: '차단기 차단 불가' }
// 태양광 연계 / 부하 증설 (11/10): 같은 화면, 글만 다르다. 부하는 ai_report/capacity.py의 load_check (전압 ≥ 0.95 pu, 역률 0.95 가정)
const KIND = {
  pv: { title: '태양광 연계 검토', what: '태양광', verb: '붙일', calc: '연계 가능량 계산', okText: '그대로 연계 가능' },
  load: { title: '부하 증설 검토', what: '부하', verb: '늘릴', calc: '증설 가능량 계산', okText: '그대로 증설 가능' },
}

function violationLine(v, names) {
  const what = names[v.element_id] ?? v.element_id
  const val =
    v.kind === 'overvoltage' || v.kind === 'undervoltage'
      ? `${v.value.toFixed(3)} pu (기준 ${v.limit})`
      : v.kind === 'overload'
        ? `${v.value.toFixed(0)}% (기준 ${v.limit}%)`
        : `${v.value.toFixed(1)} kA (정격 ${v.limit} kA)`
  return { what, val, kind: VIOLATION_TEXT[v.kind] ?? v.kind }
}

function HostingSection({ graph, node, hosting, resultAt, onCheckHosting, onAddPv, onFocus }) {
  const [target, setTarget] = useState('')
  const [kind, setKind] = useState(hosting?.busId === node.id && hosting.kind ? hosting.kind : 'pv')
  const k = KIND[kind]
  const mine = hosting?.busId === node.id && (hosting.kind ?? 'pv') === kind ? hosting : null
  const names = Object.fromEntries([...graph.nodes, ...graph.lines, ...graph.feeders].map((x) => [x.id, x.name]))
  const targetKw = target.trim() === '' || Number.isNaN(Number(target)) ? null : Math.max(0, Number(target))
  const basis = (at) => (at ? `${at.date} ${at.hour}시 기준` : '최대 조건 기준')
  const d = mine?.status === 'done' ? mine.data : null
  const atLimit = d && d.limited_by.length === 0
  // 계산한 뒤 계통을 고쳤거나(허용전류·태양광 등) 화면 시각을 바꿨으면 결과가 옛것
  const sameAt = (a, b) => (a ? !!b && a.date === b.date && a.hour === b.hour : !b)
  const stale = d && (mine.key !== electricalKey(graph) || !sameAt(mine.at, resultAt))
  const added = mine?.added && graph.nodes.some((n) => n.id === mine.added)
  return (
    <div className="hosting">
      <div className="hosting-head">
        <h4>{k.title}</h4>
        <div className="seg">
          {Object.entries(KIND).map(([key, x]) => (
            <button key={key} type="button" className={kind === key ? 'on' : ''} onClick={() => setKind(key)}>
              {x.what}
            </button>
          ))}
        </div>
      </div>
      <div className="hosting-row">
        <label className="field">
          <span>목표 용량 (선택)</span>
          <div className="field-input">
            <input type="text" inputMode="decimal" value={target} placeholder="예: 3000" onChange={(e) => setTarget(e.target.value)} />
            <i>kW</i>
          </div>
        </label>
        <button type="button" className="primary-outline" disabled={mine?.status === 'busy'} onClick={() => onCheckHosting(node.id, targetKw, kind)}>
          {mine?.status === 'busy' ? '계산 중...' : k.calc}
        </button>
      </div>
      {mine?.status === 'error' && <p className="warn small">계산하지 못했습니다: {mine.error}</p>}
      {d && (
        <>
          {stale && <p className="warn small">계산한 뒤 계통이나 화면 시각이 바뀌었습니다. 아래는 예전 결과이니 &ldquo;{k.calc}&rdquo;을 다시 눌러 주세요.</p>}
          <div className="hosting-max">
            <span className="muted small">더 {k.verb} 수 있는 최대 · {basis(mine.at)}</span>
            <b>{d.max_kw >= 20000 && atLimit ? '20,000 kW 이상' : `${d.max_kw.toLocaleString()} kW`}</b>
            {d.max_kw === 0 && d.limited_by.length > 0 && <span className="warn small">지금 계통이 이미 기준을 넘어서 더 {k.verb} 수 없습니다</span>}
          </div>
          {d.limited_by.length > 0 && (
            <>
              <span className="small">이 이상 {k.verb === '붙일' ? '붙이면' : '늘리면'} 막히는 곳</span>
              <ul>
                {d.limited_by.map((v) => {
                  const t = violationLine(v, names)
                  return (
                    <li key={`${v.kind}-${v.element_id}`}>
                      <span>
                        <b className="bad">{t.kind}</b> {t.what}
                      </span>
                      <button type="button" className="chip" onClick={() => onFocus(v.element_id)} title="단선도에서 이 위치로 이동">
                        ⌖ {t.val}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          {d.target_kw != null && (
            <>
              <span className="small">목표 {d.target_kw.toLocaleString()} kW를 {k.verb === '붙일' ? '붙이면' : '늘리면'}</span>
              {d.target_violations.length === 0 ? (
                <span className="ok-line">기준 안에 있음 · {k.okText}</span>
              ) : (
                <ul>
                  {d.target_violations.map((v) => {
                    const t = violationLine(v, names)
                    return (
                      <li key={`t-${v.kind}-${v.element_id}`}>
                        <span>
                          <b className="bad">{t.kind}</b> {t.what}
                          {v.required_rated_current_a != null && <> → 허용전류 {Math.ceil(v.required_rated_current_a)} A 이상으로</>}
                        </span>
                        <button type="button" className="chip" onClick={() => onFocus(v.element_id)} title="단선도에서 이 위치로 이동">
                          ⌖ {t.val}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {added ? (
                <span className="ok-line">붙였습니다 · 시간대별 시뮬레이션 탭에서 전후 비교, 되돌리려면 편집 모드에서 Ctrl+Z</span>
              ) : (
                <button type="button" className="mini" disabled={stale} onClick={() => onAddPv(node.id, d.target_kw, kind)} title={`실제로 ${k.what} 노드를 붙입니다 (자동 저장, 편집 모드에서 Ctrl+Z로 되돌리기)`}>
                  이 접속점에 {d.target_kw.toLocaleString()} kW 붙여 보기
                </button>
              )}
              <span className="muted small">
                붙인 {k.what}의 kW는 {kind === 'pv' ? '설비용량' : '최대 부하'}라 &ldquo;지금 시각&rdquo; 화면에서는 그 시각 배율만큼만 나옵니다. 위 검토 값과 똑같이 보려면 &ldquo;최대 조건&rdquo;으로 바꿔 보세요.
              </span>
            </>
          )}
          {/* 구현 참고 (최민준 추가, 고영민 확인 필요): 유스케이스 1 ⑤ AI 추천 (components/UsecasePanels.jsx) */}
          {kind === 'pv' && <HostingAi graph={graph} hosting={mine} stale={stale} />}
          <span className="muted small">선로 허용전류는 데이터가 없으면 400 A 가정값이라 최대치가 이 값에 크게 좌우됩니다.</span>
        </>
      )}
    </div>
  )
}

function NodeProps({ graph, node, result, editing, onChange, hosting, resultAt, onCheckHosting, onAddPv, onFocus }) {
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
      <Suspense fallback={<div className="eq3d" />}>
        <Equipment3D node={node} color={r ? voltageColor(r) : COLORS.gray} />
      </Suspense>
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
              <Stat label="① 전압" value={`${r.voltage_pu.toFixed(4)} pu`} color={voltageColor(r)} />
              <Stat
                label="④ 3상 단락전류·용량"
                value={r.fault_current_ka != null ? `${r.fault_current_ka.toFixed(2)} kA · ${mvaOf(r.fault_current_ka).toFixed(0)} MVA` : '-'}
              />
              {/* 1선·2선 지락 전류 (11/9 팀 피드백). 백엔드가 지락을 계산하지 않는 버전이면 줄을 숨긴다 */}
              {r.ground_fault_current_ka != null && <Stat label="1선 지락전류" value={`${r.ground_fault_current_ka.toFixed(2)} kA`} />}
              {r.double_ground_fault_current_ka != null && <Stat label="2선 지락전류" value={`${r.double_ground_fault_current_ka.toFixed(2)} kA`} />}
            </>
          ) : (
            <Stat label="상태" value="정전 (전원에서 끊김)" color={COLORS.outage} />
          )}
        </div>
      )}
      {node.type === 'bus' && onCheckHosting && result && (
        <HostingSection
          key={node.id}
          graph={graph}
          node={node}
          hosting={hosting}
          resultAt={resultAt}
          onCheckHosting={onCheckHosting}
          onAddPv={onAddPv}
          onFocus={onFocus}
        />
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
          {/* 구현 참고 (고영민·최민준 확인 필요): 선로 전체 임피던스 = Ω/km × 길이 (OpenDSS가 계산에 쓰는 값과 같음, 안진성 추가) */}
          <dl className="meta">
            <dt>선로 임피던스</dt>
            <dd>
              {(line.r_ohm_per_km * line.length_km).toFixed(3)} + j{(line.x_ohm_per_km * line.length_km).toFixed(3)} Ω
            </dd>
          </dl>
          {/* 구현 참고 (고영민·최민준 확인 필요): 영상분 R0·X0 편집 칸 (1선·2선 지락 계산용, 안진성 추가).
              비우면 시뮬레이션이 정상분 × 3으로 계산 (simulation/dss.py의 DEFAULT_ZERO_SEQ_RATIO) */}
          <NumberField key={`${line.id}-r0`} label="영상분 저항 R0" unit="Ω/km" value={line.r0_ohm_per_km} disabled={!editing} onCommit={(v) => set({ r0_ohm_per_km: v })} />
          <NumberField key={`${line.id}-x0`} label="영상분 리액턴스 X0" unit="Ω/km" value={line.x0_ohm_per_km} disabled={!editing} onCommit={(v) => set({ x0_ohm_per_km: v })} />
        </>
      )}
      <NumberField key={`${line.id}-amp`} label="허용전류" unit="A" value={line.rated_current_a} disabled={!editing} onCommit={(v) => set({ rated_current_a: v })} />
      {r && (
        <div className="stats">
          <Stat label="유효전력" value={`${r.p_kw.toFixed(0)} kW`} />
          <Stat label="무효전력" value={`${r.q_kvar.toFixed(0)} kvar`} />
          <Stat label="② 부하율" value={r.loading_pct != null ? `${r.loading_pct.toFixed(1)} %` : '-'} color={r.loading_pct > OVERLOAD_PCT ? COLORS.red : r.loading_pct != null ? loadingColor(r.loading_pct) : undefined} />
          <Stat
            label="③ 역조류"
            value={!r.reverse_flow ? '없음' : r.reverse_flow_ok === true ? '있음 · 정상' : r.reverse_flow_ok === false ? '있음 · 비정상' : '있음'}
            color={!r.reverse_flow ? undefined : r.reverse_flow_ok === true ? COLORS.orange : COLORS.red}
          />
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
      {/* 변전소는 이름만 고칠 수 있다. 아래 값은 시뮬레이션 결과를 바꾸므로 적재 데이터 값을 보여 주기만 한다 (cim/graph.py의 save_substation과 같은 규칙) */}
      <NumberField key={`${s.id}-v`} label="모선 전압" unit="pu" value={s.source_voltage_pu} disabled />
      <NumberField key={`${s.id}-sc`} label="3상 단락용량" unit="MVA" value={s.short_circuit_mva} disabled />
      <NumberField key={`${s.id}-xr`} label="X/R" value={s.x_r_ratio} disabled />
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

export default function PropertyPanel({ graph, selectedIds, result, editing, onChange, hosting, resultAt, onCheckHosting, onAddPv, onFocus }) {
  if (!graph) return <aside className="props" />
  const id = selectedIds.length === 1 ? selectedIds[0] : null
  const node = id && graph.nodes.find((n) => n.id === id)
  const line = id && graph.lines.find((l) => l.id === id)
  let body
  if (selectedIds.length > 1) body = <p className="muted">{selectedIds.length}개 선택됨 (Delete로 삭제, 끌어서 함께 이동)</p>
  else if (node)
    body = (
      <NodeProps
        graph={graph}
        node={node}
        result={result}
        editing={editing}
        onChange={onChange}
        hosting={hosting}
        resultAt={resultAt}
        onCheckHosting={onCheckHosting}
        onAddPv={onAddPv}
        onFocus={onFocus}
      />
    )
  else if (line) body = <LineProps graph={graph} line={line} result={result} editing={editing} onChange={onChange} />
  else if (id?.startsWith('attach:')) body = <p className="muted">접속점 붙임 (bus_id). 지우면 설비가 접속점에서 떨어집니다</p>
  else body = <SubstationProps graph={graph} editing={editing} onChange={onChange} />
  return <aside className="props">{body}</aside>
}
