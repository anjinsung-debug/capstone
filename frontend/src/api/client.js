// 백엔드 API 호출. 개발 중에는 Vite 프록시가 /api 를 http://localhost:8000 으로 전달한다.
export async function getHealth() {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
