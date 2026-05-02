import asyncio
import json
import math
import struct
import websockets

SAMPLE_RATE = 16000
DURATION_SEC = 3
FREQ = 440

async def main():
    url = "ws://localhost:8000/sessions/localtest/audio-stream?participant_id=test_user&asr=funasr"

    async with websockets.connect(url) as ws:
        await ws.send(json.dumps({
            "type": "start",
            "source": "browser_private",
            "scope": "private",
            "agentType": "private_browser",
            "roomName": "localtest",
            "participantId": "test_user",
            "userId": "test_user",
            "displayName": "test_user",
            "clientId": "local-test",
            "sampleRate": 16000,
            "channels": 1,
            "encoding": "float32",
            "format": "float32",
            "asrModel": "funasr",
        }))

        total_samples = SAMPLE_RATE * DURATION_SEC
        chunk_size = 512

        for start in range(0, total_samples, chunk_size):
            samples = []
            for i in range(start, min(start + chunk_size, total_samples)):
                value = 0.2 * math.sin(2 * math.pi * FREQ * i / SAMPLE_RATE)
                samples.append(value)

            pcm = struct.pack("<" + "f" * len(samples), *samples)
            await ws.send(pcm)
            await asyncio.sleep(chunk_size / SAMPLE_RATE)

        await ws.send(json.dumps({
            "type": "stop",
            "source": "browser_private",
            "scope": "private",
            "agentType": "private_browser",
            "roomName": "localtest",
            "participantId": "test_user",
            "userId": "test_user",
            "displayName": "test_user",
            "clientId": "local-test",
        }))

asyncio.run(main())