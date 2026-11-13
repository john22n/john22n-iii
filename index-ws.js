require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const server = require('http').createServer();
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const adminKey = process.env.BLOG_ADMIN_KEY || '';
const adminSessionDuration = 8 * 60 * 60 * 1000;
const bundledResumePath = path.join(__dirname, 'assets', 'john-noriega-resume.pdf');
const resumePath = process.env.RESUME_PATH || bundledResumePath;

if (!fs.existsSync(resumePath)) {
  fs.mkdirSync(path.dirname(resumePath), { recursive: true });
  fs.copyFileSync(bundledResumePath, resumePath);
}

if (isProduction && !adminKey) {
  throw new Error('BLOG_ADMIN_KEY is required when NODE_ENV=production.');
}

function createAdminSessionToken() {
  const expiresAt = Date.now() + adminSessionDuration;
  const signature = crypto
    .createHmac('sha256', adminKey)
    .update(`blog-admin-session-v1:${expiresAt}`)
    .digest('hex');
  return `${expiresAt}.${signature}`;
}

function hasValidAdminSession(token) {
  const [expiresAt, suppliedSignature] = token.split('.');
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Date.now() || !suppliedSignature) return false;

  const expectedSignature = crypto
    .createHmac('sha256', adminKey)
    .update(`blog-admin-session-v1:${expiresAt}`)
    .digest('hex');
  const expected = Buffer.from(expectedSignature);
  const supplied = Buffer.from(suppliedSignature);
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

function hashVisitorIp(ip) {
  return crypto
    .createHmac('sha256', adminKey || 'local-development-visitor-metrics')
    .update(ip)
    .digest('hex');
}

app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  next();
});
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
}));

app.use(express.json({ limit: '100kb' }));
app.get('/assets/john-noriega-resume.pdf', function(req, res) {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(resumePath);
});
app.use('/assets', express.static(path.join(__dirname, 'assets'), {
  fallthrough: false,
  maxAge: isProduction ? '1d' : 0,
}));

app.get('/', async function(req, res) {
  try {
    await databaseReady;
    await new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO site_visitors (ip_hash)
        VALUES (?)
        ON CONFLICT(ip_hash) DO UPDATE SET
          last_seen = CURRENT_TIMESTAMP,
          visit_count = visit_count + 1
      `, [hashVisitorIp(req.ip)], (error) => error ? reject(error) : resolve());
    });
  } catch (error) {
    console.error('Could not record portfolio visit.');
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/favicon.ico', function(req, res) {
  res.status(204).end();
});

app.get('/projects', function(req, res) {
  res.sendFile(path.join(__dirname, 'projects.html'));
});

app.get('/robots.txt', function(req, res) {
  res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: https://john22n-iii.com/sitemap.xml\n');
});

app.get('/sitemap.xml', function(req, res) {
  res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://john22n-iii.com/</loc></url><url><loc>https://john22n-iii.com/projects</loc></url></urlset>');
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'The request body is not valid JSON.' });
  }
  next(error);
});

server.on('request', app);

if (require.main === module) {
  server.listen(PORT, function () { console.log('Listening on ' + PORT); });
}

server.headersTimeout = 10000;
server.requestTimeout = 15000;
server.keepAliveTimeout = 5000;
server.maxRequestsPerSocket = 100;

let isShuttingDown = false;
function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  wss.clients.forEach((client) => {
    client.terminate();
  });

  server.close(() => {
    shutdownDB();
  });
}

if (require.main === module) {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/** Websocket **/
const WebSocketServer = require('ws').Server;

const wss = new WebSocketServer({
  server,
  path: '/live',
  maxPayload: 1024,
  perMessageDeflate: false,
  verifyClient: ({ origin, req }, done) => {
    if (wss.clients.size >= 200) {
      done(false, 503, 'Server busy');
      return;
    }

    try {
      const originUrl = new URL(origin);
      const validProtocol = !isProduction || originUrl.protocol === 'https:';
      done(validProtocol && originUrl.host === req.headers.host, 403, 'Forbidden');
    } catch {
      done(false, 403, 'Forbidden');
    }
  },
});

wss.on('connection', function connection(ws) {
  const numClients = wss.clients.size;

  console.log('clients connected: ', numClients);

  wss.broadcast(`Current visitors: ${numClients}`);

  if (ws.readyState === ws.OPEN) {
    ws.send('welcome!');
  }

  ws.on('close', function close() {
    wss.broadcast(`Current visitors: ${wss.clients.size}`);
    console.log('A client has disconnected');
  });

  ws.on('error', function error() {
    //
  });
});


/**
 * Broadcast data to all connected clients
 * @param  {Object} data
 * @void
 */
wss.broadcast = function broadcast(data) {
  console.log('Broadcasting: ', data);
  wss.clients.forEach(function each(client) {
    if (client.readyState === client.OPEN) client.send(data);
  });
};
/** End Websocket **/
/** database start **/

const sqlite = require('sqlite3')
const dbPath = process.env.BLOG_DB_PATH || path.join(__dirname, 'blog.db');
const db = new sqlite.Database(dbPath);

const starterPosts = [
  {
    title: 'The whole stack is a design surface.',
    category: 'Engineering',
    content: 'A product’s character does not stop at the edge of the screen. It lives in how quickly data arrives, how errors explain themselves, and whether the system behaves predictably when the happy path disappears.\n\nThat makes the entire stack a design surface. A good schema can simplify an interface. A carefully shaped API can remove whole categories of loading states. A clear error model can turn a dead end into a useful next step.\n\nThe best full-stack work happens when these choices are made together—not as isolated frontend and backend tasks, but as one continuous experience.'
  },
  {
    title: 'Real-time without the noise.',
    category: 'WebSockets',
    content: 'Real-time features work best when they answer a real human need: knowing who is present, seeing a decision land, or watching shared work change without refreshing.\n\nThe technology should disappear behind that moment. Start with the smallest event model possible, make connection state visible when it matters, and always decide what the experience becomes when the socket closes.'
  },
  {
    title: 'Readable code is product infrastructure.',
    category: 'Craft',
    content: 'Readable code is not a preference reserved for cleanup day. It is infrastructure for every feature that comes next.\n\nDirect names, narrow responsibilities, and unsurprising control flow let a team change software with confidence. Cleverness may save a line today; clarity saves hours every time someone returns to the work.'
  }
];

const databaseReady = new Promise((resolve, reject) => {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `, (createError) => {
      if (createError) reject(createError);
    });
    db.run(`
      CREATE TABLE IF NOT EXISTS site_visitors (
        ip_hash TEXT PRIMARY KEY,
        first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        visit_count INTEGER NOT NULL DEFAULT 1
      )
    `, (createError) => {
      if (createError) reject(createError);
    });
    db.run(`
      CREATE TABLE IF NOT EXISTS resume_clicks (
        ip_hash TEXT PRIMARY KEY,
        first_clicked TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_clicked TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        click_count INTEGER NOT NULL DEFAULT 1
      )
    `, (createError) => {
      if (createError) reject(createError);
    });
    db.get('SELECT COUNT(*) AS count FROM posts', (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      if (row.count > 0) {
        resolve();
        return;
      }

      const insert = db.prepare('INSERT INTO posts (title, category, content) VALUES (?, ?, ?)');
      starterPosts.slice().reverse().forEach((post) => {
        insert.run(post.title, post.category, post.content);
      });
      insert.finalize((insertError) => insertError ? reject(insertError) : resolve());
    });
  });
});

app.use('/api', function(req, res, next) {
  databaseReady.then(() => next(), next);
});

app.get('/api/posts', function(req, res) {
  db.all('SELECT id, title, category, content, created_at FROM posts ORDER BY id DESC', (error, posts) => {
    if (error) return res.status(500).json({ error: 'Could not load posts.' });
    res.json(posts);
  });
});

app.get('/api/health', function(req, res) {
  res.json({ status: 'ok' });
});

app.post('/api/events/resume-click', function(req, res) {
  db.run(`
    INSERT INTO resume_clicks (ip_hash)
    VALUES (?)
    ON CONFLICT(ip_hash) DO UPDATE SET
      last_clicked = CURRENT_TIMESTAMP,
      click_count = click_count + 1
  `, [hashVisitorIp(req.ip)], (error) => {
    if (error) return res.status(500).json({ error: 'Could not record resume click.' });
    res.status(204).end();
  });
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many publishing attempts. Try again later.' },
});

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again later.' },
});

function requireAdmin(req, res, next) {
  let suppliedKey = req.get('x-blog-key') || '';
  const authorization = req.get('authorization') || '';
  const sessionCookie = (req.get('cookie') || '')
    .split(';')
    .map((cookie) => cookie.trim().split('='))
    .find(([name]) => name === 'blog_admin')?.[1] || '';

  if (!suppliedKey && authorization.startsWith('Basic ')) {
    try {
      const credentials = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
      const separator = credentials.indexOf(':');
      const username = credentials.slice(0, separator);
      if (separator > -1 && username === 'admin') {
        suppliedKey = credentials.slice(separator + 1);
      }
    } catch {
      suppliedKey = '';
    }
  }

  if (!adminKey) {
    return res.status(503).json({ error: 'Publishing is not configured.' });
  }

  const expected = Buffer.from(adminKey);
  const supplied = Buffer.from(suppliedKey || '');
  const hasValidKey = expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
  const hasValidSession = hasValidAdminSession(sessionCookie);

  if (!hasValidKey && !hasValidSession) {
    if (req.path === '/admin') {
      res.setHeader('WWW-Authenticate', 'Basic realm="Blog admin", charset="UTF-8"');
    }
    return res.status(401).json({ error: 'Authentication failed.' });
  }

  res.setHeader('Cache-Control', 'no-store');
  next();
}

app.get('/admin', adminLoginLimiter, requireAdmin, function(req, res) {
  res.cookie('blog_admin', createAdminSessionToken(), {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
    maxAge: adminSessionDuration,
    path: '/api',
  });
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/api/metrics/visitors', requireAdmin, function(req, res) {
  db.get(`
    SELECT
      (SELECT COUNT(*) FROM site_visitors) AS unique_visitors,
      (SELECT COALESCE(SUM(visit_count), 0) FROM site_visitors) AS total_visits,
      (SELECT COUNT(*) FROM site_visitors WHERE DATE(last_seen) = DATE('now')) AS unique_today,
      (SELECT COUNT(*) FROM site_visitors WHERE last_seen >= DATETIME('now', '-7 days')) AS unique_last_7_days,
      (SELECT COUNT(*) FROM resume_clicks) AS unique_resume_clickers,
      (SELECT COALESCE(SUM(click_count), 0) FROM resume_clicks) AS total_resume_clicks
  `, (error, metrics) => {
    if (error) return res.status(500).json({ error: 'Could not load visitor metrics.' });
    res.json(metrics);
  });
});

app.get('/api/resume', requireAdmin, function(req, res, next) {
  fs.stat(resumePath, (error, stats) => {
    if (error) return next(error);
    res.json({
      size: stats.size,
      updated_at: stats.mtime.toISOString(),
    });
  });
});

app.put(
  '/api/resume',
  adminLimiter,
  requireAdmin,
  express.raw({ type: 'application/pdf', limit: '10mb' }),
  async function(req, res) {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Choose a PDF résumé to upload.' });
    }
    if (req.body.subarray(0, 5).toString() !== '%PDF-') {
      return res.status(400).json({ error: 'The uploaded file is not a valid PDF.' });
    }

    const temporaryPath = `${resumePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(temporaryPath, req.body, { mode: 0o644 });
      await fs.promises.rename(temporaryPath, resumePath);
      const stats = await fs.promises.stat(resumePath);
      res.json({ size: stats.size, updated_at: stats.mtime.toISOString() });
    } catch (error) {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
      console.error('Could not replace the résumé.', error);
      res.status(500).json({ error: 'Could not replace the résumé.' });
    }
  }
);

app.post('/api/posts', adminLimiter, requireAdmin, function(req, res) {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const category = typeof req.body.category === 'string' ? req.body.category.trim() : '';
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';

  if (!title || !category || !content) {
    return res.status(400).json({ error: 'Title, category, and post content are required.' });
  }

  if (title.length > 120 || category.length > 40 || content.length > 20000) {
    return res.status(400).json({ error: 'One or more fields are too long.' });
  }

  db.run(
    'INSERT INTO posts (title, category, content) VALUES (?, ?, ?)',
    [title, category, content],
    function(error) {
      if (error) return res.status(500).json({ error: 'Could not publish the post.' });

      db.get(
        'SELECT id, title, category, content, created_at FROM posts WHERE id = ?',
        [this.lastID],
        (lookupError, post) => {
          if (lookupError) return res.status(500).json({ error: 'Post published, but could not be returned.' });
          res.status(201).json(post);
        }
      );
    }
  );
});

app.delete('/api/posts/:id', adminLimiter, requireAdmin, function(req, res) {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId) || postId < 1) {
    return res.status(400).json({ error: 'The post ID is invalid.' });
  }

  db.run('DELETE FROM posts WHERE id = ?', [postId], function(error) {
    if (error) return res.status(500).json({ error: 'Could not delete the post.' });
    if (this.changes === 0) return res.status(404).json({ error: 'Post not found.' });
    res.status(204).end();
  });
});

app.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'The uploaded file must be 10 MB or smaller.' });
  }
  next(error);
});

function shutdownDB() {
  console.log('shutting down');
  db.close((error) => {
    if (error) console.error('Could not close the database cleanly.');
  });
}

module.exports = { server, db, wss, databaseReady };
