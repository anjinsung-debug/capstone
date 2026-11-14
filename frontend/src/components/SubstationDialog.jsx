// 새 변전소 만들기 / 변전소 이름 바꾸기 창
// 새 변전소는 "기본 구성"(전원·모선·차단기·접속점)으로 시작하는 것을 권장한다:
// 진짜 백엔드는 전원이 정확히 1개여야 저장되기 때문 (cim/graph.py의 save_substation)
import { useEffect, useState } from 'react'
import { getSubstation } from '../api/client.js'
import Modal from './Modal.jsx'

export function NewSubstationDialog({ onCreate, onClose }) {
  const [name, setName] = useState('새 변전소')
  const [template, setTemplate] = useState('starter')
  const [shortCircuit, setShortCircuit] = useState('')
  const valid = name.trim().length > 0
  const submit = (e) => {
    e.preventDefault()
    if (!valid) return
    const sc = shortCircuit.trim() === '' ? null : Number(shortCircuit)
    onCreate({ name: name.trim(), template, short_circuit_mva: Number.isNaN(sc) ? null : sc })
  }
  return (
    <Modal title="새 변전소" onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        <label className="field">
          <span>변전소 이름</span>
          <div className="field-input">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
          </div>
        </label>

        <div className="field">
          <span>시작 구성</span>
          <div className="choice-row">
            <label className={template === 'starter' ? 'choice on' : 'choice'}>
              <input type="radio" name="template" checked={template === 'starter'} onChange={() => setTemplate('starter')} />
              <b>기본 구성</b>
              <small>전원 → 모선 → 차단기 → 접속점. 부하만 붙이면 바로 계산됩니다</small>
            </label>
            <label className={template === 'empty' ? 'choice on' : 'choice'}>
              <input type="radio" name="template" checked={template === 'empty'} onChange={() => setTemplate('empty')} />
              <b>빈 계통</b>
              <small>처음부터 직접 그립니다. 전원을 놓기 전까지는 저장되지 않을 수 있어요</small>
            </label>
          </div>
        </div>

        <label className="field">
          <span>3상 단락용량 (선택)</span>
          <div className="field-input">
            <input inputMode="decimal" placeholder="비우면 가정값 300" value={shortCircuit} onChange={(e) => setShortCircuit(e.target.value)} />
            <i>MVA</i>
          </div>
        </label>

        <div className="dialog-buttons">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            만들기
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function RenameDialog({ current, onRename, onClose }) {
  const [name, setName] = useState(current)
  const valid = name.trim().length > 0 && name.trim() !== current
  return (
    <Modal title="변전소 이름 바꾸기" onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) onRename(name.trim())
        }}
      >
        <label className="field">
          <span>새 이름</span>
          <div className="field-input">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
          </div>
        </label>
        <div className="dialog-buttons">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            바꾸기
          </button>
        </div>
      </form>
    </Modal>
  )
}

// 변전소 완전 삭제 확인 (변전소 목록의 ✕, 11/14). 한 번 더 물어본다
// target: { id, name, unsaved }. 지금 열린 변전소면 graph를 받아 개수를 바로 보이고, 다른 변전소면 불러와서 보인다
// 저장 전인 새 변전소는 DB에 없으므로 "만들던 것 버리기"만 한다
export function DeleteSubstationDialog({ target, graph, onDelete, onClose }) {
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(null)
  useEffect(() => {
    if (graph || target.unsaved) return
    let alive = true
    getSubstation(target.id)
      .then((g) => alive && setLoaded(g))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [graph, target])
  const g = graph ?? loaded
  const count = (types) => g.nodes.filter((n) => types.includes(n.type)).length
  return (
    <Modal title="변전소 완전 삭제" onClose={busy ? () => {} : onClose}>
      <div className="dialog-form">
        <p className="delete-warn">
          <b>&lsquo;{target.name}&rsquo;</b> 변전소를 완전히 삭제할까요?
        </p>
        {g ? (
          <ul className="delete-list">
            <li>
              배전선로 {g.feeders.length}개, 선로 {g.lines.length}개
            </li>
            <li>
              부하 {count(['load'])}개 · 태양광 {count(['pv'])}개 · 풍력 {count(['wind'])}개 · 접속점 {count(['bus'])}개
            </li>
          </ul>
        ) : (
          !target.unsaved && <p className="muted small">지울 내용을 불러오는 중...</p>
        )}
        <p className="muted small">
          {target.unsaved
            ? '아직 저장 전인 새 변전소라 만들던 내용만 버립니다.'
            : '위 내용이 모두 지워지고 되돌릴 수 없습니다.'}
        </p>
        <div className="dialog-buttons">
          <button type="button" onClick={onClose} disabled={busy} autoFocus>
            취소
          </button>
          <button
            type="button"
            className="danger-btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await onDelete(target)
              setBusy(false)
            }}
          >
            {busy ? '삭제 중...' : '완전 삭제'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
