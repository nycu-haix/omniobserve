import torch
from transformers import WhisperProcessor, WhisperForConditionalGeneration

MODEL_NAME = "MediaTek-Research/Breeze-ASR-25"

print("Loading processor from Hugging Face cache or downloading if missing...")
processor = WhisperProcessor.from_pretrained(MODEL_NAME)

print("Loading model from Hugging Face cache or downloading if missing...")
model = WhisperForConditionalGeneration.from_pretrained(
    MODEL_NAME,
    torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
)

print("Breeze ASR 25 is ready.")
print("Model files are stored in Hugging Face cache, not in ./models/Breeze-ASR-25")