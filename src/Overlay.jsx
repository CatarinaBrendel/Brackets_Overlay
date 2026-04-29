import React, { useState, useEffect, useMemo } from 'react'

function computeScore(d, sId) {
  if (d == null) return '—'
  const candidates = [d.score, d.wins, d.gameWins, d.gamesWon, d.setScore]
  for (const c of candidates) if (typeof c === 'number') return c
  if (Array.isArray(d.games)) {
    const wins = d.games.reduce((acc, g) => {
      const gg = g && (g.node || g)
      const winner = gg && (gg.winnerId || (gg.winner && gg.winner.id))
      return acc + (winner && String(winner) === String(sId) ? 1 : 0)
    }, 0)
    return wins || '—'
  }
  return '—'
}

function Overlay({ event, entrants = [], selectedIds = [], tournamentName = null, participantDetails = {} }) {
  const selected = useMemo(() => {
    if (!selectedIds || !selectedIds.length) return []
    const set = new Set(selectedIds.map(String))
    return (entrants || []).filter(e => set.has(String(e.id)))
  }, [entrants, selectedIds])

  const [openMap, setOpenMap] = useState({})

  // When `selectedIds` changes, ensure openMap has entries for them (default collapsed).
  useEffect(() => {
    if (!Array.isArray(selectedIds)) return
    setOpenMap(prev => {
      const next = { ...prev }
      let changed = false
      for (const id of selectedIds) {
        if (!(id in next)) { next[id] = false; changed = true }
      }
      return changed ? next : prev
    })
  }, [selectedIds])

  function toggleOpen(id) {
    setOpenMap(prev => ({ ...prev, [id]: !prev[id] }))
  }

  if (!event) return (
    <div className="w-full h-40 flex items-center justify-center text-white/60 border border-dashed border-white/20">
      No event loaded — overlay will display here
    </div>
  )

  return (
    <div className="w-screen max-w-full text-white px-4">
      <div className="absolute inset-x-0 flex flex-col items-start justify-center">
        <div className="bg-black/30 backdrop-blur-sm rounded-lg px-6 py-3 w-full max-w-8xl mx-auto mb-16">
          <div className="w-full flex items-center justify-between gap-4">
            <div className="flex flex-col min-w-0">
              {tournamentName && <div className="text-sm text-gray-300 truncate">{tournamentName}</div>}
              <div className="text-4xl font-extrabold truncate">{event.name}</div>
            </div>

            <div className="text-gray-200 text-right ml-4 mr-16">{(event && event.entrantsCount) || entrants.length} participants</div>
          </div>
        </div>
        {selected.length > 0 && (
          <div className="mt-3 w-full mx-auto flex flex-col gap-3">
              {selected.map(s => {
                const det = participantDetails[String(s.id)] || {}
                const isOpen = !!openMap[s.id]

                return (
                  <div key={s.id} className="w-full bg-black/60 px-3 py-2 rounded-lg">
                    <div className="w-full flex flex-row items-center justify-between gap-4">
                      <div className="flex flex-col items-start">
                        <div className="font-bold text-4xl">{s.name}</div>
                        <div className="text-lg text-white/80">{det.round || '—'}</div>
                      </div>

                      <div className="flex items-center gap-3">
                          <div className="flex flex-col items-end">
                          <div className="text-white/90">W: {det.waves ?? '—'}</div>
                          <div className="text-white/90">S: {computeScore(det, s.id)}</div>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); toggleOpen(s.id) }} className="text-gray-300 hover:text-white ml-2">{isOpen ? '▾' : '▸'}</button>
                      </div>
                    </div>

                    {isOpen && Array.isArray(det.sets) && det.sets.length > 0 && (
                      <div className="mt-2 text-lg text-left text-white/70 max-h-36 overflow-auto w-full pr-4">
                        {det.sets.map((st, idx) => (
                          <div key={st.setId || idx} className="py-1 border-t border-white/10">
                            <div className="flex justify-between">
                              <div>{st.round || 'Match'}</div>
                              <div className="font-mono">{st.setScore || `${st.score}–${st.opponentScore}`}</div>
                            </div>
                            <div className="text-[14px] mt-0.5">Games: {st.waves ?? 0} · {st.startedAt ? new Date(st.startedAt).toLocaleString() : (st.completedAt ? new Date(st.completedAt).toLocaleString() : '')}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
      </div>
    </div>
  )
}

export default Overlay
