# John Noriega — software engineering portfolio

A portfolio and small publishing service built with HTML, CSS, JavaScript, Node.js, Express, WebSockets, and SQLite. The site presents selected work across fintech, payments, real-time applications, and AI-enabled business systems.

## Architecture

```text
Browser ──HTTP──▶ Express ──SQL──▶ SQLite
   │                  │
   └──WebSocket───────┘
```

- Express serves the portfolio, résumé, and JSON API.
- SQLite stores public field notes without requiring an external database service.
- Publishing endpoints use a timing-safe admin-key comparison and a stricter rate limit.
- Helmet applies a restrictive content security policy and other browser security headers.
- The WebSocket server validates origins, limits payloads and connections, and disables compression.
- Graceful shutdown closes active sockets and the database connection.

The deliberately small stack keeps deployment and operations proportional to a personal site while still exercising production concerns such as validation, authentication, observability, resource limits, and automated API tests.

## Run locally

Requires Node.js 24 or newer. The repository's `.node-version` is the source of truth for development and deployment.

```sh
npm ci
npm start
```

Open [http://localhost:3000](http://localhost:3000). The application creates `blog.db` and seeds starter field notes on its first run.

## Test

```sh
npm test
```

The test suite starts the real HTTP server against an isolated temporary SQLite database. It covers health checks, public reads, input validation, authentication, publishing, and deletion without touching the development database.

## Publishing

Authoring controls are intentionally absent from the public site. Generate an admin key, provide it to the service, and publish through the authenticated API or a private client:

```sh
export BLOG_ADMIN_KEY="$(openssl rand -hex 32)"
npm start

curl http://localhost:3000/api/posts \
  --request POST \
  --header "Content-Type: application/json" \
  --header "x-blog-key: $BLOG_ADMIN_KEY" \
  --data '{"title":"Post title","category":"Engineering","content":"Post body"}'
```

Reading `GET /api/posts` remains public. Creating and deleting notes requires the admin key.

## Production

Production startup fails closed when `BLOG_ADMIN_KEY` is missing:

```sh
NODE_ENV=production BLOG_ADMIN_KEY="your-generated-secret" npm start
```

Terminate TLS at a reverse proxy, redirect HTTP to HTTPS, and expose only ports 80 and 443. Keep port 3000 and `blog.db` private. Store the admin key in the deployment environment rather than this repository or shell history.
