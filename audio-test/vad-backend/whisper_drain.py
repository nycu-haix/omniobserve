import asyncio


async def drain_whisper_stream(ws, sender_task, queue, ready_event, timeout=60):
    """Send all queued PCM before EOF and keep reading until ASR completes."""
    if ready_event.is_set():
        return
    await asyncio.wait_for(queue.put(None), timeout=timeout)
    if sender_task is not None:
        await asyncio.wait_for(asyncio.shield(sender_task), timeout=timeout)
    await ws.send(b"")
    await asyncio.wait_for(ready_event.wait(), timeout=timeout)

