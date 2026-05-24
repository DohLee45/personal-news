import { memo, useState, useEffect } from 'react'
import { decodeWeatherCode } from '../../utils/weatherCode'
import styles from './WeatherWidget.module.css'

const SEOUL = { lat: 37.5665, lon: 126.9780, name: '서울' }

/**
 * WeatherWidget — Open-Meteo API 현재 날씨
 * weather_code 기준, Geolocation 실패 시 서울 기본값
 * memo: props 없음 → 부모 리렌더 시 재렌더 방지
 */
const WeatherWidget = memo(function WeatherWidget() {
  const [weather,  setWeather]  = useState(null)
  const [cityName, setCityName] = useState(SEOUL.name)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    let cancelled = false

    async function fetchWeather(lat, lon) {
      const params = new URLSearchParams({
        latitude:  lat,
        longitude: lon,
        current:   'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
        timezone:  'Asia/Seoul',
      })
      const url = `https://api.open-meteo.com/v1/forecast?${params}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    }

    function loadWeather(lat, lon, name) {
      fetchWeather(lat, lon)
        .then(data => {
          if (cancelled) return
          const c = data.current
          setWeather({
            temp:     c.temperature_2m,
            humidity: c.relative_humidity_2m,
            wind:     c.wind_speed_10m,
            code:     c.weather_code,
          })
          setCityName(name)
          setLoading(false)
        })
        .catch(e => {
          if (cancelled) return
          setError('날씨 정보를 불러오지 못했습니다.')
          setLoading(false)
        })
    }

    if (!navigator.geolocation) {
      loadWeather(SEOUL.lat, SEOUL.lon, SEOUL.name)
      return
    }

    navigator.geolocation.getCurrentPosition(
      pos => {
        if (cancelled) return
        loadWeather(pos.coords.latitude, pos.coords.longitude, '현재 위치')
      },
      () => {
        // 권한 거부 또는 실패 → 서울 기본값
        if (!cancelled) loadWeather(SEOUL.lat, SEOUL.lon, SEOUL.name)
      },
      { timeout: 5000 }
    )

    return () => { cancelled = true }
  }, [])

  if (loading) return (
    <section className={styles.widget} aria-label="날씨">
      <p className={styles.loading}>날씨 불러오는 중…</p>
    </section>
  )

  if (error) return (
    <section className={styles.widget} aria-label="날씨">
      <p className={styles.error}>{error}</p>
    </section>
  )

  const { emoji, label } = decodeWeatherCode(weather.code)

  return (
    <section className={styles.widget} aria-label="날씨">
      <div className={styles.head}>
        <h2 className={styles.title}>🌍 날씨</h2>
        <span className={styles.location}>{cityName}</span>
      </div>

      <div className={styles.body}>
        <span className={styles.emoji} aria-hidden="true">{emoji}</span>
        <div className={styles.info}>
          <span className={styles.temp}>{weather.temp}°C</span>
          <span className={styles.label}>{label}</span>
        </div>
      </div>

      <div className={styles.details}>
        <span>💧 습도 {weather.humidity}%</span>
        <span>💨 바람 {weather.wind} km/h</span>
      </div>
    </section>
  )
})

export default WeatherWidget
