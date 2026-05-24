/**
 * SettingsPage — ⚙ 설정 페이지 (STEP 9)
 *
 * 탭 구성:
 *   [관심 키워드] — 등록 키워드 관리 + 카테고리별 추가 + 검색기록에서 추가
 *   [검색 기록]   — 최근 10건 조회 · 개별/전체 삭제
 *   [프로필]      — 닉네임 변경 (2~10자, 한글·영문·숫자)
 *
 * 저장 전략:
 *   - 키워드: draft 상태로 편집 → "변경사항 저장" 버튼 → useKeywords.setKeywords(draft)
 *   - 검색기록: 즉시 반영 (삭제 시 localStorage 동기화)
 *   - 닉네임: 저장 버튼 → localStorage.setItem 후 토스트 표시
 *
 * 메인 피드 반영:
 *   키워드 저장 후 navigate(-1) 시 MainPage 재마운트 → useKeywords 재초기화 → 피드 갱신
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate }                              from 'react-router-dom'
import { KEYWORD_CATEGORIES, MAX_KEYWORDS }         from '../data/onboardingKeywords'
import { useKeywords }                              from '../hooks/useKeywords'
import styles                                       from './SettingsPage.module.css'

// ── 상수 ────────────────────────────────────────────────────────────────────
const NICKNAME_RE    = /^[가-힣a-zA-Z0-9]{2,10}$/
const SEARCH_KEY     = 'pn_search_history'

// ── 검색기록 유틸 ─────────────────────────────────────────────────────────
/** 저장 형식: {q, at}[] — 구버전 string 아이템 자동 변환 */
function loadSearchHistory() {
  try {
    return (JSON.parse(localStorage.getItem(SEARCH_KEY) || '[]'))
      .map(h => (typeof h === 'string' ? { q: h, at: '' } : h))
  } catch { return [] }
}

function saveSearchHistory(items) {
  try { localStorage.setItem(SEARCH_KEY, JSON.stringify(items)) } catch {}
}

/** 두 키워드 배열이 같은 집합인지 비교 (순서 무관) */
function sameSet(a, b) {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((v, i) => v === sb[i])
}

// ── 탭 정의 ──────────────────────────────────────────────────────────────
const TABS = [
  { id: 'keywords', label: '관심 키워드' },
  { id: 'search',   label: '검색 기록'   },
  { id: 'profile',  label: '프로필'      },
]

// ── 날짜 포매터 ──────────────────────────────────────────────────────────
function fmtDate(isoStr) {
  if (!isoStr) return ''
  try {
    return new Date(isoStr).toLocaleDateString('ko-KR', {
      month: 'numeric',
      day:   'numeric',
    })
  } catch { return '' }
}

// ════════════════════════════════════════════════════════════════════════════
export default function SettingsPage() {
  const navigate                     = useNavigate()
  const { keywords, setKeywords }    = useKeywords()

  // ── 탭 ────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState('keywords')

  // ── 키워드 탭 ─────────────────────────────────────────────────────────
  const [draft,  setDraft]  = useState(() => [...keywords])
  const [kwCat,  setKwCat]  = useState(KEYWORD_CATEGORIES[0].id)

  // ── 검색기록 탭 ───────────────────────────────────────────────────────
  const [searchHist, setSearchHist] = useState(loadSearchHistory)

  // ── 프로필 탭 ─────────────────────────────────────────────────────────
  const [savedNick,   setSavedNick]   = useState(
    () => localStorage.getItem('pn_nickname') || ''
  )
  const [editing,     setEditing]     = useState(false)
  const [nickInput,   setNickInput]   = useState('')
  const [nickError,   setNickError]   = useState('')

  // ── 토스트 ────────────────────────────────────────────────────────────
  const [toast,     setToast]     = useState('')
  const [toastKey,  setToastKey]  = useState(0)   // 애니메이션 재기동용
  const toastTimer                = useRef(null)

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const showToast = useCallback((msg) => {
    clearTimeout(toastTimer.current)
    setToast(msg)
    setToastKey(k => k + 1)
    toastTimer.current = setTimeout(() => setToast(''), 1800)
  }, [])

  // ════════════════════════════════════════════════════════════════════════
  // 키워드 탭 핸들러
  // ════════════════════════════════════════════════════════════════════════

  /** 드래프트 토글 — 이미 있으면 제거, 없고 여유 있으면 추가 */
  const handleDraftToggle = useCallback((kw) => {
    setDraft(prev => {
      if (prev.includes(kw)) return prev.filter(k => k !== kw)
      if (prev.length >= MAX_KEYWORDS) return prev
      return [...prev, kw]
    })
  }, [])

  /** 검색기록 항목을 드래프트에 추가 */
  const handleAddFromSearch = useCallback((q) => {
    setDraft(prev => {
      if (prev.includes(q) || prev.length >= MAX_KEYWORDS) return prev
      return [...prev, q]
    })
  }, [])

  /** 키워드 저장 → pn_keywords 갱신 */
  const handleSaveKeywords = useCallback(() => {
    setKeywords(draft)
    showToast('키워드 저장 완료!')
  }, [draft, setKeywords, showToast])

  // ════════════════════════════════════════════════════════════════════════
  // 검색기록 탭 핸들러
  // ════════════════════════════════════════════════════════════════════════

  const handleDeleteSearch = useCallback((q) => {
    setSearchHist(prev => {
      const next = prev.filter(h => h.q !== q)
      saveSearchHistory(next)
      return next
    })
  }, [])

  const handleClearSearch = useCallback(() => {
    setSearchHist([])
    localStorage.removeItem(SEARCH_KEY)
  }, [])

  // ════════════════════════════════════════════════════════════════════════
  // 프로필 탭 핸들러
  // ════════════════════════════════════════════════════════════════════════

  const handleEditNick = () => {
    setNickInput(savedNick)
    setNickError('')
    setEditing(true)
  }

  const handleSaveNick = () => {
    const val = nickInput.trim()
    if (!NICKNAME_RE.test(val)) {
      if (val.length < 2)   setNickError('2자 이상 입력해 주세요.')
      else if (val.length > 10) setNickError('10자 이하로 입력해 주세요.')
      else                  setNickError('한글, 영문, 숫자만 사용할 수 있어요.')
      return
    }
    localStorage.setItem('pn_nickname', val)
    setSavedNick(val)
    setEditing(false)
    showToast('닉네임이 변경되었습니다.')
  }

  // ── 파생 상태 ─────────────────────────────────────────────────────────
  const activeCat     = KEYWORD_CATEGORIES.find(c => c.id === kwCat)
  const isDraftMax    = draft.length >= MAX_KEYWORDS
  const isDraftChanged = !sameSet(draft, keywords)

  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className={styles.page}>

      {/* ── 헤더 ───────────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate(-1)}>← 뒤로</button>
        <h1 className={styles.title}>설정</h1>
      </header>

      {/* ── 탭 바 ──────────────────────────────────────────────────────── */}
      <nav className={styles.tabBar} role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`${styles.tab}${tab === t.id ? ' ' + styles.tabActive : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* ══════════════════════════════════════════════════════════════════
          탭 1: 관심 키워드 관리
      ══════════════════════════════════════════════════════════════════ */}
      {tab === 'keywords' && (
        <div className={styles.content}>

          {/* 현재 등록 키워드 */}
          <div className={styles.section}>
            <p className={styles.sectionLabel}>
              현재 등록 키워드
              <span className={`${styles.counter}${isDraftMax ? ' ' + styles.counterMax : ''}`}>
                {draft.length}/{MAX_KEYWORDS}
                {isDraftMax && ' (최대)'}
              </span>
            </p>
            {draft.length === 0
              ? <p className={styles.empty}>등록된 키워드가 없습니다.</p>
              : (
                <div className={styles.chipRow}>
                  {draft.map(kw => (
                    <span key={kw} className={styles.currentChip}>
                      {kw}
                      <button
                        className={styles.chipX}
                        onClick={() => handleDraftToggle(kw)}
                        aria-label={`${kw} 삭제`}
                      >✕</button>
                    </span>
                  ))}
                </div>
              )
            }
          </div>

          {/* 카테고리별 키워드 추가 */}
          <div className={styles.section}>
            <p className={styles.sectionLabel}>카테고리별 추가</p>
            <nav className={styles.catTabBar} role="tablist" aria-label="카테고리">
              {KEYWORD_CATEGORIES.map(c => (
                <button
                  key={c.id}
                  role="tab"
                  aria-selected={kwCat === c.id}
                  className={`${styles.catTab}${kwCat === c.id ? ' ' + styles.catTabActive : ''}`}
                  onClick={() => setKwCat(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </nav>

            <div className={styles.kwGrid} role="group" aria-label={`${activeCat?.label} 키워드`}>
              {activeCat?.keywords.map(kw => {
                const inDraft  = draft.includes(kw)
                const disabled = !inDraft && isDraftMax
                return (
                  <button
                    key={kw}
                    aria-pressed={inDraft}
                    className={
                      styles.kwChip +
                      (inDraft  ? ' ' + styles.kwChipSel : '') +
                      (disabled ? ' ' + styles.kwChipDis : '')
                    }
                    onClick={() => !disabled && handleDraftToggle(kw)}
                    disabled={disabled}
                  >
                    {inDraft && <span className={styles.checkMark}>✓ </span>}
                    {kw}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 검색기록에서 추가 */}
          {searchHist.length > 0 && (
            <div className={styles.section}>
              <p className={styles.sectionLabel}>검색 기록에서 추가</p>
              <div className={styles.fromSearchList}>
                {searchHist.map(h => {
                  const inDraft = draft.includes(h.q)
                  const canAdd  = !inDraft && !isDraftMax
                  return (
                    <div key={h.q} className={styles.fromSearchItem}>
                      <span className={styles.fromSearchIcon}>🕒</span>
                      <span className={styles.fromSearchQ}>{h.q}</span>
                      {inDraft
                        ? <span className={styles.addedBadge}>등록됨</span>
                        : (
                          <button
                            className={styles.addBtn}
                            onClick={() => handleAddFromSearch(h.q)}
                            disabled={!canAdd}
                            aria-label={`${h.q} 키워드로 추가`}
                          >
                            +추가
                          </button>
                        )
                      }
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 저장 버튼 */}
          <div className={styles.saveRow}>
            <button
              className={styles.saveBtn}
              onClick={handleSaveKeywords}
              disabled={!isDraftChanged}
            >
              {isDraftChanged ? '변경사항 저장' : '✓ 저장됨'}
            </button>
          </div>

        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          탭 2: 검색 기록
      ══════════════════════════════════════════════════════════════════ */}
      {tab === 'search' && (
        <div className={styles.content}>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <p className={styles.sectionLabel}>최근 검색 기록</p>
              {searchHist.length > 0 && (
                <button className={styles.clearBtn} onClick={handleClearSearch}>
                  전체 삭제
                </button>
              )}
            </div>

            {searchHist.length === 0
              ? <p className={styles.empty}>검색 기록이 없습니다.</p>
              : (
                <div className={styles.searchHistList}>
                  {searchHist.map(h => (
                    <div key={h.q} className={styles.searchHistItem}>
                      <span className={styles.searchHistIcon}>🕒</span>
                      <div className={styles.searchHistInfo}>
                        <span className={styles.searchHistQ}>{h.q}</span>
                        {h.at && (
                          <span className={styles.searchHistDate}>{fmtDate(h.at)}</span>
                        )}
                      </div>
                      <button
                        className={styles.deleteBtn}
                        onClick={() => handleDeleteSearch(h.q)}
                        aria-label={`${h.q} 삭제`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          탭 3: 프로필
      ══════════════════════════════════════════════════════════════════ */}
      {tab === 'profile' && (
        <div className={styles.content}>
          <div className={styles.section}>
            <p className={styles.sectionLabel}>닉네임</p>

            {!editing
              ? (
                <div className={styles.profileRow}>
                  <span className={styles.nickDisplay}>{savedNick}</span>
                  <button className={styles.editBtn} onClick={handleEditNick}>
                    변경
                  </button>
                </div>
              )
              : (
                <div className={styles.nickEditBox}>
                  <div className={styles.nickInputRow}>
                    <input
                      type="text"
                      className={`${styles.nickInput}${nickError ? ' ' + styles.inputError : ''}`}
                      value={nickInput}
                      maxLength={10}
                      autoFocus
                      autoComplete="off"
                      placeholder="2~10자, 한글·영문·숫자"
                      onChange={e => { setNickInput(e.target.value); setNickError('') }}
                      onKeyDown={e => {
                        if (e.key === 'Enter')  handleSaveNick()
                        if (e.key === 'Escape') setEditing(false)
                      }}
                    />
                    <span className={styles.nickCounter}>{nickInput.length}/10</span>
                  </div>
                  {nickError && <p className={styles.nickError}>{nickError}</p>}
                  <div className={styles.nickBtnRow}>
                    <button
                      className={styles.cancelBtn}
                      onClick={() => setEditing(false)}
                    >
                      취소
                    </button>
                    <button
                      className={styles.saveBtn}
                      onClick={handleSaveNick}
                    >
                      저장
                    </button>
                  </div>
                </div>
              )
            }
          </div>
        </div>
      )}

      {/* ── 토스트 ─────────────────────────────────────────────────────── */}
      {toast && (
        <div key={toastKey} className={styles.toast}>{toast}</div>
      )}

    </div>
  )
}
