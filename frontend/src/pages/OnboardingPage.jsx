import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { KEYWORD_CATEGORIES, MAX_KEYWORDS } from '../data/onboardingKeywords'
import { useKeywords } from '../hooks/useKeywords'
import styles from './OnboardingPage.module.css'

export default function OnboardingPage() {
  const navigate  = useNavigate()
  const nickname  = localStorage.getItem('pn_nickname') || '사용자'
  const { keywords, toggle, setKeywords } = useKeywords()

  const [activeTab, setActiveTab]   = useState(KEYWORD_CATEGORIES[0].id)
  const [toast, setToast]           = useState(false)
  const toastTimer                  = useRef(null)

  /* 이미 온보딩 완료 시 메인으로 리다이렉트 */
  useEffect(() => {
    if (localStorage.getItem('pn_onboarded') === 'true') {
      navigate('/', { replace: true })
    }
  }, [navigate])

  /* 닉네임 없으면 닉네임 페이지로 */
  useEffect(() => {
    if (!localStorage.getItem('pn_nickname')) {
      navigate('/nickname', { replace: true })
    }
  }, [navigate])

  /* cleanup */
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const isMax = keywords.length >= MAX_KEYWORDS

  const handleChip = useCallback((kw) => {
    toggle(kw)
  }, [toggle])

  function handleSubmit() {
    if (keywords.length === 0) return

    localStorage.setItem('pn_onboarded', 'true')

    /* 토스트 표시 후 메인으로 이동 */
    setToast(true)
    toastTimer.current = setTimeout(() => {
      navigate('/', { replace: true })
    }, 1400)
  }

  const activeCategory = KEYWORD_CATEGORIES.find(c => c.id === activeTab)

  return (
    <div className={styles.page}>
      {/* ── 헤더 ── */}
      <header className={styles.header}>
        <h1 className={styles.title}>관심 키워드 선택</h1>
        <p className={styles.subtitle}>
          관심 있는 키워드를 선택하면 맞춤 뉴스를 보여드려요
        </p>
        <div className={`${styles.counter}${isMax ? ' ' + styles.counterMax : ''}`}>
          {keywords.length} / {MAX_KEYWORDS}개 선택
          {isMax && ' (최대)'}
        </div>
      </header>

      {/* ── 카테고리 탭 ── */}
      <nav className={styles.tabBar} role="tablist" aria-label="카테고리">
        {KEYWORD_CATEGORIES.map(cat => (
          <button
            key={cat.id}
            role="tab"
            aria-selected={activeTab === cat.id}
            className={`${styles.tab}${activeTab === cat.id ? ' ' + styles.tabActive : ''}`}
            onClick={() => setActiveTab(cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </nav>

      {/* ── 키워드 칩 ── */}
      <main className={styles.content}>
        <p className={styles.categoryLabel}>{activeCategory?.label}</p>
        <div className={styles.chips} role="group" aria-label={`${activeCategory?.label} 키워드`}>
          {activeCategory?.keywords.map(kw => {
            const selected  = keywords.includes(kw)
            const disabled  = !selected && isMax
            return (
              <button
                key={kw}
                aria-pressed={selected}
                className={
                  `${styles.chip}` +
                  (selected ? ' ' + styles.chipSelected : '') +
                  (disabled ? ' ' + styles.chipDisabled : '')
                }
                onClick={() => !disabled && handleChip(kw)}
                disabled={disabled}
              >
                {kw}
              </button>
            )
          })}
        </div>
      </main>

      {/* ── 완료 버튼 ── */}
      <footer className={styles.footer}>
        {keywords.length === 0 && (
          <p className={styles.hint}>키워드를 1개 이상 선택해 주세요</p>
        )}
        <button
          className={styles.submitBtn}
          disabled={keywords.length === 0}
          onClick={handleSubmit}
        >
          완료 ({keywords.length}개 선택됨)
        </button>
      </footer>

      {/* ── 토스트 ── */}
      <div
        className={`${styles.toast}${toast ? ' ' + styles.toastVisible : ''}`}
        role="status"
        aria-live="polite"
      >
        🎉 {nickname}님, 관심 키워드가 등록되었어요!
      </div>
    </div>
  )
}
