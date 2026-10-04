// 백엔드 API 호출 함수. 개발 중에는 Vite 프록시가 /api 를 http://localhost:8000 으로 전달한다.
async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.status === 204 ? null : res.json()
}

// 상태 확인
export const getHealth = () => request('GET', '/health')

// 계통 조회·편집 저장 (FR-02, FR-05, FR-06, FR-07), 변전소 단위
export const listSubstations = () => request('GET', '/substations')
export const getSubstation = (substationId) => request('GET', `/substations/${substationId}`)
// 편집 스냅샷 전체 저장: 편집 중 추가한 노드·선로에는 crypto.randomUUID()로 id를 바로 할당해 보내고,
// 응답의 element_ids(UUID → Neo4j element id)를 받는다
export const saveSubstation = (substationId, snapshot) =>
  request('PUT', `/substations/${substationId}`, snapshot)

// 시뮬레이션 (FR-03, FR-04)
export const runSimulation = (substationId) => request('POST', `/substations/${substationId}/simulations`)

// 시뮬레이션 결과 그래프: runSimulation 결과를 그대로 넘기면 <img src>에 쓸 수 있는 PNG 주소를 돌려준다
export async function createPlot(simulationResult) {
  const res = await fetch('/api/plots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(simulationResult),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return URL.createObjectURL(await res.blob())
}

// AI 리포트 (FR-08, FR-09): runSimulation 결과를 그대로 넘긴다
export const createReport = (simulationResult) => request('POST', '/reports', simulationResult)
