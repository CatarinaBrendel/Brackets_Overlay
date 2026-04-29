import React, { useState, useRef } from 'react'
import { fetchTournamentBySlug, fetchEvent, fetchEntrantsByEventId, fetchEventBySlug } from './api/startgg'
 

export default function App() {
  const [input, setInput] = useState('')
  const [event, setEvent] = useState(null)
  const [events, setEvents] = useState([])
  const [selectedEventId, setSelectedEventId] = useState(null)
  const [entrants, setEntrants] = useState([])
  const [participantDetails, setParticipantDetails] = useState({})
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [announcementIds, setAnnouncementIds] = useState([])
  const [tournamentName, setTournamentName] = useState(null)
  const [announcementSpeed, setAnnouncementSpeed] = useState(18)
  const speedBroadcastRef = useRef(null)
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
        // parsed.id is an event slug (from URL). Resolve the event by slug, then load entrants/sets by event id.
        try {
          const ev = await fetchEventBySlug(null, parsed.id)
          if (ev) {
            setEvent(ev)
            setTournamentName(ev.tournament?.name || null)
            const nodes = await fetchEntrantsByEventId(null, ev.id)
            setEntrants(nodes)
            try {
              const sets = await (await import('./api/startgg')).fetchSetsByEventId(null, ev.id)
              enrichParticipants(nodes, sets)
            } catch (e) {}
            // inform overlay to load headers for this event
            try {
              const bc = new BroadcastChannel('startgg-overlay')
              bc.postMessage({ type: 'load-headers', tournamentName: ev.tournament?.name || null, event: { id: ev.id, name: ev.name }, slug: val })
              bc.close()
            } catch (e) {}
          }
        } catch (e) {
          // fall back to previous behaviour: try loading entrants directly
          try {
            const nodes = await fetchEntrantsByEventId(null, parsed.id)
            setEntrants(nodes)
            try {
              const sets = await (await import('./api/startgg')).fetchSetsByEventId(null, parsed.id)
              enrichParticipants(nodes, sets)
            } catch (e) {}
          } catch (err) {
            console.warn('Failed to resolve event by slug or id', err && err.message)
          }
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
          // inform overlay to load headers for this tournament + event
          setTournamentName(tournament?.name || null)
          try {
            const bc = new BroadcastChannel('startgg-overlay')
            bc.postMessage({ type: 'load-headers', tournamentName: tournament?.name || null, event: { id: e.id, name: e.name }, slug: val })
            bc.close()
          } catch (e) {}
        }
        setLoading(false)
        return
      }

      // Fallback: try event by slug
      const e = await fetchEventBySlug(null, val)
      if (e) {
        setEvent(e)
        setTournamentName(e.tournament?.name || null)
        const nodes = await fetchEntrantsByEventId(null, e.id)
        setEntrants(nodes)
        try {
          const sets = await (await import('./api/startgg')).fetchSetsByEventId(null, e.id)
          enrichParticipants(nodes, sets)
        } catch (err) {}
        // inform overlay to load headers for this event
        try {
          const bc = new BroadcastChannel('startgg-overlay')
          bc.postMessage({ type: 'load-headers', tournamentName: e.tournament?.name || null, event: { id: e.id, name: e.name }, slug: val })
          bc.close()
        } catch (e) {}
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
    // Map entrantId -> latest set info (defensive and team-aware)
    const byEntrant = {}
    const setsList = Array.isArray(sets) ? sets : (sets?.nodes || [])
    for (const s of setsList) {
      const setId = s?.id
      const round = s?.phaseGroup?.name || s?.round?.name || s?.fullRoundText || null
      const gamesList = Array.isArray(s?.games) ? s.games : (s?.games && s.games.nodes) ? s.games.nodes : []
      const waves = gamesList.length

      const slotList = Array.isArray(s?.slots) ? s.slots : (s?.slots && s.slots.nodes) ? s.slots.nodes : []
      const slotEntrants = slotList.map(sl => String((sl && sl.entrant && sl.entrant.id) || sl.entrantId || sl.id))
      const slotNames = {}
      for (const sl of slotList) {
        const pid = String((sl && sl.entrant && sl.entrant.id) || sl.entrantId || sl.id)
        const pname = (sl && sl.entrant && (sl.entrant.name || (sl.entrant.participants && sl.entrant.participants.map(p=>p.gamerTag||p.name).filter(Boolean).join(', ')))) || sl.name || null
        if (pid) slotNames[pid] = pname
      }

      const winsBy = {}
      for (const g of gamesList) {
        const gg = g?.node || g
        if (!gg) continue
        const winner = gg.winnerId || gg.winner?.id || gg.winner?.entrant?.id || gg.winner?.participant?.id || gg.winner?.player?.id || gg.winner?.entrantId || null
        if (!winner) continue
        winsBy[String(winner)] = (winsBy[String(winner)] || 0) + 1
      }
      if (Object.keys(winsBy).length === 0 && (s && (s.winnerId || s.winner?.id))) {
        const w = String(s.winnerId || (s.winner && s.winner.id))
        winsBy[w] = (winsBy[w] || 0) + 1
      }

      for (const entId of slotEntrants) {
        const score = winsBy[String(entId)] || 0
        const opponentIds = slotEntrants.filter(id => String(id) !== String(entId))
        const opponentScore = opponentIds.reduce((acc, oid) => acc + (winsBy[String(oid)] || 0), 0)
        const opponentName = opponentIds.map(id => slotNames[id] || null).filter(Boolean).join(', ') || null
        const setScore = `${score}–${opponentScore}`

        const prev = byEntrant[entId]
        const candidate = { setId, round, waves, score, opponentIds, opponentId: opponentIds[0] || null, opponentName, opponentScore, setScore, name: slotNames[entId] || null, startedAt: s?.startedAt, completedAt: s?.completedAt }
        function isNewer(a, b) {
          if (!a) return true
          if (!b) return false
          const aTime = a.completedAt || a.startedAt || a.setId
          const bTime = b.completedAt || b.startedAt || b.setId
          return String(bTime) > String(aTime)
        }
        if (!prev || isNewer(prev, candidate)) {
          byEntrant[entId] = candidate
        }
      }
    }
    setParticipantDetails(byEntrant)
  }

  return (
    <div className="control-shell">
      <div className="control-panel text-white">
        <div className="control-header mb-4">
          <div className="control-title">StartGG Control</div>
          <div className="ml-auto muted">Control panel · Live preview</div>
        </div>
        <div className="control-grid">
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

        {/* Select Event - prefer listing fetched events, otherwise show resolved event */}
        {((events && events.length > 0) || event) && (
          <div className="mt-2">
            <label className="block">Select Event
              <select className="w-full mt-1 p-2 text-black rounded" value={selectedEventId|| (event && event.id) || ''} onChange={e=>handleSelectEvent(e.target.value)}>
                <option value="">-- choose event --</option>
                {(events && events.length > 0 ? events : (event ? [event] : [])).map(ev=> <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select>
            </label>
          </div>
        )}

        {loading && <div className="mt-2 text-sm text-white/70">Loading entrants…</div>}
        {!loading && entrants && entrants.length > 0 && (
          <div className="mt-2">
            <label className="block">Search Participant for the Brackets Overlay
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
                participantDetails: details,
                totalEntrants: entrants.length
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

            <div className="mt-3 bg-black/30 p-3 rounded">
        <h3 className="text-sm mb-2">Announcement (Ticker)</h3>
        <div className="mt-2 mb-2 flex items-center gap-3">
          <label className="text-sm">Speed</label>
          <input id="announcement-speed" type="range" min="8" max="40" value={announcementSpeed} onChange={e=>{
              const v = Number(e.target.value)
              setAnnouncementSpeed(v)
              // debounce broadcast so sliding isn't noisy
              if (!speedBroadcastRef.current) speedBroadcastRef.current = { tid: null }
              if (speedBroadcastRef.current.tid) clearTimeout(speedBroadcastRef.current.tid)
              speedBroadcastRef.current.tid = setTimeout(() => {
                try {
                  const bc = new BroadcastChannel('startgg-overlay')
                  const pids = announcementIds || []
                  const participants = pids.map(pid => entrants.find(e=>String(e.id)===String(pid)) || { id: pid, name: '' }).map(p => ({ id: String(p.id), name: p.name }))
                  const details = {}
                  for (const id of pids) {
                    const key = String(id)
                    if (participantDetails[key]) details[key] = participantDetails[key]
                  }
                  const payload = { type: 'announcement-speed', announcementSpeed: v, participants, participantDetails: details, eventId: selectedEventId || (event && event.id) || null, slug: input && input.includes('start.gg') ? input : null }
                  bc.postMessage(payload)
                  bc.close()
                } catch (err) {
                  console.log('Failed to broadcast announcement speed', err)
                }
              }, 150)
            }} />
          <div className="text-sm">{announcementSpeed}s</div>
        </div>
        <label className="block">Select player(s) for Announcement Overlay
          <select multiple size={6} value={announcementIds} onChange={e=>{
              const opts = Array.from(e.target.options).filter(o=>o.selected).map(o=>o.value)
              setAnnouncementIds(opts)
            }} className="w-full mt-1 p-2 rounded text-black">
            {entrants.map(en => <option key={en.id} value={en.id}>{en.name}</option>)}
          </select>
        </label>
        <div className="mt-2">
          <button className="bg-orange-600 px-4 py-2 rounded" onClick={() => {
            try {
              const bc = new BroadcastChannel('startgg-overlay')
              const pids = announcementIds || []
              if (!pids || pids.length === 0) { console.log('No announcement participant selected'); return }
              const participants = pids.map(pid => entrants.find(e=>String(e.id)===String(pid)) || { id: pid, name: '' }).map(p => ({ id: String(p.id), name: p.name }))
              const details = {}
              for (const id of pids) {
                const key = String(id)
                if (participantDetails[key]) details[key] = participantDetails[key]
              }

              const payload = {
                type: 'announcement',
                participants,
                participantDetails: details,
                announcementSpeed: announcementSpeed,
                eventId: selectedEventId || (event && event.id) || null,
                slug: input && input.includes('start.gg') ? input : null
              }
              console.log('Control: broadcasting announcement', payload)
              bc.postMessage(payload)
              bc.close()
            } catch (err) {
              console.log('Failed to send announcement: ' + err.message)
            }
          }}>Send Announcement</button>
        </div>
          </div>
          <aside className="control-side">
            <div className="bg-black/20 p-3 rounded muted text-sm">Overlay status: {overlayStatus ?? 'idle'}</div>
          </aside>
        </div>
      </div>
      </div>
    </div>
  )
}
