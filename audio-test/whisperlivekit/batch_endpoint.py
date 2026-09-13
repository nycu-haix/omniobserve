"""Complete-file transcription on the dedicated batch worker's loaded GPU model."""
import asyncio

import numpy as np
from fastapi import File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse


def install(server):
    app = server["app"]
    app.router.routes[:] = [r for r in app.router.routes if getattr(r, "path", None) != "/v1/audio/transcriptions"]
    lock = asyncio.Lock()

    @app.post("/v1/audio/transcriptions")
    async def transcribe(file: UploadFile = File(...), language: str = Form("zh"),
                         response_format: str = Form("json"), prompt: str = Form("")):
        data = await file.read(64 * 1024 * 1024 + 1)
        if not data or len(data) > 64 * 1024 * 1024:
            raise HTTPException(413, "Expected a nonempty audio file up to 64 MiB")
        pcm = await server["_convert_to_pcm"](data)
        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        if len(audio) > 16000 * 3600:
            raise HTTPException(413, "Audio exceeds 60 minutes")
        model = server["transcription_engine"].asr.shared_model
        # This worker is reserved for batch jobs; streaming uses whisper-0.
        # Serial decoding prevents concurrent decoder hooks sharing a model.
        async with lock:
            result = await asyncio.to_thread(
                model.transcribe, audio, language=language, task="transcribe",
                initial_prompt=prompt or None, temperature=0, beam_size=1,
                condition_on_previous_text=False,
            )
        if response_format == "text":
            return PlainTextResponse(result["text"].strip())
        if response_format not in ("json", "verbose_json"):
            raise HTTPException(400, "Supported formats: json, verbose_json, text")
        response = {"text": result["text"].strip()}
        if response_format == "verbose_json":
            response.update(language=result.get("language", language),
                            duration=len(audio) / 16000, segments=result.get("segments", []))
        return JSONResponse(response)
