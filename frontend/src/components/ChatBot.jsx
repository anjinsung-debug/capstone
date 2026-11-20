// AI 챗봇 (11/20): 화면 오른쪽 아래 "질문하기". 지금 계통·계산 결과·플랫폼 기능을 LLM에 묻고 답을 받는다 (ai_report/chat.py)
// - 질문할 때마다 지금 화면의 변전소·계산 결과·계산 시각, 이미 계산한 여유 용량·보강 우선순위를 같이 보낸다.
//   서버는 내 변전소 전체(같은 시각 판정)와 그날 24시간 결과를 직접 계산해 붙인다 (backend/api/chat.py)
// - 대화는 창을 닫아도 남는다(새로고침하면 지워짐). "새 대화"로 지울 수 있다. 최근 몇 개만 서버로 보낸다 (ai_report/chat.py MAX_TURNS)
// - Enter 보내기, Shift+Enter 줄바꿈, Esc 닫기
// ponytail: 답을 한 번에 받는다(스트리밍 아님). 기다림이 길면 서버를 스트리밍으로 바꾸고 여기서 조각을 이어 붙인다
import { useEffect, useRef, useState } from 'react'
import { askChat } from '../api/client.js'
import { chatExtras } from './UsecasePanels.jsx'

const SEND_TURNS = 12 // 서버로 보내는 최근 대화 수
const SUGGESTIONS_WITH_RESULT = ['지금 계통 상태를 한 줄로 알려줘', '오늘 몇 시가 제일 위험해?', '내 변전소는 몇 곳이고 상태는 어때?', '문제가 있는 곳은 어디고 왜 그래?']
const SUGGESTIONS_NO_SUB = ['내 변전소는 몇 곳이야?', '이 플랫폼으로 뭘 할 수 있어?', '새 변전소는 어떻게 만들어?', '판정 기준이 뭐야?']

let saved = [] // 창을 닫았다 열어도 대화가 남게 (모듈에 보관)
let savedPos = null // 끌어서 옮긴 창 위치 { left, top } (닫았다 열어도 그 자리). null = 기본(오른쪽 아래)

// 제목 줄을 잡고 끌면 창을 옮긴다 (11/20). 화면 밖으로 나가지 않게 가둔다. 버튼을 누른 건 끌기로 보지 않는다
function useDrag(panel) {
  const [pos, setPos] = useState(savedPos)
  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return
    const box = panel.current.getBoundingClientRect()
    const dx = e.clientX - box.left
    const dy = e.clientY - box.top
    const move = (ev) => {
      const left = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - box.width)
      const top = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - box.height)
      savedPos = { left, top }
      setPos(savedPos)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    e.preventDefault() // 끄는 동안 글자 선택 안 되게
  }
  return { style: pos ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' } : undefined, onPointerDown }
}

function Bubble({ m }) {
  return (
    <div className={`chat-msg ${m.role}${m.error ? ' error' : ''}`}>
      {m.content.split('\n').map((line, i) => (
        <p key={i}>{line || ' '}</p>
      ))}
    </div>
  )
}

// tools: [[이름, 실행 함수], ...] = 우리 AI 기능 바로 열기 (App.jsx가 넘김, 11/20). 누르면 그 기능 창을 열고 이 창은 닫는다
export default function ChatBot({ graph, result, resultAt, isNew, tools = [] }) {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState(saved)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const list = useRef(null)
  const input = useRef(null)
  const panel = useRef(null)
  const drag = useDrag(panel)

  useEffect(() => {
    saved = msgs
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [msgs, busy, open])
  useEffect(() => {
    if (!open) return undefined
    input.current?.focus()
    const key = (e) => e.key === 'Escape' && !busy && setOpen(false)
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, busy])

  const subId = graph && !isNew ? graph.substation.id : null // 저장 전 새 변전소는 서버에 없어서 기능 질문만 된다
  const where = !graph
    ? '첫 화면 (변전소 고르기 전)'
    : `${graph.substation.name}${isNew ? ' (저장 전)' : ''}${result && resultAt ? ` · ${resultAt.date.slice(5).replace('-', '/')} ${resultAt.hour}시 결과` : result ? '' : ' · 계산 결과 없음'}`

  async function send(q) {
    const question = (q ?? text).trim()
    if (!question || busy) return
    const next = [...msgs.filter((m) => !m.error), { role: 'user', content: question }]
    setMsgs(next)
    setText('')
    setBusy(true)
    try {
      // 화면에서 이미 계산한 여유 용량 표·보강 우선순위도 같이 보낸다 (서버는 변전소 목록·24시간 결과를 직접 계산)
      const extras = subId ? chatExtras(subId, resultAt) : null
      const { reply } = await askChat(
        next.slice(-SEND_TURNS).map(({ role, content }) => ({ role, content })),
        subId,
        subId ? result : null,
        subId && result ? resultAt : null,
        extras,
      )
      setMsgs((m) => [...m, { role: 'assistant', content: reply }])
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', error: true, content: `답을 받지 못했습니다. ${e.message.replace(/^HTTP \d+: /, '')}\n.env의 AI 키와 백엔드 연결을 확인한 뒤 다시 보내 주세요.` }])
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      // 글자 대신 아이콘 (11/20): 말풍선 + AI 반짝임. 이름은 aria-label·title로
      <button type="button" className="chat-fab" onClick={() => setOpen(true)} aria-label="AI 질문하기" title="AI 질문하기 · 지금 계통·결과·기능 물어보기">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 3 13.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M12 6.2l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9Z" fill="currentColor" />
        </svg>
      </button>
    )
  }
  const suggestions = subId && result ? SUGGESTIONS_WITH_RESULT : SUGGESTIONS_NO_SUB
  return (
    <section className="chat-panel" aria-label="AI 질문하기" ref={panel} style={drag.style}>
      <header onPointerDown={drag.onPointerDown} title="끌어서 창 옮기기">
        <div>
          <strong>AI 질문하기</strong>
          <span title="질문할 때 이 화면의 변전소·계산 결과를 같이 보냅니다">{where}</span>
        </div>
        <button type="button" className="chat-head-btn" disabled={busy || msgs.length === 0} onClick={() => setMsgs([])} aria-label="새 대화" title="새 대화 (대화 지우기)">
          ↺
        </button>
        <button type="button" className="chat-head-btn" onClick={() => setOpen(false)} aria-label="닫기" title="닫기 (Esc)">
          ✕
        </button>
      </header>
      <div className="chat-list" ref={list}>
        {msgs.length === 0 && (
          <div className="chat-empty">
            {tools.length > 0 && (
              <>
                <p>AI 기능 바로 쓰기</p>
                <div className="chat-suggest chat-tools">
                  {tools.map(([label, run]) => (
                    <button
                      type="button"
                      key={label}
                      onClick={() => {
                        run()
                        setOpen(false)
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
            <p>지금 계통 상태, 계산 결과, 플랫폼 사용법을 물어보세요. 답은 이 화면의 결과를 근거로 합니다.</p>
            <div className="chat-suggest">
              {suggestions.map((s) => (
                <button type="button" key={s} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <Bubble key={i} m={m} />
        ))}
        {busy && <div className="chat-msg assistant typing">답을 만드는 중…</div>}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <textarea
          ref={input}
          rows={2}
          value={text}
          maxLength={2000}
          placeholder="질문을 입력하세요 (Enter 보내기, Shift+Enter 줄바꿈)"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button type="submit" className="primary" disabled={busy || !text.trim()}>
          보내기
        </button>
      </form>
      <p className="chat-note">AI 답은 참고용입니다. 판정과 수치는 화면의 계산 결과가 기준입니다.</p>
    </section>
  )
}
