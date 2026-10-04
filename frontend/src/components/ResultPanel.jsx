// 시뮬레이션 결과 요약, 결과 그래프(PNG), AI 리포트 표시 (제안서 2·3·5단계)
export default function ResultPanel({ result, plotUrl, report, reportMessage }) {
  if (!result) return null
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0 }}>
        {result.converged ? '계산 완료' : '계산이 수렴하지 않았습니다'} · 피더 송출{' '}
        {(result.total_p_kw / 1000).toFixed(2)} MW / {(result.total_q_kvar / 1000).toFixed(2)} MVAr
      </p>
      {plotUrl && <img src={plotUrl} alt="시뮬레이션 결과 그래프" style={{ maxWidth: '100%' }} />}
      {report ? (
        <div>
          <h3>1. 건강도 진단</h3>
          <p>{report.diagnosis}</p>
          <h3>2. 원인 분석</h3>
          <ul>{report.causes.map((c, i) => <li key={i}>{c}</li>)}</ul>
          <h3>3. 솔루션 제안</h3>
          <ul>{report.solutions.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      ) : (
        <p style={{ margin: 0 }}>{reportMessage}</p>
      )}
    </section>
  )
}
