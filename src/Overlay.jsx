import React from 'react'

export default function Overlay({ event, entrants = [], selectedIds = [], tournamentName = null, participantDetails = {} }) {
  if (!event) return (
    <div className="w-full h-40 flex items-center justify-center text-white/60 border border-dashed border-white/20">
      No event loaded — overlay will display here
    </div>
  )

  const selected = (selectedIds && selectedIds.length > 0)
    ? entrants.filter(e => selectedIds.includes(String(e.id)))
    : []

  return (
    <div className="w-full h-40 relative text-white">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="bg-black/30 backdrop-blur-sm rounded-lg px-6 py-3">
          {tournamentName && <div className="text-sm text-gray-300">{tournamentName}</div>}
          <div className="text-2xl font-extrabold">{event.name}</div>
          <div className="text-sm text-gray-200 mt-1">{entrants.length} participants</div>
          {selected.length > 0 && (
            <div className="mt-3 grid grid-flow-col auto-cols-max gap-3 items-center justify-center">
              {selected.map(s => {
                const det = participantDetails[String(s.id)] || {}
                function getScore(d) {
                  if (d == null) return '—'
                  const candidates = [d.score, d.wins, d.gameWins, d.gamesWon, d.setScore]
                  for (const c of candidates) if (typeof c === 'number') return c
                  // try nested shapes
                  if (Array.isArray(d.games)) {
                    const wins = d.games.reduce((acc, g) => {
                      const gg = g && (g.node || g)
                      const winner = gg && (gg.winnerId || (gg.winner && gg.winner.id))
                      return acc + (winner && String(winner) === String(s.id) ? 1 : 0)
                    }, 0)
                    return wins || '—'
                  }
                  return '—'
                }

                return (
                  <div key={s.id} className="bg-black/60 px-3 py-2 rounded-lg text-center min-w-[120px]">
                    <div className="font-bold text-lg">{s.name}</div>
                    <div className="text-xs text-white/80">{det.round || '—'}</div>
                    <div className="flex gap-2 justify-center mt-1 text-sm">
                      <div className="text-white/90">W:{det.waves ?? '—'}</div>
                      <div className="text-white/90">S:{getScore(det)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
