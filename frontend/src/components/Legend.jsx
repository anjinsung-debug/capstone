// 단선도 범례. 단선도(Diagram.jsx) 안에 표시한다. 색·기준값은 lib/overlay.js와 같은 것을 쓴다
import { COLORS, OVERLOAD_PCT, VOLTAGE_MAX_PU, VOLTAGE_MIN_PU } from '../lib/overlay.js'

export default function Legend() {
  const items = [
    ['정상', COLORS.normal],
    [`저전압 < ${VOLTAGE_MIN_PU}`, COLORS.low],
    [`과전압 > ${VOLTAGE_MAX_PU}`, COLORS.high],
    [`과부하 > ${OVERLOAD_PCT}%`, COLORS.overload],
    ['역조류', COLORS.reverse],
    ['정전', COLORS.outage],
    ['피더 송출', COLORS.feeder],
  ]
  return (
    <div className="legend">
      {items.map(([label, color]) => (
        <span key={label}>
          <i style={{ background: color }} />
          {label}
        </span>
      ))}
      <span className="muted">선 굵기 = 부하율, 화살표 = 실제 조류 방향</span>
    </div>
  )
}
