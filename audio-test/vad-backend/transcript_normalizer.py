from opencc import OpenCC

cc = OpenCC("s2twp")  # 簡體 → 台灣繁體

def to_traditional(text: str) -> str:
    if not text:
        return text
    return cc.convert(text)