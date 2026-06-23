# Audio Test: Public / Private Audio Agent

測試會議語音擷取、WhisperLiveKit VAD/SimulStreaming 與 Breeze ASR 25 即時轉錄流程

## Docker Compose

```
cd audio-test
docker compose up --build
```

- frontend: http://localhost:3000/merge/omni_index_gateway.html
- public agent test: http://localhost:3000/public-agent-test/public_index_gateway.html
- private agent test: http://localhost:3000/private-agent-test/private_index_gateway.html
- backend websocket: ws://localhost:8000/ws/audio

第一次啟動會載入 WhisperLiveKit 與掛載的 Breeze ASR 25 模型，會需要比較久；模型 cache 會保存在 Docker volume `model-cache`。

terminal 1(backend)

```
cd audio-test\vad-backend
.\venv\Scripts\Activate.ps1
uvicorn server_gateway:app --host 0.0.0.0 --port 8000
```

terminal 2(frontend)

```
cd audio-test\public-agent-test
python -m http.server 3000
```

public agent test: http://localhost:3000/public-agent-test/public_index_gateway.html http://localhost:3000/public-agent-test/public_index_gateway.html?jitsiUrl=https%3A%2F%2Fomni.observe.tw%2Flost-at-sea

private agent test: http://localhost:3000/private-agent-test/private_index_gateway.html
