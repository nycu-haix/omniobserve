import io
import os
import wave

import numpy as np

_MODEL_NAME = os.getenv("ASR_MODEL_NAME", "MediaTek-Research/Breeze-ASR-25")
_SAMPLE_RATE = 16000

_processor = None
_model = None
_device = None


def _load() -> None:
    global _processor, _model, _device

    if _processor is not None:
        return

    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    _device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dtype = torch.float16 if _device.type == "cuda" else torch.float32

    _processor = WhisperProcessor.from_pretrained(_MODEL_NAME)
    _model = WhisperForConditionalGeneration.from_pretrained(
        _MODEL_NAME, torch_dtype=dtype
    ).to(_device)
    _model.eval()


def transcribe(wav_bytes: bytes) -> str:
    import torch

    _load()

    with io.BytesIO(wav_bytes) as buf:
        with wave.open(buf, "rb") as wf:
            frames = wf.readframes(wf.getnframes())
            src_rate = wf.getframerate()
            n_channels = wf.getnchannels()

    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0

    if n_channels > 1:
        audio = audio.reshape(-1, n_channels).mean(axis=1)

    if src_rate != _SAMPLE_RATE:
        duration = len(audio) / float(src_rate)
        new_len = int(round(duration * _SAMPLE_RATE))
        old_x = np.linspace(0.0, duration, num=len(audio), endpoint=False)
        new_x = np.linspace(0.0, duration, num=new_len, endpoint=False)
        audio = np.interp(new_x, old_x, audio).astype(np.float32)

    audio = np.clip(audio, -1.0, 1.0)

    rms = float(np.sqrt(np.mean(audio ** 2)))
    if rms < 0.0008:
        return ""

    inputs = _processor(
        audio,
        sampling_rate=_SAMPLE_RATE,
        return_tensors="pt",
        return_attention_mask=True,
    )

    input_features = inputs.input_features.to(_device)
    if _device.type == "cuda":
        input_features = input_features.to(torch.float16)

    generate_kwargs: dict = {"max_new_tokens": 128, "no_repeat_ngram_size": 3}
    try:
        generate_kwargs["forced_decoder_ids"] = _processor.get_decoder_prompt_ids(
            language="zh", task="transcribe"
        )
    except Exception:
        generate_kwargs["language"] = "zh"
        generate_kwargs["task"] = "transcribe"

    if getattr(inputs, "attention_mask", None) is not None:
        generate_kwargs["attention_mask"] = inputs.attention_mask.to(_device)

    with torch.no_grad():
        predicted_ids = _model.generate(input_features, **generate_kwargs)

    return _processor.batch_decode(predicted_ids, skip_special_tokens=True)[0].strip()
