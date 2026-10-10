// 단선도 편집 메뉴 (제안서 4단계). 로고 옆 메뉴 버튼으로 여닫는 왼쪽 네비게이션이다.
// 설비(노드)와 선로를 여기서 골라 단선도에 만든다. 선택한 도구를 App에 알린다.
// 설비 종류 7가지와 이름은 lib/graphEdit.js의 NODE_TYPES (= cim/models.py의 NodeType)에서 가져온다
import { NODE_TYPES } from '../lib/graphEdit.js'

const TOOLS = [{ id: 'select', label: '선택·이동', hint: '노드를 끌어 옮깁니다. Shift+끌기로 여러 개 선택' }]
const LINE_TOOLS = [{ id: 'connect', label: '선로 연결', hint: '노드 두 개를 차례로 누르면 선로(또는 접속점 붙임)를 만듭니다' }]

function Tool({ tool, onTool, item }) {
  return (
    <button type="button" className={tool === item.id ? 'tool active' : 'tool'} title={item.hint} onClick={() => onTool(item.id)}>
      {item.label}
    </button>
  )
}

export default function EditToolbar({ tool, onTool, onDelete, canDelete, onClose }) {
  return (
    <nav className="toolbar" aria-label="편집 메뉴">
      <div className="toolbar-head">
        <b>편집</b>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="메뉴 닫기" title="메뉴 닫기">
          ✕
        </button>
      </div>
      <div className="toolbar-group">
        {TOOLS.map((t) => (
          <Tool key={t.id} tool={tool} onTool={onTool} item={t} />
        ))}
      </div>
      <div className="toolbar-title">노드 (고른 뒤 단선도의 빈 곳 클릭)</div>
      <div className="toolbar-group">
        {Object.entries(NODE_TYPES).map(([type, info]) => (
          <Tool key={type} tool={tool} onTool={onTool} item={{ id: type, label: info.label }} />
        ))}
      </div>
      <div className="toolbar-title">선로 (노드 두 개를 차례로 클릭)</div>
      <div className="toolbar-group">
        {LINE_TOOLS.map((t) => (
          <Tool key={t.id} tool={tool} onTool={onTool} item={t} />
        ))}
      </div>
      <div className="toolbar-group">
        <button type="button" className="tool danger" disabled={!canDelete} onClick={onDelete} title="Delete 키">
          선택 삭제
        </button>
      </div>
    </nav>
  )
}
