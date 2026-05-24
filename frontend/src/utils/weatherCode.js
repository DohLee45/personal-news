/**
 * WMO Weather interpretation codes → emoji + 설명 (한국어)
 * https://open-meteo.com/en/docs#weathervariables
 */
export function decodeWeatherCode(code) {
  if (code === 0)              return { emoji: '☀️',  label: '맑음' }
  if (code === 1)              return { emoji: '🌤️', label: '대체로 맑음' }
  if (code === 2)              return { emoji: '⛅',  label: '구름 조금' }
  if (code === 3)              return { emoji: '☁️',  label: '흐림' }
  if (code >= 45 && code <= 48) return { emoji: '🌫️', label: '안개' }
  if (code >= 51 && code <= 57) return { emoji: '🌦️', label: '이슬비' }
  if (code >= 61 && code <= 67) return { emoji: '🌧️', label: '비' }
  if (code >= 71 && code <= 77) return { emoji: '❄️',  label: '눈' }
  if (code >= 80 && code <= 82) return { emoji: '🌦️', label: '소나기' }
  if (code >= 85 && code <= 86) return { emoji: '🌨️', label: '눈 소나기' }
  if (code >= 95 && code <= 99) return { emoji: '⛈️',  label: '천둥번개' }
  return { emoji: '🌡️', label: '알 수 없음' }
}
