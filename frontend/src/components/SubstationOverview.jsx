// 첫 화면: DB에 있는 변전소를 단선도로 그린다 (11/10 피드백: 정적 그림 대신 내 DB에 맞게, 누르면 그 변전소 편집)
// 154 kV 송전선 → 변전소마다 주변압기 → 22.9 kV 모선 → 배전선로(피더)마다 출구 차단기.
// 변전소(또는 그 배전선로)를 누르면 그 변전소의 배전선로 단선도로 들어가 편집·계산한다. 맨 끝 "+ 새 변전소"는 새로 만들기
// - 처음(변전소를 고르기 전)에는 이 화면이 보이고, 고른 뒤에는 위쪽 제목을 누르면 다시 열린다
// ponytail: 변전소마다 계통을 한 번씩 불러와(GET /substations/{id}) 피더·설비 수를 그린다. 변전소가 수십 개가 되면 목록 API에 요약을 넣어 한 번에 받는다
import { useEffect, useState } from 'react'
import { getSubstation } from '../api/client.js'

const COL_W = 230 // 변전소 한 칸 너비
const TOP = 46 // 154 kV 선 높이
const BUS_Y = 178 // 22.9 kV 모선 높이

function Column({ x, sub, detail, current, onSelect }) {
  const feeders = detail?.feeders ?? []
  const count = (t) => detail?.nodes.filter((n) => n.type === t).length ?? 0
  const n = Math.max(feeders.length, 1)
  const span = Math.min(COL_W - 60, 46 * n)
  const fx = (i) => x - span / 2 + (n === 1 ? span / 2 : (span / (n - 1)) * i)
  return (
    <g className={`ov-sub${current ? ' current' : ''}`} onClick={() => onSelect(sub.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelect(sub.id)}>
      <title>{`${sub.name} · 눌러서 배전선로 단선도 열기 (편집·계산)`}</title>
      <rect className="ov-hit" x={x - COL_W / 2 + 8} y={TOP + 8} width={COL_W - 16} height={300} rx="12" />
      <line className="ov-wire" x1={x} y1={TOP} x2={x} y2={TOP + 40} />
      {/* 주변압기 (원 두 개) */}
      <circle className="ov-tr" cx={x} cy={TOP + 56} r="16" />
      <circle className="ov-tr" cx={x} cy={TOP + 80} r="16" />
      <text className="ov-small" x={x + 24} y={TOP + 72}>
        154/22.9 kV
      </text>
      <line className="ov-wire" x1={x} y1={TOP + 96} x2={x} y2={BUS_Y} />
      {/* 22.9 kV 모선 */}
      <line className="ov-bus" x1={x - span / 2 - 18} y1={BUS_Y} x2={x + span / 2 + 18} y2={BUS_Y} />
      {feeders.length === 0 && (
        <text className="ov-small" x={x} y={BUS_Y + 40} textAnchor="middle">
          {detail ? '배전선로 없음' : '불러오는 중…'}
        </text>
      )}
      {feeders.map((f, i) => (
        <g key={f.id}>
          <line className="ov-wire" x1={fx(i)} y1={BUS_Y} x2={fx(i)} y2={BUS_Y + 70} />
          <rect className="ov-cb" x={fx(i) - 7} y={BUS_Y + 22} width="14" height="14" />
          <text className="ov-feeder" x={fx(i)} y={BUS_Y + 88} textAnchor="middle">
            {f.name}
          </text>
        </g>
      ))}
      <text className="ov-name" x={x} y={TOP + 30} textAnchor="middle">
        {sub.name}
      </text>
      {detail && (
        <text className="ov-small" x={x} y={BUS_Y + 118} textAnchor="middle">
          부하 {count('load')} · 태양광 {count('pv')} · 풍력 {count('wind')}
        </text>
      )}
      {current && (
        <text className="ov-current" x={x} y={BUS_Y + 140} textAnchor="middle">
          지금 편집 중
        </text>
      )}
    </g>
  )
}

export default function SubstationOverview({ substations, currentId, onSelect, onNew }) {
  const [details, setDetails] = useState({}) // id → 계통 (피더·설비 수 그리기용)
  const ids = substations.map((s) => s.id).join(',')
  useEffect(() => {
    let alive = true
    for (const s of substations) {
      getSubstation(s.id)
        .then((g) => alive && setDetails((d) => ({ ...d, [s.id]: g })))
        .catch(() => alive && setDetails((d) => ({ ...d, [s.id]: { feeders: [], nodes: [] } })))
    }
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids])

  const cols = substations.length + 1 // 마지막 칸 = 새 변전소
  const width = Math.max(cols * COL_W + 40, 600)
  const xOf = (i) => 20 + COL_W / 2 + i * COL_W
  return (
    <section className="overview" aria-label="변전소 전체 단선도">
      <div className="overview-head">
        <div>
          <strong>변전소 전체</strong>
          <span>내 DB의 변전소 {substations.length}곳 · 변전소를 누르면 그 변전소 배전선로 단선도로 들어가 편집·계산합니다</span>
        </div>
      </div>
      <div className="ov-scroll">
        <svg className="ov-svg" width={width} height={BUS_Y + 170} viewBox={`0 0 ${width} ${BUS_Y + 170}`}>
          <line className="ov-154" x1="10" y1={TOP} x2={width - 10} y2={TOP} />
          <text className="ov-small" x="14" y={TOP - 10}>
            154 kV 송전선로
          </text>
          {substations.map((s, i) => (
            <Column key={s.id} x={xOf(i)} sub={s} detail={details[s.id]} current={s.id === currentId} onSelect={onSelect} />
          ))}
          <g className="ov-new" onClick={onNew} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onNew()}>
            <title>새 변전소 만들기</title>
            <rect x={xOf(substations.length) - COL_W / 2 + 18} y={TOP + 40} width={COL_W - 36} height={170} rx="12" />
            <text x={xOf(substations.length)} y={TOP + 130} textAnchor="middle">
              + 새 변전소
            </text>
          </g>
        </svg>
      </div>
    </section>
  )
}
