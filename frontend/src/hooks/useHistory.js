import { useState, useCallback } from 'react'

const STORAGE_KEY = 'pn_history'
const MAX_HISTORY = 100

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}
function persist(items) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)) } catch {}
}

/**
 * pn_history 관리 훅 — 2단계 저장
 *
 * Stage 1 (카드 클릭):
 *   article 객체 전체 저장, _stage: 1 마킹
 *
 * Stage 2 (상세 진입 후 본문 분석 완료):
 *   updateStage2(id, patch) 로 biasTag·biasScore·viewpoint 갱신
 *   _stage: 2, stage2Updated: true 로 업데이트
 *
 * 히스토리 구조:
 * {
 *   id, title, link, source, category,
 *   biasTag, biasScore, viewpoint,
 *   published, summary,
 *   clickedAt: ISO string,
 *   _stage: 1 | 2,
 *   stage2Updated: boolean
 * }
 */
export function useHistory() {
  const [history, setHistory] = useState(load)

  // 내부: 상태 + localStorage 동기 업데이트
  const _set = useCallback((nextFn) => {
    setHistory(prev => {
      const next = typeof nextFn === 'function' ? nextFn(prev) : nextFn
      persist(next)
      return next
    })
  }, [])

  /**
   * Stage 1: 카드 클릭 시 호출
   * - 중복(id) → 맨 앞으로 이동 (clickedAt 갱신)
   * - 100건 초과 → 오래된 것 삭제
   */
  const addStage1 = useCallback((article) => {
    _set(prev => {
      const entry = {
        ...article,
        clickedAt: new Date().toISOString(),
        _stage: 1,
      }
      const filtered = prev.filter(h => h.id !== article.id)
      return [entry, ...filtered].slice(0, MAX_HISTORY)
    })
  }, [_set])

  /**
   * Stage 2: 상세 진입 후 본문 크롤링 + AI 분석 완료 시 호출
   * @param {string} id    - 기사 id
   * @param {object} patch - { biasScore, biasTag, viewpoint }
   */
  const updateStage2 = useCallback((id, patch) => {
    _set(prev =>
      prev.map(h =>
        h.id === id
          ? { ...h, ...patch, _stage: 2, stage2Updated: true }
          : h
      )
    )
  }, [_set])

  /** 전체 히스토리 삭제 */
  const clearHistory = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setHistory([])
  }, [])

  return { history, addStage1, updateStage2, clearHistory }
}
