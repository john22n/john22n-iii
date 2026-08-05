# John Noriega — portfolio and blog

Run the site locally:

```sh
npm start
```

Open `http://localhost:3000`. Blog posts are stored in `blog.db` and can be created from the **Write a new field note** panel on the site.

Publishing and deleting always require a secret key. Generate one rather than choosing a memorable password:

```sh
export BLOG_ADMIN_KEY="$(openssl rand -hex 32)"
npm start
```

Enter the same value in the form's **Publish key** field. Reading posts remains public; publishing and deleting notes require the key.

## Production security

Run the public service with `NODE_ENV=production`; the server refuses to start without a `BLOG_ADMIN_KEY` of at least 32 characters:

```sh
NODE_ENV=production BLOG_ADMIN_KEY="your-generated-secret" npm start
```

Terminate TLS with nginx or another reverse proxy, redirect HTTP to HTTPS, and expose only ports 80 and 443 publicly. Keep port 3000 and `blog.db` inaccessible from the internet. Store the key in the service environment (for example, a root-readable systemd environment file), not in this repository or a shell-history command.
