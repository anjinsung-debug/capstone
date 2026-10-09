// 시뮬레이션 결과 요약, 피더별 송출 전력, 결과 그래프(PNG), AI 리포트 표시 (제안서 2·3·5단계)
// 리포트 형식은 ai_report/models.py의 Report(diagnosis, causes, solutions)와 같다. 형식이 바뀌면 아래 '리포트' 부분을 같이 고친다
// 그래프 PNG는 simulation/plot.py가 그린다 (한글 글꼴: Windows 맑은 고딕)
import { COLORS, OVERLOAD_PCT, VOLTAGE_MAX_PU, VOLTAGE_MIN_PU, summarize } from '../lib/overlay.js'

export function Legend() {
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

export default function ResultPanel({ graph, result, plotUrl, plotMessage, report, reportMessage }) {
  if (!result || !graph) return null
  const feederName = (id) => graph.feeders.find((f) => f.id === id)?.name ?? id
  const s = summarize(graph, result)
  return (
    <section className="results">
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
        {result.feeders.map((f) => (
          <div className="card feeder" key={f.feeder_id}>
            <span>{feederName(f.feeder_id)} 송출</span>
            <b>
              {(f.p_kw / 1000).toFixed(2)} MW / {(f.q_kvar / 1000).toFixed(2)} MVAr
            </b>
          </div>
        ))}
      </div>

      <div className="checks">
        {s.items.map((it) => (
          <div key={it.key} className={it.count ? 'check bad' : 'check'}>
            <i style={{ background: it.count ? it.color : COLORS.normal }} />
            <span>{it.label}</span>
            <b>{it.count}</b>
            {it.count > 0 && <small title={it.names.join(', ')}>{it.names.slice(0, 4).join(', ')}{it.names.length > 4 ? ' …' : ''}</small>}
          </div>
        ))}
      </div>

      <div className="result-grid">
        <div className="panel">
          <h3>결과 그래프</h3>
          {plotUrl ? <img src={plotUrl} alt="전압 프로파일과 선로별 조류" /> : <p className="muted">{plotMessage}</p>}
        </div>
        <div className="panel report">
          <h3>AI 리포트</h3>
          {report ? (
            <>
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
            </>
          ) : (
            <p className="muted">{reportMessage}</p>
          )}
        </div>
      </div>
    </section>
  )
}
