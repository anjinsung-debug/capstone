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

// 계통 조회·편집 (FR-02, FR-05, FR-06, FR-07)
export const listFeeders = () => request('GET', '/feeders')
export const getFeeder = (feederId) => request('GET', `/feeders/${feederId}`)
// 편집 스냅샷 전체 저장: 새 노드·선로는 임시 id로 보내고, 응답의 id_map으로 실제 id를 받는다
export const saveFeeder = (feederId, snapshot) => request('PUT', `/feeders/${feederId}`, snapshot)
export const createNode = (feederId, body) => request('POST', `/feeders/${feederId}/nodes`, body)
export const updateNode = (nodeId, body) => request('PATCH', `/nodes/${nodeId}`, body)
export const deleteNode = (nodeId) => request('DELETE', `/nodes/${nodeId}`)
export const createLine = (feederId, body) => request('POST', `/feeders/${feederId}/lines`, body)
export const updateLine = (lineId, body) => request('PATCH', `/lines/${lineId}`, body)
export const deleteLine = (lineId) => request('DELETE', `/lines/${lineId}`)

// 시뮬레이션 (FR-03, FR-04)
export const runSimulation = (feederId) => request('POST', `/feeders/${feederId}/simulations`)

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
