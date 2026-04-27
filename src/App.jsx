import React, { useState } from 'react'
import { fetchTournamentBySlug, fetchEvent, fetchEntrantsByEventId, fetchEventBySlug } from './api/startgg'
import Overlay from './Overlay'

export default function App() {
  const [input, setInput] = useState('')
  const [event, setEvent] = useState(null)
  const [events, setEvents] = useState([])
  const [selectedEventId, setSelectedEventId] = useState(null)
  const [entrants, setEntrants] = useState([])
  const [participantDetails, setParticipantDetails] = useState({})
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [overlayBusy, setOverlayBusy] = useState(false)
  const [overlayStatus, setOverlayStatus] = useState(null)
  function parseSlugFromUrl(value) {
    try {
      const u = new URL(value)
      const p = u.pathname
      if (p.includes('/tournament/')) return { type: 'tournament', slug: p.split('/tournament/')[1].split('/')[0] }
      if (p.includes('/event/')) return { type: 'event', id: p.split('/event/')[1].split('/')[0] }
      return { type: 'unknown', raw: value }
    } catch (e) {
      return { type: 'unknown', raw: value }
    }
  }
  async function handleFetch() {
    setError(null)
    setLoading(true)
    setEvents([])
    setEntrants([])
    setSelectedEventId(null)
    setEvent(null)
    const val = input.trim()
    if (!val) { setError('Enter a tournament/event slug or URL'); setLoading(false); return }

    try {
      const parsed = parseSlugFromUrl(val)

      if (parsed.type === 'event' && parsed.id) {
        const nodes = await fetchEntrantsByEventId(null, parsed.id)
        setEntrants(nodes)
        // fetch sets to enrich participants
        try {
          const sets = await (await import('./api/startgg')).fetchSetsByEventId(null, parsed.id)
          enrichParticipants(nodes, sets)
        } catch (e) {
          // ignore enrichment errors
        }
        setLoading(false)
        return
      }

      // Try tournament by slug first
      const slug = parsed.type === 'tournament' ? parsed.slug : val
      const tournament = await fetchTournamentBySlug(null, slug)
      const evs = (tournament && (tournament.events?.nodes || tournament.events)) || []
      if (evs.length > 0) {
        setEvents(evs)
        if (evs.length === 1) {
          const e = evs[0]
          setSelectedEventId(e.id)
          const nodes = await fetchEntrantsByEventId(null, e.id)
          setEntrants(nodes)
          try {
            const sets = await (await import('./api/startgg')).fetchSetsByEventId(null, e.id)
            enrichParticipants(nodes, sets)
          } catch (e) {}
        }
        setLoading(false)
        return
      }

      // Fallback: try event by slug
      const e = await fetchEventBySlug(null, val)
      if (e) {
        setEvent(e)
        const nodes = await fetchEntrantsByEventId(null, e.id)
        setEntrants(nodes)
        try {
          const sets = await (await import('./api/startgg')).fetchSetsByEventId(null, e.id)
          enrichParticipants(nodes, sets)
        } catch (err) {}
      } else {
        setError('No tournament or event found for that slug/URL')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectEvent(evId) {
    setSelectedEventId(evId)
    setEntrants([])
    setError(null)
    setLoading(true)
    try {
      const nodes = await fetchEntrantsByEventId(null, evId)
      setEntrants(nodes)
      try {
        const sets = await (await import('./api/startgg')).fetchSetsByEventId(null, evId)
        enrichParticipants(nodes, sets)
      } catch (e) {}
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function enrichParticipants(nodes, sets) {
    // Map entrantId -> latest set info (best-effort)
    const byEntrant = {}
    const setsList = Array.isArray(sets) ? sets : (sets?.nodes || [])
    for (const s of setsList) {
      const setId = s.id
      const round = s.fullRoundText || (s.round && s.round.name) || null
      const gamesList = Array.isArray(s.games) ? s.games : (s.games && s.games.nodes) ? s.games.nodes : []
      const waves = gamesList.length
      // Collect entrant ids in this set
      const slotList = Array.isArray(s.slots) ? s.slots : (s.slots && s.slots.nodes) ? s.slots.nodes : []
      const slotEntrants = slotList.map(sl => String((sl && sl.entrant && sl.entrant.id) || sl.entrantId || sl.id))
      // compute per-entrant score by counting game wins
      const winsBy = {}
      for (const g of gamesList) {
        const gg = g && (g.node || g)
        let winnerId = null
        if (gg) {
          winnerId = gg.winnerId || (gg.winner && gg.winner.id) || (gg.winner && gg.winner.entrant && gg.winner.entrant.id) || (gg.winner && gg.winner.participant && gg.winner.participant.id) || (gg.winner && gg.winner.player && gg.winner.player.id) || null
        }
        if (!winnerId) continue
        winsBy[String(winnerId)] = (winsBy[String(winnerId)] || 0) + 1
      }
      if (Object.keys(winsBy).length === 0 && s.winnerId) {
        winsBy[String(s.winnerId)] = 1
      }
      for (const entId of slotEntrants) {
        const score = winsBy[String(entId)] || 0
        const prev = byEntrant[entId]
        // prefer later sets (string compare may work if ids are numeric strings)
        if (!prev || String(setId) > String(prev.setId)) {
          byEntrant[entId] = { setId, round, waves, score }
        }
      }
    }
    setParticipantDetails(byEntrant)
  }

  return (
    <div className="p-4 text-white">
      <div className="mb-4 bg-black/50 p-4 rounded">
        <label className="block mt-2">Tournament or Event (slug or full URL)
          <input value={input} onChange={e=>setInput(e.target.value)} className="w-full mt-1 p-2 rounded text-black" placeholder="e.g. my-tournament-2026 or https://start.gg/tournament/...?" />
        </label>
        <div className="mt-3">
          <button disabled={loading} className="bg-blue-600 px-4 py-2 rounded" onClick={handleFetch}>{loading ? 'Loading...' : 'Fetch'}</button>
        </div>
        {error && <div className="mt-2 text-red-400">{error}</div>}
      </div>

      <div className="mt-6 bg-black/40 p-4 rounded">
        <h2 className="text-lg">Event / Entrants ({entrants?.length ?? 0})</h2>
        {events && events.length > 1 && (
          <div className="mt-2">
            <label className="block">Select Event
              <select className="w-full mt-1 p-2 text-black rounded" value={selectedEventId||''} onChange={e=>handleSelectEvent(e.target.value)}>
                <option value="">-- choose event --</option>
                {events.map(ev=> <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select>
            </label>
          </div>
        )}

        {loading && <div className="mt-2 text-sm text-white/70">Loading entrants…</div>}
        {!loading && entrants && entrants.length > 0 && (
          <div className="mt-2">
            <label className="block">Search participants
              <input value={search} onChange={e=>setSearch(e.target.value)} className="w-full mt-1 p-2 rounded text-black" placeholder="Search by name" />
            </label>
          </div>
        )}

        {!loading && entrants && entrants.length > 0 ? (
          <div className="mt-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-white/80">Total participants: {entrants.length}</div>
              <div className="text-sm text-white/80">Selected: {selectedIds.length}</div>
            </div>

            <div className="mt-2 flex gap-2">
              <button className="bg-gray-600 px-3 py-1 rounded text-sm" onClick={()=>setSelectedIds(entrants.map(e=>e.id))}>Select all</button>
              <button className="bg-gray-600 px-3 py-1 rounded text-sm" onClick={()=>setSelectedIds([])}>Clear</button>
            </div>

            <div className="max-h-80 overflow-auto bg-black/20 p-2 rounded mt-2">
              <ul>
                {(
                  (search && search.trim())
                    ? entrants.filter(en => (en.name || '').toLowerCase().includes(search.toLowerCase()))
                    : entrants
                ).map(en => (
                  <li key={en.id} className="py-1 flex items-center gap-2">
                    <input type="checkbox" className="w-4 h-4" checked={selectedIds.includes(en.id)} onChange={() => setSelectedIds(prev => prev.includes(en.id) ? prev.filter(id=>id!==en.id) : [...prev, en.id])} />
                    <span>{en.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (!loading && (
          <div className="mt-2 text-sm text-white/70">No entrants loaded</div>
        ))}
      </div>
      <div className="mt-4">
        <button
            className={`bg-green-600 px-4 py-2 rounded ${overlayBusy ? 'bg-gray-500 cursor-not-allowed' : 'hover:brightness-110 cursor-pointer'} transition transform duration-150 active:scale-95 active:translate-y-1 focus:outline-none focus:ring-2 focus:ring-green-400`}
          onClick={() => {
            try {
              const bc = new BroadcastChannel('startgg-overlay')
              // include minimal participant info and any computed details for overlay
              const participants = entrants
                .filter(e => selectedIds.includes(e.id))
                .map(e => ({ id: String(e.id), name: e.name }))
              const details = {}
              for (const id of selectedIds) {
                const key = String(id)
                if (participantDetails[key]) details[key] = participantDetails[key]
              }
              const payload = {
                type: 'update',
                eventId: selectedEventId || (event && event.id) || null,
                ids: (selectedIds || []).map(String),
                slug: input && input.includes('start.gg') ? input : null,
                participants,
                participantDetails: details
              }
              console.log('Control: broadcasting payload to overlay', payload)
              bc.postMessage(payload)
              bc.close()
            } catch (err) {
              console.log('Failed to send overlay update: ' + err.message)
            }
          }}
        >
          Update Overlay
        </button>
      </div>
    </div>
  )
}
