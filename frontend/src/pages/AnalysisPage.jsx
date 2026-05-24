/**
 * AnalysisPage — 편향 열람 분석 (STEP 10)
 *
 * 분석 대상: pn_history 中 is_debate=true 최근 30건
 * 저장소:   pn_analysis_history (최대 30건, 분석 시마다 추가)
 *
 * 표시 순서 (총평 → 상세):
 *   [총평]  원형 프로그레스 + 등급 + 메시지 + 보조카드
 *   ① 관점분포   ② 4요소 세부   ③ 카테고리 열람분포
 *   ④ 카테고리 편향분포   ⑤ 언론사 Top5
 *   ⑥ 편향도 변화추이   ⑦ 안내문구
 */

import { useCallback, useMemo, useState } from 'react'
import Header                              from '../components/Header'
import { useHistory }                      from '../hooks/useHistory'
import { leanGroup, calcTopicDiversity, buildMessages, calculateUP }
  from '../utils/upScore'
import styles from './AnalysisPage.module.css'

// ── 상수 ─────────────────────────────────────────────────────────────────
const ANALYSIS_KEY = 'pn_analysis_history'
const MAX_ANALYSIS = 30

// ── localStorage 유틸 ────────────────────────────────────────────────────
function loadAnalysisHistory() {
  try { return JSON.parse(localStorage.getItem(ANALYSIS_KEY) || '[]') }
  catch { return [] }
}

function appendAnalysisHistory(entry) {
  const prev = loadAnalysisHistory()
  const next = [entry, ...prev].slice(0, MAX_ANALYSIS)
  try { localStorage.setItem(ANALYSIS_KEY, JSON.stringify(next)) } catch {}
  return next
}

// ── 색상 헬퍼 ────────────────────────────────────────────────────────────
function scoreColor(v01) {          // v01 in [0,1]
  if (v01 <= 0.3) return '#27ae60'
  if (v01 <= 0.6) return '#f39c12'
  return '#e74c3c'
}

function gradeInfo(diversity) {     // diversity in [0,100]
  if (diversity >= 71) return { label: '높음', color: '#27ae60' }
  if (diversity >= 41) return { label: '보통', color: '#f39c12' }
  return { label: '낮음', color: '#e74c3c' }
}

const LEAN_COLORS = {
  cons: '#e74c3c',
  neut: '#27ae60',
  prog: '#3498db',
}
const LEAN_LABELS = { cons: '보수', neut: '중립', prog: '진보' }

// ══════════════════════════════════════════════════════════════════════════
// 내부 컴포넌트
// ══════════════════════════════════════════════════════════════════════════

/** 원형 프로그레스 (SVG) */
function CircleProgress({ score, color, grade }) {
  const R  = 54
  const C  = 2 * Math.PI * R
  const off = C * (1 - score / 100)
  return (
    <svg width="148" height="148" viewBox="0 0 148 148" className={styles.circlesvg}>
      <circle cx="74" cy="74" r={R} fill="none" stroke="var(--color-border)" strokeWidth="11" />
      <circle
        cx="74" cy="74" r={R} fill="none"
        stroke={color} strokeWidth="11"
        strokeDasharray={C} strokeDashoffset={off}
        strokeLinecap="round"
        transform="rotate(-90 74 74)"
        style={{ transition: 'stroke-dashoffset 0.8s ease' }}
      />
      <text x="74" y="70" textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize="30" fontWeight="700">
        {Math.round(score)}
      </text>
      <text x="74" y="98" textAnchor="middle"
        fill={color} fontSize="14" fontWeight="600">
        {grade}
      </text>
    </svg>
  )
}

/** 가로 비율 막대 */
function HBar({ label, pct, color, count, total }) {
  return (
    <div className={styles.barRow}>
      <span className={styles.barLabel}>{label}</span>
      <div className={styles.barTrack}>
        <div className={styles.barFill} style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={styles.barPct}>{Math.round(pct)}%</span>
      {count != null && (
        <span className={styles.barCount}>{count}건</span>
      )}
    </div>
  )
}

/** 스택 바 세그먼트 */
function StackBar({ segments }) {
  return (
    <div className={styles.stackBar}>
      {segments.map((s, i) => (
        <div
          key={i}
          className={styles.stackSeg}
          style={{ width: `${s.pct}%`, background: s.color }}
          title={`${s.label}: ${Math.round(s.pct)}%`}
        />
      ))}
    </div>
  )
}

/** 트렌드 SVG 라인 그래프 */
function TrendGraph({ history }) {
  // history newest-first → reverse for chart
  const data = useMemo(() => [...history].reverse(), [history])
  if (data.length === 0) return null

  const W = 560, H = 190
  const P = { t: 14, r: 18, b: 38, l: 42 }
  const cw = W - P.l - P.r
  const ch = H - P.t - P.b
  const n  = data.length

  const xOf = i => P.l + (n === 1 ? cw / 2 : cw * i / (n - 1))
  const yOf = v => P.t + ch * (1 - v / 100)

  const linePath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(d.diversity).toFixed(1)}`)
    .join(' ')

  const step = n <= 5 ? 1 : n <= 12 ? 2 : 5
  const yTicks = [0, 25, 50, 75, 100]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.graphSvg} aria-hidden="true">
      {/* 배경 밴드: 높음(≥71) 초록 */}
      <rect x={P.l} y={P.t} width={cw} height={ch * 29 / 100} fill="rgba(39,174,96,0.10)" />
      {/* 배경 밴드: 낮음(≤40) 빨강 */}
      <rect x={P.l} y={yOf(40)} width={cw} height={ch * 40 / 100} fill="rgba(231,76,60,0.10)" />

      {/* Y 그리드 */}
      {yTicks.map(v => (
        <g key={v}>
          <line x1={P.l} y1={yOf(v)} x2={P.l + cw} y2={yOf(v)}
            stroke="var(--color-border)" strokeWidth="0.6" />
          <text x={P.l - 7} y={yOf(v)} textAnchor="end" dominantBaseline="middle"
            fill="var(--color-text-sub)" fontSize="10">{v}</text>
        </g>
      ))}

      {/* 라인 */}
      {n > 1 && (
        <path d={linePath} stroke="var(--color-primary)" strokeWidth="2.2"
          fill="none" strokeLinejoin="round" strokeLinecap="round" />
      )}

      {/* 점 */}
      {data.map((d, i) => {
        const color = d.diversity >= 71 ? '#27ae60' : d.diversity >= 41 ? '#f39c12' : '#e74c3c'
        return (
          <circle key={i} cx={xOf(i)} cy={yOf(d.diversity)} r="5.5"
            fill={color} stroke="#fff" strokeWidth="1.8" />
        )
      })}

      {/* X 레이블 */}
      {data.map((d, i) => {
        if (i % step !== 0 && i !== n - 1) return null
        const dt = new Date(d.date)
        return (
          <text key={i} x={xOf(i)} y={H - P.b + 16}
            textAnchor="middle" fill="var(--color-text-sub)" fontSize="10">
            {dt.getMonth() + 1}/{dt.getDate()}
          </text>
        )
      })}

      {/* Y 축선 */}
      <line x1={P.l} y1={P.t} x2={P.l} y2={P.t + ch}
        stroke="var(--color-border)" strokeWidth="1" />
    </svg>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// 섹션 렌더러
// ══════════════════════════════════════════════════════════════════════════

/** ① 관점분포 */
function Section1({ arts }) {
  const pro   = arts.filter(a => a.viewpoint === 'pro').length
  const con   = arts.filter(a => a.viewpoint === 'con').length
  const neut  = arts.length - pro - con
  const t     = arts.length || 1
  return (
    <div className={styles.card}>
      <p className={styles.sectionTitle}>① 관점 분포</p>
      <HBar label="찬성(pro)" pct={pro/t*100} color="#3498db" count={pro} />
      <HBar label="반대(con)" pct={con/t*100} color="#e74c3c" count={con} />
      <HBar label="중도"      pct={neut/t*100} color="#27ae60" count={neut} />
      <div className={styles.viewpointLegend}>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: '#3498db' }} />찬성 {Math.round(pro/t*100)}%
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: '#e74c3c' }} />반대 {Math.round(con/t*100)}%
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: '#27ae60' }} />중도 {Math.round(neut/t*100)}%
        </span>
      </div>
    </div>
  )
}

/** ② 4요소 세부 */
function Section2({ result }) {
  const comps = [
    { key: 'd_opinion',   label: '관점편중도', weight: '35%',
      desc: '찬반 기사 쏠림 정도 (높을수록 한 방향 기사 집중)' },
    { key: 'd_source',    label: '언론사편중도', weight: '25%',
      desc: '보수·진보 언론사 균형 여부' },
    { key: 'd_bimodal',   label: '이봉성', weight: '25%',
      desc: '양극화 패턴 — 찬반 모두 높고 중립이 적을 때 상승' },
    { key: 'd_intensity', label: '편향강도', weight: '15%',
      desc: '개별 기사의 평균 편향 수치 (biasScore 기반)' },
  ]
  return (
    <div className={styles.card}>
      <p className={styles.sectionTitle}>② 4요소 세부</p>
      {comps.map(({ key, label, weight, desc }) => {
        const v = result[key]
        const color = scoreColor(v)
        return (
          <div key={key} className={styles.compRow}>
            <div className={styles.compHeader}>
              <span className={styles.compName}>{label} <small className={styles.compWeight}>({weight})</small></span>
              <span className={styles.compVal} style={{ color }}>{(v * 100).toFixed(0)}</span>
            </div>
            <div className={styles.compTrack}>
              <div className={styles.compFill} style={{ width: `${v * 100}%`, background: color }} />
            </div>
            <p className={styles.compDesc}>{desc}</p>
          </div>
        )
      })}
    </div>
  )
}

/** ③ 카테고리별 열람분포 (전체 기사) */
function Section3({ allArts }) {
  const catCnt = {}
  for (const a of allArts) {
    const c = a.category || '기타'
    catCnt[c] = (catCnt[c] || 0) + 1
  }
  const sorted = Object.entries(catCnt).sort((a, b) => b[1] - a[1])
  const t = allArts.length || 1
  return (
    <div className={styles.card}>
      <p className={styles.sectionTitle}>③ 카테고리별 열람 분포</p>
      {sorted.map(([cat, cnt]) => (
        <HBar key={cat} label={cat} pct={cnt/t*100}
          color="var(--color-primary)" count={cnt} />
      ))}
    </div>
  )
}

/** ④ 카테고리별 편향분포 (논쟁형 기사) */
function Section4({ debateArts }) {
  const catArts = {}
  for (const a of debateArts) {
    const c = a.category || '기타'
    ;(catArts[c] = catArts[c] || []).push(a)
  }
  const cats = Object.entries(catArts).sort((a, b) => b[1].length - a[1].length)
  return (
    <div className={styles.card}>
      <p className={styles.sectionTitle}>④ 카테고리별 편향 분포 (논쟁형)</p>
      {cats.length === 0 && <p className={styles.noDataMsg}>데이터 없음</p>}
      {cats.map(([cat, as]) => {
        if (as.length < 5) {
          return (
            <div key={cat} className={styles.catBiasRow}>
              <span className={styles.catBiasName}>{cat}</span>
              <span className={styles.catBiasNoData}>데이터 부족 ({as.length}건)</span>
            </div>
          )
        }
        const low  = as.filter(a => (a.biasScore ?? 0) < 0.30).length
        const mid  = as.filter(a => { const s = a.biasScore ?? 0; return s >= 0.30 && s < 0.60 }).length
        const high = as.filter(a => (a.biasScore ?? 0) >= 0.60).length
        const total = as.length
        const avg = as.reduce((s, a) => s + (a.biasScore ?? 0), 0) / total
        const icon = avg < 0.30 ? '✅' : avg < 0.60 ? '⚠️' : '🚨'
        return (
          <div key={cat} className={styles.catBiasRow}>
            <span className={styles.catBiasName}>{cat}</span>
            <div className={styles.catBiasBarWrap}>
              <StackBar segments={[
                { pct: low  / total * 100, color: '#27ae60', label: '낮음' },
                { pct: mid  / total * 100, color: '#f39c12', label: '보통' },
                { pct: high / total * 100, color: '#e74c3c', label: '높음' },
              ]} />
            </div>
            <span className={styles.catBiasIcon}>{icon}</span>
          </div>
        )
      })}
      <div className={styles.viewpointLegend}>
        <span className={styles.legendItem}><span className={styles.legendDot} style={{ background: '#27ae60' }} />균형(&lt;0.3)</span>
        <span className={styles.legendItem}><span className={styles.legendDot} style={{ background: '#f39c12' }} />주의(0.3~)</span>
        <span className={styles.legendItem}><span className={styles.legendDot} style={{ background: '#e74c3c' }} />위험(≥0.6)</span>
      </div>
    </div>
  )
}

/** ⑤ 열람 언론사 Top5 */
function Section5({ allArts }) {
  const srcArts = {}
  for (const a of allArts) {
    const s = a.source || '알 수 없음'
    ;(srcArts[s] = srcArts[s] || []).push(a)
  }
  const top5 = Object.entries(srcArts)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5)

  return (
    <div className={styles.card}>
      <p className={styles.sectionTitle}>⑤ 열람 언론사 Top 5</p>
      {top5.map(([src, as], idx) => {
        const pro  = as.filter(a => a.viewpoint === 'pro').length
        const con  = as.filter(a => a.viewpoint === 'con').length
        const neut = as.length - pro - con
        const t    = as.length || 1
        return (
          <div key={src} className={styles.sourceRow}>
            <span className={styles.sourceRank}>{idx + 1}</span>
            <span className={styles.sourceName}>{src}</span>
            <div className={styles.sourceBarWrap}>
              <div className={styles.leanStackBar}>
                <div style={{ width: `${pro/t*100}%`,  background: '#3498db', height: '100%' }} title={`찬성 ${Math.round(pro/t*100)}%`} />
                <div style={{ width: `${neut/t*100}%`, background: '#27ae60', height: '100%' }} title={`중립 ${Math.round(neut/t*100)}%`} />
                <div style={{ width: `${con/t*100}%`,  background: '#e74c3c', height: '100%' }} title={`반대 ${Math.round(con/t*100)}%`} />
              </div>
            </div>
            <span className={styles.sourceCnt}>{as.length}건</span>
          </div>
        )
      })}
      <div className={styles.leanLegend}>
        <span className={styles.leanLegendItem}><span className={styles.leanDot} style={{ background: '#3498db' }} />찬성</span>
        <span className={styles.leanLegendItem}><span className={styles.leanDot} style={{ background: '#27ae60' }} />중립</span>
        <span className={styles.leanLegendItem}><span className={styles.leanDot} style={{ background: '#e74c3c' }} />반대</span>
      </div>
    </div>
  )
}

/** ⑥ 편향도 변화 추이 */
function Section6({ analysisHistory }) {
  // 변화 요약: 최근 2회 비교
  const trend = useMemo(() => {
    if (analysisHistory.length < 2) return null
    const change = analysisHistory[0].up - analysisHistory[1].up
    if (change > 0.05)  return { label: '편중 증가 중 📈', type: 'worse' }
    if (change < -0.05) return { label: '균형 개선 중 📉', type: 'better' }
    return { label: '유지 중 ➡️', type: 'stable' }
  }, [analysisHistory])

  return (
    <div className={styles.card}>
      <p className={styles.sectionTitle}>⑥ 편향도 변화 추이</p>
      {analysisHistory.length === 0
        ? <p className={styles.noDataMsg}>분석 기록 없음</p>
        : (
          <>
            <TrendGraph history={analysisHistory} />
            {trend && (
              <div className={styles.trendSummary}>
                <span>최근 변화:</span>
                <strong style={{
                  color: trend.type === 'better' ? '#27ae60'
                       : trend.type === 'worse'  ? '#e74c3c'
                       : 'var(--color-text)',
                }}>
                  {trend.label}
                </strong>
              </div>
            )}
          </>
        )
      }
    </div>
  )
}

/** ⑦ 안내문구 */
function Section7() {
  return (
    <div className={styles.refCard}>
      <p className={styles.refTitle}>📚 분석 방법 안내</p>
      <p className={styles.refText}>
        UP(Unbalanced Perspective) Score는 관점편중도 × 0.35, 언론사편중도 × 0.25,
        이봉성 × 0.25, 편향강도 × 0.15 의 가중합입니다.
        다양성 점수 = (1 − UP) × 100으로, 높을수록 균형 잡힌 열람을 의미합니다.
        <br /><br />
        · 시간 감쇠: 최근 기사에 더 높은 가중치(반감기 7일)<br />
        · 이봉성 보정: Kitchens et al. (2020) 방법론 적용<br />
        · 주제 다양성: Shannon H / ln(카테고리 수) × 100<br />
        <br />
        <em>참조: Matakos et al. (2017), Kitchens et al. (2020), Shannon (1948)</em>
      </p>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// 메인 페이지
// ══════════════════════════════════════════════════════════════════════════
export default function AnalysisPage() {
  const { history }              = useHistory()
  const nickname                 = localStorage.getItem('pn_nickname') || '사용자'

  const [result,          setResult]          = useState(null)
  const [analysisHistory, setAnalysisHistory] = useState(loadAnalysisHistory)
  const [analysisState,   setAnalysisState]   = useState('idle')
  // 'idle' | 'insufficient' | 'done'

  // ── 논쟁형 기사 (최근 30건) ────────────────────────────────────────────
  const debateArts = useMemo(
    () => history.filter(a => a.is_debate === true).slice(0, 30),
    [history]
  )

  // ── 분석 실행 ─────────────────────────────────────────────────────────
  const handleAnalyze = useCallback(() => {
    if (debateArts.length < 5) {
      setAnalysisState('insufficient')
      setResult(null)
      return
    }

    const calc = calculateUP(debateArts)
    if (!calc) { setAnalysisState('insufficient'); return }

    const topicDiv = calcTopicDiversity(history)
    const msgs     = buildMessages(calc)
    const fullResult = { ...calc, topicDiversity: topicDiv, messages: msgs }

    // pn_analysis_history 저장
    const entry = {
      date:          new Date().toISOString(),
      up:            calc.up,
      d_opinion:     calc.d_opinion,
      d_source:      calc.d_source,
      d_bimodal:     calc.d_bimodal,
      d_intensity:   calc.d_intensity,
      diversity:     calc.diversity,
      topicDiversity: topicDiv,
      articleCount:  calc.articleCount,
    }
    const updated = appendAnalysisHistory(entry)
    setAnalysisHistory(updated)
    setResult(fullResult)
    setAnalysisState('done')
  }, [debateArts, history])

  // ── grade ───────────────────────────────────────────────────────────────
  const grade = result ? gradeInfo(result.diversity) : null

  return (
    <div className={styles.page}>
      <Header />
      <div className={styles.body}>

        {/* 페이지 타이틀 */}
        <h1 className={styles.pageTitle}>📊 {nickname}님의 뉴스 열람 분석</h1>

        {/* 분석 버튼 */}
        <button className={styles.analyzeBtn} onClick={handleAnalyze}>
          나의 편향도 분석
        </button>

        {/* ── 데이터 부족 ── */}
        {analysisState === 'insufficient' && (
          <>
            <div className={styles.insufficient}>
              <div className={styles.insufficientIcon}>📉</div>
              <p className={styles.insufficientTitle}>분석 데이터 부족</p>
              <p className={styles.insufficientDesc}>
                논쟁형 기사(is_debate=true)가 {debateArts.length}건으로<br />
                UP Score 계산에 필요한 최소 5건에 미달합니다.<br />
                뉴스를 더 읽은 뒤 다시 시도해 주세요.
              </p>
            </div>
            <Section4 debateArts={debateArts} />
            <Section5 allArts={history} />
          </>
        )}

        {/* ── 최초 진입 (아직 분석 전) ── */}
        {analysisState === 'idle' && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📊</div>
            <p className={styles.emptyTitle}>편향 분석 준비됨</p>
            <p className={styles.emptyDesc}>
              위 버튼을 눌러 나의 뉴스 열람 패턴을 분석해보세요.<br />
              논쟁형 기사 {debateArts.length}건이 준비되어 있습니다.
            </p>
          </div>
        )}

        {/* ── 분석 완료 ── */}
        {analysisState === 'done' && result && (
          <>
            {/* ── 총평 ── */}
            <div className={styles.summaryCard}>
              <div className={styles.circleWrap}>
                <CircleProgress
                  score={result.diversity}
                  color={grade.color}
                  grade={grade.label}
                />
              </div>

              <span className={styles.gradeBadge}
                style={{ background: grade.color }}>
                다양성 {grade.label}
              </span>

              {/* 총평 메시지 */}
              <div className={styles.msgs}>
                {result.messages.map((m, i) => (
                  <p key={i} className={styles.msg}>{m}</p>
                ))}
              </div>

              {/* 이봉성 경고 */}
              {result.d_bimodal > 0.3 && result.d_opinion < 0.2 && (
                <div className={styles.bimodalWarn}>
                  🚨 <strong>이봉성 경고</strong> — 양극화 패턴 감지됨.
                  찬반이 갈리는 기사만 읽고 중도 시각이 부족합니다.
                </div>
              )}

              {/* 보조 카드: 주제다양성 + 분석기사수 */}
              <div className={styles.subCards}>
                <div className={styles.subCard}>
                  <p className={styles.subCardLabel}>주제 다양성</p>
                  <p className={styles.subCardValue}>{Math.round(result.topicDiversity)}</p>
                  <p className={styles.subCardUnit}>/ 100</p>
                </div>
                <div className={styles.subCard}>
                  <p className={styles.subCardLabel}>분석 기사 수</p>
                  <p className={styles.subCardValue}>{result.articleCount}</p>
                  <p className={styles.subCardUnit}>건 (논쟁형)</p>
                </div>
                <div className={styles.subCard}>
                  <p className={styles.subCardLabel}>UP Score</p>
                  <p className={styles.subCardValue}
                    style={{ color: scoreColor(result.up) }}>
                    {(result.up * 100).toFixed(0)}
                  </p>
                  <p className={styles.subCardUnit}>/ 100</p>
                </div>
              </div>
            </div>

            {/* ── 상세 분석 ── */}
            <p className={styles.divider}>상세 분석</p>

            <Section1 arts={debateArts} />
            <Section2 result={result} />
            <Section3 allArts={history} />
            <Section4 debateArts={debateArts} />
            <Section5 allArts={history} />
            <Section6 analysisHistory={analysisHistory} />
            <Section7 />
          </>
        )}

      </div>
    </div>
  )
}
