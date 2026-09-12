"""Small form-login gateway for the read-only Gatus dashboard."""
import base64
import hashlib
import hmac
import html
import http.cookies
import http.server
import os
import time
import urllib.error
import urllib.parse
import urllib.request

SECRET = os.environ['AUTH_COOKIE_SECRET'].encode()
USER = 'developers@observe.tw'
PASSWORD_HASH = os.environ['AUTH_PASSWORD_HASH']
SALT = os.environ['AUTH_PASSWORD_SALT'].encode()
TTL = 8 * 3600

def page(error=''):
    return ('''<!doctype html><html lang="zh-Hant"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>OmniObserve 監控登入</title>
<style>body{margin:0;background:#0b1220;color:#e5eaf2;font:16px system-ui;display:grid;place-items:center;min-height:100vh}main{width:min(360px,80vw);padding:32px;border:1px solid #29354a;border-radius:16px;background:#111c2e}h1{font-size:24px}label{display:block;margin-top:20px}input,button{box-sizing:border-box;width:100%;padding:12px;border-radius:8px;margin-top:8px;font:inherit}input{border:1px solid #526078;background:#0b1220;color:white}button{border:0;background:#80c66b;color:#10200c;cursor:pointer;margin-top:24px;font-weight:600}.error{color:#ffaaaa}p{color:#b9c6d8}</style>
<main><h1>OmniObserve 外部監控</h1><p>使用團隊帳號登入，查看各環境與服務狀態。</p>'''
        + ('<p class="error" role="alert">' + html.escape(error) + '</p>' if error else '')
        + '''<form method="post" action="/login"><label for="username">帳號</label><input id="username" name="username" type="email" autocomplete="username" required>
<label for="password">密碼</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">登入</button></form></main></html>''').encode()

class Gateway(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Do not log credentials, cookies or URLs with query data.

    def reply(self, status, body=b'', headers=None):
        self.send_response(status)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        for key, value in (headers or {}).items(): self.send_header(key, value)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD': self.wfile.write(body)

    def authenticated(self):
        try:
            cookie = http.cookies.SimpleCookie(self.headers.get('Cookie', ''))
            token = cookie['omni_monitor'].value
            expiry, signature = token.split('.', 1)
            expected = hmac.new(SECRET, expiry.encode(), hashlib.sha256).hexdigest()
            return time.time() < int(expiry) <= time.time() + TTL + 60 and hmac.compare_digest(signature, expected)
        except (KeyError, ValueError, http.cookies.CookieError): return False

    def do_GET(self):
        if self.path == '/healthz':
            return self.reply(200, b'OK', {'Content-Type': 'text/plain'})
        if self.path == '/login':
            return self.reply(200, page(), {'Content-Type': 'text/html; charset=utf-8'})
        if not self.authenticated():
            return self.reply(303, headers={'Location': '/login'})
        # Origin is fixed; a client-controlled URL cannot change the upstream.
        if not self.path.startswith('/') or self.path.startswith('//'):
            return self.reply(400)
        req = urllib.request.Request('http://metrics:8080' + self.path, method=self.command,
                                     headers={'Accept': self.headers.get('Accept', '*/*')})
        try:
            upstream = urllib.request.urlopen(req, timeout=15)
        except urllib.error.HTTPError as exc:
            upstream = exc
        except (urllib.error.URLError, TimeoutError):
            return self.reply(502, b'Monitor temporarily unavailable')
        with upstream:
            body = upstream.read()
            headers = {k: v for k, v in upstream.headers.items() if k.lower() in
                       {'content-type', 'content-encoding', 'etag', 'last-modified'}}
            return self.reply(upstream.status, body, headers)

    do_HEAD = do_GET

    def do_POST(self):
        if self.path != '/login': return self.reply(405)
        if self.headers.get('Origin') not in (None, os.environ.get('PUBLIC_ORIGIN', 'https://uptime.omni.observe.tw')):
            return self.reply(403)
        try: size = int(self.headers.get('Content-Length', '0'))
        except ValueError: return self.reply(400)
        if not 0 < size <= 4096: return self.reply(400)
        try: fields = urllib.parse.parse_qs(self.rfile.read(size).decode())
        except UnicodeError: return self.reply(400)
        name = fields.get('username', [''])[0]
        password = fields.get('password', [''])[0]
        digest = hashlib.pbkdf2_hmac('sha256', password.encode(), SALT, 200000).hex()
        if not (hmac.compare_digest(name, USER) and hmac.compare_digest(digest, PASSWORD_HASH)):
            time.sleep(1)
            return self.reply(401, page('帳號或密碼不正確'), {'Content-Type': 'text/html; charset=utf-8'})
        expiry = str(int(time.time()) + TTL)
        signature = hmac.new(SECRET, expiry.encode(), hashlib.sha256).hexdigest()
        return self.reply(303, headers={'Location': '/', 'Set-Cookie':
            f'omni_monitor={expiry}.{signature}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age={TTL}'})

http.server.ThreadingHTTPServer(('0.0.0.0', 8080), Gateway).serve_forever()
