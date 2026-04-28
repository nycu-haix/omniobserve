const params = new URLSearchParams(window.location.search);

const JITSI_URL = params.get("jitsiUrl") || window.AGENT_JITSI_URL || "https://meet.jit.si/heiohkwnjr";

const VAD_WS_URL = params.get("apiWsUrl") || window.AGENT_API_WS_URL || "ws://" + window.location.hostname + ":8001/ws/audio";

const AUTO_START = params.get("autoStart") === "true";

const { domain: JITSI_DOMAIN, roomName: ROOM_NAME } = parseJitsiUrl(JITSI_URL);

function parseJitsiUrl(url) {
	const parsed = new URL(url);

	const domain = parsed.hostname;

	// lib-jitsi-meet 不接受大寫 room name，所以統一轉小寫
	const roomName = parsed.pathname.replace(/^\/+/, "").split("/")[0].toLowerCase();

	if (!domain || !roomName) {
		throw new Error("Invalid Jitsi URL: " + url);
	}

	return {
		domain,
		roomName
	};
}

const DEBUG = false;
const SHOW_RMS = false;

let connection = null;
let conference = null;
let audioContext = null;
let vadWs = null;

let hasReceivedAudioInput = false;
let lastLevelLogTime = 0;

let mixerNode = null;
let mixerCompressor = null;
let mixerProcessor = null;
let mixerSilentGain = null;
let mixerPipelineStarted = false;

let mixedAudioSamples = 0;
let mixedWallStart = null;
let lastTimingLogTime = 0;

let pendingPcm = new Float32Array(0);
let sentChunkCount = 0;

const remoteAudioPipelines = new Map();
const participants = new Map();

const logBox = document.getElementById("log");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

let hasStartedAgent = false;
let isStoppingAgent = false;
let allowPageOutput = true;

function log(message, force = false) {
	console.log(message);

	if (!allowPageOutput && !force) return;
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

	return "client_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}

// log("✅ public_agent_gateway.js version: audio-capturestream-final-001");

if (startBtn) {
	startBtn.addEventListener("click", () => {
		startAgent();
	});
} else {
	console.error("startBtn not found");
}

if (stopBtn) {
	stopBtn.addEventListener("click", () => {
		stopAgent();
	});
}

if (AUTO_START) {
	setTimeout(() => {
		startAgent();
	}, 300);
}

async function startAgent() {
	if (hasStartedAgent) return;

	hasStartedAgent = true;
	isStoppingAgent = false;
	allowPageOutput = true;

	try {
		if (startBtn) startBtn.disabled = true;
		if (stopBtn) stopBtn.disabled = false;

		audioContext = new AudioContext();
		await audioContext.resume();

		log(`Jitsi URL: ${JITSI_URL}`);
		log(`Room name: ${ROOM_NAME}`);
		log(`API WebSocket: ${VAD_WS_URL}`);

		log("Connecting to backend...");
		await connectVadWebSocket();

		if (isStoppingAgent) return;

		// log("Starting Public Agent...");
		startPublicAgent();
	} catch (err) {
		log("❌ Failed to start agent: " + (err.message || err), true);
		console.error(err);

		hasStartedAgent = false;

		if (startBtn) startBtn.disabled = false;
		if (stopBtn) stopBtn.disabled = true;
	}
}

async function stopAgent() {
	if (!hasStartedAgent && isStoppingAgent) return;

	log("🛑 Stopping Public Agent...", true);

	isStoppingAgent = true;
	hasStartedAgent = false;

	if (startBtn) startBtn.disabled = false;
	if (stopBtn) stopBtn.disabled = true;

	for (const [, pipeline] of remoteAudioPipelines.entries()) {
		try {
			pipeline.cleanup();
		} catch (err) {
			console.warn("Failed to cleanup audio pipeline:", err);
		}
	}

	remoteAudioPipelines.clear();
	participants.clear();

	if (mixerProcessor) {
		try {
			mixerProcessor.onaudioprocess = null;
			mixerProcessor.disconnect();
		} catch (err) {
			console.warn("Failed to disconnect mixerProcessor:", err);
		}

		mixerProcessor = null;
	}

	if (mixerNode) {
		try {
			mixerNode.disconnect();
		} catch {}

		mixerNode = null;
	}

	if (mixerCompressor) {
		try {
			mixerCompressor.disconnect();
		} catch {}

		mixerCompressor = null;
	}

	if (mixerSilentGain) {
		try {
			mixerSilentGain.disconnect();
		} catch {}

		mixerSilentGain = null;
	}

	mixerPipelineStarted = false;

	if (conference) {
		try {
			conference.leave();
		} catch (err) {
			console.warn("Failed to leave conference:", err);
		}

		conference = null;
	}

	if (connection) {
		try {
			connection.disconnect();
		} catch (err) {
			console.warn("Failed to disconnect Jitsi:", err);
		}

		connection = null;
	}

	if (vadWs) {
		try {
			if (vadWs.readyState === WebSocket.OPEN) {
				vadWs.send(
					JSON.stringify({
						type: "stop",
						source: "browser_public",
						scope: "public",
						agentType: "public agent",
						roomName: ROOM_NAME,
						userId: "public agent",
						displayName: "public agent"
					})
				);
			}
		} catch (err) {
			console.warn("Failed to send stop message:", err);
		}

		try {
			vadWs.close();
		} catch {}

		vadWs = null;
	}

	if (audioContext) {
		try {
			await audioContext.close();
		} catch (err) {
			console.warn("Failed to close audioContext:", err);
		}

		audioContext = null;
	}

	pendingPcm = new Float32Array(0);
	sentChunkCount = 0;
	mixedAudioSamples = 0;
	mixedWallStart = null;
	lastTimingLogTime = 0;
	lastLevelLogTime = 0;
	hasReceivedAudioInput = false;

	log("✅ Public Agent stopped", true);

	allowPageOutput = false;
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
					source: "browser_public",
					scope: "public",
					agentType: "public_browser",
					roomName: ROOM_NAME,
					participantId: "public agent",
					userId: "public agent",
					displayName: "public agent",
					clientId: makeClientId()
				})
			);

			finish();
		};

		vadWs.onerror = err => {
			console.error("WebSocket error:", err);
			finish("⚠️ Backend not connected, continue without backend");
		};

		vadWs.onmessage = event => {
			// log("Backend: " + event.data);
		};

		vadWs.onclose = () => {
			debug("WebSocket closed");
		};

		setTimeout(() => {
			if (!vadWs || vadWs.readyState !== WebSocket.OPEN) {
				finish("⚠️ Backend connection timeout, continue without backend");
			}
		}, 1500);
	});
}

function startPublicAgent() {
	JitsiMeetJS.init();

	const options = buildJitsiOptions();

	// log("Jitsi options: " + JSON.stringify(options, null, 2));

	connection = new JitsiMeetJS.JitsiConnection(null, null, options);

	connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED, onConnectionSuccess);

	connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_FAILED, err => {
		if (isStoppingAgent) return;

		log("❌ Jitsi connection failed: " + JSON.stringify(err));
		console.error("Jitsi connection failed:", err);
		console.error("Jitsi options:", options);
	});

	connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED, () => {
		if (isStoppingAgent) return;

		log("Jitsi connection disconnected");
	});

	connection.connect();
}

function normalizeServiceUrl(url) {
	if (!url) return null;

	let finalUrl = url;

	if (finalUrl.startsWith("//")) {
		if (finalUrl.includes("xmpp-websocket")) {
			finalUrl = (window.location.protocol === "https:" ? "wss:" : "ws:") + finalUrl;
		} else {
			finalUrl = window.location.protocol + finalUrl;
		}
	}

	finalUrl = finalUrl.replace("{roomName}", encodeURIComponent(ROOM_NAME));

	if (!/[?&]room=/.test(finalUrl)) {
		finalUrl += (finalUrl.includes("?") ? "&" : "?") + "room=" + encodeURIComponent(ROOM_NAME);
	}

	return finalUrl;
}

function buildJitsiOptions() {
	const serverConfig = window.config || {};

	const hosts = {
		...(serverConfig.hosts || {}),
		domain: serverConfig.hosts?.domain || JITSI_DOMAIN,
		muc: serverConfig.hosts?.muc || `conference.${JITSI_DOMAIN}`
	};

	let serviceUrl = null;

	if (serverConfig.websocket) {
		serviceUrl = normalizeServiceUrl(serverConfig.websocket);
	} else if (serverConfig.bosh) {
		serviceUrl = normalizeServiceUrl(serverConfig.bosh);
	} else {
		serviceUrl = `wss://${JITSI_DOMAIN}/xmpp-websocket?room=${encodeURIComponent(ROOM_NAME)}`;
	}

	return {
		hosts,
		serviceUrl,
		clientNode: "http://jitsi.org/jitsimeet",
		deploymentInfo: serverConfig.deploymentInfo || {}
	};
}

function onConnectionSuccess() {
	log("✅ Connected to Jitsi");

	try {
		// log("Before initJitsiConference");

		conference = connection.initJitsiConference(ROOM_NAME, {
			p2p: {
				enabled: false
			}
		});

		// log("✅ Conference object created");
	} catch (err) {
		log("❌ initJitsiConference failed: " + (err.message || err));
		console.error(err);
		return;
	}

	conference.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED, () => {
		// log(`✅ Joined conference: ${ROOM_NAME}`);

		try {
			conference.setDisplayName("Public Audio Agent");
		} catch (err) {
			log("⚠️ Failed to set display name: " + err.message);
		}
		addLocalMicTrackForReceivingTest();

		setTimeout(() => {
			try {
				const ps = conference.getParticipants?.() || [];
				// log(`👥 participants count=${ps.length}`);

				for (const p of ps) {
					// log(
					//   `👥 participant id=${p.getId?.()}, ` +
					//   `name=${p.getDisplayName?.()}`
					// );
				}
			} catch (err) {
				debug("Failed to list participants: " + err.message);
			}
		}, 2000);
	});

	conference.on(JitsiMeetJS.events.conference.CONFERENCE_FAILED, error => {
		log("❌ Conference failed: " + JSON.stringify(error));
		console.error("Conference failed:", error);
	});

	conference.on(JitsiMeetJS.events.conference.CONFERENCE_LEFT, () => {
		if (isStoppingAgent) return;
		log("⚠️ Conference left");
	});

	conference.on(JitsiMeetJS.events.conference.USER_JOINED, (id, participant) => {
		const displayName = participant?.getDisplayName?.() || participant?.getProperty?.("displayName") || "unknown";

		participants.set(id, {
			participantId: id,
			displayName
		});

		log(`👤 User joined: id=${id}, name=${displayName}`);
	});

	conference.on(JitsiMeetJS.events.conference.USER_LEFT, id => {
		const participantInfo = participants.get(id);
		const displayName = participantInfo?.displayName || "unknown";

		log(`👤 User left: id=${id}, name=${displayName}`);

		const pipeline = remoteAudioPipelines.get(id);

		if (pipeline) {
			pipeline.cleanup();
			remoteAudioPipelines.delete(id);
		}

		participants.delete(id);
	});

	conference.on(JitsiMeetJS.events.conference.TRACK_ADDED, track => {
		const mst = track.getTrack?.();

		// log(
		//   `TRACK_ADDED: type=${track.getType()}, ` +
		//   `local=${track.isLocal()}, ` +
		//   `jitsiMuted=${track.isMuted?.()}, ` +
		//   `mediaMuted=${mst?.muted}, ` +
		//   `mediaReadyState=${mst?.readyState}, ` +
		//   `participant=${track.getParticipantId?.()}`
		// );

		onTrackAdded(track);
	});

	conference.on(JitsiMeetJS.events.conference.TRACK_REMOVED, track => {
		stopRemoteAudioPipeline(track);
	});

	conference.on(JitsiMeetJS.events.conference.TRACK_MUTE_CHANGED, track => {
		const mst = track.getTrack?.();

		log(
			`🎚️ TRACK_MUTE_CHANGED: ` +
				`type=${track.getType()}, ` +
				`local=${track.isLocal()}, ` +
				`jitsiMuted=${track.isMuted?.()}, ` +
				`mediaMuted=${mst?.muted}, ` +
				`mediaReadyState=${mst?.readyState}, ` +
				`participant=${track.getParticipantId?.()}`
		);
	});

	log("Joining conference...");

	try {
		conference.join();
		// log("conference.join() called");
	} catch (err) {
		log("❌ conference.join() threw error: " + (err.message || err));
		console.error(err);
	}
}

function onTrackAdded(track) {
	if (isStoppingAgent) return;

	const type = track.getType();
	const isLocal = track.isLocal();

	if (isLocal) return;
	if (type !== "audio") return;

	const participantId = track.getParticipantId();
	const mediaStreamTrack = track.getTrack();

	if (!participantId || !mediaStreamTrack) {
		debug("Invalid remote audio track");
		return;
	}

	attachJitsiAudioLevelDebug(track);

	const newTrackId = mediaStreamTrack.id;
	const oldPipeline = remoteAudioPipelines.get(participantId);

	if (oldPipeline && oldPipeline.mediaStreamTrackId === newTrackId) {
		debug(`Duplicate audio track ignored: participant=${participantId}, trackId=${newTrackId}`);
		return;
	}

	const participantInfo = participants.get(participantId);
	const displayName = participantInfo?.displayName || "unknown";

	log(`🎧 Remote audio received from ` + `name=${displayName}, trackId=${newTrackId}`);

	startRemoteAudioPipeline(track);
}

function attachJitsiAudioLevelDebug(track) {
	try {
		const trackEvents = JitsiMeetJS.events?.track;

		if (!trackEvents?.TRACK_AUDIO_LEVEL_CHANGED) {
			return;
		}

		track.addEventListener(trackEvents.TRACK_AUDIO_LEVEL_CHANGED, level => {
			if (level > 0.001) {
				// log(
				//   `📈 Jitsi track audio level=${level.toFixed(4)}, ` +
				//   `participant=${track.getParticipantId?.()}`
				// );
			}
		});
	} catch (err) {
		debug("Cannot attach TRACK_AUDIO_LEVEL_CHANGED: " + err.message);
	}
}

function ensureMixedAudioPipeline() {
	if (mixerPipelineStarted) return;

	mixerNode = audioContext.createGain();
	mixerNode.gain.value = 1.0;

	mixerCompressor = audioContext.createDynamicsCompressor();
	mixerCompressor.threshold.value = -24;
	mixerCompressor.knee.value = 30;
	mixerCompressor.ratio.value = 12;
	mixerCompressor.attack.value = 0.003;
	mixerCompressor.release.value = 0.25;

	mixerProcessor = audioContext.createScriptProcessor(4096, 1, 1);

	mixerSilentGain = audioContext.createGain();

	// 讓 processor 持續被拉動，但避免輸出太大聲。
	// 如果你想聽 mixer output debug，可以暫時改成 1.0。
	mixerSilentGain.gain.value = 0.00001;

	mixerNode.connect(mixerCompressor);
	mixerCompressor.connect(mixerProcessor);
	mixerProcessor.connect(mixerSilentGain);
	mixerSilentGain.connect(audioContext.destination);

	mixerProcessor.onaudioprocess = event => {
		if (isStoppingAgent || !hasStartedAgent) return;

		const input = event.inputBuffer.getChannelData(0);

		const downsampled = downsampleTo16k(input, audioContext.sampleRate);

		if (mixedWallStart === null) {
			mixedWallStart = Date.now();
		}

		mixedAudioSamples += downsampled.length;

		const now = Date.now();

		if (now - lastTimingLogTime > 5000) {
			lastTimingLogTime = now;

			const audioSec = mixedAudioSamples / 16000;
			const wallSec = (now - mixedWallStart) / 1000;
			const ratio = wallSec > 0.1 ? audioSec / wallSec : 0;

			// log(
			//   `⏱️ audioSec=${audioSec.toFixed(2)}, ` +
			//   `wallSec=${wallSec.toFixed(2)}, ` +
			//   `ratio=${ratio.toFixed(2)}`
			// );
		}

		const pcmRms = calculateRms(downsampled);
		const pcmPeak = calculatePeak(downsampled);

		if (SHOW_RMS) {
			const now = Date.now();

			if (now - lastLevelLogTime > 1000) {
				lastLevelLogTime = now;

				log(`🔊 pcm rms=${pcmRms.toFixed(6)}, ` + `peak=${pcmPeak.toFixed(6)}, ` + `ws=${vadWs?.readyState}, ` + `chunks=${sentChunkCount}`);
			}
		}

		if ((pcmRms > 0.0005 || pcmPeak > 0.01) && !hasReceivedAudioInput) {
			hasReceivedAudioInput = true;
			// log("✅ 成功接收到 non-silent public audio input");
		}

		appendAndSendContinuousPcm(downsampled);
	};

	mixerPipelineStarted = true;

	// log(
	//   `✅ Mixed public audio pipeline started, ` +
	//   `browser sampleRate=${audioContext.sampleRate}`
	// );
}

function startRemoteAudioPipeline(track) {
	const participantId = track.getParticipantId();
	const mediaStreamTrack = track.getTrack();

	if (!participantId || !mediaStreamTrack) {
		debug("Invalid remote audio track");
		return;
	}

	const newTrackId = mediaStreamTrack.id;
	const oldPipeline = remoteAudioPipelines.get(participantId);

	if (oldPipeline) {
		if (oldPipeline.mediaStreamTrackId === newTrackId) {
			debug(`Same audio track ignored for participant=${participantId}`);
			return;
		}

		log(`🧹 Cleaning old pipeline for participant=${participantId}, ` + `oldTrackId=${oldPipeline.mediaStreamTrackId}, newTrackId=${newTrackId}`);

		oldPipeline.cleanup();
		remoteAudioPipelines.delete(participantId);
	}

	const cleanupPipeline = startAudioElementPipeline(track, participantId);

	remoteAudioPipelines.set(participantId, {
		track,
		mediaStreamTrackId: newTrackId,
		cleanup: cleanupPipeline
	});

	// log(
	//   `✅ Started audio element pipeline for ` +
	//   `participant=${participantId}, trackId=${newTrackId}`
	// );
}

function stopRemoteAudioPipeline(track) {
	if (track.isLocal()) return;
	if (track.getType() !== "audio") return;

	const participantId = track.getParticipantId();

	if (!participantId) return;

	const pipeline = remoteAudioPipelines.get(participantId);

	if (!pipeline) return;

	if (pipeline.track !== track) {
		debug(`Ignored old removed track for participant=${participantId}`);
		return;
	}

	pipeline.cleanup();
	remoteAudioPipelines.delete(participantId);

	debug(`Stopped audio pipeline for participant=${participantId}`);
}

function startAudioElementPipeline(jitsiTrack, participantId) {
	ensureMixedAudioPipeline();

	const mediaStreamTrack = jitsiTrack.getTrack();

	if (!mediaStreamTrack) {
		log(`❌ No MediaStreamTrack for participant=${participantId}`);
		return function cleanup() {};
	}

	// log(
	//   `🎙️ Track status for audio element pipeline: ` +
	//   `enabled=${mediaStreamTrack.enabled}, ` +
	//   `muted=${mediaStreamTrack.muted}, ` +
	//   `readyState=${mediaStreamTrack.readyState}, ` +
	//   `id=${mediaStreamTrack.id}`
	// );

	const audioElement = document.createElement("audio");
	audioElement.autoplay = true;
	audioElement.playsInline = true;

	// Debug 階段先顯示出來，確認 Public Agent 頁面是否真的聽得到聲音。
	// 若確認正常，可改成 muted=true / display=none。
	audioElement.muted = false;
	audioElement.volume = 1.0;
	audioElement.controls = true;
	audioElement.style.display = "block";
	audioElement.style.marginTop = "12px";

	document.body.appendChild(audioElement);

	try {
		jitsiTrack.attach(audioElement);
		// log("✅ Jitsi track attached to audio element");
	} catch (err) {
		log("❌ Failed to attach Jitsi track to audio element: " + err.message);

		return function cleanup() {
			try {
				audioElement.remove();
			} catch {}
		};
	}

	const trackGain = audioContext.createGain();
	trackGain.gain.value = 1.0;

	let source = null;
	let capturedStream = null;

	audioElement
		.play()
		.then(() => {
			// log("▶️ remote audio element playing");

			setTimeout(() => {
				// log(
				//   `🎧 audioElement state: ` +
				//   `paused=${audioElement.paused}, ` +
				//   `muted=${audioElement.muted}, ` +
				//   `volume=${audioElement.volume}, ` +
				//   `readyState=${audioElement.readyState}, ` +
				//   `currentTime=${audioElement.currentTime.toFixed(2)}`
				// );
			}, 2000);

			try {
				if (typeof audioElement.captureStream === "function") {
					capturedStream = audioElement.captureStream();

					const capturedTracks = capturedStream.getAudioTracks();

					// log(
					//   `🎧 captureStream audioTracks=` +
					//   capturedTracks.length
					// );

					capturedTracks.forEach(t => {
						// log(
						//   `🎧 captured track: id=${t.id}, ` +
						//   `enabled=${t.enabled}, muted=${t.muted}, ` +
						//   `readyState=${t.readyState}`
						// );

						t.onmute = () => {
							log(`🔇 captured track muted: ${t.id}`);
						};

						t.onunmute = () => {
							log(`🔊 captured track unmuted: ${t.id}`);
						};

						t.onended = () => {
							log(`🛑 captured track ended: ${t.id}`);
						};
					});

					source = audioContext.createMediaStreamSource(capturedStream);
					source.connect(trackGain);
					trackGain.connect(mixerNode);

					// log(
					//   `✅ audioElement.captureStream connected to WebAudio mixer: ` +
					//   `participant=${participantId}`
					// );
				} else {
					source = audioContext.createMediaElementSource(audioElement);
					source.connect(trackGain);
					trackGain.connect(mixerNode);

					log(`✅ createMediaElementSource connected to WebAudio mixer: ` + `participant=${participantId}`);
				}
			} catch (err) {
				log("❌ audio element pipeline failed: " + err.message);
				console.error(err);
			}
		})
		.catch(err => {
			log("❌ remote audio element play failed: " + err.message);
		});

	mediaStreamTrack.onmute = () => {
		log(`🔇 remote mediaStreamTrack muted: participant=${participantId}`);
	};

	mediaStreamTrack.onunmute = () => {
		log(`🔊 remote mediaStreamTrack unmuted: participant=${participantId}`);
	};

	mediaStreamTrack.onended = () => {
		log(`🛑 remote mediaStreamTrack ended: participant=${participantId}`);
	};

	return function cleanup() {
		mediaStreamTrack.onmute = null;
		mediaStreamTrack.onunmute = null;
		mediaStreamTrack.onended = null;

		try {
			if (capturedStream) {
				capturedStream.getTracks().forEach(t => {
					t.onmute = null;
					t.onunmute = null;
					t.onended = null;
					t.stop?.();
				});
			}
		} catch {}

		try {
			if (source) source.disconnect();
		} catch {}

		try {
			trackGain.disconnect();
		} catch {}

		try {
			jitsiTrack.detach(audioElement);
		} catch {}

		try {
			audioElement.pause();
		} catch {}

		try {
			audioElement.remove();
		} catch {}

		log(`🧹 Audio element pipeline cleaned: participant=${participantId}`);
	};
}

function downsampleTo16k(buffer, inputSampleRate) {
	const outputSampleRate = 16000;

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

	while (offset + 512 <= merged.length) {
		const chunk = merged.slice(offset, offset + 512);

		if (vadWs && vadWs.readyState === WebSocket.OPEN) {
			const safeChunk = new Float32Array(chunk);
			vadWs.send(safeChunk.buffer);

			sentChunkCount++;

			if (sentChunkCount % 100 === 0) {
				// log(`📤 sent PCM chunks: ${sentChunkCount}, ws=${vadWs?.readyState}`);
			}
		}

		offset += 512;
	}

	pendingPcm = merged.slice(offset);
}

function injectTestToneToMixer() {
	if (!audioContext) {
		log("❌ audioContext not ready");
		return;
	}

	ensureMixedAudioPipeline();

	const osc = audioContext.createOscillator();
	const gain = audioContext.createGain();

	osc.frequency.value = 440;
	gain.gain.value = 0.05;

	osc.connect(gain);
	gain.connect(mixerNode);

	osc.start();

	log("🧪 Test tone injected to mixer");

	setTimeout(() => {
		try {
			osc.stop();
		} catch {}

		try {
			osc.disconnect();
		} catch {}

		try {
			gain.disconnect();
		} catch {}

		log("🧪 Test tone stopped");
	}, 3000);
}

window.injectTestToneToMixer = injectTestToneToMixer;

async function addLocalMicTrackForReceivingTest() {
	try {
		if (!conference) {
			log("⚠️ Cannot add local mic track: conference not ready");
			return;
		}

		// log("🎙️ Creating local mic track for receiving test...");

		const tracks = await JitsiMeetJS.createLocalTracks({
			devices: ["audio"]
		});

		const audioTrack = tracks.find(t => t.getType() === "audio");

		if (!audioTrack) {
			log("⚠️ No local audio track created");
			return;
		}

		try {
			await audioTrack.mute();
			// log("🔇 Local mic track muted");
		} catch (err) {
			log("⚠️ Failed to mute local mic track: " + err.message);
		}

		await conference.addTrack(audioTrack);

		// log("✅ Local mic track added to conference");
	} catch (err) {
		log("❌ Failed to add local mic track: " + (err.message || err));
		console.error(err);
	}
}

window.addLocalMicTrackForReceivingTest = addLocalMicTrackForReceivingTest;
