import React, { useEffect, useState, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import Announcement from './Announcement'
import './index.css'

function AnnouncementApp() {
  const [participants, setParticipants] = useState([])
  const [details, setDetails] = useState({})
  const [renderPayload, setRenderPayload] = useState(null)
  const pollRef = useRef({ timerId: null, lastParticipantIds: null })
  const [visible, setVisible] = useState(false)
  const cycleRef = useRef({ hideTimer: null, showTimer: null })
  const [announcementSpeed, setAnnouncementSpeed] = useState(18)

  // helper: compute details from sets (same logic as overlay)
  function computeDetailsFromSets(sets) {
    const byEntrant = {}
    const setsList = Array.isArray(sets) ? sets : (sets?.nodes || [])
    for (const s of setsList) {
      const setId = s?.id
      const round = s?.phaseGroup?.name || s?.round?.name || s?.fullRoundText || null
      const gamesList = Array.isArray(s?.games) ? s.games : (s?.games && s.games.nodes) ? s.games.nodes : []
      const slotList = Array.isArray(s?.slots) ? s.slots : (s?.slots && s.slots.nodes) ? s.slots.nodes : []
      const slotEntrants = slotList.map(sl => String((sl && sl.entrant && sl.entrant.id) || sl.entrantId || sl.id))
      const slotNames = {}
      for (const sl of slotList) {
        const pid = String((sl && sl.entrant && sl.entrant.id) || sl.entrantId || sl.id)
        const pname = (sl && sl.entrant && (sl.entrant.name || (sl.entrant.participants && sl.entrant.participants.map(p => p.gamerTag || p.name).filter(Boolean).join(', ')))) || sl.name || null
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
        const candidate = { setId, round, score, opponentIds, opponentId: opponentIds[0] || null, opponentName, opponentScore, setScore, name: slotNames[entId] || null, startedAt: s?.startedAt, completedAt: s?.completedAt }
        function isNewer(a, b) {
          if (!a) return true
          if (!b) return false
          const aTime = a.completedAt || a.startedAt || a.setId
          const bTime = b.completedAt || b.startedAt || b.setId
          return String(bTime) > String(aTime)
        }
        if (!prev || isNewer(prev, candidate)) byEntrant[entId] = candidate
      }
    }
    return byEntrant
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const slug = params.get('slug')
    const eventId = params.get('eventId')
    const pid = params.get('participantId')

    let mounted = true
    const bc = new BroadcastChannel('startgg-overlay')

    function clearCycleTimers() {
      try {
        if (cycleRef.current.hideTimer) clearTimeout(cycleRef.current.hideTimer)
        if (cycleRef.current.showTimer) clearTimeout(cycleRef.current.showTimer)
      } catch (e) {}
      cycleRef.current.hideTimer = null
      cycleRef.current.showTimer = null
    }

    async function startAnnouncementLoop() {
      clearCycleTimers()
      // try to fetch latest details before showing so content appears immediately
      let finalPayload = null
      try {
        const lastEid = pollRef.current.lastEventId
        const lastPids = pollRef.current.lastParticipantIds ? pollRef.current.lastParticipantIds.split(',') : null
        let pdMap = {}
        if (lastEid && lastPids && lastPids.length > 0) {
          pdMap = await pollForParticipants(lastEid, lastPids) || {}
        }
        if (lastPids && lastPids.length > 0) {
          const payloadParticipants = lastPids.map(id => {
            const p = participants.find(pp => String(pp.id) === String(id))
            return p ? { id: String(p.id), name: p.name } : { id: String(id), name: (pdMap[String(id)] && pdMap[String(id)].name) || '' }
          })
          // only show if we have usable content (names or fetched details)
          const hasNames = payloadParticipants.some(pp => pp.name && String(pp.name).trim())
          const hasDetails = Object.keys(pdMap || {}).length > 0
          let shouldShow = hasNames || hasDetails
          // if not ready, retry a few times (short delay) to allow fetch to complete
          if (!shouldShow && lastEid && lastPids && lastPids.length > 0) {
            const wait = ms => new Promise(r => setTimeout(r, ms))
            for (let attempt = 0; attempt < 6 && !shouldShow && mounted; attempt++) {
              await wait(500)
              pdMap = await pollForParticipants(lastEid, lastPids) || {}
              const refreshedNames = payloadParticipants.some(pp => pp.name && String(pp.name).trim())
              const refreshedDetails = Object.keys(pdMap || {}).length > 0
              shouldShow = refreshedNames || refreshedDetails
            }
          }
          if (shouldShow) finalPayload = { participants: payloadParticipants, details: pdMap }
          else finalPayload = null
        } else {
          finalPayload = null
        }
      } catch (e) {
        // ignore fetch errors and still skip
        finalPayload = null
      }

      // only show when finalPayload has content
      if (finalPayload && ((finalPayload.participants && finalPayload.participants.length > 0) || (finalPayload.details && Object.keys(finalPayload.details).length > 0))) {
        setRenderPayload(finalPayload)
        setVisible(true)
        // hide after 60s
        cycleRef.current.hideTimer = setTimeout(() => {
          setVisible(false)
          // clear render payload so bg won't pop with stale content
          setRenderPayload(null)
          // show again after 3 minutes (180s)
          cycleRef.current.showTimer = setTimeout(() => {
            // restart the loop
            if (!mounted) return
            void startAnnouncementLoop()
          }, 180000)
        }, 60000)
      } else {
        // skip showing this cycle; schedule next show attempt after 3 minutes
        setRenderPayload(null)
        cycleRef.current.showTimer = setTimeout(() => {
          if (!mounted) return
          void startAnnouncementLoop()
        }, 180000)
      }
    }

    async function pollForParticipants(eid, participantIds) {
      try {
        const sets = await (await import('./api/startgg')).fetchSetsByEventId(null, eid)
        const computed = computeDetailsFromSets(sets)
        const pdMap = {}
        for (const id of participantIds) {
          if (computed[String(id)]) pdMap[String(id)] = computed[String(id)]
        }
        if (mounted && Object.keys(pdMap).length > 0) {
          setDetails(prev => ({ ...prev, ...pdMap }))
        }
        return pdMap
      } catch (e) {
        console.log('pollForParticipants failed', e)
        return {}
      }
    }

    bc.onmessage = (ev) => {
      const msg = ev.data
      if (!msg) return
      if (msg.type === 'announcement-speed') {
        if (msg.announcementSpeed) setAnnouncementSpeed(Number(msg.announcementSpeed) || 18)
        if (msg.participants && Array.isArray(msg.participants)) {
          setParticipants(msg.participants.map(p => ({ id: String(p.id), name: p.name })))
        }
        if (msg.participantDetails) setDetails(msg.participantDetails || {})
        return
      }

        if (msg.type === 'announcement') {
        const baseMap = msg.participantDetails || {}
        if (msg.participants && Array.isArray(msg.participants)) {
          setParticipants(msg.participants.map(p => ({ id: String(p.id), name: p.name })))
          setDetails(baseMap)
          if (msg.announcementSpeed) setAnnouncementSpeed(Number(msg.announcementSpeed) || 18)
            // start visibility loop
            void startAnnouncementLoop()
        } else if (msg.participant) {
          setParticipants([{ id: String(msg.participant.id), name: msg.participant.name }])
          setDetails(baseMap)
          if (msg.announcementSpeed) setAnnouncementSpeed(Number(msg.announcementSpeed) || 18)
            void startAnnouncementLoop()
        }

        const pids = (msg.participants && msg.participants.map(p => String(p.id))) || (msg.participant && [String(msg.participant.id)]) || []
        const announcedEventId = msg.eventId
        const announcedSlug = msg.slug
        if ((announcedEventId || announcedSlug) && pids.length > 0) {
          ;(async () => {
            try {
              let eid = announcedEventId
              if (!eid && announcedSlug) {
                const ev = await (await import('./api/startgg')).fetchEventBySlug(null, announcedSlug)
                eid = ev && ev.id
              }
              if (!eid) return
              const sets = await (await import('./api/startgg')).fetchSetsByEventId(null, eid)
              const computed = computeDetailsFromSets(sets)
              const pdMap = {}
              for (const id of pids) {
                if (computed[String(id)]) pdMap[String(id)] = computed[String(id)]
              }
              if (Object.keys(pdMap).length > 0) {
                setDetails(prev => ({ ...prev, ...pdMap }))
                setParticipants(prev => prev.map(p => ({ ...p, name: (pdMap[p.id] && pdMap[p.id].name) || p.name })))
                if (pollRef.current.timerId) clearInterval(pollRef.current.timerId)
                pollRef.current.lastParticipantIds = pids.join(',')
                pollRef.current.lastEventId = eid
                const id = setInterval(() => pollForParticipants(eid, pids), 60000)
                pollRef.current.timerId = id
                // ensure announcement visibility loop is running
                void startAnnouncementLoop()
              }
            } catch (e) {
              console.log('announcement: failed to resolve event sets', e)
            }
          })()
        }
      }

      if (msg.type === 'update' && msg.eventId && Array.isArray(msg.ids) && msg.ids.length > 0) {
        // if control sent an update and we are showing participants that intersect, refresh
        const showingIds = participants.map(p => String(p.id))
        const intersect = msg.ids.map(String).filter(id => showingIds.includes(id))
        if (intersect.length > 0) {
          const eid = msg.eventId
          pollForParticipants(eid, intersect)
        }
      }
    }

    // initial load from query params
    if (eventId && pid) {
      ;(async () => {
        try {
          const sets = await (await import('./api/startgg')).fetchSetsByEventId(null, eventId)
          const computed = computeDetailsFromSets(sets)
          const pd = computed[String(pid)] || null
          if (mounted && pd) {
            setParticipants([{ id: String(pid), name: pd.name || null }])
            setDetails(prev => ({ ...prev, [String(pid)]: pd }))
            void startAnnouncementLoop()
          }
            const id = setInterval(() => {
              if (!mounted) return
              pollForParticipants(eventId, [pid])
            }, 60000)
            pollRef.current.timerId = id
            pollRef.current.lastEventId = eventId
            pollRef.current.lastParticipantIds = String(pid)
        } catch (e) {
          console.log('announcement initial load failed', e)
        }
      })()
    } else if (slug && pid) {
      ;(async () => {
        try {
          const ev = await (await import('./api/startgg')).fetchEventBySlug(null, slug)
          if (ev && ev.id) {
            const sets = await (await import('./api/startgg')).fetchSetsByEventId(null, ev.id)
            const computed = computeDetailsFromSets(sets)
            const pd = computed[String(pid)] || null
            if (mounted && pd) {
              setParticipants([{ id: String(pid), name: pd.name || null }])
              setDetails(prev => ({ ...prev, [String(pid)]: pd }))
              void startAnnouncementLoop()
            }
            const id = setInterval(() => {
              if (!mounted) return
              pollForParticipants(ev.id, [pid])
            }, 60000)
            pollRef.current.timerId = id
          }
        } catch (e) {
          console.log('announcement initial load by slug failed', e)
        }
      })()
    }

    return () => { mounted = false; bc.close(); if (pollRef.current.timerId) clearInterval(pollRef.current.timerId); clearCycleTimers() }
  }, [])

  return (
    <div className="p-0">
      <Announcement participants={(renderPayload && renderPayload.participants) || participants} details={(renderPayload && renderPayload.details) || details} speed={announcementSpeed} visible={visible} />
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <AnnouncementApp />
)
