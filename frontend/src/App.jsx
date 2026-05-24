import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import NicknamePage   from './pages/NicknamePage'
import OnboardingPage from './pages/OnboardingPage'
import MainPage       from './pages/MainPage'
import styles from './App.module.css'

// 무거운 페이지 — code-split chunk로 분리
const ArticlePage  = lazy(() => import('./pages/ArticlePage'))
const AnalysisPage = lazy(() => import('./pages/AnalysisPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

/** localStorage 값 확인 헬퍼 */
function hasNickname()  { return Boolean(localStorage.getItem('pn_nickname')) }
function hasOnboarded() { return localStorage.getItem('pn_onboarded') === 'true' }

/**
 * 보호 라우트:
 *   닉네임 없음  → NicknamePage
 *   온보딩 미완  → OnboardingPage
 *   모두 완료   → children 렌더
 */
function RequireSetup({ children }) {
  if (!hasNickname())  return <Navigate to="/nickname"  replace />
  if (!hasOnboarded()) return <Navigate to="/onboarding" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className={styles.fallback}>로딩 중...</div>}>
      <Routes>
        {/* 설정 라우트 */}
        <Route path="/nickname"   element={<NicknamePage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />

        {/* 보호 라우트 */}
        <Route path="/" element={
          <RequireSetup><MainPage /></RequireSetup>
        } />
        <Route path="/article/:id" element={
          <RequireSetup><ArticlePage /></RequireSetup>
        } />
        <Route path="/analysis" element={
          <RequireSetup><AnalysisPage /></RequireSetup>
        } />
        <Route path="/settings" element={
          <RequireSetup><SettingsPage /></RequireSetup>
        } />

        {/* 미매칭 → 루트 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
