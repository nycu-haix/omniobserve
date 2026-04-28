# Audio Test: Public / Private Audio Agent

測試會議語音擷取、VAD 切段與 ASR 轉錄流程

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

public agent test: http://localhost:3000/public-agent-test/public_index_gateway.html http://localhost:3000/public-agent-test/public_index_gateway.html?jitsiUrl=https%3A%2F%2Fomni.elvismao.com%2Fskyishandsome

private agent test: http://localhost:3000/private-agent-test/private_index_gateway.html
