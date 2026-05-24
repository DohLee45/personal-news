import { useState, useCallback, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import Header        from '../components/Header'
import CategoryTabs, { TABS } from '../components/CategoryTabs'
import HeadlineNews  from '../components/HeadlineNews'
import ArticleCard   from '../components/ArticleCard'
import Sidebar       from '../components/Sidebar'
import Pagination    from '../components/Pagination'
import { useKeywords } from '../hooks/useKeywords'
import { useHistory }  from '../hooks/useHistory'
import { useFeed }     from '../hooks/useFeed'
import styles from './MainPage.module.css'

/* ── 전체탭 카테고리 고정 순서 (TABS에서 '전체' 제외하여 파생) ── */
const ALL_CATS = TABS.filter(t => t !== '전체')

/* 유효 탭 집합 (URL params 검증용) */
const VALID_TABS = new Set(TABS)

/* 전체탭 초기 페이지 state (카테고리별 독립) */
const INIT_CAT_PAGES = Object.fromEntries(ALL_CATS.map(c => [c, 1]))

function groupByCategory(articles) {
  const map = Object.fromEntries(ALL_CATS.map(c => [c, []]))
  for (const a of articles) {
    if (map[a.category]) map[a.category].push(a)
  }
  return map
}

/** 제목·언론사·카테고리에 query 포함 여부 */
function matchesQuery(article, q) {
  const lower = q.toLowerCase()
  return (
    (article.title   || '').toLowerCase().includes(lower) ||
    (article.source  || '').toLowerCase().includes(lower) ||
    (article.category|| '').toLowerCase().includes(lower)
  )
}

export default function MainPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  // P: 뒤로가기 시 이전 탭 유지 — URL ?tab= 에서 복원
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get('tab')
    return VALID_TABS.has(t) ? t : '전체'
  })
  const [instantQuery, setInstantQuery] = useState('')  // 앱내 즉시 필터
  const [rssQuery,     setRssQuery]     = useState('')  // RSS API 검색

  // 전체탭: 카테고리별 독립 페이지 state
  const [catPages, setCatPages] = useState(INIT_CAT_PAGES)
  // 개별탭: 단일 페이지 state
  const [singlePage, setSinglePage] = useState(1)

  const { keywords }                       = useKeywords()
  const { history, addStage1 }             = useHistory()

  // keywords/search 변경 시만 API 재호출 — 탭 전환은 category 필드로 클라이언트 필터링
  const { articles, isLoading, isStale, error, refresh } = useFeed(
    keywords, rssQuery, history
  )

  // 탭 전환 시 개별탭 페이지 리셋
  useEffect(() => { setSinglePage(1) }, [activeTab])

  /* ── 이벤트 핸들러 ── */
  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab)
    setInstantQuery('')
    setRssQuery('')
    setCatPages(INIT_CAT_PAGES)  // 전체탭 카테고리 페이지도 리셋
    // 탭 상태를 URL에 반영 (replace: true → 히스토리 오염 방지)
    setSearchParams(tab === '전체' ? {} : { tab }, { replace: true })
  }, [setSearchParams])

  const handleInstantSearch = useCallback((q) => {
    setInstantQuery(q)
    if (q) setActiveTab('전체')
  }, [])

  const handleRssSearch = useCallback((q) => {
    setRssQuery(q)
    if (q) setActiveTab('전체')
  }, [])

  const handleRead = useCallback((article) => {
    addStage1(article)
  }, [addStage1])

  /* ── 검색 모드 판별 ── */
  const isSearchMode = Boolean(instantQuery || rssQuery)
  const activeQuery  = instantQuery || rssQuery

  /* ── 탭 필터링 (API 재호출 없음 — category 필드 기준) ── */
  const tabArticles = useMemo(() => {
    if (activeTab === '전체' || isSearchMode) return articles
    return articles.filter(a => a.category === activeTab)
  }, [articles, activeTab, isSearchMode])

  /* ── 검색 모드 표시 기사 ── */
  const displayArticles = useMemo(() => {
    if (!isSearchMode) return tabArticles
    if (instantQuery) return articles.filter(a => matchesQuery(a, instantQuery))
    return articles
  }, [articles, tabArticles, isSearchMode, instantQuery])

  /* ── 전체탭 그룹핑 (메모이즈) ── */
  const grouped = useMemo(() => {
    if (activeTab !== '전체' || isSearchMode) return null
    return groupByCategory(articles)
  }, [articles, activeTab, isSearchMode])

  /* ── 로딩 스피너 ── */
  function renderLoading() {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <span>뉴스를 불러오는 중…</span>
      </div>
    )
  }

  /* ── 에러 ── */
  function renderError() {
    return (
      <div className={styles.error}>
        <p>{error}</p>
        <button className={styles.retryBtn} onClick={refresh}>다시 시도</button>
      </div>
    )
  }

  /* ── 검색 결과 렌더 ── */
  function renderSearch() {
    const isRssResult = !instantQuery && Boolean(rssQuery)   // RSS 신규 결과

    return (
      <>
        <div className={styles.searchHeader}>
          <span className={styles.searchTitle}>🔍 "{activeQuery}" 검색 결과</span>
          <span className={styles.searchCount}>{displayArticles.length}건</span>
        </div>
        {displayArticles.length === 0
          ? <p className={styles.empty}>검색 결과가 없습니다.</p>
          : (
            <>
              {/* 검색 결과도 헤드라인 1건 크게 */}
              <HeadlineNews
                article={displayArticles[0]}
                onRead={handleRead}
              />
              <div className={styles.grid}>
                {displayArticles.slice(1).map(a => (
                  <ArticleCard
                    key={a.id}
                    article={a}
                    onRead={handleRead}
                    isSearchResult={isRssResult}
                  />
                ))}
              </div>
            </>
          )
        }
      </>
    )
  }

  /* ── 전체탭 렌더 (카테고리별 독립 페이지네이션) ── */
  function renderAll() {
    if (!grouped) return null
    const hasSome = ALL_CATS.some(c => grouped[c]?.length > 0)
    if (!hasSome) return <p className={styles.empty}>뉴스가 없습니다.</p>

    const PAGE_SIZE = 3  // 페이지당 일반 기사 수
    const MAX_PAGES = 2  // 최대 2페이지

    return ALL_CATS
      .filter(c => grouped[c]?.length > 0)
      .map(cat => {
        const catArticles = grouped[cat]
        const headline    = catArticles[0]
        const rest        = catArticles.slice(1)
        const page        = catPages[cat] || 1
        const totalPages  = Math.min(MAX_PAGES, Math.ceil(rest.length / PAGE_SIZE))
        const pageArts    = rest.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

        return (
          <section key={cat} className={styles.section}>
            <h2 className={styles.sectionTitle}>{cat}</h2>
            {/* 헤드라인: 페이지 전환 시에도 항상 고정 */}
            <HeadlineNews article={headline} onRead={handleRead} />
            {pageArts.length > 0 && (
              <div className={styles.grid}>
                {pageArts.map(a => (
                  <ArticleCard key={a.id} article={a} onRead={handleRead} />
                ))}
              </div>
            )}
            {/* 일반 기사 3건 초과 시에만 페이지네이션 표시 */}
            {totalPages > 1 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                onChange={p => setCatPages(prev => ({ ...prev, [cat]: p }))}
              />
            )}
          </section>
        )
      })
  }

  /* ── 개별 탭 렌더 (헤드라인 고정 + 22건/페이지) ── */
  function renderCategory() {
    if (tabArticles.length === 0) return <p className={styles.empty}>뉴스가 없습니다.</p>

    const PAGE_SIZE  = 22
    const headline   = tabArticles[0]
    const rest       = tabArticles.slice(1)
    const totalPages = Math.max(1, Math.ceil(rest.length / PAGE_SIZE))
    const pageArts   = rest.slice((singlePage - 1) * PAGE_SIZE, singlePage * PAGE_SIZE)

    return (
      <>
        <HeadlineNews article={headline} onRead={handleRead} />
        {pageArts.length > 0 && (
          <div className={styles.grid}>
            {pageArts.map(a => (
              <ArticleCard key={a.id} article={a} onRead={handleRead} />
            ))}
          </div>
        )}
        {totalPages > 1 && (
          <Pagination
            page={singlePage}
            totalPages={totalPages}
            onChange={setSinglePage}
          />
        )}
      </>
    )
  }

  /* ── 메인 렌더 ── */
  function renderFeed() {
    // 최초 로딩(캐시도 없음)만 전체 스피너
    if (isLoading && articles.length === 0) return renderLoading()
    if (error && !isStale)                  return renderError()
    if (isSearchMode)                       return renderSearch()
    if (activeTab === '전체')               return renderAll()
    return renderCategory()
  }

  return (
    <div className={styles.page}>
      <Header
        onSearch={handleRssSearch}
        onInstantSearch={handleInstantSearch}
      />
      <CategoryTabs active={activeTab} onChange={handleTabChange} />

      {/* stale 표시 배너 */}
      {isStale && (
        <div className={styles.staleBanner}>
          캐시된 결과를 표시 중입니다. 최신 뉴스 불러오는 중…
        </div>
      )}

      <div className={styles.layout}>
        <main className={styles.feed}>{renderFeed()}</main>
        <Sidebar />
      </div>
    </div>
  )
}
