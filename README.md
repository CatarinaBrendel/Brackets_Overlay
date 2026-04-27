# StartGG Overlay (Vite + React + Tailwind)

This small app provides a browser-based overlay you can use as a transparent OBS Browser Source. It queries StartGG's GraphQL API and renders a simple overlay preview.

Quick start

1. Install deps:

```bash
cd Startgg
npm install
```

2. Run dev server:

```bash
npm run dev
```

3. In OBS, add a Browser source pointing to `http://localhost:3000`, enable `Shutdown source when not visible` as needed, and set the Browser source to allow transparency.


Usage
- Enter an event slug (the app uses the StartGG GraphQL endpoint). Click "Fetch Event" to load.

Environment
- Create a `.env` file at the project root with the Vite-prefixed variable. This app requires the key only from the env file:

  VITE_STARTGG_API_KEY=your_startgg_api_key_here

- Vite only exposes env vars to client code when they start with `VITE_`. Restart the dev server after editing `.env`.

Notes
- This project is a minimal starting point. Extend `src/Overlay.jsx` to render scores, teams, or live match info.
