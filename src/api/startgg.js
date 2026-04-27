import axios from 'axios'

const STARTGG_URL = 'https://api.start.gg/gql/alpha'

function getKey() {
  return import.meta.env.VITE_STARTGG_API_KEY
}

async function doQuery(query, variables) {
  const key = getKey()
  if (!key) throw new Error('StartGG API key not provided. Set VITE_STARTGG_API_KEY in .env.')

  const resp = await axios.post(
    STARTGG_URL,
    { query, variables },
    { headers: { Authorization: `Bearer ${key}` } }
  )

  if (resp.data.errors) throw new Error(JSON.stringify(resp.data.errors))
  return resp.data.data
}

export async function fetchEventBySlug(apiKey, slug) {
  const query = `
    query EventBySlug($slug: String!) {
      event(slug: $slug) { id name tournament { id name } }
    }
  `

  try {
    const data = await doQuery(query, { slug })
    // tournaments may be a connection with nodes
    return data.event
  } catch (err) {
    // If schema differs, try returning basic event fields
    if (err.message && err.message.includes('tournaments')) {
      const alt = `
        query EventBySlugAlt($slug: String!) {
          event(slug: $slug) { id name }
        }
      `
      const data = await doQuery(alt, { slug })
      return data.event
    }
    throw err
  }
}

export async function fetchTournamentBySlug(apiKey, slug) {
  const query = `
    query TournamentBySlug($slug: String!) {
      tournament(slug: $slug) { id name events { nodes { id name slug } } }
    }
  `

  try {
    const data = await doQuery(query, { slug })
    return data.tournament
  } catch (err) {
    if (err.message && err.message.includes('nodes')) {
      const alt = `
        query TournamentBySlugAlt($slug: String!) {
          tournament(slug: $slug) { id name events { id name slug } }
        }
      `
      const data = await doQuery(alt, { slug })
      return data.tournament
    }
    throw err
  }
}

export async function fetchEntrantsByEventId(apiKey, eventId) {
  const query = `
    query EventEntrants($id: ID!) {
      event(id: $id) { id name entrants(query: { perPage: 500 }) { nodes { id name } } }
    }
  `

  try {
    const data = await doQuery(query, { id: eventId })
    return data.event?.entrants?.nodes || []
  } catch (err) {
    if (err.message && err.message.includes('nodes')) {
      const alt = `
        query EventEntrantsAlt($id: ID!) {
          event(id: $id) { id name entrants(query: { perPage: 500 }) { id name } }
        }
      `
      const data = await doQuery(alt, { id: eventId })
      // entrants might be an array directly
      return data.event?.entrants || []
    }
    throw err
  }
}

export async function fetchSetsByEventId(apiKey, eventId) {
  const query = `
    query EventSets($id: ID!) {
      event(id: $id) {
        id
        sets(query: { perPage: 500 }) { nodes { id fullRoundText state winnerId slots { entrant { id name } entrantId } games { id winnerId } } }
      }
    }
  `

  try {
    const data = await doQuery(query, { id: eventId })
    return data.event?.sets?.nodes || data.event?.sets || []
  } catch (err) {
    if (err.message && err.message.includes('nodes')) {
      const alt = `
        query EventSetsAlt($id: ID!) {
          event(id: $id) {
            id
            sets(query: { perPage: 500 }) { id fullRoundText state winnerId slots { entrant { id name } entrantId } games { id winnerId } }
          }
        }
      `
      const data = await doQuery(alt, { id: eventId })
      return data.event?.sets || []
    }
    throw err
  }
}

export async function fetchEventDetails(apiKey, eventId) {
  const basicQuery = `
    query EventDetails($id: ID!) {
      event(id: $id) {
        id
        name
        phaseGroups { id }
        entrants { nodes { id name participants { id gamerTag player { id } } } }
        sets(perPage: 500) { nodes { id fullRoundText round startedAt completedAt state slots { entrant { id name } } } }
      }
    }
  `

  let details = null
  try {
    const data = await doQuery(basicQuery, { id: eventId })
    details = data?.event || null
  } catch (err) {
    // best-effort: log and continue to augmented query
    console.warn('fetchEventDetails: basic query failed', err && err.message)
    details = null
  }

  // Augmented query that includes games/winnerId when available
  const augmentedQuery = `
    query EventDetailsWithGames($id: ID!) {
      event(id: $id) {
        id
        name
        entrants { nodes { id name participants { id gamerTag player { id } } } }
        sets(perPage: 500) {
          nodes { id fullRoundText round startedAt completedAt state slots { entrant { id name } } games { id winnerId } }
        }
      }
    }
  `

  try {
    const adata = await doQuery(augmentedQuery, { id: eventId })
    const augmented = adata?.event
    if (augmented && details && details.sets && Array.isArray(details.sets.nodes) && augmented.sets && Array.isArray(augmented.sets.nodes)) {
      const byId = {}
      augmented.sets.nodes.forEach(s => { if (s && s.id) byId[String(s.id)] = s })
      details.sets.nodes.forEach(s => {
        const a = byId[String(s.id)]
        if (a && a.games) s.games = a.games
      })
    } else if (augmented && !details) {
      // if basic failed but augmented succeeded, use augmented
      details = augmented
    }
  } catch (e) {
    console.warn('fetchEventDetails: augmented query failed', e && e.message)
  }

  return details
}

export async function fetchEventById(apiKey, eventId) {
  const query = `
    query EventById($id: ID!) {
      event(id: $id) { id name entrants(query: { perPage: 500 }) { nodes { id name } } }
    }
  `

  try {
    const data = await doQuery(query, { id: eventId })
    return data.event
  } catch (err) {
    if (err.message && err.message.includes('nodes')) {
      const alt = `
        query EventByIdAlt($id: ID!) {
          event(id: $id) { id name entrants(query: { perPage: 500 }) { id name } }
        }
      `
      const data = await doQuery(alt, { id: eventId })
      return data.event
    }
    throw err
  }
}

// Backwards-compatible alias
export { fetchEventBySlug as fetchEvent }
