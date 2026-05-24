/**
 * searchHistory.js — pn_search_history localStorage 유틸
 *
 * 저장 형식: { q: string, at: ISO string }[]
 * 하위 호환: 구버전 string 아이템을 { q, at: '' } 로 자동 변환
 *
 * SearchBar, SettingsPage 공용으로 사용
 */

const KEY = 'pn_search_history'
const MAX = 10

/** localStorage에서 검색기록 로드 (구버전 string 자동 변환) */
export function loadSearchHistory() {
  try {
    return (JSON.parse(localStorage.getItem(KEY) || '[]'))
      .map(h => (typeof h === 'string' ? { q: h, at: '' } : h))
  } catch { return [] }
}

/** 검색기록 저장 (최대 MAX건) */
export function saveSearchHistory(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))) } catch {}
}

/**
 * 검색어를 맨 앞에 추가 (중복 시 기존 항목 제거 후 재삽입)
 * 호출 후 setHistory(loadSearchHistory())로 React state 갱신 필요
 */
export function addSearch(query) {
  const item = { q: query, at: new Date().toISOString() }
  const list = loadSearchHistory().filter(h => h.q !== query)
  list.unshift(item)
  saveSearchHistory(list)
}

/** 검색기록 전체 삭제 */
export function clearSearchHistory() {
  try { localStorage.removeItem(KEY) } catch {}
}
