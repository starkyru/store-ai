# Deploying the docs site to a VPS

The docs site is a static VitePress build. After building, the `docs/site/.vitepress/dist/` directory contains pure HTML/CSS/JS that can be served by any web server.

## Build

```bash
# From the repo root
pnpm --filter store-ai-docs run build
```

Output is in `docs/site/.vitepress/dist/`.

## Option 1: Nginx (recommended)

Copy the dist folder to your VPS and serve with nginx:

```bash
# On your local machine — build and upload
pnpm --filter store-ai-docs run build
rsync -avz --delete docs/site/.vitepress/dist/ your-vps:/var/www/store-ai/
```

Nginx config (`/etc/nginx/sites-available/store-ai`):

```nginx
server {
    listen 80;
    server_name docs.your-domain.com;

    root /var/www/store-ai;
    index index.html;

    # SPA fallback — VitePress uses clean URLs
    location / {
        try_files $uri $uri.html $uri/ =404;
    }

    # Cache static assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Gzip
    gzip on;
    gzip_types text/html text/css application/javascript application/json image/svg+xml;
}
```

Enable and reload:

```bash
sudo ln -sf /etc/nginx/sites-available/store-ai /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### With HTTPS (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d docs.your-domain.com
```

## Option 2: Caddy

Even simpler — automatic HTTPS:

```
# /etc/caddy/Caddyfile
docs.your-domain.com {
    root * /var/www/store-ai
    try_files {path} {path}.html {path}/
    file_server
    encode gzip
}
```

## Option 3: Subdirectory deployment

If you're serving under a subdirectory (e.g., `your-domain.com/store-ai/`), set the base path in `.vitepress/config.ts`:

```typescript
export default defineConfig({
  base: '/store-ai/',
  // ... rest of config
});
```

Then rebuild.

## Option 4: Docker

```dockerfile
FROM nginx:alpine
COPY docs/site/.vitepress/dist/ /usr/share/nginx/html/
COPY docs/site/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

```nginx
# docs/site/nginx.conf
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri.html $uri/ =404;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/html text/css application/javascript application/json image/svg+xml;
}
```

```bash
docker build -t store-ai-docs .
docker run -p 8080:80 store-ai-docs
```

## Automated deployment

Add to your CI or use a simple deploy script:

```bash
#!/bin/bash
# deploy-docs.sh
set -e

pnpm --filter store-ai-docs run build
rsync -avz --delete docs/site/.vitepress/dist/ your-vps:/var/www/store-ai/
echo "Docs deployed."
```

Make executable and run:

```bash
chmod +x deploy-docs.sh
./deploy-docs.sh
```
