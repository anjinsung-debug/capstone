// 새 변전소 이름 입력 창. 브라우저 기본 prompt 대신 화면 스타일에 맞춰 띄운다.
// Enter로 만들고 Esc나 바깥 클릭으로 닫는다.
import { useEffect, useRef, useState } from 'react'

export default function NewSubstationDialog({ onCreate, onCancel }) {
  const [name, setName] = useState('새 변전소')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = (e) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed) onCreate(trimmed)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="new-sub-title" onSubmit={submit}>
        <h2 id="new-sub-title">새 변전소</h2>
        <p className="muted">빈 단선도에서 시작합니다. 왼쪽 편집 메뉴에서 전원 → 접속점 → 차단기 순서로 설비를 추가하세요.</p>
        <label className="field">
          <span>변전소 이름</span>
          <div className="field-input">
            <input ref={inputRef} type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            취소
          </button>
          <button type="submit" className="primary" disabled={!name.trim()}>
            만들기
          </button>
        </div>
      </form>
    </div>
  )
}
