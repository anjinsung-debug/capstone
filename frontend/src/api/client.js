// 백엔드 API 호출. 개발 중에는 Vite 프록시가 /api 를 http://localhost:8000 으로 전달한다.
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
export const createNode = (feederId, body) => request('POST', `/feeders/${feederId}/nodes`, body)
export const updateNode = (nodeId, body) => request('PATCH', `/nodes/${nodeId}`, body)
export const deleteNode = (nodeId) => request('DELETE', `/nodes/${nodeId}`)
export const createLine = (feederId, body) => request('POST', `/feeders/${feederId}/lines`, body)
export const updateLine = (lineId, body) => request('PATCH', `/lines/${lineId}`, body)
export const deleteLine = (lineId) => request('DELETE', `/lines/${lineId}`)

// 시뮬레이션 (FR-03, FR-04)
export const runSimulation = (feederId) => request('POST', `/feeders/${feederId}/simulations`)
export const getSimulation = (simulationId) => request('GET', `/simulations/${simulationId}`)

// AI 리포트 (FR-08, FR-09)
export const createReport = (simulationId) => request('POST', `/simulations/${simulationId}/report`)
