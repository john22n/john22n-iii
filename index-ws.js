require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const server = require('http').createServer();
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const adminKey = process.env.BLOG_ADMIN_KEY || '';

if (adminKey && Buffer.byteLength(adminKey) < 32) {
  throw new Error('BLOG_ADMIN_KEY must be at least 32 characters long.');
}

if (isProduction && !adminKey) {
  throw new Error('BLOG_ADMIN_KEY is required when NODE_ENV=production.');
}

app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'sha256-qqF6FsVzse4XjXzPd4kaApxes9tdAHd2Otkk1dK4wqQ='"],
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

app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'The request body is not valid JSON.' });
  }
  next(error);
});

server.on('request', app);

server.listen(PORT, function () { console.log('Listening on ' + PORT); });

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

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

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
const db = new sqlite.Database(path.join(__dirname, 'blog.db'));

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

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.get('SELECT COUNT(*) AS count FROM posts', (error, row) => {
    if (error || row.count > 0) return;

    const insert = db.prepare('INSERT INTO posts (title, category, content) VALUES (?, ?, ?)');
    starterPosts.slice().reverse().forEach((post) => {
      insert.run(post.title, post.category, post.content);
    });
    insert.finalize();
  });
});

app.get('/api/posts', function(req, res) {
  db.all('SELECT id, title, category, content, created_at FROM posts ORDER BY id DESC', (error, posts) => {
    if (error) return res.status(500).json({ error: 'Could not load posts.' });
    res.json(posts);
  });
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many publishing attempts. Try again later.' },
});

function requireAdmin(req, res, next) {
  const suppliedKey = req.get('x-blog-key');

  if (!adminKey) {
    return res.status(503).json({ error: 'Publishing is not configured.' });
  }

  const expected = Buffer.from(adminKey);
  const supplied = Buffer.from(suppliedKey || '');
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    return res.status(401).json({ error: 'Authentication failed.' });
  }

  res.setHeader('Cache-Control', 'no-store');
  next();
}

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

function shutdownDB() {
  console.log('shutting down');
  db.close((error) => {
    if (error) console.error('Could not close the database cleanly.');
  });
}
