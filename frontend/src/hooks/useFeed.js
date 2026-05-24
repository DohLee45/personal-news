import { useState, useEffect, useRef, useCallback } from 'react'
import { sortByInterest } from '../utils/interestScore'

/* ── 모듈 레벨 캐시 (stale-while-revalidate) ─────────────────── */
const _cache = new Map()   // cacheKey → { articles: [], ts: number }
const CACHE_TTL = 5 * 60 * 1000   // 5분

/**
 * 기본 검색어 — 사용자 키워드 없을 때 카테고리 균형 확보
 * 각 카테고리 대표 1개씩, 백엔드가 각 키워드로 병렬 RSS 수집
 */
const DEFAULT_KW = ['정치', '경제', '사회', 'AI', '스포츠', '연예']

function cacheKey(kws, q) {
  return `${kws.join(',')}|${q}`
}

/**
 * 단일 /api/news 호출:
 *   - 검색 시: q로 max=40
 *   - 일반 피드: 사용자 키워드 상위 10개(없으면 DEFAULT_KW)로 max=50
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

  const kwParam = kws.length > 0
    ? kws.slice(0, 10).join(',')
    : DEFAULT_KW.join(',')

  const res = await fetch(
    `/api/news?keywords=${encodeURIComponent(kwParam)}&max=50`,
    { signal }
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * 뉴스 피드 fetch 훅 — stale-while-revalidate
 *
 * 탭 전환은 이 훅 밖(MainPage)에서 category 필드로 필터링.
 * 이 훅은 category를 받지 않으며, 키워드/검색어 변경 시에만 API를 재호출한다.
 *
 * @param {string[]} keywords - 사용자 관심 키워드 (피드 fetch + 관심도 정렬)
 * @param {string}   search   - 검색어 ('' = 미검색)
 * @param {object[]} history  - pn_history (열람빈도 정렬용)
 * @returns {{ articles, isLoading, error, refresh, isStale }}
 */
export function useFeed(keywords, search = '', history = []) {
  const key = cacheKey(keywords, search)

  // 캐시에서 초기값 즉시 설정 (stale)
  const cached = _cache.get(key)
  const isFresh = cached && (Date.now() - cached.ts < CACHE_TTL)

  const [articles,  setArticles]  = useState(cached?.articles || [])
  const [isLoading, setIsLoading] = useState(!isFresh)
  const [isStale,   setIsStale]   = useState(!!cached && !isFresh)
  const [error,     setError]     = useState(null)

  const abortRef = useRef(null)
  const keyRef   = useRef(key)

  const runFetch = useCallback(async (kws, q, hist) => {
    const thisKey = cacheKey(kws, q)

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
  }, [key])   // keywords/search 변경 시에만 재호출

  const refresh = useCallback(() => {
    _cache.delete(key)
    runFetch(keywords, search, history)
  }, [key, keywords, search, history, runFetch])

  return { articles, isLoading, isStale, error, refresh }
}
