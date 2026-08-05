const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-blog-'));
process.env.BLOG_DB_PATH = path.join(temporaryDirectory, 'test.db');
process.env.BLOG_ADMIN_KEY = 'test-admin-key';

const { db, server, wss } = require('./index-ws');
let baseUrl;
const basicAdminHeader = `Basic ${Buffer.from('admin:test-admin-key').toString('base64')}`;

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  wss.clients.forEach((client) => client.terminate());
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await new Promise((resolve, reject) => {
    db.close((error) => error ? reject(error) : resolve());
  });
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('health endpoint reports that the server is available', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('portfolio and resume are publicly available', async () => {
  const portfolio = await fetch(baseUrl);
  assert.equal(portfolio.status, 200);
  assert.match(await portfolio.text(), /Systems that <span>move\.<\/span>/);

  const resume = await fetch(`${baseUrl}/assets/john-noriega-resume.pdf`);
  assert.equal(resume.status, 200);
  assert.equal(resume.headers.get('content-type'), 'application/pdf');
  assert.ok((await resume.arrayBuffer()).byteLength > 0);
});

test('admin page requires HTTP Basic authentication', async () => {
  const unauthorized = await fetch(`${baseUrl}/admin`);
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get('www-authenticate'), /^Basic /);

  const authorized = await fetch(`${baseUrl}/admin`, {
    headers: { authorization: basicAdminHeader },
  });
  assert.equal(authorized.status, 200);
  assert.match(authorized.headers.get('set-cookie'), /blog_admin=.*HttpOnly.*SameSite=Strict/);
  assert.match(await authorized.text(), /Field Notes Control Room/);
});

test('public post reads return the starter posts', async () => {
  const response = await fetch(`${baseUrl}/api/posts`);
  const posts = await response.json();

  assert.equal(response.status, 200);
  assert.equal(posts.length, 3);
  assert.ok(posts.every((post) => post.id && post.title && post.category && post.content));
});

test('publishing rejects unauthorized and invalid requests', async () => {
  const unauthorized = await fetch(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'A title', category: 'Testing', content: 'Body' }),
  });
  assert.equal(unauthorized.status, 401);

  const invalid = await fetch(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-blog-key': 'test-admin-key' },
    body: JSON.stringify({ title: '', category: 'Testing', content: 'Body' }),
  });
  assert.equal(invalid.status, 400);
});

test('an administrator can publish and delete a post', async () => {
  const headers = { 'content-type': 'application/json', 'x-blog-key': 'test-admin-key' };
  const published = await fetch(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'Test post', category: 'Testing', content: 'Test body' }),
  });
  const post = await published.json();
  assert.equal(published.status, 201);
  assert.equal(post.title, 'Test post');

  const posts = await (await fetch(`${baseUrl}/api/posts`)).json();
  assert.ok(posts.some(({ id }) => id === post.id));

  const deleted = await fetch(`${baseUrl}/api/posts/${post.id}`, {
    method: 'DELETE',
    headers: { 'x-blog-key': 'test-admin-key' },
  });
  assert.equal(deleted.status, 204);

  const postsAfterDelete = await (await fetch(`${baseUrl}/api/posts`)).json();
  assert.ok(!postsAfterDelete.some(({ id }) => id === post.id));
});

test('admin browser session can publish and delete a post', async () => {
  const adminPage = await fetch(`${baseUrl}/admin`, {
    headers: { authorization: basicAdminHeader },
  });
  const sessionCookie = adminPage.headers.get('set-cookie').split(';', 1)[0];
  const invalidSession = await fetch(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie.replace(/\d+/, '0') },
    body: JSON.stringify({ title: 'Invalid session', category: 'Testing', content: 'Test body' }),
  });
  assert.equal(invalidSession.status, 401);

  const published = await fetch(`${baseUrl}/api/posts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ title: 'Admin page post', category: 'Testing', content: 'Test body' }),
  });
  const post = await published.json();
  assert.equal(published.status, 201);

  const deleted = await fetch(`${baseUrl}/api/posts/${post.id}`, {
    method: 'DELETE',
    headers: { cookie: sessionCookie },
  });
  assert.equal(deleted.status, 204);
});

test('deleting rejects an invalid post ID', async () => {
  const response = await fetch(`${baseUrl}/api/posts/not-a-number`, {
    method: 'DELETE',
    headers: { 'x-blog-key': 'test-admin-key' },
  });
  assert.equal(response.status, 400);
});
