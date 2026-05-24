import { useState, useCallback } from 'react'
import { MAX_KEYWORDS } from '../data/onboardingKeywords'

const STORAGE_KEY = 'pn_keywords'

/**
 * pn_keywords localStorage 읽기/쓰기 훅
 * @returns {{ keywords: string[], toggle: (kw: string) => void, setKeywords: (kws: string[]) => void, clear: () => void }}
 */
export function useKeywords() {
  const [keywords, setKeywordsState] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })

  const setKeywords = useCallback((kws) => {
    const next = Array.isArray(kws) ? kws.slice(0, MAX_KEYWORDS) : []
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {/* storage full */ }
    setKeywordsState(next)
  }, [])

  const toggle = useCallback((kw) => {
    setKeywordsState(prev => {
      let next
      if (prev.includes(kw)) {
        next = prev.filter(k => k !== kw)
      } else {
        if (prev.length >= MAX_KEYWORDS) return prev   // 이미 최대치
        next = [...prev, kw]
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {/* storage full */ }
      return next
    })
  }, [])

  const clear = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setKeywordsState([])
  }, [])

  return { keywords, toggle, setKeywords, clear }
}
