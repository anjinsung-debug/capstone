// 3D 보기: 지금 계통(graph)과 계산 결과(result)를 3D로 세워서 보여 준다 (발표용 시각화, 편집은 2D 단선도에서)
// - 위치: 2D 단선도 좌표(x, y)를 바닥(x, z)으로 옮김. 같은 배치라 2D와 오가며 비교하기 쉽다
// - 접속점: 기둥. 높이 = 전압 (0.9 pu → 낮음, 1.05 pu → 반투명 기준판 높이). 색 = 전압 판정 (lib/overlay.js의 voltageColor)
// - 선로: 기둥 꼭대기를 잇는 관 (전압이 낮은 곳일수록 선이 내려가 전압 강하가 보인다). 색 = 부하율 (loadingColor). 역조류면 주황(정상)·빨강(비정상)이고 흐르는 방향으로 점이 움직인다
// - 설비: 전원(변압기), 차단기, 개폐기, 부하(집), 태양광(패널), 풍력(날개가 돎). 정전이면 회색
// - 마우스: 끌어서 돌리기, 휠로 확대, 오른쪽 끌기로 이동. 올리면 값, 누르면 오른쪽 속성 칸에 그 설비
// three.js만 쓴다 (react-three-fiber 없이). 계통·결과가 바뀌면 장면을 다시 만든다
// ponytail: 설비 모양은 단순 도형이다. 실제 변전소 설비 3D 모델(.glb)로 바꾸려면 GLTFLoader로 불러와 makeDevice만 바꾸면 된다
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { COLORS, VOLTAGE_MAX_PU, loadingColor, voltageColor } from '../lib/overlay.js'

const SCALE = 1 / 40 // 2D 좌표(px) → 3D 거리
const poleHeight = (v) => Math.max(0.4, 0.6 + (v - 0.9) * 20) // 0.9 pu → 0.6, 1.0 pu → 2.6, 1.05 pu → 3.6
const TYPE_LABEL = { source: '전원(변압기)', breaker: '차단기', switch: '개폐기', bus: '접속점', load: '부하', pv: '태양광', wind: '풍력' }

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15, ...extra })

// 설비 모양 (모두 바닥 y=0에서 위로)
function makeDevice(n, color) {
  const g = new THREE.Group()
  if (n.type === 'source') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.2), mat('#56636b'))
    base.position.y = 0.25
    const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 24), mat(COLORS.blue))
    c1.position.set(-0.35, 1.05, 0)
    const c2 = c1.clone()
    c2.position.x = 0.35
    g.add(base, c1, c2)
  } else if (n.type === 'breaker') {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.6), mat(n.is_open ? COLORS.green : COLORS.red))
    b.position.y = 0.45
    g.add(b)
  } else if (n.type === 'switch') {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.45), mat(n.is_open ? COLORS.green : '#c9d3d8'))
    b.position.y = 0.3
    g.add(b)
  } else if (n.type === 'load') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), mat(color))
    body.position.y = 0.35
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.55, 4), mat('#8a6a4a'))
    roof.position.y = 0.97
    roof.rotation.y = Math.PI / 4
    g.add(body, roof)
  } else if (n.type === 'pv') {
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7), mat('#9aa5ab'))
    stand.position.y = 0.35
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.8), mat('#1f4f9a', { emissive: '#0b2a5a', metalness: 0.5 }))
    panel.position.y = 0.75
    panel.rotation.x = -0.5
    g.add(stand, panel)
  } else if (n.type === 'wind') {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 2.4), mat('#dfe6ea'))
    pole.position.y = 1.2
    const rotor = new THREE.Group()
    rotor.position.y = 2.4
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.02), mat('#f1f4f6'))
      blade.position.y = 0.45
      const arm = new THREE.Group()
      arm.rotation.z = (i * 2 * Math.PI) / 3
      arm.add(blade)
      rotor.add(arm)
    }
    rotor.userData.spin = true
    g.add(pole, rotor)
  }
  return g
}

// 두 점 사이 관 (선로·붙임선)
function tube(a, b, radius, color, opacity = 1) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, len, 10, 1, true),
    mat(color, { emissive: color, emissiveIntensity: 0.25, transparent: opacity < 1, opacity }),
  )
  m.position.copy(a).addScaledVector(dir, 0.5)
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  return m
}

function buildScene(graph, result) {
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight('#cfe8ff', '#1a1f24', 1.1))
  const sun = new THREE.DirectionalLight('#ffffff', 1.4)
  sun.position.set(20, 40, 15)
  scene.add(sun)

  const xs = graph.nodes.map((n) => n.x)
  const ys = graph.nodes.map((n) => n.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 200) * SCALE
  const pos = (n) => new THREE.Vector3((n.x - cx) * SCALE, 0, (n.y - cy) * SCALE)

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.6, size * 1.6), mat('#12181d', { roughness: 1 }))
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)
  const grid = new THREE.GridHelper(size * 1.6, 32, '#2a343b', '#1c242a')
  grid.position.y = 0.01
  scene.add(grid)

  const res = Object.fromEntries((result?.nodes ?? []).map((r) => [r.node_id, r]))
  const nodeRes = (n) => res[n.id] ?? (n.bus_id ? res[n.bus_id] : null)
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]))
  const picks = [] // 마우스로 집을 수 있는 것들 (userData.info)
  const top = {} // 노드마다 선로가 닿는 높이

  for (const n of graph.nodes) {
    const r = nodeRes(n)
    const color = r ? voltageColor(r) : COLORS.gray
    const p = pos(n)
    const info = { id: n.id, title: `${TYPE_LABEL[n.type] ?? n.type} · ${n.name}`, lines: [] }
    if (r) {
      if (!r.energized) info.lines.push('정전 (전원에서 끊김)')
      else {
        info.lines.push(`전압 ${r.voltage_pu.toFixed(4)} pu`)
        if (r.fault_current_ka != null) info.lines.push(`3상 단락 ${r.fault_current_ka.toFixed(2)} kA`)
        if (r.ground_fault_current_ka != null) info.lines.push(`1선 지락 ${r.ground_fault_current_ka.toFixed(2)} kA`)
        if (r.double_ground_fault_current_ka != null) info.lines.push(`2선 지락 ${r.double_ground_fault_current_ka.toFixed(2)} kA`)
      }
    }
    if (['load', 'pv', 'wind'].includes(n.type) && n.p_kw != null) info.lines.push(`설정 출력 ${n.p_kw} kW`)

    if (n.type === 'bus') {
      const h = r?.energized ? poleHeight(r.voltage_pu) : 0.5
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, h, 16), mat(color, { emissive: color, emissiveIntensity: 0.3 }))
      pole.position.copy(p).setY(h / 2)
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), mat(color, { emissive: color, emissiveIntensity: 0.5 }))
      cap.position.copy(p).setY(h)
      pole.userData.info = cap.userData.info = info
      scene.add(pole, cap)
      picks.push(pole, cap)
      top[n.id] = h
    } else {
      const d = makeDevice(n, color)
      d.position.copy(p)
      d.traverse((o) => {
        if (o.isMesh) {
          o.userData.info = info
          picks.push(o)
        }
      })
      scene.add(d)
      top[n.id] = n.type === 'source' ? 1.6 : n.type === 'breaker' ? 0.9 : 0.6
    }
  }

  // 전압 상한 기준판 (1.05 pu 높이): 기둥이 뚫고 올라가면 과전압
  const limitY = poleHeight(VOLTAGE_MAX_PU)
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 1.3, size * 1.3),
    new THREE.MeshBasicMaterial({ color: COLORS.red, transparent: true, opacity: 0.025, side: THREE.DoubleSide, depthWrite: false }),
  )
  plate.rotation.x = -Math.PI / 2
  plate.position.y = limitY
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(plate.geometry), new THREE.LineBasicMaterial({ color: COLORS.red, transparent: true, opacity: 0.5 }))
  edge.rotation.copy(plate.rotation)
  edge.position.copy(plate.position)
  scene.add(plate, edge)

  // 붙임선 (부하·태양광·풍력·전원 → 접속점): 가는 회색
  for (const n of graph.nodes) {
    const b = n.bus_id && byId[n.bus_id]
    if (!b) continue
    scene.add(tube(pos(n).setY(top[n.id]), pos(b).setY(top[b.id]), 0.03, '#6b7a83', 0.7))
  }

  // 선로
  const lineRes = Object.fromEntries((result?.lines ?? []).map((r) => [r.line_id, r]))
  const flows = [] // 역조류 점 애니메이션 { a, b, dots }
  for (const l of graph.lines) {
    const a0 = byId[l.from_node_id]
    const b0 = byId[l.to_node_id]
    if (!a0 || !b0) continue
    const r = lineRes[l.id]
    const a = pos(a0).setY(top[a0.id])
    const b = pos(b0).setY(top[b0.id])
    let color = l.kind === 'switch' ? '#8b9aa3' : r ? loadingColor(r.loading_pct) : COLORS.idle
    if (r?.reverse_flow) color = r.reverse_flow_ok === false ? COLORS.red : COLORS.orange
    const radius = l.kind === 'switch' ? 0.05 : r?.loading_pct > 100 ? 0.14 : 0.09
    const m = tube(a, b, radius, color)
    const name = l.name || `${a0.name} → ${b0.name}`
    const info = { id: l.id, title: `${l.kind === 'switch' ? '차단기·개폐기 연결' : '선로'} · ${name}`, lines: [] }
    if (r) {
      info.lines.push(`유효전력 ${r.p_kw.toFixed(0)} kW`)
      if (r.loading_pct != null) info.lines.push(`부하율 ${r.loading_pct.toFixed(1)}%`)
      if (r.reverse_flow) info.lines.push(`역조류 · ${r.reverse_flow_ok === false ? '비정상' : '정상'}`)
    }
    if (l.length_km != null && l.kind !== 'switch') info.lines.push(`길이 ${l.length_km} km`)
    m.userData.info = info
    picks.push(m)
    scene.add(m)
    // 전력이 흐르는 방향으로 움직이는 점 (역조류 선로만). p_kw는 저장된 from → to가 +
    if (r?.reverse_flow) {
      const [s, e] = r.p_kw >= 0 ? [a, b] : [b, a]
      const dots = [0, 1, 2].map(() => {
        const d = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color }))
        scene.add(d)
        return d
      })
      flows.push({ s, e, dots })
    }
  }
  return { scene, picks, flows, size }
}

export default function Diagram3D({ graph, result, onSelect }) {
  const box = useRef(null)
  const [tip, setTip] = useState(null) // 마우스 올린 것 { x, y, info }
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    const el = box.current
    if (!el || !graph?.nodes.length) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor('#0b0f12')
    el.appendChild(renderer.domElement)
    const { scene, picks, flows, size } = buildScene(graph, result)
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
    camera.position.set(size * 0.2, size * 0.75, size * 0.95)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1, 0)
    controls.enableDamping = true
    controls.maxPolarAngle = Math.PI / 2.05

    const resize = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / Math.max(h, 1)
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    const ray = new THREE.Raycaster()
    const mouse = new THREE.Vector2()
    const hit = (e) => {
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      ray.setFromCamera(mouse, camera)
      const h = ray.intersectObjects(picks, false)[0]
      return h ? { info: h.object.userData.info, x: e.clientX - rect.left, y: e.clientY - rect.top } : null
    }
    const onMove = (e) => setTip(hit(e))
    let down = null
    const onDown = (e) => (down = { x: e.clientX, y: e.clientY })
    const onUp = (e) => {
      // 끌어서 돌린 게 아니라 제자리 클릭일 때만 선택
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return
      const h = hit(e)
      onSelectRef.current?.(h ? [h.info.id] : [])
    }
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointerleave', () => setTip(null))

    const clock = new THREE.Clock()
    let raf
    const loop = () => {
      const t = clock.getElapsedTime()
      scene.traverse((o) => o.userData.spin && (o.rotation.z = t * 2))
      for (const f of flows) {
        f.dots.forEach((d, i) => d.position.lerpVectors(f.s, f.e, (t * 0.4 + i / 3) % 1))
      }
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      scene.traverse((o) => {
        o.geometry?.dispose()
        o.material?.dispose()
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [graph, result])

  return (
    <div className="d3-wrap" ref={box}>
      {tip && (
        <div className="d3-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <b>{tip.info.title}</b>
          {tip.info.lines.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      )}
      <div className="d3-legend">
        <b>3D 보기</b>
        <span>기둥 높이 = 접속점 전압 (붉은 판 = 1.05 pu 기준)</span>
        <span>
          <i style={{ background: COLORS.green }} /> 정상 <i style={{ background: COLORS.orange }} /> 주의·정상 역조류 <i style={{ background: COLORS.red }} /> 위험·비정상
        </span>
        <span>선로 색 = 부하율, 움직이는 점 = 역조류 방향</span>
        <span className="muted">끌기: 돌리기 · 휠: 확대 · 오른쪽 끌기: 이동 · 클릭: 속성 보기</span>
      </div>
    </div>
  )
}
