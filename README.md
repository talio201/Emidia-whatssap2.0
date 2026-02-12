# WhatsApp Backend

Minimal instructions to run the backend locally.

- Requirements: Node.js 18+ and npm

Setup
---------
1. Change to the server folder:

```
cd server
```

2. Install dependencies:

```
npm install
```

Environment variables
----------------------
- `API_TOKEN` (required) — token used by the extension/clients to authenticate requests.
- `PORT` (optional) — default `3001`.

Run
----

Start the server (example):

```
API_TOKEN=your_secret_token npm start
```
Run visible Chrome (avoids Chrome for Testing):

```
BROWSER_VISIBLE=true API_TOKEN=your_secret_token npm start
```

If Puppeteer opens "Chrome for Testing", force the system Chrome binary:

```
CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
BROWSER_VISIBLE=true API_TOKEN=your_secret_token npm start
```

Run tests
---------

```
NODE_ENV=test API_TOKEN=test-token npm test
```

Notes
-----
- The local data directory `server/data/` is ignored by git and used to store `store.json` and uploads.
- Do not use a weak/default `API_TOKEN` in production. Consider secret management or external DB for persistence.
