import { useState, useEffect, useRef, useCallback } from 'react'
import { sortByInterest } from '../utils/interestScore'

/* ── 모듈 레벨 캐시 (stale-while-revalidate) ─────────────────── */
const _cache = new Map()   // cacheKey → { articles: [], ts: number }
const CACHE_TTL = 5 * 60 * 1000   // 5분

/**
 * 캐시 키: 검색어 기준만 사용.
 * - 메인 피드 (search=''): '__feed__' (고정 — 키워드 변경 시 API 재호출 없음)
 * - 검색 (search≠''): 'search|<query>'
 */
function cacheKey(q) {
  return q ? `search|${q}` : '__feed__'
}

/**
 * 단일 /api/news 호출:
 *   - 검색 시: q로 max=40 키워드 검색
 *   - 일반 피드: 카테고리 RSS max=20 (키워드 전달 불필요)
 * 탭 전환 시에는 호출하지 않음 — 프론트에서 category 필드로 필터링
 */
async function fetchArticles(kws, q, signal) {
  if (q) {
    const res = await fetch(
      `/api/news?keywords=${encodeURIComponent(q)}&max=40&when=20d`,
      { signal }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }

  // 메인 피드: 카테고리 RSS (키워드 불필요)
  const res = await fetch(`/api/news?max=20`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * 뉴스 피드 fetch 훅 — stale-while-revalidate
 *
 * 탭 전환은 이 훅 밖(MainPage)에서 category 필드로 필터링.
 * 메인 피드는 카테고리 RSS로 수집되므로 keywords → API 재호출 없음.
 * keywords 변경 시에는 캐시된 기사를 클라이언트에서 재정렬만 수행.
 *
 * @param {string[]} keywords - 사용자 관심 키워드 (관심도 정렬용)
 * @param {string}   search   - 검색어 ('' = 미검색)
 * @param {object[]} history  - pn_history (열람빈도 정렬용)
 * @returns {{ articles, isLoading, error, refresh, isStale }}
 */
export function useFeed(keywords, search = '', history = []) {
  const key = cacheKey(search)

  // 캐시에서 초기값 즉시 설정 (stale)
  const cached = _cache.get(key)
  const isFresh = cached && (Date.now() - cached.ts < CACHE_TTL)

  const [articles,  setArticles]  = useState(
    cached?.articles ? sortByInterest(cached.articles, keywords, history) : []
  )
  const [isLoading, setIsLoading] = useState(!isFresh)
  const [isStale,   setIsStale]   = useState(!!cached && !isFresh)
  const [error,     setError]     = useState(null)

  const abortRef = useRef(null)
  const keyRef   = useRef(key)

  const runFetch = useCallback(async (kws, q, hist) => {
    const thisKey = cacheKey(q)

    // 이전 요청 취소
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    // stale 데이터 즉시 표시 후 백그라운드 재검증
    const staleEntry = _cache.get(thisKey)
    if (staleEntry) {
      setArticles(sortByInterest(staleEntry.articles, kws, hist))
      setIsStale(true)
    }

    setIsLoading(true)
    setError(null)

    try {
      const raw = await fetchArticles(kws, q, ctrl.signal)
      // 키 변경 중(탭 전환 등) 도착한 응답 무시
      if (keyRef.current !== thisKey) return

      const sorted = sortByInterest(raw, kws, hist)
      _cache.set(thisKey, { articles: raw, ts: Date.now() })

      setArticles(sorted)
      setIsStale(false)
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err.message || '뉴스를 불러오지 못했습니다.')
    } finally {
      if (keyRef.current === thisKey) setIsLoading(false)
    }
  }, [])

  // search 변경 시에만 API 재호출 (keywords 변경은 재호출 없음)
  useEffect(() => {
    keyRef.current = key

    if (isFresh && cached) {
      // 캐시 유효 → 재정렬만
      setArticles(sortByInterest(cached.articles, keywords, history))
      setIsLoading(false)
      setIsStale(false)
      return
    }

    runFetch(keywords, search, history)
    return () => { if (abortRef.current) abortRef.current.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])   // search 변경 시에만 재호출

  // keywords 변경 시 캐시된 기사 재정렬 (API 재호출 없음)
  useEffect(() => {
    const entry = _cache.get(key)
    if (entry) {
      setArticles(sortByInterest(entry.articles, keywords, history))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(keywords)])

  const refresh = useCallback(() => {
    _cache.delete(key)
    runFetch(keywords, search, history)
  }, [key, keywords, search, history, runFetch])

  return { articles, isLoading, isStale, error, refresh }
}
