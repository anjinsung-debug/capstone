// 위쪽 변전소 선택 목록 (11/14): 펼친 목록의 변전소마다 오른쪽에 ✕ (누르면 완전 삭제 확인 창).
// 브라우저 기본 <select>는 항목 안에 버튼을 넣을 수 없어서 직접 만든 목록이다. 맨 아래는 "+ 새 변전소" (11/10 피드백)
// - 바깥을 누르거나 Esc를 누르면 닫힌다. ↑↓·Enter로도 고를 수 있다
// - 저장 전인 새 변전소도 목록 맨 위에 "(저장 전)"으로 보이고 ✕로 버릴 수 있다
import { useEffect, useRef, useState } from 'react'

export default function SubstationPicker({ substations, current, isNew, onSelect, onNew, onDelete }) {
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(-1) // 키보드로 가리키는 줄
  const box = useRef(null)
  const rows = [...(isNew && current ? [{ ...current, unsaved: true }] : []), ...substations]

  useEffect(() => {
    if (!open) return undefined
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false)
    const key = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  const pick = (s) => {
    setOpen(false)
    if (s === 'new') onNew()
    else if (!s.unsaved && s.id !== current?.id) onSelect(s.id)
  }
  const onKey = (e) => {
    const n = rows.length + 1 // + 새 변전소
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setCursor((c) => (c + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
    } else if (e.key === 'Enter' && open && cursor >= 0) {
      e.preventDefault()
      pick(cursor < rows.length ? rows[cursor] : 'new')
    }
  }

  const label = current ? `${current.name}${isNew ? ' (저장 전)' : ''}` : '변전소 선택'
  return (
    <div className="sub-picker" ref={box}>
      <button type="button" className={`sub-current${current ? '' : ' empty'}`} onClick={() => setOpen((o) => !o)} onKeyDown={onKey} aria-haspopup="listbox" aria-expanded={open}>
        <span>{label}</span>
        <i aria-hidden="true">▾</i>
      </button>
      {open && (
        <ul className="sub-list" role="listbox">
          {rows.map((s, i) => (
            <li key={s.id} role="option" aria-selected={s.id === current?.id} className={`${s.id === current?.id ? 'on' : ''}${i === cursor ? ' cursor' : ''}`}>
              <button type="button" className="sub-name" onClick={() => pick(s)}>
                {s.name}
                {s.unsaved && <small> (저장 전)</small>}
              </button>
              <button
                type="button"
                className="sub-x"
                title={`'${s.name}' 변전소 완전 삭제`}
                aria-label={`${s.name} 삭제`}
                onClick={() => {
                  setOpen(false)
                  onDelete(s)
                }}
              >
                ✕
              </button>
            </li>
          ))}
          <li className={`sub-new${cursor === rows.length ? ' cursor' : ''}`}>
            <button type="button" className="sub-name" onClick={() => pick('new')}>
              + 새 변전소
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}
