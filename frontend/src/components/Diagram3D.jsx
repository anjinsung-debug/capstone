// 3D 보기: 지금 계통(graph)과 계산 결과(result)를 실제 배전 설비 모양으로 세워서 보여 준다 (발표용 시각화, 편집은 2D 단선도에서)
// - 위치: 2D 단선도 좌표(x, y)를 바닥(x, z)으로 옮김. 같은 배치라 2D와 오가며 비교하기 쉽다
// - 전원 → 변전소 구내: 자갈 바닥·울타리, 154kV 인입 철구, 주변압기 2대(탱크·방열기·부싱·콘서베이터), 22.9kV 배전반 건물
// - 차단기 → 옥외 배전반(함), 개폐기 → 전주 위 개폐기, 접속점 → 콘크리트 전주(완금·애자 3개)
// - 선로 → 전주 사이 3상 전선(처짐). 색 = 부하율 (lib/overlay.js의 loadingColor), 역조류면 주황(정상)·빨강(비정상) + 흐르는 방향으로 빛 점
// - 부하 → 고압 고객(1000 kW 이상)은 공장, 나머지는 주택. 전주에서 인입선. 태양광 → 패널 어레이 + 인버터, 풍력 → 풍력 발전기(날개가 돎)
// - 전압: 애자·전주 띠 색 = 전압 판정 (voltageColor). "전압 막대"를 켜면 전주 위에 높이 = 전압인 막대와 1.05 pu 기준판
// - 마우스: 끌어서 돌리기, 휠로 확대, 오른쪽 끌기로 이동. 올리면 값, 누르면 오른쪽 속성 칸에 그 설비
// three.js만 쓴다 (react-three-fiber 없이). 계통·결과가 바뀌면 장면을 다시 만든다
// ponytail: 설비는 기본 도형을 조합한 모양이다. 실제 3D 모델(.glb)로 바꾸려면 GLTFLoader로 불러와 build* 함수만 바꾸면 된다
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { COLORS, VOLTAGE_MAX_PU, loadingColor, voltageColor } from '../lib/overlay.js'
import { box, cyl, glow, insulator, label, mat } from '../lib/threeKit.js'

const SCALE = 1 / 40 // 2D 좌표(px) → 3D 거리 (1 = 약 40px)
const POLE_H = 3.0 // 전주 완금 높이
const PHASE_GAP = 0.42 // 3상 전선 간격 (완금 위 애자 간격)
const BAR_BASE = POLE_H + 0.5 // 전압 막대 시작 높이
const barHeight = (v) => Math.max(0.15, (v - 0.9) * 20) // 0.9 pu → 0, 1.0 pu → 2, 1.05 pu → 3
const TYPE_LABEL = { source: '변전소(주변압기)', breaker: '차단기', switch: '개폐기', bus: '접속점(전주)', load: '부하', pv: '태양광', wind: '풍력' }

// ── 설비 모양 (모두 바닥 y=0, 앞쪽 = +z) ──

// 변전소 구내. w×d 크기에 맞춰 배치. 앞쪽(+z)에 22.9kV 배전반, 뒤쪽(-z)에 154kV 인입 철구
function buildSubstation(name, w, d) {
  const g = new THREE.Group()
  g.add(box(w, 0.06, d, mat('#3b4144', { roughness: 1 }), 0, 0.03, 0)) // 자갈 바닥
  // 울타리: 기둥 + 위아래 가로대
  const fence = mat('#8d979c', { metalness: 0.6 })
  const posts = []
  for (let x = -w / 2; x <= w / 2 + 1e-6; x += w / Math.round(w / 0.7)) posts.push([x, -d / 2], [x, d / 2])
  for (let z = -d / 2; z <= d / 2 + 1e-6; z += d / Math.round(d / 0.7)) posts.push([-w / 2, z], [w / 2, z])
  for (const [x, z] of posts) g.add(cyl(0.025, 0.025, 0.75, fence, x, 0.375, z, 6))
  for (const y of [0.25, 0.7]) {
    g.add(box(w, 0.02, 0.02, fence, 0, y, -d / 2), box(w, 0.02, 0.02, fence, 0, y, d / 2))
    g.add(box(0.02, 0.02, d, fence, -w / 2, y, 0), box(0.02, 0.02, d, fence, w / 2, y, 0))
  }
  // 154kV 인입 철구 (격자 대신 굵은 각재 두 기둥 + 가로보)
  const steel = mat('#9aa4a9', { metalness: 0.7, roughness: 0.4 })
  const gz = -d / 2 + 0.45
  for (const x of [-w * 0.32, w * 0.32]) {
    for (const dx of [-0.08, 0.08]) for (const dz of [-0.08, 0.08]) g.add(box(0.035, 2.6, 0.035, steel, x + dx, 1.3, gz + dz))
    for (let y = 0.4; y < 2.6; y += 0.45) g.add(box(0.2, 0.025, 0.2, steel, x, y, gz))
  }
  g.add(box(w * 0.7, 0.08, 0.12, steel, 0, 2.55, gz))
  for (const x of [-0.5, 0, 0.5]) g.add(insulator('#c9c2b5', 4, x * w * 0.5, 2.25, gz))
  // 주변압기 2대: 탱크 + 방열기 + 부싱 3개 + 콘서베이터
  const tank = mat('#71808a', { metalness: 0.5 })
  for (const x of [-w * 0.22, w * 0.22]) {
    const t = new THREE.Group()
    t.add(box(1.0, 0.9, 0.75, tank, 0, 0.5, 0))
    for (let i = 0; i < 6; i++) t.add(box(0.04, 0.7, 0.32, tank, -0.52 - i * 0.07, 0.48, 0), box(0.04, 0.7, 0.32, tank, 0.52 + i * 0.07, 0.48, 0))
    for (const bx of [-0.3, 0, 0.3]) t.add(insulator('#8a5a3c', 5, bx, 0.95, -0.15))
    for (const bx of [-0.25, 0, 0.25]) t.add(insulator('#8a5a3c', 3, bx, 0.95, 0.2))
    const cons = cyl(0.12, 0.12, 0.8, tank, 0, 1.25, 0.32)
    cons.rotation.z = Math.PI / 2
    t.add(cons, box(0.6, 0.1, 0.5, mat('#4b555c'), 0, 0.05, 0))
    t.position.set(x, 0, -d * 0.05)
    g.add(t)
  }
  // 22.9kV 배전반 건물 (앞쪽) + 출입문
  const bw = w * 0.62
  g.add(box(bw, 1.0, 0.9, mat('#c7ccc9', { roughness: 0.9 }), 0, 0.5, d / 2 - 0.65))
  g.add(box(bw + 0.1, 0.06, 1.0, mat('#58656c'), 0, 1.03, d / 2 - 0.65))
  g.add(box(0.3, 0.55, 0.02, mat('#4d5961'), bw * 0.3, 0.28, d / 2 - 0.19))
  for (let i = 0; i < 4; i++) g.add(box(0.22, 0.12, 0.02, glow('#9fd6ff', 0.4), -bw * 0.35 + i * 0.3, 0.72, d / 2 - 0.19))
  const tag = label(name.endsWith('변전소') ? name : `${name} 변전소`)
  tag.position.set(0, 3.2, 0)
  g.add(tag)
  return g
}

// 옥외 배전반(함) 차단기: 문 두 짝 + 상태등 (닫힘 = 빨강 투입, 열림 = 초록 개방)
function buildBreaker(isOpen) {
  const g = new THREE.Group()
  g.add(box(0.8, 0.12, 0.6, mat('#596369'), 0, 0.06, 0))
  g.add(box(0.7, 1.1, 0.5, mat('#9aa6ab', { metalness: 0.4 }), 0, 0.67, 0))
  g.add(box(0.32, 0.9, 0.02, mat('#87939a'), -0.17, 0.65, 0.26), box(0.32, 0.9, 0.02, mat('#87939a'), 0.17, 0.65, 0.26))
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), glow(isOpen ? COLORS.green : COLORS.red, 1.2)))
  g.children.at(-1).position.set(0, 1.1, 0.27)
  return g
}

// 콘크리트 전주 + 완금 + 애자 3개. 완금은 x축 방향 (호출하는 쪽이 선로 방향에 맞춰 돌림)
function buildPole(insColor, withSwitch = false, isOpen = false) {
  const g = new THREE.Group()
  g.add(cyl(0.06, 0.09, POLE_H + 0.35, mat('#a9afb2', { roughness: 0.9 }), 0, (POLE_H + 0.35) / 2, 0))
  g.add(box(PHASE_GAP * 2 + 0.3, 0.07, 0.08, mat('#6e777c', { metalness: 0.6 }), 0, POLE_H - 0.08, 0))
  for (const x of [-PHASE_GAP, 0, PHASE_GAP]) g.add(insulator(insColor, 2, x, POLE_H - 0.04, 0))
  g.add(cyl(0.095, 0.095, 0.12, glow(insColor, 0.5), 0, POLE_H - 0.6, 0)) // 전압 판정 띠
  if (withSwitch) {
    g.add(box(0.36, 0.42, 0.3, mat('#7d8a90', { metalness: 0.5 }), 0, POLE_H - 1.0, 0.18))
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), glow(isOpen ? COLORS.green : COLORS.red, 1.2))
    lamp.position.set(0, POLE_H - 0.85, 0.34)
    g.add(lamp)
  }
  return g
}

function buildHouse(color) {
  const g = new THREE.Group()
  g.add(box(0.9, 0.7, 0.8, mat('#d9d2c3', { roughness: 0.9 }), 0, 0.35, 0))
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.5, 4), mat('#7a4e3a'))
  roof.position.y = 0.95
  roof.rotation.y = Math.PI / 4
  g.add(roof, box(0.2, 0.35, 0.02, mat('#5a4434'), 0, 0.18, 0.41), box(0.16, 0.14, 0.02, glow('#ffd88a', 0.5), 0.25, 0.45, 0.41))
  g.add(cyl(0.05, 0.05, 0.12, glow(color, 0.6), -0.3, 0.06, 0.45)) // 계량기 (전압 판정 색)
  return g
}

function buildFactory(color) {
  const g = new THREE.Group()
  g.add(box(1.9, 0.9, 1.3, mat('#7d8b93', { metalness: 0.3 }), 0, 0.45, 0))
  for (let i = 0; i < 3; i++) {
    const tooth = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.45, 1.3, 3), mat('#5e6a71'))
    tooth.rotation.set(Math.PI / 2, 0, Math.PI / 2)
    tooth.position.set(-0.63 + i * 0.63, 1.05, 0)
    g.add(tooth)
  }
  g.add(cyl(0.09, 0.11, 1.4, mat('#9b8f86'), 0.7, 1.15, -0.4))
  g.add(box(0.5, 0.4, 0.02, mat('#4f5c63'), -0.5, 0.2, 0.66))
  g.add(box(0.3, 0.32, 0.25, mat('#8e999e'), 0.75, 0.16, 0.8)) // 수전 설비
  g.add(cyl(0.05, 0.05, 0.12, glow(color, 0.6), 0.75, 0.38, 0.95))
  return g
}

function buildSolar(kw) {
  const g = new THREE.Group()
  const rows = kw >= 1000 ? 3 : 2
  const cols = kw >= 1000 ? 4 : 3
  const panel = mat('#1d3f7a', { metalness: 0.7, roughness: 0.25, emissive: '#0a1f45', emissiveIntensity: 0.4 })
  const frame = mat('#aab3b8', { metalness: 0.6 })
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c - (cols - 1) / 2) * 0.62
      const z = (r - (rows - 1) / 2) * 0.62
      g.add(cyl(0.02, 0.02, 0.35, frame, x, 0.17, z, 6))
      const p = box(0.56, 0.03, 0.4, panel, x, 0.38, z)
      p.rotation.x = -0.45
      g.add(p)
    }
  }
  g.add(box(0.3, 0.35, 0.2, mat('#d0d5d8'), (cols / 2) * 0.62 + 0.15, 0.18, 0)) // 인버터
  return g
}

function buildWind() {
  const g = new THREE.Group()
  const white = mat('#eef2f4', { roughness: 0.4 })
  g.add(cyl(0.07, 0.13, 3.6, white, 0, 1.8, 0))
  g.add(box(0.22, 0.2, 0.5, white, 0, 3.65, 0))
  const rotor = new THREE.Group()
  rotor.position.set(0, 3.65, 0.28)
  for (let i = 0; i < 3; i++) {
    const arm = new THREE.Group()
    arm.rotation.z = (i * 2 * Math.PI) / 3
    arm.add(box(0.07, 1.3, 0.02, white, 0, 0.65, 0))
    rotor.add(arm)
  }
  rotor.userData.spin = true
  g.add(rotor)
  return g
}

// 처진 전선 한 가닥 (양 끝 a, b, 가운데가 sag만큼 내려감)
function wire(a, b, radius, m, sag = 0.25) {
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
  mid.y -= sag
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b)
  return { mesh: new THREE.Mesh(new THREE.TubeGeometry(curve, 16, radius, 6, false), m), curve }
}

function buildScene(graph, result) {
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog('#0b0f12', 40, 120)
  scene.add(new THREE.HemisphereLight('#d6ecff', '#26302b', 1.4))

  const xs = graph.nodes.map((n) => n.x)
  const ys = graph.nodes.map((n) => n.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 200) * SCALE
  const pos = (n) => new THREE.Vector3((n.x - cx) * SCALE, 0, (n.y - cy) * SCALE)

  const sun = new THREE.DirectionalLight('#fff6e8', 1.6)
  sun.position.set(size * 0.5, size * 1.2, size * 0.35)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -size, right: size, top: size, bottom: -size, near: 1, far: size * 4 })
  scene.add(sun)

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size * 2.2, size * 2.2), mat('#1a2420', { roughness: 1, metalness: 0 }))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  const grid = new THREE.GridHelper(size * 2.2, 44, '#24302b', '#1d2824')
  grid.position.y = 0.005
  scene.add(grid)

  const res = Object.fromEntries((result?.nodes ?? []).map((r) => [r.node_id, r]))
  const nodeRes = (n) => res[n.id] ?? (n.bus_id ? res[n.bus_id] : null)
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]))
  const picks = [] // 마우스로 집을 수 있는 것들 (userData.info)
  const anchor = {} // 노드마다 전선이 닿는 점(바닥 좌표 기준 높이)과 완금 방향 { y, dir }
  const bars = new THREE.Group() // 전압 막대 (켜고 끌 수 있음)

  // 전주 완금 방향: 이어진 선로 방향의 평균에 수직
  const lineDir = {}
  for (const l of graph.lines) {
    const a = byId[l.from_node_id]
    const b = byId[l.to_node_id]
    if (!a || !b) continue
    const d = pos(b).sub(pos(a)).normalize()
    for (const id of [a.id, b.id]) (lineDir[id] ??= new THREE.Vector3()).add(d) // 들어오고 나가는 선이 같은 방향으로 더해지게
  }

  const add = (obj, info) => {
    obj.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true
        o.receiveShadow = true
        if (info) {
          o.userData.info = info
          picks.push(o)
        }
      }
    })
    scene.add(obj)
  }

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

    const dir = lineDir[n.id]?.lengthSq() > 1e-6 ? lineDir[n.id].clone().normalize() : new THREE.Vector3(0, 0, 1)
    const yaw = Math.atan2(dir.x, dir.z) // 선로 방향을 바라보게 (완금 = x축이 선로에 수직)
    let obj
    if (n.type === 'source') {
      obj = buildSubstation(graph.substation?.name ?? '', 6.0, 4.6)
      // 구내 앞(배전반)이 접속점 쪽을 보게
      const b = n.bus_id && byId[n.bus_id]
      const toward = b ? pos(b).sub(p) : new THREE.Vector3(0, 0, 1)
      obj.rotation.y = Math.atan2(toward.x, toward.z)
      obj.position.copy(p).addScaledVector(toward.lengthSq() ? toward.clone().normalize() : toward, -1.5)
      const front = new THREE.Vector3(Math.sin(obj.rotation.y), 0, Math.cos(obj.rotation.y))
      anchor[n.id] = { at: obj.position.clone().addScaledVector(front, 1.9).setY(1.0), dir: new THREE.Vector3(front.z, 0, -front.x) }
    } else if (n.type === 'breaker') {
      obj = buildBreaker(n.is_open)
      obj.position.copy(p)
      obj.rotation.y = yaw
      anchor[n.id] = { at: p.clone().setY(1.15), dir: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), single: true }
    } else if (n.type === 'bus' || n.type === 'switch') {
      obj = buildPole(color, n.type === 'switch', n.is_open)
      obj.position.copy(p)
      obj.rotation.y = yaw
      anchor[n.id] = { at: p.clone().setY(POLE_H + 0.12), dir: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)) }
      if (n.type === 'bus' && r?.energized) {
        const h = barHeight(r.voltage_pu)
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, h, 12), mat(color, { emissive: color, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 }))
        bar.position.copy(p).setY(BAR_BASE + h / 2)
        bar.userData.info = info
        picks.push(bar)
        bars.add(bar)
      }
    } else if (n.type === 'load') {
      obj = (n.p_kw ?? 0) >= 1000 ? buildFactory(color) : buildHouse(color)
      obj.position.copy(p)
      anchor[n.id] = { at: p.clone().setY(n.p_kw >= 1000 ? 0.9 : 0.75), single: true }
    } else if (n.type === 'pv') {
      obj = buildSolar(n.p_kw ?? 0)
      obj.position.copy(p)
      anchor[n.id] = { at: p.clone().setY(0.4), single: true }
    } else if (n.type === 'wind') {
      obj = buildWind()
      obj.position.copy(p)
      anchor[n.id] = { at: p.clone().setY(1.0), single: true }
    }
    if (obj) add(obj, info)
  }

  // 전압 막대 기준판 (1.05 pu)
  const limit = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 1.3, size * 1.3),
    new THREE.MeshBasicMaterial({ color: COLORS.red, transparent: true, opacity: 0.04, side: THREE.DoubleSide, depthWrite: false }),
  )
  limit.rotation.x = -Math.PI / 2
  limit.position.y = BAR_BASE + barHeight(VOLTAGE_MAX_PU)
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(limit.geometry), new THREE.LineBasicMaterial({ color: COLORS.red, transparent: true, opacity: 0.6 }))
  edge.rotation.copy(limit.rotation)
  edge.position.copy(limit.position)
  bars.add(limit, edge)
  bars.visible = false
  scene.add(bars)

  // 인입선 (전주 → 부하·태양광·풍력·변전소): 가는 검은 선 한 가닥
  const drop = mat('#2a2f33')
  for (const n of graph.nodes) {
    const b = n.bus_id && byId[n.bus_id]
    if (!b || !anchor[n.id] || !anchor[b.id] || n.type === 'source') continue
    scene.add(wire(anchor[b.id].at, anchor[n.id].at, 0.015, drop, 0.15).mesh)
  }
  // 변전소 배전반 → 모선 전주
  for (const n of graph.nodes.filter((x) => x.type === 'source')) {
    const b = n.bus_id && byId[n.bus_id]
    if (b && anchor[b.id]) scene.add(wire(anchor[n.id].at, anchor[b.id].at, 0.03, mat('#3a4248'), 0.1).mesh)
  }

  // 선로: 3상 전선 (한 상씩 완금 애자 간격만큼 옆으로)
  const lineRes = Object.fromEntries((result?.lines ?? []).map((r) => [r.line_id, r]))
  const flows = [] // 역조류 빛 점 { curve, dots, reverse }
  for (const l of graph.lines) {
    const a0 = byId[l.from_node_id]
    const b0 = byId[l.to_node_id]
    const A = anchor[a0?.id]
    const B = anchor[b0?.id]
    if (!A || !B) continue
    const r = lineRes[l.id]
    let color = l.kind === 'switch' ? '#8b9aa3' : r ? loadingColor(r.loading_pct) : COLORS.idle
    if (r?.reverse_flow) color = r.reverse_flow_ok === false ? COLORS.red : COLORS.orange
    const m = glow(color, r?.loading_pct > 100 ? 0.9 : 0.45)
    const thick = r?.loading_pct > 100 ? 0.045 : 0.028
    const name = l.name || `${a0.name} → ${b0.name}`
    const info = { id: l.id, title: `${l.kind === 'switch' ? '차단기·개폐기 연결' : '선로'} · ${name}`, lines: [] }
    if (r) {
      info.lines.push(`유효전력 ${r.p_kw.toFixed(0)} kW`)
      if (r.loading_pct != null) info.lines.push(`부하율 ${r.loading_pct.toFixed(1)}%`)
      if (r.reverse_flow) info.lines.push(`역조류 · ${r.reverse_flow_ok === false ? '비정상' : '정상'}`)
    }
    if (l.length_km != null && l.kind !== 'switch') info.lines.push(`길이 ${l.length_km} km`)
    const span = A.at.distanceTo(B.at)
    const sag = Math.min(0.5, span * 0.04)
    const phases = A.single || B.single ? [0] : [-1, 0, 1]
    let middle
    for (const k of phases) {
      const a = A.at.clone().addScaledVector(A.dir ?? new THREE.Vector3(), k * PHASE_GAP)
      const b = B.at.clone().addScaledVector(B.dir ?? new THREE.Vector3(), k * PHASE_GAP)
      // 양 끝 완금 방향이 반대면 상이 꼬이지 않게 맞춘다
      if (A.dir && B.dir && A.dir.dot(B.dir) < 0) b.copy(B.at).addScaledVector(B.dir, -k * PHASE_GAP)
      const w = wire(a, b, thick, m, sag)
      w.mesh.userData.info = info
      w.mesh.castShadow = true
      picks.push(w.mesh)
      scene.add(w.mesh)
      if (k === 0) middle = w.curve
    }
    if (r?.reverse_flow && middle) {
      const dots = [0, 1, 2].map(() => {
        const d = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color }))
        scene.add(d)
        return d
      })
      flows.push({ curve: middle, dots, backward: r.p_kw < 0 }) // p_kw는 저장된 from → to가 +
    }
  }
  return { scene, picks, flows, bars, size }
}

export default function Diagram3D({ graph, result, onSelect }) {
  const box3 = useRef(null)
  const barsRef = useRef(null)
  const viewRef = useRef(null) // 장면을 다시 만들 때 이어 쓸 카메라 위치·바라보는 점
  const homeRef = useRef(null) // "처음 시점으로" 버튼
  const [tip, setTip] = useState(null) // 마우스 올린 것 { x, y, info }
  const [showBars, setShowBars] = useState(false)
  const showBarsRef = useRef(showBars)
  showBarsRef.current = showBars
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    if (barsRef.current) barsRef.current.visible = showBars
  }, [showBars])

  useEffect(() => {
    const el = box3.current
    if (!el || !graph?.nodes.length) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor('#0b0f12')
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    el.appendChild(renderer.domElement)
    const { scene, picks, flows, bars, size } = buildScene(graph, result)
    bars.visible = showBarsRef.current
    barsRef.current = bars
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400)
    // 지도처럼 조작 (11/10 피드백: 너무 휙휙 돌아감, 옆으로 옮기기 쉽게)
    //   왼쪽 끌기 = 옆으로 이동, 오른쪽 끌기 = 돌리기(천천히), 휠 = 확대, 방향키 = 이동
    const controls = new MapControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.rotateSpeed = 0.35
    controls.panSpeed = 0.9
    controls.zoomSpeed = 0.7
    controls.keyPanSpeed = 14
    controls.screenSpacePanning = false // 바닥을 따라 미끄러지듯 이동
    controls.minPolarAngle = 0.15
    controls.maxPolarAngle = Math.PI / 2.15
    controls.minDistance = 2
    controls.maxDistance = size * 3
    controls.listenToKeyEvents(window)
    const home = () => {
      camera.position.set(size * 0.25, size * 0.6, size * 0.95)
      controls.target.set(0, 1, 0)
      controls.update()
    }
    // 결과가 새로 계산돼 장면을 다시 만들어도 보던 시점을 유지한다
    if (viewRef.current) {
      camera.position.copy(viewRef.current.position)
      controls.target.copy(viewRef.current.target)
    } else home()
    homeRef.current = home

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
      const h = ray.intersectObjects(picks, false).find((x) => x.object.visible && (x.object.parent === scene || x.object.parent?.visible !== false))
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
    const onLeave = () => setTip(null)
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointerleave', onLeave)

    const clock = new THREE.Clock()
    let raf
    const loop = () => {
      const t = clock.getElapsedTime()
      scene.traverse((o) => o.userData.spin && (o.rotation.z = t * 2))
      for (const f of flows) {
        f.dots.forEach((d, i) => {
          const u = (t * 0.35 + i / 3) % 1
          d.position.copy(f.curve.getPoint(f.backward ? 1 - u : u))
        })
      }
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => {
      viewRef.current = { position: camera.position.clone(), target: controls.target.clone() }
      homeRef.current = null
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      scene.traverse((o) => {
        o.geometry?.dispose()
        if (o.material?.map) o.material.map.dispose()
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [graph, result])

  return (
    <div className="d3-wrap" ref={box3}>
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
        <span>
          <i style={{ background: COLORS.green }} /> 정상 <i style={{ background: COLORS.orange }} /> 주의·정상 역조류 <i style={{ background: COLORS.red }} /> 위험·비정상
        </span>
        <span>전선 색 = 부하율 · 움직이는 빛 = 역조류 방향 · 애자·전주 띠 색 = 전압</span>
        <label className="d3-check">
          <input type="checkbox" checked={showBars} onChange={(e) => setShowBars(e.target.checked)} />
          전압 막대 보기 (높이 = 전압, 붉은 판 = 1.05 pu)
        </label>
        <span className="muted">왼쪽 끌기·방향키: 옆으로 이동 · 오른쪽 끌기: 돌리기 · 휠: 확대 · 클릭: 속성 보기</span>
        <button type="button" className="mini" onClick={() => homeRef.current?.()}>
          처음 시점으로
        </button>
      </div>
    </div>
  )
}
