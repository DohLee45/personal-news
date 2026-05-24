/**
 * ArticlePage — 기사 상세 페이지 (STEP 8)
 *
 * 점진적 로딩 순서:
 *   [즉시]        ① 제목(Noto Serif KR)  ② 편향도 바·태그  ④ 원문보기 버튼
 *   [병렬 시작]
 *     POST /api/analysis  → ③ AI 요약  ⑤ 편향 분석 (5~15초)
 *     GET  /api/related   → ⑥ 1차 다른 논조 추천 (2~5초)
 *   [수동 클릭]   POST /api/recommend → Agent C 정밀 추천
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

// ── 관련 기사 카드 (내부 이동) ─────────────────────────────────────────────
function RelatedCard({ article, onRead }) {
  const nav = useNavigate()
  const handleClick = () => {
    if (onRead) onRead(article)
    nav(`/article/${article.id}`, { state: { article } })
  }
  return (
    <div
      className={styles.relatedCard}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') handleClick() }}
    >
      <span className={styles.relatedCardTitle}>{article.title}</span>
      <span className={styles.relatedCardMeta}>
        {article.category && (
          <span className={styles.relatedCardCat}>{article.category}</span>
        )}
        <span>{article.source}</span>
        {article.biasTag && (
          <span className={styles.relatedCardTag}>{article.biasTag}</span>
        )}
      </span>
    </div>
  )
}

// ── 메인 페이지 컴포넌트 ────────────────────────────────────────────────────
export default function ArticlePage() {
  const navigate           = useNavigate()
  const { id }             = useParams()
  const { state }          = useLocation()
  const article            = state?.article
  const { updateStage2, addStage1 } = useHistory()

  // ── 분석 상태 ─────────────────────────────────────────────────────────────
  const [analysisPhase, setAnalysisPhase] = useState('loading')
  // 'loading' | 'done' | 'error'
  const [aiData,        setAiData]        = useState(null)
  const [updatedBias,   setUpdatedBias]   = useState(null)

  // ── 관련 기사 상태 ────────────────────────────────────────────────────────
  const [related, setRelated] = useState({ loading: true, articles: [], msg: '' })

  // ── Agent C 상태 ──────────────────────────────────────────────────────────
  const [agentC, setAgentC] = useState({ triggered: false, loading: false, data: null })

  const didFetch = useRef(false)

  // ── 데이터 페치 ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!article || didFetch.current) return
    didFetch.current = true

    const ctrl = new AbortController()

    // ── ① POST /api/analysis (크롤링 + Agent A) ────────────────────────────
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
            category: article.category || '시사·사회',
            summary:  article.summary  || '',
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()

        setAiData(json.ai_analysis   ?? null)
        setUpdatedBias(json.updated_bias ?? null)
        setAnalysisPhase('done')

        // Stage 2 히스토리 업데이트
        if (json.updated_bias && article.id) {
          updateStage2(article.id, {
            biasScore: json.updated_bias.biasScore,
            biasTag:   json.updated_bias.biasTag,
            viewpoint: json.updated_bias.viewpoint,
          })
        }
      } catch (err) {
        if (err.name !== 'AbortError') setAnalysisPhase('error')
      }
    }

    // ── ② GET /api/related (1차 RSS 추천) ────────────────────────────────
    const runRelated = async () => {
      try {
        const params = new URLSearchParams({
          title:       article.title  || '',
          source:      article.source || '',
          exclude_url: article.link   || '',
        })
        const res = await fetch(`/api/related?${params}`, { signal: ctrl.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        setRelated({
          loading:  false,
          articles: json.articles            ?? [],
          msg:      json.non_debate_message  ?? '',
        })
      } catch (err) {
        if (err.name !== 'AbortError') {
          setRelated({ loading: false, articles: [], msg: '' })
        }
      }
    }

    // 병렬 실행
    runAnalysis()
    runRelated()

    return () => ctrl.abort()
  }, [article, updateStage2])

  // ── Agent C 호출 ─────────────────────────────────────────────────────────
  const handleAgentC = useCallback(async () => {
    if (!article || agentC.triggered) return

    setAgentC(prev => ({ ...prev, triggered: true, loading: true }))

    const candidates = related.articles
    try {
      const res = await fetch('/api/recommend', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article: {
            title:     article.title,
            source:    article.source,
            link:      article.link,
            biasScore: updatedBias?.biasScore ?? article.biasScore,
            summary:   article.summary,
            ai_analysis: aiData,
          },
          candidates,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setAgentC({ triggered: true, loading: false, data: json })
    } catch {
      setAgentC(prev => ({ ...prev, loading: false }))
    }
  }, [article, agentC.triggered, related.articles, updatedBias, aiData])

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

  // AI 분석 결과 (ai_unavailable 케이스 분리)
  const aiUnavailable = aiData?.ai_unavailable === true
  const analysis      = aiUnavailable ? null : aiData

  return (
    <div className={styles.page}>
      <Header />
      <div className={styles.body}>

        {/* 뒤로가기 */}
        <button className={styles.back} onClick={() => navigate(-1)}>← 뒤로가기</button>

        {/* ── 기사 헤더 카드 ─────────────────────────────────────────────────── */}
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

        {/* ── AI 분석 (로딩 / 완료 / 에러) ─────────────────────────────────── */}
        {analysisPhase === 'loading' && (
          <div className={styles.skeletonSection}>
            <div className={styles.skeleton} />
            <div className={`${styles.skeleton} ${styles.skeletonShort}`} />
            <div className={styles.skeleton} />
            <div className={`${styles.skeleton} ${styles.skeletonMed}`} />
            <div className={styles.skeleton} />
            <p className={styles.skeletonHint}>기사를 분석하고 있습니다...</p>
          </div>
        )}

        {analysisPhase === 'error' && (
          <div className={styles.errorBox}>
            AI 분석을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </div>
        )}

        {analysisPhase === 'done' && aiUnavailable && (
          <div className={styles.errorBox}>
            OpenRouter API 사용량이 다 하였습니다.
          </div>
        )}

        {analysisPhase === 'done' && analysis && (
          <>
            {/* AI 요약 */}
            {analysis.summary?.length > 0 && (
              <div className={styles.section}>
                <p className={styles.sectionTitle}>📋 AI 요약</p>
                <ul className={styles.summaryList}>
                  {analysis.summary.map((s, i) => (
                    <li key={i} className={styles.summaryItem}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 편향 설명 */}
            {analysis.bias_explanation && (
              <div className={styles.section}>
                <p className={styles.sectionTitle}>⚖️ 편향 판별 설명</p>
                <p className={styles.analysisText}>{analysis.bias_explanation}</p>
              </div>
            )}

            {/* 찬반 시각 */}
            {(analysis.pro_view || analysis.con_view) && (
              <div className={styles.section}>
                <p className={styles.sectionTitle}>📊 찬반 시각</p>
                <div className={styles.proConGrid}>
                  {analysis.pro_view && (
                    <div className={styles.proBox}>
                      <p className={styles.proConLabel}>찬성</p>
                      <p className={styles.proConText}>{analysis.pro_view}</p>
                    </div>
                  )}
                  {analysis.con_view && (
                    <div className={styles.conBox}>
                      <p className={styles.proConLabel}>반대</p>
                      <p className={styles.proConText}>{analysis.con_view}</p>
                    </div>
                  )}
                </div>
                {analysis.neutral_view && (
                  <p className={`${styles.analysisText} ${styles.analysisTextMt}`}>
                    <strong>중립적 해석:</strong> {analysis.neutral_view}
                  </p>
                )}
              </div>
            )}

            {/* 배경 정보 */}
            {analysis.context_note && (
              <div className={styles.section}>
                <p className={styles.sectionTitle}>📖 배경 정보</p>
                <p className={styles.analysisText}>{analysis.context_note}</p>
              </div>
            )}

            {/* 교차검증 */}
            {analysis.cross_check && (
              <div className={styles.section}>
                <p className={styles.sectionTitle}>🔍 교차검증 포인트</p>
                <p className={styles.analysisText}>{analysis.cross_check}</p>
              </div>
            )}
          </>
        )}

        {/* ── 1차 추천 (RSS 기반, 자동) ──────────────────────────────────────── */}
        <div className={styles.relatedSection}>
          <p className={styles.relatedTitle}>
            🗞 다른 시각 기사
          </p>

          {related.loading && (
            <p className={styles.loadingText}>추천 기사를 불러오는 중...</p>
          )}

          {!related.loading && related.articles.length === 0 && (
            <p className={styles.nonDebateMsg}>관련 기사를 찾지 못했습니다.</p>
          )}

          {!related.loading && related.articles.length > 0 && (
            <div className={styles.relatedList}>
              {related.articles.map(a => (
                <RelatedCard key={a.id ?? a.link} article={a} onRead={(a) => addStage1(a)} />
              ))}
            </div>
          )}
        </div>

        {/* ── Agent C 정밀 분석 (수동) ───────────────────────────────────────── */}
        <div className={styles.agentCWrap}>
          {!agentC.triggered && (
            <>
              <button
                className={styles.agentCBtn}
                onClick={handleAgentC}
                disabled={related.loading}
              >
                🤖 AI 정밀 분석
              </button>
              <p className={styles.agentCHint}>
                AI가 다른 논조 기사를 선별하고 추천 이유를 설명합니다 (API 1회 소모)
              </p>
            </>
          )}

          {agentC.triggered && agentC.loading && (
            <div className={styles.agentCLoadingBox}>
              <div className={styles.spinner} />
              <p className={styles.loadingText}>AI가 분석 중입니다...</p>
            </div>
          )}

          {agentC.triggered && !agentC.loading && agentC.data && (
            <>
              {agentC.data.ai_unavailable ? (
                <p className={styles.agentCUnavailable}>
                  {agentC.data.message ?? 'OpenRouter API 사용량이 다 하였습니다.'}
                </p>
              ) : (
                <>
                  {agentC.data.no_result_reason && (
                    <p className={styles.agentCUnavailable}>{agentC.data.no_result_reason}</p>
                  )}
                  {agentC.data.recommendations?.length > 0 && (
                    <div className={styles.agentCResultList}>
                      {agentC.data.recommendations.map((rec, i) => {
                        const cand = related.articles[rec.index]
                        if (!cand) return null
                        return (
                          <div key={i} className={styles.agentCResultCard}>
                            <a
                              href={cand.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.agentCResultTitle}
                            >
                              {cand.title}
                            </a>
                            <p className={styles.agentCResultReason}>💬 {rec.reason}</p>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {agentC.triggered && !agentC.loading && !agentC.data && (
            <p className={styles.agentCUnavailable}>분석 중 오류가 발생했습니다.</p>
          )}
        </div>

      </div>
    </div>
  )
}
