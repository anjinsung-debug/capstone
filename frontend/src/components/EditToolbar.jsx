// 단선도 편집 도구 (제안서 4단계). 선택한 도구를 App에 알린다.
// 설비 종류 7가지와 이름은 lib/graphEdit.js의 NODE_TYPES (= cim/models.py의 NodeType)에서 가져온다
import { NODE_TYPES } from '../lib/graphEdit.js'

const TOOLS = [
  { id: 'select', label: '선택·이동', icon: '↖', hint: '노드를 끌어 옮깁니다. Shift+끌기로 여러 개 선택' },
  { id: 'connect', label: '연결', icon: '⟋', hint: '노드 두 개를 차례로 누르면 선로(또는 접속점 붙임)를 만듭니다' },
]
const ICONS = { source: '⏻', breaker: '■', switch: '◇', bus: '●', load: '▼', pv: '☀', wind: '✣' }

export default function EditToolbar({ tool, onTool, onDelete, canDelete }) {
  return (
    <aside className="toolbar">
      <div className="toolbar-group">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className={tool === t.id ? 'tool active' : 'tool'} title={t.hint} onClick={() => onTool(t.id)}>
            <span className="tool-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      <div className="toolbar-title">설비 추가 (빈 곳 클릭)</div>
      <div className="toolbar-group">
        {Object.entries(NODE_TYPES).map(([type, info]) => (
          <button key={type} type="button" className={tool === type ? 'tool active' : 'tool'} onClick={() => onTool(type)}>
            <span className={`tool-icon t-${type}`}>{ICONS[type]}</span>
            {info.label}
          </button>
        ))}
      </div>
      <div className="toolbar-group">
        <button type="button" className="tool danger" disabled={!canDelete} onClick={onDelete} title="Delete 키">
          <span className="tool-icon">✕</span>
          선택 삭제
        </button>
      </div>
    </aside>
  )
}
