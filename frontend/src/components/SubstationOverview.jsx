// 첫 화면: 변전소 전체 단선도 (154/22.9kV 왕산변전소, 주변압기 4대 → 22.9kV 상·하단 모선 → 배전선로(D/L) 인출)
// 그림은 frontend/public/overview/wangsan_22kv.html (안진성이 준 정적 그림. 전력공급 전과정1.html의 154kV 왕산 단선도에서 22.9kV 구간만 저장)
// 앱이 계산하는 건 그중 배전선로 하나(변전소 선택 → 편집·시뮬레이션)라서, 여기서는 그림만 보여 주고 계산과는 연결하지 않는다.
// - 변전소를 고르기 전: 이 화면이 처음 보인다
// - 고른 뒤: 위쪽 "변전소 전체" 버튼으로 다시 열고 닫는다
// ponytail: 정적 그림이라 숫자(전류·이용률)는 저장 시점 값이다. 배전선로(D/L)를 누르면 그 선로 단선도로 넘어가게 하려면
// D/L 이름과 우리 계통(CIM) 변전소를 짝지은 표가 있어야 한다 (지금 CIM 데이터에는 D/L 이름이 없음)
const SRC = `${import.meta.env.BASE_URL}overview/wangsan_22kv.html`

// 그림 파일은 OS 다크 모드를 따르는데, 앱은 늘 어두운 화면이라 그림도 어둡게 맞춘다 (같은 출처라 문서에 바로 접근 가능)
function darken(e) {
  try {
    e.currentTarget.contentDocument.documentElement.dataset.theme = 'dark'
  } catch {
    /* 못 바꾸면 그림 기본 색 그대로 */
  }
}

export default function SubstationOverview({ hasGraph, onClose }) {
  return (
    <section className="overview" aria-label="변전소 전체 단선도">
      <div className="overview-head">
        <div>
          <strong>변전소 전체 보기</strong>
          <span>왕산변전소 154/22.9kV · 주변압기 4대 · 22.9kV 상·하단 모선 · 배전선로(D/L) 인출 (저장 시점 운전 상태)</span>
        </div>
        {hasGraph ? (
          <button type="button" onClick={onClose}>
            배전선로 단선도로 돌아가기
          </button>
        ) : (
          <span className="overview-hint">오른쪽 위에서 변전소를 고르면 배전선로 단선도(편집·계산)로 넘어갑니다</span>
        )}
      </div>
      {/* sandbox: 그림 파일에는 스크립트가 없다. 같은 출처만 허용해서 색 맞추기(darken)만 가능하게 */}
      <iframe title="왕산변전소 22.9kV 단선도" src={SRC} sandbox="allow-same-origin" onLoad={darken} />
    </section>
  )
}
