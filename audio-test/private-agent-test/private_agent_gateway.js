const VAD_WS_URL = window.AGENT_API_WS_URL || "ws://" + window.location.hostname + ":8001/ws/audio";

const SAMPLE_RATE = 16000;
const SEND_CHUNK_SIZE = 512;

const DEBUG = false;
const SHOW_RMS = false;

let audioContext = null;
let micStream = null;
let micSource = null;
let processor = null;
let silentGain = null;
let vadWs = null;

let pendingPcm = new Float32Array(0);
let sentChunkCount = 0;

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

// log("✅ private_agent_gateway.js loaded");

async function startPrivateAgent() {
	if (hasStartedAgent) return;

	hasStartedAgent = true;
	isStoppingAgent = false;
	hasReceivedAudioInput = false;

	sentChunkCount = 0;
	pendingPcm = new Float32Array(0);
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
		log(`API WebSocket: ${VAD_WS_URL}`);

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

		// log(`✅ Private Agent started, browser sampleRate=${audioContext.sampleRate}`);
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
			micStream.getTracks().forEach(track => track.stop());
		} catch {}

		micStream = null;
	}

	if (vadWs) {
		try {
			if (vadWs.readyState === WebSocket.OPEN) {
				vadWs.send(
					JSON.stringify({
						type: "stop",
						source: "browser_private",
						scope: "private",
						agentType: "private_browser",
						roomName: getRoomName(),
						userId: getUserId(),
						displayName: getDisplayName()
					})
				);
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

	log("✅ Private Agent stopped");
}

function connectVadWebSocket() {
	return new Promise(resolve => {
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

			vadWs.send(
				JSON.stringify({
					type: "start",
					source: "browser_private",
					scope: "private",
					agentType: "private_browser",
					roomName: getRoomName(),
					participantId: getUserId(),
					userId: getUserId(),
					displayName: getDisplayName(),
					clientId: makeClientId()
				})
			);

			finish();
		};

		vadWs.onerror = err => {
			console.error("WebSocket error:", err);
			finish("⚠️ Backend not connected");
		};

		vadWs.onmessage = event => {
			// log("Backend: " + event.data);
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

	processor.onaudioprocess = event => {
		if (isStoppingAgent || !hasStartedAgent) return;

		const input = event.inputBuffer.getChannelData(0);

		const downsampled = downsampleTo16k(input, audioContext.sampleRate);

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

			log(`⏱️ private audioSec=${audioSec.toFixed(2)}, ` + `wallSec=${wallSec.toFixed(2)}, ` + `ratio=${ratio.toFixed(2)}`);
		}

		const pcmRms = calculateRms(downsampled);
		const pcmPeak = calculatePeak(downsampled);

		if (SHOW_RMS) {
			const now = Date.now();

			if (now - lastLevelLogTime > 1000) {
				lastLevelLogTime = now;

				log(`🎙️ private pcm rms=${pcmRms.toFixed(6)}, ` + `peak=${pcmPeak.toFixed(6)}, ` + `ws=${vadWs?.readyState}, ` + `chunks=${sentChunkCount}`);
			}
		}

		if ((pcmRms > 0.0005 || pcmPeak > 0.01) && !hasReceivedAudioInput) {
			hasReceivedAudioInput = true;
			log("✅ 成功接收到 private microphone input");
		}

		appendAndSendContinuousPcm(downsampled);
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

		for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
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
