# AniLok 🎌

> A modern, futuristic anime streaming web app powered by the [AniWatch API](https://github.com/ghoshRitesh12/aniwatch-api).

![AniLok](https://img.shields.io/badge/AniLok-Streaming-00d4ff?style=for-the-badge)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-black?style=for-the-badge&logo=vercel)

---

## ✨ Features

- 🏠 **Homepage** — Hero spotlight, Trending, Most Popular, Latest Episodes, Upcoming
- 📺 **Watch Page** — HLS player with SUB/DUB toggle, multi-server selector, episode grid
- 🔍 **Search** — Real-time suggestions with poster previews
- 🎭 **Categories & Genres** — Individual browsable pages with pagination
- 🔒 **Built-in CORS Proxy** — Serverless `/api/proxy.js` forwards all API calls, no third-party proxy needed when deployed

---

## 🚀 Deploy to Vercel (GitHub Import)

### Step 1 — Push to GitHub

```bash
# Clone or download this repo, then:
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/anilok.git
git push -u origin main
```

### Step 2 — Import on Vercel

1. Go to **[vercel.com/new](https://vercel.com/new)**
2. Click **"Import Git Repository"**
3. Select your `anilok` repo
4. Vercel auto-detects the config — just click **Deploy**

That's it. No environment variables. No build step. No configuration needed.

Your app will be live at `https://anilok-<hash>.vercel.app` within ~30 seconds.

---

## 🗂 Project Structure

```
anilok/
├── api/
│   └── proxy.js        ← Serverless CORS proxy (Vercel function)
├── public/
│   └── index.html      ← The entire AniLok frontend (single file)
├── vercel.json         ← Routes /proxy/* to the function, serves public/
├── package.json        ← "type": "module", Node ≥18
├── .gitignore
└── README.md
```

---

## 🔧 How the Proxy Works

```
Browser  →  GET /proxy/home
                │
         Vercel Function  (api/proxy.js)
                │  strips /proxy prefix
                │  forwards to animelokam.vercel.app/api/v2/hianime/home
                │  injects  Access-Control-Allow-Origin: *
                ↓
         Response back to browser  ✅  no CORS error
```

Because the proxy is on the **same origin** as the frontend (`/proxy`), the browser never makes a cross-origin request at all — eliminating CORS entirely.

### Local development fallback

When you open `public/index.html` directly (as a `file://` URL or on `localhost`), the app detects it isn't on Vercel and automatically falls back to `corsproxy.io` as a temporary CORS proxy so you can still test locally without deploying.

---

## 📡 API Routes

All AniWatch API paths are available under `/proxy/*`:

| Frontend calls | Proxy forwards to |
|---|---|
| `GET /proxy/home` | `.../hianime/home` |
| `GET /proxy/search?q=naruto` | `.../hianime/search?q=naruto` |
| `GET /proxy/anime/:id` | `.../hianime/anime/:id` |
| `GET /proxy/anime/:id/episodes` | `.../hianime/anime/:id/episodes` |
| `GET /proxy/episode/servers?animeEpisodeId=...` | `.../hianime/episode/servers?...` |
| `GET /proxy/episode/sources?...` | `.../hianime/episode/sources?...` |
| `GET /proxy/category/:type?page=N` | `.../hianime/category/:type?page=N` |
| `GET /proxy/genre/:name?page=N` | `.../hianime/genre/:name?page=N` |

---

## 📝 License

MIT — do whatever you want with it.
