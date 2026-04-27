from pathlib import Path
import torch
from transformers import WhisperProcessor, WhisperForConditionalGeneration

MODEL_NAME = "MediaTek-Research/Breeze-ASR-25"
SAVE_DIR = Path("models") / "Breeze-ASR-25"

SAVE_DIR.mkdir(parents=True, exist_ok=True)

print("Downloading processor...")
processor = WhisperProcessor.from_pretrained(MODEL_NAME)
processor.save_pretrained(SAVE_DIR)

print("Downloading model...")
model = WhisperForConditionalGeneration.from_pretrained(
    MODEL_NAME,
    torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
)
model.save_pretrained(SAVE_DIR)

print(f"Saved Breeze ASR 25 to: {SAVE_DIR.resolve()}")