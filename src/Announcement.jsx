import React from 'react'

function categorizeRound(roundText) {
  if (!roundText) return '—'
  const raw = String(roundText).trim()
  const t = raw.toLowerCase()

  // Pools (with optional round)
  const poolMatch = t.match(/pool[s]?\b(?:[^0-9]*(?:round\s*(\d+))?)?/i)
  if (t.includes('pool')) {
    const m = raw.match(/round\s*(\d+)/i)
    return m ? `Pools · Round ${m[1]}` : 'Pools'
  }

  // Top N (e.g. Top 24, Top16)
  const top = t.match(/top\s*#?\s*(\d+)/i) || t.match(/top(\d+)/i)
  if (top && top[1]) return `Top ${top[1]}`

  // "Round of N" -> Top N
  const roundOf = t.match(/round\s+of\s*(\d+)/i)
  if (roundOf && roundOf[1]) return `Top ${roundOf[1]}`

  // Winners / Losers with optional round/number
  if (t.includes('winner')) {
    const n = (raw.match(/winners?[^0-9]*(?:round\s*(\d+))/i) || [])[1]
    return n ? `Winners · Round ${n}` : 'Winners'
  }
  if (t.includes('loser')) {
    const n = (raw.match(/losers?[^0-9]*(?:round\s*(\d+))/i) || [])[1]
    return n ? `Losers · Round ${n}` : 'Losers'
  }

  // Grand Final / GF
  if (t.includes('grand') && t.includes('final') || /\bgf\b/i.test(t)) return 'Grand Final'

  // Specific keywords: finals, semi, quarter
  if (t.includes('final')) return 'Finals'
  if (t.includes('semi')) return 'Semifinals'
  if (t.includes('quarter')) return 'Quarterfinals'

  // Generic numbered round (e.g., "Round 1")
  const r = raw.match(/round\s*(\d+)/i)
  if (r && r[1]) return `Round ${r[1]}`

  // Fallback to the raw value if nothing matched
  return raw
}

export default function Announcement({ participant, participants = null, details = {}, speed = 18, visible = true }) {
  if (!visible) return null
  const people = participants && Array.isArray(participants) ? participants : (participant ? [participant] : [])

  function renderMessageFor(p) {
    const id = p?.id
    const name = p?.name || '—'
    const det = (id && details && details[String(id)]) ? details[String(id)] : details || {}
    const roundRaw = det?.round || null
    const stage = categorizeRound(roundRaw)
    const opponentName = det?.opponentName || (det?.opponent && det.opponent.name) || null
    const scoreVal = det?.setScore ?? (det && (det.score ?? det.wins ?? null))
    let scoreStr = '—'
    if (typeof scoreVal === 'string' && scoreVal.trim()) scoreStr = scoreVal
    else if (typeof scoreVal === 'number') scoreStr = String(scoreVal)
    else if (det && (det.score !== undefined || det.opponentScore !== undefined)) {
      const a = (det.score != null) ? det.score : '—'
      const b = (det.opponentScore != null) ? det.opponentScore : '—'
      scoreStr = `${a}–${b}`
    }
    return opponentName ? `${name} vs ${opponentName} • ${stage} • ${scoreStr}` : `${name} • ${stage} • ${scoreStr}`
  }

  const messages = people.length > 0 ? people.map(p => renderMessageFor(p)) : ['Awaiting announcement…']

  // Build repeating items sequence of messages
  const repeats = 6
  const items = []
  for (let r = 0; r < repeats; r++) {
    for (let i = 0; i < messages.length; i++) {
      items.push(<span key={`${r}-${i}`} className="ticker__item">{messages[i]}</span>)
    }
  }

  // Adjust duration proportional to number of messages so added items don't make it too fast
  const messageCount = messages.length || 1
  // scale factor grows with message count, but keep within reasonable bounds
  const scale = Math.max(1, messageCount)
  const effectiveDuration = Math.min(240, Math.max(8, Math.round(speed * scale)))

  return (
    <div className="w-full">
      <div className="ticker">
        <div className="ticker__wrap" aria-hidden style={{ animationDuration: `${effectiveDuration}s` }}>
          {items}
        </div>
      </div>
      {people.length === 0 && (
        <div className="text-center text-white/60 mt-2">Awaiting announcement…</div>
      )}
    </div>
  )
}
