const VAD_WS_URL =
  window.AGENT_API_WS_URL ||
  "ws://localhost:8000/ws/audio";

// REST API base URL
const AUDIO_SEGMENT_API_BASE_URL =
  window.AGENT_API_BASE_URL ||
  "http://localhost:8000";

const SAMPLE_RATE = 16000;
const SEND_CHUNK_SIZE = 512;

// REST audio segment settings
const AUDIO_SEGMENT_MS = 5000;
const AUDIO_SEGMENT_SAMPLES = Math.floor(SAMPLE_RATE * (AUDIO_SEGMENT_MS / 1000));
const AUDIO_SEGMENT_FILE_FORMAT = "wav";
const MIN_UPLOAD_SAMPLES = Math.floor(SAMPLE_RATE * 0.2); // avoid uploading extremely tiny final chunks

const DEBUG = true;
const SHOW_RMS = true;

let audioContext = null;
let micStream = null;
let micSource = null;
let processor = null;
let silentGain = null;
let vadWs = null;

let pendingPcm = new Float32Array(0);
let sentChunkCount = 0;

// REST upload buffer
let pendingUploadPcm = new Float32Array(0);
let currentSegmentStartedAt = null;

let hasStartedAgent = false;
let isStoppingAgent = false;
let hasReceivedAudioInput = false;

let lastLevelLogTime = 0;
let lastTimingLogTime = 0;
let audioSamples = 0;
let wallStart = null;

const logBox = document.getElementById("log");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

const userIdInput = document.getElementById("userIdInput");
const displayNameInput = document.getElementById("displayNameInput");
const roomNameInput = document.getElementById("roomNameInput");

function log(message) {
  console.log(message);
  if (!logBox) return;

  logBox.textContent += message + "\n";
  logBox.scrollTop = logBox.scrollHeight;
}

function debug(message) {
  if (!DEBUG) return;
  log("[debug] " + message);
}

function makeClientId() {
  if (window.crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  return "private_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}

function getUserId() {
  return userIdInput?.value?.trim() || window.AGENT_USER_ID || "unknown_user";
}

function getDisplayName() {
  return displayNameInput?.value?.trim() || window.AGENT_DISPLAY_NAME || "unknown";
}

function getRoomName() {
  return roomNameInput?.value?.trim() || window.AGENT_ROOM_NAME || "unknown_room";
}

// session_id is required in:
// POST /sessions/{session_id}/audio-segments
function getSessionId() {
  return window.AGENT_SESSION_ID || getRoomName();
}

if (startBtn) {
  startBtn.addEventListener("click", () => {
    startPrivateAgent();
  });
}

if (stopBtn) {
  stopBtn.addEventListener("click", () => {
    stopPrivateAgent();
  });
}

log("✅ private_agent_gateway.js loaded");

async function startPrivateAgent() {
  if (hasStartedAgent) return;

  hasStartedAgent = true;
  isStoppingAgent = false;
  hasReceivedAudioInput = false;

  sentChunkCount = 0;
  pendingPcm = new Float32Array(0);

  pendingUploadPcm = new Float32Array(0);
  currentSegmentStartedAt = null;

  audioSamples = 0;
  wallStart = null;
  lastLevelLogTime = 0;
  lastTimingLogTime = 0;

  try {
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;

    log(`Private User ID: ${getUserId()}`);
    log(`Display Name: ${getDisplayName()}`);
    log(`Room Name: ${getRoomName()}`);
    log(`Session ID: ${getSessionId()}`);
    log(`API WebSocket: ${VAD_WS_URL}`);
    log(`Audio Segment REST API: ${AUDIO_SEGMENT_API_BASE_URL}/sessions/${getSessionId()}/audio-segments`);

    log("Connecting to backend...");
    await connectVadWebSocket();

    if (isStoppingAgent) return;

    log("Requesting microphone permission...");

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      },
      video: false
    });

    log("✅ Microphone permission granted");

    audioContext = new AudioContext();
    await audioContext.resume();

    startMicPipeline();

    log(`✅ Private Agent started, browser sampleRate=${audioContext.sampleRate}`);
  } catch (err) {
    log("❌ Failed to start private agent: " + (err.message || err));
    console.error(err);

    hasStartedAgent = false;

    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
  }
}

async function stopPrivateAgent() {
  if (!hasStartedAgent && isStoppingAgent) return;

  log("🛑 Stopping Private Agent...");

  isStoppingAgent = true;
  hasStartedAgent = false;

  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;

  // Upload the final remaining audio segment, if there is any.
  await flushPendingUploadSegment();

  if (processor) {
    try {
      processor.onaudioprocess = null;
      processor.disconnect();
    } catch {}

    processor = null;
  }

  if (micSource) {
    try {
      micSource.disconnect();
    } catch {}

    micSource = null;
  }

  if (silentGain) {
    try {
      silentGain.disconnect();
    } catch {}

    silentGain = null;
  }

  if (micStream) {
    try {
      micStream.getTracks().forEach((track) => track.stop());
    } catch {}

    micStream = null;
  }

  if (vadWs) {
    try {
      if (vadWs.readyState === WebSocket.OPEN) {
        vadWs.send(JSON.stringify({
          type: "stop",
          source: "browser_private",
          scope: "private",
          agentType: "private_browser",
          roomName: getRoomName(),
          userId: getUserId(),
          displayName: getDisplayName()
        }));
      }
    } catch {}

    try {
      vadWs.close();
    } catch {}

    vadWs = null;
  }

  if (audioContext) {
    try {
      await audioContext.close();
    } catch {}

    audioContext = null;
  }

  pendingPcm = new Float32Array(0);
  sentChunkCount = 0;

  pendingUploadPcm = new Float32Array(0);
  currentSegmentStartedAt = null;

  log("✅ Private Agent stopped");
}

function connectVadWebSocket() {
  return new Promise((resolve) => {
    let settled = false;

    function finish(message) {
      if (settled) return;

      settled = true;

      if (message) {
        log(message);
      }

      resolve();
    }

    vadWs = new WebSocket(VAD_WS_URL);
    vadWs.binaryType = "arraybuffer";

    vadWs.onopen = () => {
      log("✅ Connected to backend");

      vadWs.send(JSON.stringify({
        type: "start",
        source: "browser_private",
        scope: "private",
        agentType: "private_browser",
        roomName: getRoomName(),
        participantId: getUserId(),
        userId: getUserId(),
        displayName: getDisplayName(),
        clientId: makeClientId()
      }));

      finish();
    };

    vadWs.onerror = (err) => {
      console.error("WebSocket error:", err);
      finish("⚠️ Backend not connected");
    };

    vadWs.onmessage = (event) => {
      log("Backend: " + event.data);
    };

    vadWs.onclose = () => {
      debug("WebSocket closed");
    };

    setTimeout(() => {
      if (!vadWs || vadWs.readyState !== WebSocket.OPEN) {
        finish("⚠️ Backend connection timeout");
      }
    }, 1500);
  });
}

function startMicPipeline() {
  if (!audioContext || !micStream) {
    throw new Error("audioContext or micStream not ready");
  }

  micSource = audioContext.createMediaStreamSource(micStream);
  processor = audioContext.createScriptProcessor(4096, 1, 1);

  silentGain = audioContext.createGain();
  silentGain.gain.value = 0.00001;

  micSource.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(audioContext.destination);

  processor.onaudioprocess = (event) => {
    if (isStoppingAgent || !hasStartedAgent) return;

    const input = event.inputBuffer.getChannelData(0);

    const downsampled = downsampleTo16k(
      input,
      audioContext.sampleRate
    );

    if (wallStart === null) {
      wallStart = Date.now();
    }

    audioSamples += downsampled.length;

    const now = Date.now();

    if (now - lastTimingLogTime > 5000) {
      lastTimingLogTime = now;

      const audioSec = audioSamples / SAMPLE_RATE;
      const wallSec = (now - wallStart) / 1000;
      const ratio = wallSec > 0.1 ? audioSec / wallSec : 0;

      log(
        `⏱️ private audioSec=${audioSec.toFixed(2)}, ` +
        `wallSec=${wallSec.toFixed(2)}, ` +
        `ratio=${ratio.toFixed(2)}`
      );
    }

    const pcmRms = calculateRms(downsampled);
    const pcmPeak = calculatePeak(downsampled);

    if (SHOW_RMS) {
      const now = Date.now();

      if (now - lastLevelLogTime > 1000) {
        lastLevelLogTime = now;

        log(
          `🎙️ private pcm rms=${pcmRms.toFixed(6)}, ` +
          `peak=${pcmPeak.toFixed(6)}, ` +
          `ws=${vadWs?.readyState}, ` +
          `chunks=${sentChunkCount}`
        );
      }
    }

    if ((pcmRms > 0.0005 || pcmPeak > 0.01) && !hasReceivedAudioInput) {
      hasReceivedAudioInput = true;
      log("✅ 成功接收到 private microphone input");
    }

    // 原本 WebSocket PCM 傳送：保留
    appendAndSendContinuousPcm(downsampled);

    // 新增 REST multipart audio segment 上傳：符合 API 格式
    appendAndUploadAudioSegment(downsampled);
  };
}

function downsampleTo16k(buffer, inputSampleRate) {
  const outputSampleRate = SAMPLE_RATE;

  if (inputSampleRate === outputSampleRate) {
    return new Float32Array(buffer);
  }

  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);

  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);

    let accum = 0;
    let count = 0;

    for (
      let i = offsetBuffer;
      i < nextOffsetBuffer && i < buffer.length;
      i++
    ) {
      accum += buffer[i];
      count++;
    }

    result[offsetResult] = count > 0 ? accum / count : 0;

    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function calculateRms(buffer) {
  if (!buffer || buffer.length === 0) return 0;

  let sum = 0;

  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }

  return Math.sqrt(sum / buffer.length);
}

function calculatePeak(buffer) {
  if (!buffer || buffer.length === 0) return 0;

  let peak = 0;

  for (let i = 0; i < buffer.length; i++) {
    const value = Math.abs(buffer[i]);
    if (value > peak) peak = value;
  }

  return peak;
}

function appendAndSendContinuousPcm(newPcm) {
  const merged = new Float32Array(pendingPcm.length + newPcm.length);

  merged.set(pendingPcm, 0);
  merged.set(newPcm, pendingPcm.length);

  let offset = 0;

  while (offset + SEND_CHUNK_SIZE <= merged.length) {
    const chunk = merged.slice(offset, offset + SEND_CHUNK_SIZE);

    if (vadWs && vadWs.readyState === WebSocket.OPEN) {
      const safeChunk = new Float32Array(chunk);
      vadWs.send(safeChunk.buffer);

      sentChunkCount++;

      if (sentChunkCount % 100 === 0) {
        log(`📤 sent private PCM chunks: ${sentChunkCount}, ws=${vadWs?.readyState}`);
      }
    }

    offset += SEND_CHUNK_SIZE;
  }

  pendingPcm = merged.slice(offset);
}

function appendAndUploadAudioSegment(newPcm) {
  if (!newPcm || newPcm.length === 0) return;

  if (!currentSegmentStartedAt) {
    currentSegmentStartedAt = new Date();
  }

  const merged = new Float32Array(pendingUploadPcm.length + newPcm.length);

  merged.set(pendingUploadPcm, 0);
  merged.set(newPcm, pendingUploadPcm.length);

  let offset = 0;

  while (offset + AUDIO_SEGMENT_SAMPLES <= merged.length) {
    const segmentPcm = merged.slice(offset, offset + AUDIO_SEGMENT_SAMPLES);

    const startedAt = currentSegmentStartedAt;
    const durationMs = Math.round((segmentPcm.length / SAMPLE_RATE) * 1000);
    const endedAt = new Date(startedAt.getTime() + durationMs);

    currentSegmentStartedAt = endedAt;

    const audioBlob = float32PcmToWavBlob(segmentPcm, SAMPLE_RATE);

    uploadAudioSegment({
      sessionId: getSessionId(),
      participantId: getUserId(),
      micMode: "private",
      audioBlob,
      fileFormat: AUDIO_SEGMENT_FILE_FORMAT,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString()
    })
      .then((result) => {
        log(
          `✅ uploaded audio segment: ${result.id}, ` +
          `duration_ms=${result.duration_ms ?? durationMs}`
        );
      })
      .catch((err) => {
        log("❌ upload audio segment failed: " + (err.message || err));
        console.error(err);
      });

    offset += AUDIO_SEGMENT_SAMPLES;
  }

  pendingUploadPcm = merged.slice(offset);
}

async function flushPendingUploadSegment() {
  if (!pendingUploadPcm || pendingUploadPcm.length < MIN_UPLOAD_SAMPLES) {
    pendingUploadPcm = new Float32Array(0);
    currentSegmentStartedAt = null;
    return;
  }

  const segmentPcm = pendingUploadPcm;
  const startedAt = currentSegmentStartedAt || new Date();
  const durationMs = Math.round((segmentPcm.length / SAMPLE_RATE) * 1000);
  const endedAt = new Date(startedAt.getTime() + durationMs);

  pendingUploadPcm = new Float32Array(0);
  currentSegmentStartedAt = null;

  const audioBlob = float32PcmToWavBlob(segmentPcm, SAMPLE_RATE);

  try {
    const result = await uploadAudioSegment({
      sessionId: getSessionId(),
      participantId: getUserId(),
      micMode: "private",
      audioBlob,
      fileFormat: AUDIO_SEGMENT_FILE_FORMAT,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString()
    });

    log(
      `✅ uploaded final audio segment: ${result.id}, ` +
      `duration_ms=${result.duration_ms ?? durationMs}`
    );
  } catch (err) {
    log("❌ upload final audio segment failed: " + (err.message || err));
    console.error(err);
  }
}

async function uploadAudioSegment({
  sessionId,
  participantId,
  micMode,
  audioBlob,
  fileFormat,
  startedAt,
  endedAt,
  retryOf = null,
}) {
  const formData = new FormData();

  formData.append("participant_id", participantId);
  formData.append("mic_mode", micMode); // "public" or "private"
  formData.append("file_format", fileFormat); // "wav" / "webm" / "mp3" / "m4a"
  formData.append("started_at", startedAt);
  formData.append("ended_at", endedAt);
  formData.append("audioFile", audioBlob, `segment.${fileFormat}`);

  if (retryOf) {
    formData.append("retry_of", retryOf);
  }

  const response = await fetch(
    `${AUDIO_SEGMENT_API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/audio-segments`,
    {
      method: "POST",
      body: formData,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upload failed: ${response.status} ${errorText}`);
  }

  return await response.json();
}

function float32PcmToWavBlob(float32Array, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = float32Array.length * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");

  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;

  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    const intSample = sample < 0
      ? sample * 0x8000
      : sample * 0x7fff;

    view.setInt16(offset, intSample, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}