# NuMind MAPS — Admin Dashboard

A standalone Node/Express admin dashboard that connects directly to your existing
`numind.db` SQLite database and renders live student reports on the web.

---

## Folder structure

```
numind-admin/
├── server.js            ← Express app entry point (also mountable as middleware)
├── package.json
├── .env.example         ← Copy to .env and fill in your values
├── .gitignore
├── middleware/
│   └── auth.js          ← Session-based auth guard
├── routes/
│   ├── auth.js          ← POST /auth/login, /auth/logout, GET /auth/me
│   └── api.js           ← GET /api/students, /api/students/:id, /api/stats
└── public/
    ├── index.html       ← SPA shell
    ├── style.css        ← All styles
    └── app.js           ← All frontend logic
```

---

## Setup

### 1. Install dependencies

```bash
cd numind-admin
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
ADMIN_PORT=4000
SQLITE_PATH=../numind.db        # path to your existing DB file
ADMIN_USER=admin
ADMIN_PASSWORD=your-secure-password
SESSION_SECRET=a-long-random-string
NODE_ENV=development
```

Generate a session secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Run

```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

Open `http://localhost:4000` and sign in.

---

## Deploying to the internet

### Option A — Same VPS as your existing Node app (recommended)

Run the admin dashboard as a separate process on a different port, then proxy
it through Nginx with a sub-path or subdomain.

**Nginx config (subdomain)**:
```nginx
server {
    listen 443 ssl;
    server_name admin.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        'upgrade';
    }
}
```

**Keep the process alive with PM2**:
```bash
npm install -g pm2
pm2 start server.js --name numind-admin
pm2 save
pm2 startup
```

### Option B — Mount into your existing Express app

If you'd rather expose the dashboard under a route like `/admin` on your
existing app, require it as middleware:

```js
// In your main app.js / index.js
const adminDash = require('./numind-admin/server');
app.use('/admin', adminDash);
```

> Make sure `SQLITE_PATH` in `.env` (or `process.env`) still points to
> your DB correctly relative to the working directory of your main process.

### Option C — Railway / Render / Fly.io

These platforms support Node apps out of the box.

1. Push the `numind-admin/` folder as a standalone repo.
2. Set all the `.env` values as environment variables in the platform dashboard.
3. For `SQLITE_PATH`, mount a persistent disk and point to it — SQLite files
   do NOT persist on ephemeral file systems (Railway/Render free tier).
   Consider switching to `better-sqlite3` with a mounted volume, or use
   a hosted Postgres and migrate if you need true cloud persistence.

---

## API Reference

All API routes require a valid admin session (cookie-based).

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/login` | `{ username, password }` → sets session cookie |
| `POST` | `/auth/logout` | Destroys session |
| `GET`  | `/auth/me` | Returns `{ admin }` if logged in, else 401 |
| `GET`  | `/api/students` | List students. Supports `?search=&school=&class=&fit_tier=` |
| `GET`  | `/api/students/meta` | Returns distinct schools, classes, total counts |
| `GET`  | `/api/students/:sessionId` | Full report for one student (all 7 tables) |
| `GET`  | `/api/stats` | Aggregate dashboard stats |

---

## Security notes

- The DB is opened **read-only** — the dashboard can never modify your data.
- Sessions are HTTP-only cookies, secure in production.
- Set `NODE_ENV=production` and use HTTPS (Nginx + Let's Encrypt) in production.
- Change `ADMIN_PASSWORD` and `SESSION_SECRET` before going live.
- Helmet is included for standard HTTP security headers.

---

## Adding PDF download (optional, future)

Your existing `download.js` can be wired up by adding a route in `routes/api.js`:

```js
router.get('/students/:sessionId/pdf', async (req, res) => {
  const data = getFullReport(req.params.sessionId); // from db.js
  const pdfBuffer = await generatePDF(data);        // from download.js
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${data.student.full_name}-report.pdf"`);
  res.send(pdfBuffer);
});
```
