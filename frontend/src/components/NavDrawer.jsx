// 왼쪽 편집 메뉴 (제안서 4단계, FR-06). 위 왼쪽 ✎ 편집 버튼으로 연다. 열려 있는 동안이 "편집 중"이다.
// 설비(노드)는 칸을 단선도로 끌어다 놓거나, 칸을 누른 뒤 단선도 빈 곳을 누르면 추가된다.
// 선로는 "선로 그리기"를 누른 뒤 노드 두 개를 차례로 누르면 생긴다 (lib/graphEdit.js의 connect).
// 설비 종류 7가지와 이름은 lib/graphEdit.js의 NODE_TYPES (= cim/models.py의 NodeType)에서 가져온다
import NodeIcon from './NodeIcon.jsx'
import { DEFAULT_LINE, NODE_TYPES } from '../lib/graphEdit.js'

export const DRAG_TYPE = 'application/x-capstone-node' // 끌어다 놓기로 넘기는 값의 종류 (Diagram.jsx가 받음)

export default function NavDrawer({ open, substationName, onRename, tool, onTool, onUndo, canUndo, onDelete, canDelete, onClose }) {
  return (
    <aside className={open ? 'nav open' : 'nav'} aria-hidden={!open}>
      <div className="nav-head">
        <b>편집 메뉴</b>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="메뉴 닫기" title="메뉴 닫기 (편집 끝)">
          ✕
        </button>
      </div>

      {/* 변전소 이름 바꾸기는 편집 중에만 (팀 피드백 10/26: 위 변전소 선택 옆 ✎ 버튼을 여기로 옮김. 새 변전소 버튼은 위에 그대로) */}
      <div className="nav-section">
        <div className="nav-title">변전소</div>
        <div className="nav-sub">
          <span className="nav-sub-name" title={substationName}>
            {substationName ?? '-'}
          </span>
          <button type="button" className="tool" disabled={!substationName} onClick={onRename} title="변전소 이름 바꾸기">
            <span className="tool-icon">✎</span>이름 바꾸기
          </button>
        </div>
      </div>

      <div className="nav-section">
        <div className="nav-title">도구</div>
        <button type="button" className={tool === 'select' ? 'tool active' : 'tool'} onClick={() => onTool('select')} title="노드를 끌어 옮깁니다. Shift+끌기로 여러 개 선택">
          <span className="tool-icon">↖</span>선택·이동
        </button>
      </div>

      <div className="nav-section">
        <div className="nav-title">노드 추가 · 끌어다 놓기</div>
        <div className="tiles">
          {Object.entries(NODE_TYPES).map(([type, info]) => (
            <button
              key={type}
              type="button"
              draggable
              className={tool === type ? 'tile active' : 'tile'}
              onClick={() => onTool(tool === type ? 'select' : type)}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, type)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              title={`${info.label}: 단선도로 끌어다 놓거나, 누른 뒤 빈 곳을 클릭`}
            >
              <span className="tile-icon">
                <NodeIcon type={type} size={18} />
              </span>
              <span>{info.short}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="nav-section">
        <div className="nav-title">선로</div>
        <button type="button" className={tool === 'connect' ? 'tool active' : 'tool'} onClick={() => onTool(tool === 'connect' ? 'select' : 'connect')}>
          <span className="tool-icon">⟋</span>선로 그리기
        </button>
        <p className="nav-note">
          노드 두 개를 차례로 누르세요. 부하·태양광·풍력·전원은 접속점에 붙습니다.
          새 선로 기본값 {DEFAULT_LINE.length_km} km, {DEFAULT_LINE.r_ohm_per_km}+j{DEFAULT_LINE.x_ohm_per_km} Ω/km (오른쪽 속성에서 고침)
        </p>
      </div>

      <div className="nav-section">
        <div className="nav-title">편집</div>
        <div className="nav-row">
          <button type="button" className="tool" disabled={!canUndo} onClick={onUndo} title="Ctrl+Z">
            <span className="tool-icon">↶</span>되돌리기
          </button>
          <button type="button" className="tool danger" disabled={!canDelete} onClick={onDelete} title="Delete 키">
            <span className="tool-icon">✕</span>삭제
          </button>
        </div>
      </div>

      <p className="nav-foot">
        바꿀 때마다 자동 저장되고 결과가 다시 계산됩니다.
        <br />
        Delete 삭제 · Ctrl+Z 되돌리기 · Esc 선택 도구
      </p>
    </aside>
  )
}
