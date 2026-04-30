# OmniObserve Audio Test

This directory contains the standalone audio test stack for validating browser microphone capture, WebSocket audio streaming, backend VAD segmentation, FunASR transcription, and transcript return messages.

It is separate from the main `backend/` and `frontend/` app. Use it when you want to test whether the audio pipeline itself works before wiring it into the full OmniObserve meeting experience.

## What It Provides

- `vad-backend/`: FastAPI backend with Silero VAD and FunASR.
- `GET /`: browser diagnostic page for direct microphone testing.
- `GET /healthz`: backend health check.
- `WS /ws/audio`: simple audio WebSocket endpoint.
- `WS /sessions/{session_id}/audio-stream?participant_id=...`: session-scoped audio WebSocket endpoint.
- `merge/`, `public-agent-test/`, `private-agent-test/`: older static browser test pages for Jitsi-oriented testing.

The recommended test entrypoint is now the backend diagnostic page:

```text
http://localhost:8000/
```

On the deployed service:

```text
https://ai.omni.elvismao.com/
```

## Docker Run

The Docker Compose setup is intended for Linux hosts with Nvidia GPU support.

```bash
cd audio-test
docker compose up --build
```

Exposed local ports:

```text
Backend diagnostic page: http://localhost:8001/
Backend health check:    http://localhost:8001/healthz
Backend WebSocket:       ws://localhost:8001/ws/audio
Static test pages:       http://localhost:3001/
```

The compose file requests an Nvidia GPU device for `vad-backend`. On macOS Docker Desktop, prefer the direct Python setup above unless you remove or override the GPU reservation.

The Docker image uses `vad-backend/requirements.cuda-v100.txt`, which pins PyTorch and torchaudio to CUDA 11.8 wheels for V100 compatibility:

```text
torch==2.4.1+cu118
torchaudio==2.4.1+cu118
```

After rebuilding on the V100 host, backend startup logs should include `supported_arches` with `sm_70`.

## Browser Diagnostic Test

Use the diagnostic page to test the whole pipeline manually:

1. Open `http://localhost:8000/` locally or `https://ai.omni.elvismao.com/` on deployment.
2. Keep the default WebSocket URL unless testing a different backend.
3. Set `Session / roomName`, `Participant ID`, and `Display Name` if needed.
4. Press `Start microphone` and allow microphone access.
5. Speak Chinese for 2-5 seconds.
6. Stop speaking for at least 1.2 seconds so VAD can close the segment.
7. Confirm the page shows:
   - WebSocket status is open while running.
   - PCM chunks increase.
   - VAD start/end events appear in the log.
   - `segment_saved` appears after speech ends.
   - latest transcript appears after ASR finishes.

If the page receives `asr_error`, check the backend terminal logs first. If VAD events appear but no transcript returns, the audio path is working and the failure is likely in ASR/model loading.

## CLI WAV Smoke Test

`vad-backend/test_pcm_sender.py` streams a WAV file to the backend as continuous 16kHz mono PCM chunks. It prints backend messages and reports whether a transcript or ASR error was received.

Install dependencies in the same environment used by the backend, then run:

```bash
cd audio-test/vad-backend
source .venv/bin/activate

python test_pcm_sender.py /path/to/test.wav \
  --ws ws://localhost:8000/ws/audio \
  --room smoke-test \
  --participant-id cli_user \
  --display-name "CLI User"
```

For the deployed service:

```bash
python test_pcm_sender.py /path/to/test.wav \
  --ws wss://ai.omni.elvismao.com/ws/audio \
  --room smoke-test \
  --participant-id cli_user \
  --display-name "CLI User"
```

Expected output includes backend JSON messages such as `vad`, `segment_saved`, and then either:

```text
SMOKE_RESULT: transcript
```

or:

```text
SMOKE_RESULT: asr_error
```

By default, the smoke test does not clear backend output files. To explicitly clear prior wav/transcript outputs before sending audio, add:

```bash
--reset-outputs
```

## WebSocket Protocol

The browser and CLI use the same basic protocol.

Start message:

```json
{
  "type": "start",
  "source": "browser_diagnostic",
  "scope": "private",
  "agentType": "diagnostic_browser",
  "roomName": "audio-diagnostic",
  "participantId": "diagnostic_user",
  "userId": "diagnostic_user",
  "displayName": "Diagnostic User",
  "sampleRate": 16000,
  "channels": 1,
  "encoding": "float32",
  "format": "float32"
}
```

Audio chunks:

```text
Binary Float32 PCM, mono, 16kHz
```

Stop message:

```json
{
  "type": "stop"
}
```

Common backend messages:

```text
vad
segment_saved
transcript
asr_error
reset_outputs_done
```

## Deployment Checks

For the deployed backend:

```bash
curl -i https://ai.omni.elvismao.com/healthz
```

Expected:

```json
{"status":"ok"}
```

A healthy `/healthz` only proves the FastAPI process is alive. To verify the real audio service, use the browser diagnostic page or the CLI WAV smoke test.

## ASR Device Settings

The backend selects the ASR device with `ASR_DEVICE`:

```text
ASR_DEVICE=auto    # default; use cuda:0 if torch detects CUDA, otherwise cpu
ASR_DEVICE=cpu     # force CPU
ASR_DEVICE=cuda:0  # force first CUDA device
```

For quick tests, the punctuation model can be disabled:

```text
FUNASR_DISABLE_PUNC=1
```

If deployment on an older Nvidia GPU such as V100 returns:

```text
CUDA error: no kernel image is available for execution on the device
```

then the installed PyTorch/CUDA wheel is not compatible with that GPU architecture. The fastest recovery is to redeploy with `ASR_DEVICE=cpu` to confirm ASR correctness. The proper GPU fix is to rebuild the image with a PyTorch CUDA wheel that still supports the V100 target.

For the provided Docker setup, rebuild the backend image after pulling the latest files:

```bash
cd audio-test
docker compose build --no-cache vad-backend
docker compose up -d vad-backend
docker compose logs -f vad-backend
```

Confirm the logs show a V100 device with `capability=sm_70` and that `supported_arches` includes `sm_70`.

## Runtime Output Files

The backend writes runtime outputs under:

```text
audio-test/vad-backend/segments/*.wav
audio-test/vad-backend/transcripts.jsonl
```

`server_gateway.py` clears old segment and transcript outputs on startup. These files are runtime artifacts and should not be treated as source files.
