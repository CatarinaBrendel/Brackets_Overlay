import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Overlay from './Overlay'
import { fetchEventBySlug, fetchEventById, fetchEntrantsByEventId, fetchTournamentBySlug, fetchSetsByEventId, fetchEventDetails } from './api/startgg'
import './index.css'

function logSetsDiagnostics(sets) {
  try {
    if (!Array.isArray(sets)) {
      console.log('logSetsDiagnostics: sets is not an array', sets)
      return
    }
    const total = sets.length
    let withGames = 0
    let totalGames = 0
    let gamesWithWinner = 0
    for (const s of sets) {
      if (s && Array.isArray(s.games) && s.games.length > 0) {
        withGames++
        totalGames += s.games.length
        for (const g of s.games) {
          if (g && (g.winnerId !== undefined && g.winnerId !== null)) gamesWithWinner++
        }
      }
    }
    console.log(`logSetsDiagnostics: sets=${total} withGames=${withGames} totalGames=${totalGames} gamesWithWinner=${gamesWithWinner}`)
    const sample = sets.slice(0, 5).map(s => ({ id: s.id, games: Array.isArray(s.games) ? s.games.length : 0, winnerId: s.winnerId || null, slots: (s.slots || []).map(sl => ({ entrantId: sl?.entrant?.id || sl?.entrantId || null, entrantName: sl?.entrant?.name || null })) }))
    console.log('logSetsDiagnostics: sample sets', sample)
  } catch (e) {
    console.warn('logSetsDiagnostics failed', e)
  }
}

function OverlayApp() {
  const [event, setEvent] = useState(null)
  const [entrants, setEntrants] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [participantDetails, setParticipantDetails] = useState({})
  const [tournamentName, setTournamentName] = useState(null)
  const [error, setError] = useState(null)

  // initial load from query params (optional)
  useEffect(() => {
    let mounted = true
    const params = new URLSearchParams(window.location.search)
    const slug = params.get('slug')
    const eventId = params.get('eventId')
    const ids = params.get('ids')

    async function loadInitial() {
      try {
        if (eventId) {
          const ev = await fetchEventById(null, eventId)
          if (!mounted) return
          setEvent({ id: ev.id, name: ev.name })
          const nodes = ev.entrants?.nodes || ev.entrants || []
          setEntrants(nodes)
          // try to enrich participant details if possible
          try {
            const sets = await fetchSetsByEventId(null, eventId)
            const details = computeDetailsFromSets(sets)
            if (mounted) setParticipantDetails(details)
          } catch (e) {}
        } else if (slug) {
          // if slug looks like a tournament URL, do nothing here — control should push updates
          const ev = await fetchEventBySlug(null, slug)
          if (!mounted) return
          setEvent(ev)
          const nodes = await fetchEntrantsByEventId(null, ev.id)
          if (!mounted) return
          setEntrants(nodes)
        }

        if (ids) {
          const list = ids.split(',').filter(Boolean).map(String)
          setSelectedIds(list)
        }
      } catch (err) {
        if (mounted) setError(err.message)
      }
    }

    loadInitial()

    return () => { mounted = false }
  }, [])

  // Listen for BroadcastChannel updates from control
  useEffect(() => {
    const bc = new BroadcastChannel('startgg-overlay')
    console.log('Overlay: listening for startgg-overlay BroadcastChannel')
    let mounted = true
    bc.onmessage = async (ev) => {
      const msg = ev.data
      console.log('Overlay: received broadcast', msg)
      if (!msg || msg.type !== 'update') return

      try {
        setError(null)
        const ids = (msg.ids || []).map(String)

        // Helper to build baseline entrant map
        const buildBaseline = (nodes) => {
          const base = {}
          for (const n of (nodes || [])) {
            const pid = String(n.id)
            const p0 = (n.participants && n.participants[0]) || null
            base[pid] = {
              name: n.name || (p0 && (p0.gamerTag || p0.name)) || null,
              seed: n.seed || null,
              prefix: (p0 && (p0.prefix || null)) || null,
              tag: (p0 && (p0.gamerTag || null)) || null
            }
          }
          return base
        }

        // If control supplied participants, prefer that as the source of visible entrants
        if (msg.participants && Array.isArray(msg.participants)) {
          const mapped = msg.participants.map(p => ({ id: String(p.id), name: p.name }))
          console.log('Overlay: using participants from control', mapped)

          // If control supplied eventId, try to fetch full details to augment
          if (msg.eventId) {
            const details = await fetchEventDetails(null, msg.eventId)
            if (!mounted) return
            if (details) {
              setEvent({ id: details.id, name: details.name })
              const nodes = details.entrants?.nodes || details.entrants || []
              setEntrants(nodes)
              const sets = details.sets?.nodes || details.sets || []
              logSetsDiagnostics(sets)
              const computed = computeDetailsFromSets(sets)
              const merged = { ...buildBaseline(nodes), ...computed, ...(msg.participantDetails || {}) }
              const normalized = {}
              for (const k of Object.keys(merged)) {
                const v = merged[k] || {}
                normalized[k] = { ...v, score: v.score ?? 0, waves: v.waves ?? 0, round: v.round ?? null }
              }
              console.log('Overlay: merged participantDetails', normalized)
              setParticipantDetails(normalized)
              setSelectedIds(ids)
              return
            }
          }

          // If control supplied a slug, try to resolve event/tournament
          if (msg.slug) {
            if (msg.slug.includes('/tournament/')) {
              try {
                const parsed = new URL(msg.slug)
                const tslug = parsed.pathname.split('/tournament/')[1].split('/')[0]
                const t = await fetchTournamentBySlug(null, tslug)
                if (mounted) setTournamentName(t?.name || null)
              } catch (e) {
                // ignore
              }
            }

            if (msg.slug.includes('/event/')) {
              try {
                const details = await fetchEventDetails(null, msg.slug)
                if (!mounted) return
                if (details) {
                  setEvent({ id: details.id, name: details.name })
                  const nodes = details.entrants?.nodes || details.entrants || []
                  setEntrants(nodes)
                  const sets = details.sets?.nodes || details.sets || []
                  logSetsDiagnostics(sets)
                  const computed = computeDetailsFromSets(sets)
                  const merged = { ...buildBaseline(nodes), ...computed, ...(msg.participantDetails || {}) }
                  const normalized = {}
                  for (const k of Object.keys(merged)) {
                    const v = merged[k] || {}
                    normalized[k] = { ...v, score: v.score ?? 0, waves: v.waves ?? 0, round: v.round ?? null }
                  }
                  setParticipantDetails(normalized)
                  setSelectedIds(ids)
                  return
                }
              } catch (e) {
                console.log('Overlay: failed to fetch event by slug', e)
              }
            }
          }

          // Fallback: use provided participants and any provided participantDetails
          setEntrants(mapped)
          console.log('Overlay: using participantDetails from control', msg.participantDetails)
          setParticipantDetails(msg.participantDetails || {})
          setSelectedIds(ids)
          return
        }

        // No participants provided — attempt to fetch from eventId or slug
        if (msg.eventId) {
          const details = await fetchEventDetails(null, msg.eventId)
          if (!mounted) return
          if (details) {
            setEvent({ id: details.id, name: details.name })
            const nodes = details.entrants?.nodes || details.entrants || []
            setEntrants(nodes)
            const sets = details.sets?.nodes || details.sets || []
            logSetsDiagnostics(sets)
            const computed = computeDetailsFromSets(sets)
            const merged = { ...buildBaseline(nodes), ...computed }
            const normalized = {}
            for (const k of Object.keys(merged)) {
              const v = merged[k] || {}
              normalized[k] = { ...v, score: v.score ?? 0, waves: v.waves ?? 0, round: v.round ?? null }
            }
            setParticipantDetails(normalized)
            setSelectedIds(ids)
            return
          }
        }

        if (msg.slug) {
          if (msg.slug.includes('/tournament/')) {
            try {
              const parsed = new URL(msg.slug)
              const tslug = parsed.pathname.split('/tournament/')[1].split('/')[0]
              const t = await fetchTournamentBySlug(null, tslug)
              if (mounted) setTournamentName(t?.name || null)
            } catch (e) {
              // ignore
            }
          }

          if (msg.slug.includes('/event/')) {
            try {
              const details = await fetchEventDetails(null, msg.slug)
              if (!mounted) return
              if (details) {
                setEvent({ id: details.id, name: details.name })
                const nodes = details.entrants?.nodes || details.entrants || []
                setEntrants(nodes)
                const sets = details.sets?.nodes || details.sets || []
                logSetsDiagnostics(sets)
                const computed = computeDetailsFromSets(sets)
                const merged = { ...buildBaseline(nodes), ...computed }
                const normalized = {}
                for (const k of Object.keys(merged)) {
                  const v = merged[k] || {}
                  normalized[k] = { ...v, score: v.score ?? 0, waves: v.waves ?? 0, round: v.round ?? null }
                }
                setParticipantDetails(normalized)
                setSelectedIds(ids)
                return
              }
            } catch (e) {
              console.log('Overlay: failed to fetch event by slug', e)
            }
          }
        }

        // Default: just update selected ids
        if (mounted) setSelectedIds(ids)
      } catch (err) {
        if (mounted) setError(err.message)
      }
    }

    return () => { mounted = false; bc.close() }
  }, [])

  function computeDetailsFromSets(sets) {
    const byEntrant = {}
    const setsList = Array.isArray(sets) ? sets : (sets?.nodes || [])
    for (const s of setsList) {
      const setId = s.id
      const round = s.fullRoundText || (s.round && s.round.name) || null
      const gamesList = Array.isArray(s.games) ? s.games : (s.games && s.games.nodes) ? s.games.nodes : []
      const waves = gamesList.length
      const slotList = Array.isArray(s.slots) ? s.slots : (s.slots && s.slots.nodes) ? s.slots.nodes : []
      const slotEntrants = slotList.map(sl => String((sl && sl.entrant && sl.entrant.id) || sl.entrantId || sl.id))
      const winsBy = {}
      for (const g of gamesList) {
        const gg = g && (g.node || g) // handle item being wrapped
        let winnerId = null
        if (gg) {
          winnerId = gg.winnerId || (gg.winner && gg.winner.id) || (gg.winner && gg.winner.entrant && gg.winner.entrant.id) || (gg.winner && gg.winner.participant && gg.winner.participant.id) || (gg.winner && gg.winner.player && gg.winner.player.id) || null
        }
        if (!winnerId) continue
        winsBy[String(winnerId)] = (winsBy[String(winnerId)] || 0) + 1
      }
      // fallback: if no game-level winners but set-level winner exists, credit them one win
      if (Object.keys(winsBy).length === 0 && s.winnerId) {
        winsBy[String(s.winnerId)] = 1
      }
      for (const entId of slotEntrants) {
        const score = winsBy[String(entId)] || 0
        const prev = byEntrant[entId]
        if (!prev || String(setId) > String(prev.setId)) {
          byEntrant[entId] = { setId, round, waves, score }
        }
      }
    }
    return byEntrant
  }

  return (
    <div className="p-2">
      {error && <div className="text-red-400">{error}</div>}
      <Overlay event={event} entrants={entrants} selectedIds={selectedIds} tournamentName={tournamentName} participantDetails={participantDetails} />
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <OverlayApp />
)
