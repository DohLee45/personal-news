import { memo, useState, useRef, useCallback, useEffect } from 'react'
import styles from './SearchBar.module.css'

const HISTORY_KEY = 'pn_search_history'
const MAX_HISTORY = 10

/**
 * 저장 형식: { q: string, at: ISO string }[]
 * 하위 호환: 구버전 string[] 항목은 { q, at: '' } 로 변환
 */
function loadHistory() {
  try {
    return (JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'))
      .map(h => (typeof h === 'string' ? { q: h, at: '' } : h))
  } catch { return [] }
}
function saveHistory(items) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY))) } catch {}
}

/**
 * SearchBar — 헤더에 항시 배치
 *
 * 동작 방식:
 *   1. 입력 즉시: onInstantSearch(q) → 기존 피드에서 즉시 필터링 (API 없음)
 *   2. debounce 300ms 후: onSearch(q) → RSS API 호출 (새 결과)
 *   3. Enter: 즉시 onSearch(q)
 *   4. 빈 값으로 변경: 둘 다 '' 전달 → 피드 초기화
 *
 * 검색결과 표시:
 *   - 즉시 필터 결과(onInstantSearch): 기존 biasTag 그대로 표시
 *   - RSS 새 결과(onSearch): ArticleCard isSearchResult=true → S_media만 표시
 *
 * @param {{
 *   onInstantSearch: (q: string) => void,
 *   onSearch: (q: string) => void
 * }} props
 */
const SearchBar = memo(function SearchBar({ onInstantSearch, onSearch }) {
  const [value,   setValue]   = useState('')
  const [open,    setOpen]    = useState(false)
  const [history, setHistory] = useState(loadHistory)
  const debounceRef = useRef(null)
  const wrapRef     = useRef(null)

  // 외부 클릭 → 드롭다운 닫기
  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const persistHistory = useCallback((q) => {
    const item = { q, at: new Date().toISOString() }
    const next = [item, ...history.filter(h => h.q !== q)].slice(0, MAX_HISTORY)
    setHistory(next)
    saveHistory(next)
  }, [history])

  // RSS 검색 실행 (히스토리 저장 포함)
  const submitRSS = useCallback((q) => {
    const trimmed = q.trim()
    if (!trimmed) return
    persistHistory(trimmed)
    onSearch(trimmed)
    setOpen(false)
  }, [onSearch, persistHistory])

  // RSS 검색 실행 (히스토리는 q 문자열로 전달)
  function handleChange(e) {
    const v = e.target.value
    setValue(v)
    setOpen(!v && history.length > 0)

    // 즉시 앱내 검색 (앱내 필터, API 없음)
    onInstantSearch(v.trim())

    // debounce 300ms → RSS 검색
    clearTimeout(debounceRef.current)
    if (v.trim()) {
      debounceRef.current = setTimeout(() => submitRSS(v), 300)
    } else {
      onSearch('')   // 검색어 지우면 RSS 피드도 초기화
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      clearTimeout(debounceRef.current)
      submitRSS(value)
    }
    if (e.key === 'Escape') { setOpen(false) }
  }

  function handleFocus() {
    if (!value && history.length > 0) setOpen(true)
  }

  function handleClear() {
    setValue('')
    onInstantSearch('')
    onSearch('')
    setOpen(history.length > 0)
  }

  function handleHistoryClick(q) {
    setValue(q)
    onInstantSearch(q)
    submitRSS(q)
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <input
        type="search"
        className={styles.input}
        placeholder="키워드 검색…"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        autoComplete="off"
        aria-label="뉴스 검색"
      />
      {value && (
        <button className={styles.clearBtn} onClick={handleClear} aria-label="검색어 지우기">
          ✕
        </button>
      )}

      {open && history.length > 0 && (
        <div className={styles.dropdown} role="listbox" aria-label="최근 검색어">
          {history.map(h => (
            <button
              key={h.q}
              className={styles.dropItem}
              role="option"
              onClick={() => handleHistoryClick(h.q)}
            >
              <span className={styles.dropIcon}>🕒</span>
              {h.q}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})

export default SearchBar
