from pathlib import Path
import torch
from funasr import AutoModel

BASE_DIR = Path(__file__).resolve().parent

DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"

print(f"Loading FunASR on {DEVICE}...")

model = AutoModel(
    model="paraformer-zh",
    punc_model="ct-punc",
    device=DEVICE,
    disable_update=True,
)

print("FunASR loaded successfully.")

segments_dir = BASE_DIR / "segments"
wav_files = sorted(segments_dir.glob("*.wav")) if segments_dir.exists() else []

if wav_files:
    wav_file = wav_files[0]
    print(f"Testing with wav file: {wav_file}")

    result = model.generate(
        input=str(wav_file),
        language="zh",
        use_itn=True,
        batch_size_s=20,
    )

    print("Raw result:")
    print(result)

    if result and isinstance(result, list) and isinstance(result[0], dict):
        print("Text:")
        print(result[0].get("text", ""))
else:
    print("No wav files found in segments/. Download/load test only.")