// 설비 종류별 모양·색 (단선도 Cytoscape 스타일과 편집 메뉴·표의 아이콘이 같은 정의를 쓴다).
// 예전에는 메뉴 아이콘을 글자(▼ ☀ ⏻ …)로 따로 그려서 단선도 모양(▲ 육각형 둥근 네모 …)과 달랐다
export const TYPE_STYLE = {
  source: { shape: 'round-rectangle', color: '#b388ff', size: 34 },
  breaker: { shape: 'rectangle', color: '#ff7a7a', size: 22 },
  switch: { shape: 'diamond', color: '#7fd1ff', size: 22 },
  bus: { shape: 'ellipse', color: '#8c979d', size: 12 },
  load: { shape: 'triangle', color: '#c9d1d5', size: 22 },
  pv: { shape: 'hexagon', color: '#f5c542', size: 24 },
  wind: { shape: 'pentagon', color: '#5ee0c8', size: 24 },
}

// Cytoscape 모양과 같은 꼭짓점 (24×24 안에 그림)
const POLY = {
  triangle: '12,3 22,21 2,21',
  diamond: '12,2 22,12 12,22 2,12',
  hexagon: '2,12 7,3 17,3 22,12 17,21 7,21',
  pentagon: '12,2 22,9.5 18,21 6,21 2,9.5',
}

export default function NodeIcon({ type, size = 16 }) {
  const s = TYPE_STYLE[type]
  if (!s) return null
  // 접속점은 단선도에서도 작게 그리므로 아이콘도 조금 작게
  const shape =
    s.shape === 'ellipse' ? (
      <circle cx="12" cy="12" r={type === 'bus' ? 7 : 10} />
    ) : s.shape === 'rectangle' ? (
      <rect x="3" y="3" width="18" height="18" />
    ) : s.shape === 'round-rectangle' ? (
      <rect x="2" y="2" width="20" height="20" rx="5" />
    ) : (
      <polygon points={POLY[s.shape]} />
    )
  return (
    <svg className="node-icon" viewBox="0 0 24 24" width={size} height={size} fill={s.color} aria-hidden="true">
      {shape}
    </svg>
  )
}
