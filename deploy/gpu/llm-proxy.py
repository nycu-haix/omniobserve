"""Private OpenAI-compatible adapter for the shared Ollama model.

Ollama uses reasoning_effort, while application branches send enable_thinking.
Keep this service on the internal embeddings network; it has no public route.
"""
import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ORIGIN = os.environ.get("OLLAMA_ORIGIN", "http://embedding-cpu:11434").rstrip("/")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return
        self.proxy()

    def do_POST(self):
        self.proxy()

    def proxy(self):
        if self.path not in ("/v1/chat/completions", "/v1/models"):
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 <= length <= 4 * 1024 * 1024:
                self.send_error(413)
                return
            body = self.rfile.read(length) if length else None
            if body and self.path == "/v1/chat/completions":
                payload = json.loads(body)
                if not isinstance(payload, dict):
                    raise ValueError("Expected JSON object")
                thinking = payload.pop("enable_thinking", False)
                payload.setdefault("reasoning_effort", "medium" if thinking else "none")
                body = json.dumps(payload).encode()
            request = urllib.request.Request(
                ORIGIN + self.path, data=body, method=self.command,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                self.send_response(response.status)
                self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
                self.end_headers()
                while chunk := response.read1(8192):
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except urllib.error.HTTPError as error:
            self.send_response(error.code)
            self.end_headers()
            self.wfile.write(error.read())
        except (ValueError, TypeError):
            self.send_error(400)
        except (OSError, urllib.error.URLError):
            self.send_error(502)

    def log_message(self, *args):
        # Requests may contain meeting content; do not log bodies or headers.
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
