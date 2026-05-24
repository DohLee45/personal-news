import { useState, useEffect, useRef, useCallback } from 'react'
import { sortByInterest } from '../utils/interestScore'

/* ── 모듈 레벨 캐시 (탭 전환 시 stale-while-revalidate) ───── */
const _cache = new Map()   // cacheKey → { articles: [], ts: number }
const CACHE_TTL = 5 * 60 * 1000   // 5분

const CATEGORIES = ['정치','경제','금융','시사·사회','과학기술','환경','국제','연예','스포츠']

const CAT_KW = {
  '정치':     '정치',
  '경제':     '경제',
  '금융':     '주식금융',
  '시사·사회':'사회',
  '과학기술': 'AI기술',
  '환경':     '환경기후',
  '국제':     '국제뉴스',
  '연예':     '연예',
  '스포츠':   '스포츠',
}

function cacheKey(cat, kws, q) {
  return `${cat}|${kws.join(',')}|${q}`
}

async function fetchArticles(cat, kws, q, signal) {
  if (q) {
    const res = await fetch(
      `/api/news?keywords=${encodeURIComponent(q)}&max=40`,
      { signal }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }

  if (cat === '전체') {
    const results = await Promise.allSettled(
      CATEGORIES.map(c =>
        fetch(`/api/news?keywords=${encodeURIComponent(CAT_KW[c] || c)}&max=10`, { signal })
          .then(r => r.ok ? r.json() : [])
          .then(items => items.map(a => ({ ...a, _catGroup: c })))
      )
    )
    return results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
  }

  // 개별 카테고리: 관심 키워드 상위 5개 or 카테고리명
  const kwParam = kws.length > 0 ? kws.slice(0, 5).join(',') : cat
  const res = await fetch(
    `/api/news?keywords=${encodeURIComponent(kwParam)}&max=40`,
    { signal }
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * 뉴스 피드 fetch 훅 — stale-while-revalidate
 *
 * @param {string}   category - '전체' 또는 카테고리명
 * @param {string[]} keywords - 사용자 관심 키워드 (정렬용)
 * @param {string}   search   - 검색어 ('' = 미검색)
 * @param {object[]} history  - pn_history (열람빈도 정렬용)
 * @returns {{ articles, isLoading, error, refresh, isStale }}
 */
export function useFeed(category, keywords, search = '', history = []) {
  const key = cacheKey(category, keywords, search)

  // 캐시에서 초기값 즉시 설정 (stale)
  const cached = _cache.get(key)
  const isFresh = cached && (Date.now() - cached.ts < CACHE_TTL)

  const [articles,  setArticles]  = useState(cached?.articles || [])
  const [isLoading, setIsLoading] = useState(!isFresh)
  const [isStale,   setIsStale]   = useState(!!cached && !isFresh)
  const [error,     setError]     = useState(null)

  const abortRef  = useRef(null)
  const keyRef    = useRef(key)

  const runFetch = useCallback(async (cat, kws, q, hist) => {
    const thisKey = cacheKey(cat, kws, q)

    // 이전 요청 취소
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    // stale 데이터 즉시 반환 후 백그라운드 재검증
    const staleEntry = _cache.get(thisKey)
    if (staleEntry) {
      setArticles(sortByInterest(staleEntry.articles, kws, hist))
      setIsStale(true)
    }

    setIsLoading(true)
    setError(null)

    try {
      const raw = await fetchArticles(cat, kws, q, ctrl.signal)
      // 키가 변경된 경우(탭 전환 중 응답 도착) 무시
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
      // 캐시 유효 → 재정렬만 적용
      setArticles(sortByInterest(cached.articles, keywords, history))
      setIsLoading(false)
      setIsStale(false)
      return
    }

    runFetch(category, keywords, search, history)
    return () => { if (abortRef.current) abortRef.current.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])   // key 변경 시에만 재실행

  const refresh = useCallback(() => {
    _cache.delete(key)
    runFetch(category, keywords, search, history)
  }, [key, category, keywords, search, history, runFetch])

  return { articles, isLoading, isStale, error, refresh }
}
