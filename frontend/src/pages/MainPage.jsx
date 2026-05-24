import { useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import Header        from '../components/Header'
import CategoryTabs, { TABS } from '../components/CategoryTabs'
import HeadlineNews  from '../components/HeadlineNews'
import ArticleCard   from '../components/ArticleCard'
import Sidebar       from '../components/Sidebar'
import { useKeywords } from '../hooks/useKeywords'
import { useHistory }  from '../hooks/useHistory'
import { useFeed }     from '../hooks/useFeed'
import styles from './MainPage.module.css'

/* ── 전체탭 카테고리 고정 순서 ── */
const ALL_CATS = ['정치','경제','금융','시사·사회','과학기술','환경','국제','연예','스포츠']

/* 유효 탭 집합 (URL params 검증용) */
const VALID_TABS = new Set(TABS)

function groupByCategory(articles) {
  const map = Object.fromEntries(ALL_CATS.map(c => [c, []]))
  for (const a of articles) {
    const key = a.category || a._catGroup
    if (map[key]) map[key].push(a)
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

  const { keywords }                       = useKeywords()
  const { history, addStage1 }             = useHistory()

  const { articles, isLoading, isStale, error, refresh } = useFeed(
    activeTab, keywords, rssQuery, history
  )

  /* ── 이벤트 핸들러 ── */
  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab)
    setInstantQuery('')
    setRssQuery('')
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

  /* ── 표시할 기사 배열 ── */
  const displayArticles = useMemo(() => {
    if (!isSearchMode) return articles
    // 즉시 필터: 현재 로드된 피드에서 바로 검색
    if (instantQuery) return articles.filter(a => matchesQuery(a, instantQuery))
    // RSS 검색 결과 그대로
    return articles
  }, [articles, isSearchMode, instantQuery])

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

  /* ── 전체탭 렌더 ── */
  function renderAll() {
    if (!grouped) return null
    const hasSome = ALL_CATS.some(c => grouped[c]?.length > 0)
    if (!hasSome) return <p className={styles.empty}>뉴스가 없습니다.</p>

    return ALL_CATS
      .filter(c => grouped[c]?.length > 0)
      .map(cat => {
        const catArticles = grouped[cat]
        return (
          <section key={cat} className={styles.section}>
            <h2 className={styles.sectionTitle}>{cat}</h2>
            {/* 각 카테고리 섹션 첫 기사: 헤드라인 크게 */}
            <HeadlineNews article={catArticles[0]} onRead={handleRead} />
            {catArticles.length > 1 && (
              <div className={styles.grid}>
                {catArticles.slice(1).map(a => (
                  <ArticleCard key={a.id} article={a} onRead={handleRead} />
                ))}
              </div>
            )}
          </section>
        )
      })
  }

  /* ── 개별 탭 렌더 ── */
  function renderCategory() {
    if (articles.length === 0) return <p className={styles.empty}>뉴스가 없습니다.</p>
    return (
      <>
        <HeadlineNews article={articles[0]} onRead={handleRead} />
        {articles.length > 1 && (
          <div className={styles.grid}>
            {articles.slice(1).map(a => (
              <ArticleCard key={a.id} article={a} onRead={handleRead} />
            ))}
          </div>
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
