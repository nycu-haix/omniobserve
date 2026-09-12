"""Authenticated deployment overview and durable single-worker audio queue."""
import hashlib
import hmac
import http.cookies
import http.server
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).parent
DATA = Path(os.getenv('OPS_DATA', '/data'))
MAX_UPLOAD = 64 * 1024 * 1024
MAX_STORED = 1024 * 1024 * 1024
TTL = 8 * 3600
USER = 'developers@observe.tw'
TARGETS = json.loads(os.getenv('OPS_TARGETS', '{}'))
API = os.getenv('DOKPLOY_URL', 'https://dokploy.observe.tw/api')


def db():
    c = sqlite3.connect(DATA / 'jobs.sqlite', timeout=30)
    c.row_factory = sqlite3.Row
    return c


def initialize():
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / 'audio').mkdir(exist_ok=True)
    with db() as c:
        c.executescript('''PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL,
          created REAL NOT NULL, updated REAL NOT NULL, attempts INTEGER DEFAULT 0,
          progress REAL DEFAULT 0, duration REAL DEFAULT 0, text TEXT DEFAULT '',
          error TEXT DEFAULT '', next_run REAL DEFAULT 0, size INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS audit (time REAL, action TEXT, target TEXT, detail TEXT);
        ''')
        c.execute("UPDATE jobs SET status='queued', error='服務重啟，工作已重新排隊' WHERE status='processing'")


def audit(action, target, detail=''):
    with db() as c: c.execute('INSERT INTO audit VALUES (?,?,?,?)', (time.time(), action, target, detail))


def update(job_id, **values):
    values['updated'] = time.time()
    with db() as c:
        c.execute('UPDATE jobs SET ' + ','.join(k + '=?' for k in values) + ' WHERE id=?', (*values.values(), job_id))


def claim():
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute("SELECT * FROM jobs WHERE status='queued' AND next_run<=? ORDER BY created LIMIT 1", (time.time(),)).fetchone()
        if not row: return None
        c.execute("UPDATE jobs SET status='processing', attempts=attempts+1, updated=? WHERE id=?", (time.time(), row['id']))
        return dict(row)


def cancelled(job_id):
    with db() as c: return c.execute('SELECT status FROM jobs WHERE id=?', (job_id,)).fetchone()[0] == 'cancelled'


def transcribe_job(job, model):
    audio = DATA / 'audio' / job['id']
    probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(audio)],
                           capture_output=True, timeout=30, check=True)
    duration = float(json.loads(probe.stdout)['format']['duration'])
    if not 0 < duration <= 3600: raise ValueError('duration')
    update(job['id'], duration=duration, error='')
    segments, _ = model.transcribe(str(audio), beam_size=1, vad_filter=True)
    text = []
    for segment in segments:
        if cancelled(job['id']): return
        text.append(segment.text.strip())
        update(job['id'], progress=min(99, segment.end / duration * 100), text='\n'.join(text))
    if not cancelled(job['id']):
        update(job['id'], status='completed', progress=100, text='\n'.join(text), error='')


def worker():
    model = None
    while True:
        job = claim()
        if not job:
            time.sleep(2)
            continue
        try:
            if model is None:
                from faster_whisper import WhisperModel
                model = WhisperModel(os.getenv('ASR_MODEL', 'small'), device='cpu', compute_type='int8', cpu_threads=1, num_workers=1)
            transcribe_job(job, model)
        except Exception as exc:
            if cancelled(job['id']): continue
            attempt = job['attempts'] + 1
            permanent = isinstance(exc, (ValueError, subprocess.CalledProcessError))
            update(job['id'], status='failed' if permanent or attempt >= 3 else 'queued',
                   next_run=time.time() + 30 * 2 ** attempt,
                   error='音檔無法讀取或超過 60 分鐘' if permanent else '轉錄暫時失敗，將自動重試' if attempt < 3 else '轉錄失敗，請重試或聯絡管理員')
            audit('transcription-error', job['id'], type(exc).__name__)


def dokploy(method, data, read=False):
    url = API + '/' + method
    body = None if read else json.dumps(data).encode()
    if read: url += '?' + urllib.parse.urlencode(data)
    req = urllib.request.Request(url, data=body, headers={'x-api-key': os.environ['DOKPLOY_API_KEY'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r: return json.load(r)


def commit_of(deployment):
    value = deployment.get('commitId') or deployment.get('commitHash') or ''
    if re.fullmatch('[0-9a-f]{40}', value): return value
    match = re.search(r'(?:Commit:|commit[: ]|CD \S+)\s*([0-9a-f]{40})', (deployment.get('description') or '') + ' ' + (deployment.get('title') or ''))
    return match.group(1) if match else None


def deployments():
    items = []
    for name, target in TARGETS.items():
        try:
            info = dokploy('compose.one', {'composeId': target['compose_id']}, read=True)
            history = sorted(info.get('deployments', []), key=lambda d: d.get('createdAt', ''), reverse=True)[:10]
            rows = [{'status': x.get('status'), 'createdAt': x.get('createdAt'), 'title': x.get('title'), 'commit': commit_of(x)} for x in history]
            done = next((x for x in rows if x['status'] == 'done'), None)
            items.append({'name': name, 'branch': target['branch'], 'url': target['url'], 'status': info.get('composeStatus'),
                          'autoDeploy': bool(info.get('autoDeploy')), 'commit': done['commit'] if done else None,
                          'history': rows, 'console': target['console']})
        except Exception:
            items.append({'name': name, 'branch': target['branch'], 'url': target['url'], 'status': 'unavailable', 'history': []})
    return items


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_): pass

    def send(self, status, body=b'', content_type='application/json', headers=None):
        if isinstance(body, (dict, list)): body = json.dumps(body, ensure_ascii=False).encode()
        if isinstance(body, str): body = body.encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        for k, v in (headers or {}).items(): self.send_header(k, v)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD': self.wfile.write(body)

    def authenticated(self):
        try:
            token = http.cookies.SimpleCookie(self.headers.get('Cookie', ''))['omni_ops'].value
            expiry, sig = token.split('.')
            expected = hmac.new(os.environ['AUTH_COOKIE_SECRET'].encode(), expiry.encode(), hashlib.sha256).hexdigest()
            return time.time() < int(expiry) <= time.time() + TTL + 60 and hmac.compare_digest(sig, expected)
        except (KeyError, ValueError, http.cookies.CookieError): return False

    def do_GET(self):
        route = urllib.parse.urlsplit(self.path).path
        if route == '/healthz': return self.send(200, {'status': 'ok'})
        if route == '/login': return self.send(200, (ROOT / 'login.html').read_bytes(), 'text/html; charset=utf-8')
        if not self.authenticated():
            if route.startswith('/api/'): return self.send(401, {'error': '請重新登入'})
            return self.send(303, headers={'Location': '/login'})
        if route == '/': return self.send(200, (ROOT / 'index.html').read_bytes(), 'text/html; charset=utf-8')
        if route == '/api/deployments': return self.send(200, deployments())
        if route == '/api/jobs':
            with db() as c: rows = [dict(r) for r in c.execute('SELECT * FROM jobs ORDER BY created DESC LIMIT 100')]
            return self.send(200, rows)
        match = re.fullmatch('/api/jobs/([a-f0-9]{32})/download', route)
        if match:
            with db() as c: row = c.execute('SELECT * FROM jobs WHERE id=?', (match[1],)).fetchone()
            if not row or row['status'] != 'completed': return self.send(404, {'error': '逐字稿尚未完成'})
            return self.send(200, row['text'], 'text/plain; charset=utf-8', {'Content-Disposition': 'attachment; filename="transcript.txt"'})
        return self.send(404, {'error': '找不到頁面'})

    def do_POST(self):
        route = urllib.parse.urlsplit(self.path).path
        if self.headers.get('Origin') not in (None, os.environ.get('PUBLIC_ORIGIN', 'https://ops.omni.observe.tw')):
            return self.send(403, {'error': '來源不符'})
        try: size = int(self.headers.get('Content-Length', '0'))
        except ValueError: return self.send(400, {'error': '無效長度'})
        if route == '/login':
            if not 0 < size < 4096: return self.send(400)
            fields = urllib.parse.parse_qs(self.rfile.read(size).decode(errors='replace'))
            digest = hashlib.pbkdf2_hmac('sha256', fields.get('password', [''])[0].encode(), os.environ['AUTH_PASSWORD_SALT'].encode(), 200000).hex()
            if fields.get('username', [''])[0] != USER or not hmac.compare_digest(digest, os.environ['AUTH_PASSWORD_HASH']):
                time.sleep(1)
                return self.send(401, '帳號或密碼不正確，請返回重試。', 'text/plain; charset=utf-8')
            expiry = str(int(time.time()) + TTL)
            sig = hmac.new(os.environ['AUTH_COOKIE_SECRET'].encode(), expiry.encode(), hashlib.sha256).hexdigest()
            return self.send(303, headers={'Location': '/', 'Set-Cookie': f'omni_ops={expiry}.{sig}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age={TTL}'})
        if not self.authenticated(): return self.send(401, {'error': '請重新登入'})
        if route == '/logout': return self.send(303, headers={'Location': '/login', 'Set-Cookie': 'omni_ops=; Path=/; Secure; HttpOnly; Max-Age=0'})
        if route == '/api/jobs':
            if not 0 < size <= MAX_UPLOAD: return self.send(413, {'error': '請上傳 64 MB 以內的音檔'})
            with db() as c: stored = c.execute('SELECT COALESCE(sum(size),0) FROM jobs').fetchone()[0]
            if stored + size > MAX_STORED or shutil.disk_usage(DATA).free < size + 256 * 1024 * 1024:
                return self.send(507, {'error': '錄音儲存額度不足，請聯絡管理員'})
            name = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get('name', ['recording'])[0]
            name = Path(name.replace('\\', '/')).name[:180]
            ident = secrets.token_hex(16)
            target = DATA / 'audio' / ident
            remaining = size
            self.connection.settimeout(60)
            try:
                with target.open('xb') as f:
                    while remaining:
                        chunk = self.rfile.read(min(1024 * 1024, remaining))
                        if not chunk: raise ValueError('short upload')
                        f.write(chunk); remaining -= len(chunk)
                target.chmod(0o600)
                with db() as c:
                    c.execute('INSERT INTO jobs(id,name,status,created,updated,size) VALUES (?,?,?,?,?,?)', (ident,name,'queued',time.time(),time.time(),size))
            except Exception:
                target.unlink(missing_ok=True)
                return self.send(400, {'error': '上傳中斷，請重試'})
            audit('upload', ident)
            return self.send(201, {'id': ident})
        match = re.fullmatch('/api/jobs/([a-f0-9]{32})/(retry|cancel)', route)
        if match:
            with db() as c:
                c.execute('BEGIN IMMEDIATE')
                row = c.execute('SELECT * FROM jobs WHERE id=?', (match[1],)).fetchone()
                if not row: return self.send(404)
                if match[2] == 'retry':
                    if row['status'] not in ('failed', 'cancelled'): return self.send(409, {'error': '此工作不需重試'})
                    # Transaction keeps retry/cancel atomic with the worker claim.
                    c.execute("UPDATE jobs SET status='queued', attempts=0, next_run=?, error='', progress=0, text='' WHERE id=?", (time.time()+5,match[1]))
                else:
                    if row['status'] != 'queued': return self.send(409, {'error': '只能取消尚未開始的工作'})
                    c.execute("UPDATE jobs SET status='cancelled',updated=? WHERE id=?", (time.time(),match[1]))
            audit(match[2], match[1]); return self.send(200, {'ok': True})
        match = re.fullmatch('/api/deployments/([a-z-]+)/redeploy', route)
        if match and match[1] in TARGETS:
            name = match[1]
            try:
                target = TARGETS[name]
                info = dokploy('compose.one', {'composeId': target['compose_id']}, read=True)
                if info.get('composeStatus') == 'running': return self.send(409, {'error': '正在部署，請等待完成'})
                dokploy('compose.deploy', {'composeId': target['compose_id'], 'title': 'Team redeploy ' + name, 'description': 'Requested from authenticated operations portal'})
                audit('redeploy', name)
                return self.send(202, {'ok': True})
            except Exception: return self.send(502, {'error': '部署服務暫時無法連線'})
        return self.send(404)


def main():
    initialize()
    threading.Thread(target=worker, daemon=True).start()
    http.server.ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()


if __name__ == '__main__': main()
