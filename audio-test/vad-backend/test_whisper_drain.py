import asyncio
import unittest
from whisper_drain import drain_whisper_stream, committed_whisper_text


class DrainTests(unittest.IsolatedAsyncioTestCase):
    def test_multiple_committed_utterances_survive_finalization(self):
        lines = [{"text":"第一句。"}, {"speaker":-2,"text":"silence"}, {"text":"第二句。"}, {"transcription":"最後一句。"}]
        self.assertEqual(committed_whisper_text(lines), "第一句。第二句。最後一句。")

    async def test_audio_precedes_eof_and_delayed_final_is_received(self):
        queue = asyncio.Queue()
        ready = asyncio.Event()
        sent = []
        class Socket:
            async def send(self, item):
                sent.append(item)
                if item == b'':
                    asyncio.get_running_loop().call_later(.01, ready.set)
        ws = Socket()
        await queue.put(b'first')
        await queue.put(b'last')
        async def sender():
            while (item := await queue.get()) is not None:
                await ws.send(item)
        task = asyncio.create_task(sender())
        await drain_whisper_stream(ws, task, queue, ready, timeout=1)
        self.assertEqual(sent, [b'first', b'last', b''])
        self.assertTrue(ready.is_set())

    async def test_missing_completion_times_out_instead_of_claiming_success(self):
        class Socket:
            async def send(self, item): pass
        with self.assertRaises(asyncio.TimeoutError):
            await drain_whisper_stream(Socket(), None, asyncio.Queue(), asyncio.Event(), timeout=.01)

    async def test_completed_stream_is_not_stopped_twice(self):
        ready = asyncio.Event(); ready.set()
        class Socket:
            async def send(self, item): raise AssertionError('duplicate EOF')
        await drain_whisper_stream(Socket(), None, asyncio.Queue(), ready)


if __name__ == '__main__': unittest.main()
