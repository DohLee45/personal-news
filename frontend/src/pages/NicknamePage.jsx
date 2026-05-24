import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './NicknamePage.module.css'

/** 닉네임 유효성: 2~10자, 한글·영문·숫자만 */
const NICKNAME_RE = /^[가-힣a-zA-Z0-9]{2,10}$/

export default function NicknamePage() {
  const navigate = useNavigate()
  const [value, setValue]   = useState('')
  const [touched, setTouched] = useState(false)

  const errorMsg = useCallback(() => {
    if (!touched) return ''
    if (value.length === 0)   return '닉네임을 입력해 주세요.'
    if (!NICKNAME_RE.test(value)) {
      if (value.length < 2)  return '2자 이상 입력해 주세요.'
      if (value.length > 10) return '10자 이하로 입력해 주세요.'
      return '한글, 영문, 숫자만 사용할 수 있어요.'
    }
    return ''
  }, [value, touched])

  const isValid = NICKNAME_RE.test(value)

  function handleChange(e) {
    setValue(e.target.value)
    if (!touched) setTouched(true)
  }

  function handleSubmit(e) {
    e.preventDefault()
    setTouched(true)
    if (!isValid) return
    localStorage.setItem('pn_nickname', value.trim())
    navigate('/onboarding', { replace: true })
  }

  const msg = errorMsg()

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {/* 로고 */}
        <h1 className={styles.logo}>Personal NEWS</h1>
        <p className={styles.tagline}>
          나만의 관심사로 큐레이션된 뉴스와<br />
          AI 편향 분석을 한 곳에서 경험하세요
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="nickname" className={styles.label}>
            닉네임을 입력해 주세요
          </label>

          <div className={styles.inputWrap}>
            <input
              id="nickname"
              type="text"
              className={`${styles.input}${msg ? ' ' + styles.error : ''}`}
              placeholder="예) 뉴스러버, NewsKing"
              value={value}
              maxLength={10}
              autoComplete="off"
              autoFocus
              onChange={handleChange}
              onBlur={() => setTouched(true)}
            />
            <span className={styles.counter}>{value.length}/10</span>
          </div>

          <p className={styles.errorMsg}>{msg}</p>

          <button
            type="submit"
            className={styles.btn}
            disabled={touched && !isValid}
          >
            시작하기
          </button>
        </form>

        <div className={styles.features}>
          <span className={styles.feature}>📰 관심 키워드 뉴스</span>
          <span className={styles.feature}>🤖 AI 편향 분석</span>
          <span className={styles.feature}>📊 편향 리포트</span>
        </div>
      </div>
    </div>
  )
}
