/**
 * ArticlePage — 기사 상세 페이지 (STEP 8)
 *
 * 점진적 로딩 순서:
 *   [즉시]        ① 제목  ② 편향도 바·태그  ③ 원문보기 버튼
 *   [자동, API 0회]
 *     POST /api/analysis  → ④ 원문 요약 (크롤링 + 앞 5문장, 1~3초)
 *     GET  /api/related   → ⑤ 다른 시각 기사 (RSS 추천, 2~5초)
 *   [수동 클릭, API 1회]
 *     POST /api/deep-analysis → ⑥ AI 정밀 분석 (편향 설명 + 배경 + 교차검증)
 *
 * Stage 2 히스토리 업데이트:
 *   POST /api/analysis 완료 후 updated_bias 로 updateStage2() 호출
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import Header from '../components/Header'
import { useHistory } from '../hooks/useHistory'
import styles from './ArticlePage.module.css'

// ── 편향 바 색상 ────────────────────────────────────────────────────────────
function biasColor(score) {
  if (score < 0.30) return 'green'
  if (score < 0.60) return 'yellow'
  return 'red'
}

// ── 편향 바 컴포넌트 ────────────────────────────────────────────────────────
function BiasBar({ score, tag }) {
  const color = biasColor(score)
  const pct   = Math.round(score * 100)
  return (
    <div className={styles.biasRow}>
      <span className={styles.biasLabel}>편향도</span>
      <div className={styles.biasBarWrap}>
        <div
          className={`${styles.biasBarFill} ${styles[color]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={styles.biasTag}>{tag}</span>
      <span className={styles.biasScore}>{pct}%</span>
    </div>
  )
}

// ── 메인 페이지 컴포넌트 ────────────────────────────────────────────────────
export default function ArticlePage() {
  const navigate                    = useNavigate()
  const { id }                      = useParams()
  const { state }                   = useLocation()
  const article                     = state?.article
  const { updateStage2, addStage1 } = useHistory()

  // ── 상태 ─────────────────────────────────────────────────────────────────
  // 크롤링 + 요약 추출
  const [crawlPhase,  setCrawlPhase]  = useState('loading') // 'loading'|'done'|'error'
  const [summary,     setSummary]     = useState('')
  const [updatedBias, setUpdatedBias] = useState(null)

  // 추천 기사
  const [related, setRelated] = useState({ loading: true, articles: [] })

  // AI 정밀 분석
  const [deepPhase, setDeepPhase] = useState('idle') // 'idle'|'loading'|'done'|'error'
  const [deepData,  setDeepData]  = useState(null)

  const didFetch = useRef(false)

  // ── 데이터 페치 ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!article || didFetch.current) return
    didFetch.current = true

    const ctrl = new AbortController()

    // ① POST /api/analysis (크롤링 + bias 재계산 + 요약 추출, API 0회)
    const runAnalysis = async () => {
      try {
        const res = await fetch('/api/analysis', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          signal:  ctrl.signal,
          body: JSON.stringify({
            url:      article.link     || '',
            title:    article.title    || '',
            source:   article.source   || '',
            category: article.category || '사회',
            summary:  article.summary  || '',
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()

        setSummary(data.summary || '')
        setUpdatedBias(data.updated_bias ?? null)
        setCrawlPhase('done')

        // Stage 2 히스토리 업데이트
        if (data.updated_bias && article.id) {
          updateStage2(article.id, {
            biasScore: data.updated_bias.biasScore,
            biasTag:   data.updated_bias.biasTag,
            viewpoint: data.updated_bias.viewpoint,
          })
        }
      } catch (err) {
        if (err.name !== 'AbortError') setCrawlPhase('error')
      }
    }

    // ② GET /api/related (추천 기사, API 0회)
    const runRelated = async () => {
      try {
        const params = new URLSearchParams({
          title:       article.title  || '',
          source:      article.source || '',
          exclude_url: article.link   || '',
        })
        const res = await fetch(`/api/related?${params}`, { signal: ctrl.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setRelated({ loading: false, articles: data.articles ?? [] })
      } catch (err) {
        if (err.name !== 'AbortError') {
          setRelated({ loading: false, articles: [] })
        }
      }
    }

    // 병렬 실행
    runAnalysis()
    runRelated()

    return () => ctrl.abort()
  }, [article, updateStage2])

  // ── AI 정밀 분석 호출 ─────────────────────────────────────────────────────
  const handleDeepAnalysis = useCallback(async () => {
    if (deepPhase !== 'idle' || !article) return
    setDeepPhase('loading')
    try {
      const res = await fetch('/api/deep-analysis', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url:      article.link     || '',
          title:    article.title    || '',
          source:   article.source   || '',
          category: article.category || '사회',
          summary:  article.summary  || '',
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setDeepData(data)
      setDeepPhase('done')
    } catch {
      setDeepPhase('error')
    }
  }, [deepPhase, article])

  // ── 추천 기사 클릭 → ArticlePage 이동 ───────────────────────────────────
  const handleRelatedClick = useCallback((a) => {
    addStage1(a)
    navigate(`/article/${a.id}`, { state: { article: a } })
    window.scrollTo(0, 0)
  }, [addStage1, navigate])

  // ── article 없음 ──────────────────────────────────────────────────────────
  if (!article) {
    return (
      <div className={styles.page}>
        <Header />
        <div className={styles.body}>
          <button className={styles.back} onClick={() => navigate(-1)}>← 뒤로가기</button>
          <p className={styles.placeholder}>기사 정보를 불러올 수 없습니다. (ID: {id})</p>
        </div>
      </div>
    )
  }

  // 편향 표시값: 분석 결과 있으면 updated, 없으면 router state
  const displayScore = updatedBias?.biasScore ?? article.biasScore ?? 0
  const displayTag   = updatedBias?.biasTag   ?? article.biasTag   ?? ''

  return (
    <div className={styles.page}>
      <Header />
      <div className={styles.body}>

        {/* 뒤로가기 */}
        <button className={styles.back} onClick={() => navigate(-1)}>← 뒤로가기</button>

        {/* ── 4-1. 기사 헤더 카드 (즉시) ─────────────────────────────────── */}
        <div className={styles.card}>
          {article.category && (
            <span className={styles.cat}>{article.category}</span>
          )}
          <h1 className={styles.title}>{article.title}</h1>
          <p className={styles.meta}>
            {article.source}
            {article.published && ` · ${article.published.slice(0, 10)}`}
          </p>

          {/* 편향도 바 */}
          <BiasBar score={displayScore} tag={displayTag} />

          {/* 원문 링크 */}
          {article.link && (
            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.originalLink}
            >
              원문 기사 보기 →
            </a>
          )}
        </div>

        {/* ── 4-2. 원문 요약 (크롤링 완료 후 자동, API 0회) ─────────────── */}
        {crawlPhase === 'loading' && (
          <div className={styles.skeletonSection}>
            <div className={styles.skeleton} />
            <div className={`${styles.skeleton} ${styles.skeletonShort}`} />
            <div className={styles.skeleton} />
            <div className={`${styles.skeleton} ${styles.skeletonMed}`} />
            <p className={styles.skeletonHint}>원문을 불러오는 중입니다...</p>
          </div>
        )}

        {crawlPhase !== 'loading' && (
          <div className={styles.section}>
            <p className={styles.sectionTitle}>📝 원문 요약</p>
            {summary
              ? <p className={styles.analysisText}>{summary}</p>
              : <p className={styles.analysisText}>요약을 불러올 수 없습니다.</p>
            }
          </div>
        )}

        {/* ── 4-3. 다른 시각 기사 (RSS 추천, API 0회) ──────────────────── */}
        <div className={styles.relatedSection}>
          <p className={styles.relatedTitle}>👁 다른 시각 기사</p>

          {related.loading && (
            <p className={styles.loadingText}>추천 기사를 불러오는 중...</p>
          )}

          {!related.loading && related.articles.length === 0 && (
            <p className={styles.nonDebateMsg}>관련 기사를 찾지 못했습니다.</p>
          )}

          {!related.loading && related.articles.length > 0 && (
            <div className={styles.relatedList}>
              {related.articles
                .filter(a => a.link !== article.link)
                .map(a => (
                  <div
                    key={a.id ?? a.link}
                    className={styles.relatedCard}
                    onClick={() => handleRelatedClick(a)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter') handleRelatedClick(a) }}
                  >
                    <span className={styles.relatedCardTitle}>{a.title}</span>
                    <span className={styles.relatedCardMeta}>
                      {a.category && (
                        <span className={styles.relatedCardCat}>{a.category}</span>
                      )}
                      <span>{a.source}</span>
                      {a.biasTag && (
                        <span className={styles.relatedCardTag}>{a.biasTag}</span>
                      )}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* ── 4-4. AI 정밀 분석 버튼 (클릭 시 API 1회) ─────────────────── */}
        <div className={styles.agentCWrap}>
          {deepPhase === 'idle' && (
            <>
              <button className={styles.agentCBtn} onClick={handleDeepAnalysis}>
                🔍 AI 정밀 분석
              </button>
              <p className={styles.agentCHint}>
                AI가 기사의 편향성을 정밀 분석합니다 (API 1회 소모)
              </p>
            </>
          )}

          {deepPhase === 'loading' && (
            <div className={styles.agentCLoadingBox}>
              <div className={styles.spinner} />
              <p className={styles.loadingText}>AI가 분석 중입니다...</p>
            </div>
          )}

          {deepPhase === 'error' && (
            <p className={styles.agentCUnavailable}>분석 중 오류가 발생했습니다.</p>
          )}

          {deepPhase === 'done' && deepData?.ai_unavailable && (
            <p className={styles.agentCUnavailable}>
              {deepData.message ?? 'OpenRouter API 사용량이 다 하였습니다.'}
            </p>
          )}
        </div>

        {/* ── 4-4. AI 정밀 분석 결과 (7개 섹션) ──────────────────────────── */}
        {deepPhase === 'done' && deepData && !deepData.ai_unavailable && (
          <>
            {/* ⚖️ 편향 판별 설명 */}
            {deepData.bias_explanation && (
              <div className={styles.section}>
                <p className={styles.sectionTitle}>⚖️ 편향 판별 설명</p>
                <p className={styles.analysisText}>{deepData.bias_explanation}</p>
              </div>
            )}

            {/* 👥 찬반 입장 그리드 */}
            {(deepData.pro_view || deepData.con_view) && (
              <div className={styles.section}>
                <p className={styles.sectionTitle}>👥 찬반 입장</p>
                <div className={styles.proConGrid}>
                  {deepData.pro_view && (
                    <div className={styles.proBox}>
                      <p className={styles.proConLabel}>찬성 측</p>
                      <p className={styles.proConText}>{deepData.pro_view}</p>
                    </div>
                  )}
                  {deepData.con_view && (
                    <div className={styles.conBox}>
                      <p className={styles.proConLabel}>반대 측</p>
                      <p className={styles.proConText}>{deepData.con_view}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ⚖️ 중도 시각 */}
            {deepData.neutral_view && (
              <div className={styles.section}>
                <p className={styles.sectionTitle}>⚖️ 중도 시각</p>
                <p className={styles.analysisText}>{deepData.neutral_view}</p>
              </div>
            )}

            {/* 📖 맥락 정보 */}
            {deepData.context_note && (
              <div className={styles.section}>
                <p className={styles.sectionTitle}>📖 맥락 정보</p>
                <p className={styles.analysisText}>{deepData.context_note}</p>
              </div>
            )}

            {/* 🔢 AI 편향도 점수 (ai_bias_score === -1 이면 미제공 → 숨김) */}
            {typeof deepData.ai_bias_score === 'number' && deepData.ai_bias_score >= 0 && (
              <div className={styles.section}>
                <p className={styles.sectionTitle}>🔢 AI 편향도 점수</p>
                <p className={styles.analysisText}>
                  규칙 기반: {displayScore.toFixed(2)}&nbsp;|&nbsp;AI 판단: {deepData.ai_bias_score.toFixed(2)}
                </p>
              </div>
            )}

            {/* 🔍 교차검증 포인트 */}
            {deepData.cross_check && (
              <div className={styles.section}>
                <p className={styles.sectionTitle}>🔍 교차검증 포인트</p>
                <p className={styles.analysisText}>{deepData.cross_check}</p>
              </div>
            )}

            {/* 💡 관련 논점 기사 */}
            {deepData.recommendations && deepData.recommendations.length > 0 && (
              <div className={styles.relatedSection}>
                <p className={styles.relatedTitle}>💡 관련 논점 기사</p>
                <div className={styles.relatedList}>
                  {deepData.recommendations.map(a => (
                    <div
                      key={a.id ?? a.link}
                      className={styles.relatedCard}
                      onClick={() => handleRelatedClick(a)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter') handleRelatedClick(a) }}
                    >
                      <span className={styles.relatedCardTitle}>{a.title}</span>
                      <span className={styles.relatedCardMeta}>
                        {a.category && (
                          <span className={styles.relatedCardCat}>{a.category}</span>
                        )}
                        <span>{a.source}</span>
                        {a.biasTag && (
                          <span className={styles.relatedCardTag}>{a.biasTag}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}
