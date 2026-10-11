// 시뮬레이션 결과 패널: 요약, 결과 그래프(PNG), AI 리포트 (제안서 2·3·5단계)
// 화면 오른쪽 패널에 들어가며, 세 부분을 탭으로 나눠 스크롤 없이 바로 볼 수 있게 한다.
// 위치 버튼(문제 지점, 피더, 지점별 결과)을 누르면 onFocus(id)로 단선도가 그 위치로 이동한다.
// 리포트 형식은 ai_report/models.py의 Report(diagnosis, causes, solutions)와 같다. 형식이 바뀌면 아래 '리포트' 부분을 같이 고친다
// 그래프 PNG는 simulation/plot.py가 그린다 (한글 글꼴: Windows 맑은 고딕)
import { useState } from 'react'
import { COLORS, VOLTAGE_MIN_PU, summarize } from '../lib/overlay.js'

const SECTIONS = [
  ['summary', '요약'],
  ['plot', '그래프'],
  ['report', 'AI 리포트'],
]

function Summary({ graph, result, onFocus }) {
  const s = summarize(graph, result)
  const feederName = (id) => graph.feeders.find((f) => f.id === id)?.name ?? id
  const breakerOf = (feederId) => graph.nodes.find((n) => n.type === 'breaker' && n.feeder_id === feederId)
  return (
    <>
      <div className="cards">
        <div className="card">
          <span>최저 전압</span>
          <b style={{ color: s.minV !== null && s.minV < VOLTAGE_MIN_PU ? COLORS.low : undefined }}>
            {s.minV === null ? '-' : `${s.minV.toFixed(3)} pu`}
          </b>
        </div>
        <div className="card">
          <span>최대 3상 단락전류</span>
          <b>{s.maxFault.toFixed(2)} kA</b>
        </div>
        <div className="card">
          <span>선로 손실</span>
          <b>{result.loss_kw.toFixed(1)} kW</b>
        </div>
        {result.feeders.map((f) => {
          const breaker = breakerOf(f.feeder_id)
          return (
            <button
              type="button"
              className="card feeder"
              key={f.feeder_id}
              disabled={!breaker}
              onClick={() => breaker && onFocus(breaker.id)}
              title="단선도에서 이 피더의 차단기로 이동"
            >
              <span>{feederName(f.feeder_id)} 송출</span>
              <b>
                {(f.p_kw / 1000).toFixed(2)} MW / {(f.q_kvar / 1000).toFixed(2)} MVAr
              </b>
            </button>
          )
        })}
      </div>

      <h4>문제 지점 (누르면 단선도에서 이동)</h4>
      <div className="checks">
        {s.items.map((it) => (
          <div key={it.key} className={it.count ? 'check bad' : 'check'}>
            <i style={{ background: it.count ? it.color : COLORS.normal }} />
            <span>{it.label}</span>
            <b>{it.count}</b>
            {it.count > 0 && (
              <div className="chips">
                {it.refs.map((r) => (
                  <button type="button" className="chip" key={r.id} onClick={() => onFocus(r.id)} title="단선도에서 보기">
                    {r.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <h4>지점별 전압·고장전류 (전압 낮은 순)</h4>
      <table className="node-table">
        <thead>
          <tr>
            <th>지점</th>
            <th>전압 (pu)</th>
            <th>단락전류 (kA)</th>
          </tr>
        </thead>
        <tbody>
          {s.nodes.map((n) => (
            <tr key={n.id} onClick={() => onFocus(n.id)} title="단선도에서 보기">
              <td>
                <i style={{ background: COLORS[n.state] }} />
                {n.name}
              </td>
              <td>{n.voltage === null ? '정전' : n.voltage.toFixed(3)}</td>
              <td>{n.fault == null ? '-' : n.fault.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function Report({ report, reportMessage }) {
  if (!report) return <p className="muted">{reportMessage}</p>
  return (
    <div className="report">
      <h4>1. 건강도 진단</h4>
      <p>{report.diagnosis}</p>
      <h4>2. 원인 분석</h4>
      <ul>
        {report.causes.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
      <h4>3. 솔루션 제안</h4>
      <ul>
        {report.solutions.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </div>
  )
}

export default function ResultPanel({ graph, result, plotUrl, plotMessage, report, reportMessage, onFocus }) {
  const [section, setSection] = useState('summary')
  if (!result || !graph) return <p className="muted">시뮬레이션을 실행하면 결과가 여기에 표시됩니다.</p>
  return (
    <div className="results">
      <div className="seg seg-wide" role="tablist">
        {SECTIONS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={section === k} className={section === k ? 'on' : ''} onClick={() => setSection(k)}>
            {label}
            {k === 'report' && !report && <span className="dot-busy" />}
          </button>
        ))}
      </div>
      <div className="results-body">
        {section === 'summary' && <Summary graph={graph} result={result} onFocus={onFocus} />}
        {section === 'plot' && (plotUrl ? <img src={plotUrl} alt="전압 프로파일과 선로별 조류" /> : <p className="muted">{plotMessage}</p>)}
        {section === 'report' && <Report report={report} reportMessage={reportMessage} />}
      </div>
    </div>
  )
}
