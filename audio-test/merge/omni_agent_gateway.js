/*
 * omni_agent_gateway.js
 *
 * Design:
 * - One real participant browser = one LocalMicAgent.
 * - Public/private audio is captured from that participant's browser microphone.
 * - Jitsi iframe only handles meeting UI and mute state; it is NOT used as the audio source.
 *
 * Public mode:
 *   - Jitsi mic unmuted  => send this browser mic as scope=public
 *   - Jitsi mic muted    => stop sending public audio
 *
 * Private mode:
 *   - force Jitsi mic muted
 *   - send this browser mic as scope=private
 *
 * Backend WebSocket default:
 *   ws://localhost:8000/sessions/{roomName}/audio-stream?participant_id={userId}
 */

(() => {
  "use strict";

  const VERSION = "participant-browser-mic-public-input-003";

  const params = new URLSearchParams(window.location.search);
  const APP_DEFAULTS = window.OMNI_DEFAULTS || {};

  const DEFAULT_ROOM_NAME =
    APP_DEFAULTS.roomName || "lost-at-sea";

  const DEFAULT_JITSI_BASE_URL =
    APP_DEFAULTS.jitsiBaseUrl || "https://meet.omni.elvismao.com";

  const DEFAULT_JITSI_URL =
    APP_DEFAULTS.jitsiUrl ||
    buildDefaultJitsiUrl(
        DEFAULT_ROOM_NAME,
        APP_DEFAULTS.displayName || APP_DEFAULTS.userId || "anonymous"
    );

  const DEFAULT_API_BASE_WS_URL =
    APP_DEFAULTS.apiBaseWsUrl || "ws://" + window.location.hostname + ":8001";

  const SAMPLE_RATE = 16000;
  const SEND_CHUNK_SIZE = 512;
  const PROCESSOR_BUFFER_SIZE = 4096;

  const DEBUG = params.get("debug") === "true";
  const SHOW_RMS = params.get("showRms") === "true";

  const DEFAULT_MODE = normalizeMode(
    params.get("mode") ||
    APP_DEFAULTS.mode ||
    "public"
  );

  const AUTO_JOIN = params.has("autoJoin")
    ? params.get("autoJoin") !== "false"
    : APP_DEFAULTS.autoJoin !== false;

  let ui = null;
  let jitsiController = null;
  let localMicAgent = null;

  const state = {
    mode: DEFAULT_MODE,
    jitsiJoined: false,
    jitsiMicMuted: true,
    applyingRoute: false,
    routePending: false,
    autoUnmuteOnceOnPublic: false
  };

  document.addEventListener("DOMContentLoaded", () => {
    boot();
  });

  if (document.readyState === "interactive" || document.readyState === "complete") {
    setTimeout(() => {
      if (!ui) boot();
    }, 0);
  }

  function boot() {
    if (ui) return;

    ui = createUi();

    const initialConfig = readInitialConfig();

    ui.roomNameInput.value = initialConfig.roomName;
    ui.jitsiUrlInput.value = initialConfig.jitsiUrl;
    ui.apiWsUrlInput.value = initialConfig.apiWsUrl;
    ui.userIdInput.value = initialConfig.userId;
    ui.displayNameInput.value = initialConfig.displayName;

    localMicAgent = new LocalMicAgent({
      getConfig,
      log,
      debug,
      onStatusChange: updateUiState
    });

    jitsiController = new JitsiIframeController({
      getConfig,
      log,
      debug,
      onJoined: async () => {
        state.jitsiJoined = true;
        await refreshJitsiMicStatus();
        await applyAgentRouting("jitsi joined");
      },
      onLeft: async () => {
        state.jitsiJoined = false;
        state.jitsiMicMuted = true;
        await localMicAgent.stop();
        updateUiState();
      },
      onAudioMuteStatusChanged: async (muted) => {
        state.jitsiMicMuted = muted;
        log(`🎚️ Jitsi mic muted = ${muted}`);
        await applyAgentRouting("jitsi mic changed");
      }
    });

    bindUiEvents();
    updateUiState();

    window.omniAgent = {
      joinMeeting: () => joinMeeting(),
      leaveMeeting: () => leaveMeeting(),
      switchToPublic: () => switchMode("public"),
      switchToPrivate: () => switchMode("private"),
      stopAgent: () => localMicAgent.stop(),
      getConfig,
      getState: () => ({ ...state })
    };

    log(`✅ omni_agent_gateway.js loaded: ${VERSION}`);
    log(`Room name: ${getConfig().roomName}`);
    log(`Jitsi URL: ${getConfig().jitsiUrl}`);
    log(`Audio WebSocket: ${getConfig().apiWsUrl}`);
    log(`Initial mode: ${state.mode}`);

    if (AUTO_JOIN) {
      setTimeout(() => {
        joinMeeting();
      }, 300);
    }
  }

  function readInitialConfig() {
    const jitsiUrl =
      params.get("jitsiUrl") ||
      window.AGENT_JITSI_URL ||
      localStorageGet("omni.jitsiUrl", "") ||
      APP_DEFAULTS.jitsiUrl ||
      DEFAULT_JITSI_URL;

    const roomNameFromJitsiUrl = parseRoomNameFromUrl(jitsiUrl);
    const roomNameFromPath = getRoomNameFromPath();

    const roomName = normalizeRoomName(
      params.get("roomName") ||
      window.AGENT_ROOM_NAME ||
      localStorageGet("omni.roomName", "") ||
      APP_DEFAULTS.roomName ||
      roomNameFromJitsiUrl ||
      roomNameFromPath ||
      DEFAULT_ROOM_NAME
    );

    const userId =
      params.get("userId") ||
      window.AGENT_USER_ID ||
      localStorageGet("omni.userId", "") ||
      APP_DEFAULTS.userId ||
      getOrCreateAnonymousUserId();

    const displayName =
      params.get("displayName") ||
      window.AGENT_DISPLAY_NAME ||
      localStorageGet("omni.displayName", "") ||
      APP_DEFAULTS.displayName ||
      userId;

    const apiWsUrl =
      params.get("apiWsUrl") ||
      window.AGENT_API_WS_URL ||
      APP_DEFAULTS.apiWsUrl ||
      "";

    return {
      roomName,
      jitsiUrl,
      apiWsUrl,
      userId,
      displayName
    };
  }

  function getConfig() {
    const jitsiUrl =
      ui.jitsiUrlInput.value.trim() ||
      DEFAULT_JITSI_URL;

    const roomName = normalizeRoomName(
      ui.roomNameInput.value.trim() ||
      parseRoomNameFromUrl(jitsiUrl) ||
      DEFAULT_ROOM_NAME
    );

    const userId =
      ui.userIdInput.value.trim() ||
      getOrCreateAnonymousUserId();

    const displayName =
      ui.displayNameInput.value.trim() ||
      userId ||
      "anonymous";

    const apiWsUrl =
      ui.apiWsUrlInput.value.trim() ||
      buildDefaultApiWsUrl(roomName, userId);

    return {
      roomName,
      jitsiUrl,
      apiWsUrl,
      userId,
      displayName
    };
  }

  function bindUiEvents() {
    ui.applyConfigBtn.addEventListener("click", async () => {
      await applyConfigFromUi();
    });

    ui.joinBtn.addEventListener("click", joinMeeting);
    ui.leaveBtn.addEventListener("click", leaveMeeting);

    ui.publicModeBtn.addEventListener("click", () => {
      switchMode("public");
    });

    ui.privateModeBtn.addEventListener("click", () => {
      switchMode("private");
    });

    ui.stopAgentBtn.addEventListener("click", async () => {
      await localMicAgent.stop();
      updateUiState();
    });

    ui.refreshMicBtn.addEventListener("click", async () => {
      await refreshJitsiMicStatus();
      await applyAgentRouting("manual refresh");
    });

    ui.clearLogBtn.addEventListener("click", () => {
      ui.logBox.textContent = "";
    });

    ui.userIdInput.addEventListener("change", () => {
      localStorageSet("omni.userId", ui.userIdInput.value.trim());
      if (!ui.apiWsUrlInput.value.trim()) updateUiState();
    });

    ui.displayNameInput.addEventListener("change", () => {
      localStorageSet("omni.displayName", ui.displayNameInput.value.trim());
    });

    ui.roomNameInput.addEventListener("change", () => {
      localStorageSet("omni.roomName", ui.roomNameInput.value.trim());
      if (!ui.apiWsUrlInput.value.trim()) updateUiState();
    });
  }

  async function joinMeeting() {
    try {
      await jitsiController.join();
      updateUiState();
    } catch (err) {
      log("❌ Failed to join Jitsi meeting: " + (err.message || err));
      console.error(err);
    }
  }

  async function leaveMeeting() {
    await jitsiController.leave();
    await localMicAgent.stop();

    state.jitsiJoined = false;
    state.jitsiMicMuted = true;

    updateUiState();
  }

  async function switchMode(nextMode) {
    nextMode = normalizeMode(nextMode);

    const oldMode = state.mode;

    if (state.mode === nextMode) {
      await applyAgentRouting("same mode clicked");
      return;
    }

    state.mode = nextMode;

    state.autoUnmuteOnceOnPublic =
      oldMode === "private" && nextMode === "public";

    log(`🔁 Switched to ${nextMode.toUpperCase()} mode`);

    if (nextMode === "private") {
      log("🔒 Private mode: Jitsi mic will be muted. Browser mic goes to private transcript.");
    } else {
      log("🌐 Public mode: browser mic goes to public transcript only when Jitsi mic is unmuted.");
    }

    updateUiState();
    await applyAgentRouting("mode changed");
  }

  async function refreshJitsiMicStatus() {
    if (!jitsiController || !jitsiController.isJoined()) {
      state.jitsiMicMuted = true;
      updateUiState();
      return true;
    }

    try {
      const muted = await jitsiController.isAudioMuted();
      state.jitsiMicMuted = muted;
      updateUiState();
      return muted;
    } catch (err) {
      debug("Failed to refresh Jitsi mic status: " + (err.message || err));
      return state.jitsiMicMuted;
    }
  }

  async function applyAgentRouting(reason) {
    if (state.applyingRoute) {
      state.routePending = true;
      return;
    }

    state.applyingRoute = true;

    try {
      do {
        state.routePending = false;

        debug("applyAgentRouting: " + reason);

        if (state.mode === "private") {
          if (jitsiController.isJoined()) {
            await jitsiController.ensureAudioMuted();
            state.jitsiMicMuted = true;
          }

          await localMicAgent.start("private");
          updateUiState();
          continue;
        }

        if (state.mode === "public") {
          if (!jitsiController.isJoined()) {
            await localMicAgent.stop();
            updateUiState();
            continue;
          }

          let muted = await refreshJitsiMicStatus();

          if (muted && state.autoUnmuteOnceOnPublic) {
            state.autoUnmuteOnceOnPublic = false;

            log("🎙️ Switched from private to public: unmuting Jitsi mic once...");
            await jitsiController.ensureAudioUnmuted();

            muted = await refreshJitsiMicStatus();
          }

          if (muted) {
            await localMicAgent.stop();
            log("⚠️ Jitsi mic is muted, so public browser mic is not sent.");
            updateUiState();
            continue;
          }

          await localMicAgent.start("public");
          updateUiState();
          continue;
        }
      } while (state.routePending);
    } catch (err) {
      log("❌ applyAgentRouting failed: " + (err.message || err));
      console.error(err);
    } finally {
      state.applyingRoute = false;
      updateUiState();
    }
  }

  function updateUiState() {
    const config = getConfig();

    const agentStatus = localMicAgent?.getStatus() || {
      running: false,
      scope: null
    };

    ui.modeStatus.textContent = state.mode;
    ui.modeStatus.className =
      "omni-pill " + (state.mode === "public" ? "public" : "private");

    ui.jitsiStatus.textContent = state.jitsiJoined ? "joined" : "not joined";
    ui.jitsiStatus.className =
      "omni-pill " + (state.jitsiJoined ? "running" : "stopped");

    ui.jitsiMicStatus.textContent = state.jitsiMicMuted ? "muted" : "unmuted";
    ui.jitsiMicStatus.className =
      "omni-pill " + (state.jitsiMicMuted ? "stopped" : "running");

    ui.agentStatus.textContent = agentStatus.running
      ? `running / ${agentStatus.scope}`
      : "stopped";

    ui.agentStatus.className =
      "omni-pill " + (agentStatus.running ? agentStatus.scope : "stopped");

    ui.joinBtn.disabled = state.jitsiJoined;
    ui.leaveBtn.disabled = !state.jitsiJoined;

    ui.publicModeBtn.disabled = state.mode === "public";
    ui.privateModeBtn.disabled = state.mode === "private";

    ui.stopAgentBtn.disabled = !agentStatus.running;

    ui.currentInfo.textContent =
      `room=${config.roomName}, userId=${config.userId}, displayName=${config.displayName}`;

    ui.computedWsUrl.textContent = config.apiWsUrl;
  }

  function log(message) {
    console.log(message);

    if (!ui?.logBox) return;

    const time = new Date().toLocaleTimeString();
    ui.logBox.textContent += `[${time}] ${message}\n`;
    ui.logBox.scrollTop = ui.logBox.scrollHeight;
  }

  function debug(message) {
    if (!DEBUG) return;
    log("[debug] " + message);
  }

  class LocalMicAgent {
    constructor({ getConfig, log, debug, onStatusChange }) {
      this.getConfig = getConfig;
      this.log = log;
      this.debug = debug;
      this.onStatusChange = onStatusChange;

      this.running = false;
      this.scope = null;
      this.stopping = false;

      this.audioContext = null;
      this.micStream = null;
      this.micSource = null;
      this.processor = null;
      this.silentGain = null;

      this.ws = null;
      this.clientId = null;

      this.pendingPcm = new Float32Array(0);
      this.sentChunkCount = 0;

      this.hasReceivedAudioInput = false;
      this.lastLevelLogTime = 0;
      this.lastLoggedConfigKey = null;
    }

    getStatus() {
      return {
        running: this.running,
        scope: this.scope,
        chunks: this.sentChunkCount
      };
    }

    async start(scope) {
      scope = normalizeMode(scope);

      if (this.running && this.scope === scope) {
        return;
      }

			if (this.running && this.scope !== scope) {
        await this.switchScope(scope);
        return;
      }

			this.running = true;
			this.scope = scope;
			this.stopping = false;
			this.pendingPcm = new Float32Array(0);
			this.sentChunkCount = 0;
			this.hasReceivedAudioInput = false;
			this.lastLevelLogTime = 0;

			this.onStatusChange?.();

			const config = this.getConfig();

			try {
				// this.log(`🎙️ Starting browser mic agent as ${scope.toUpperCase()}`);
				// this.log(`User ID: ${config.userId}`);
				// this.log(`Display Name: ${config.displayName}`);
				// this.log(`Room Name: ${config.roomName}`);
				// this.log(`API WebSocket: ${config.apiWsUrl}`);

				await this.connectWebSocket(scope);

				if (this.stopping) return;

				this.micStream = await navigator.mediaDevices.getUserMedia({
					audio: {
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: true,
						channelCount: 1
					},
					video: false
				});

				this.audioContext = new AudioContext();
				await this.audioContext.resume();

				this.startMicPipeline();

				this.log(`✅ Browser mic agent started as ${scope}`);
				this.onStatusChange?.();
			} catch (err) {
				this.log("❌ Failed to start browser mic agent: " + (err.message || err));
				console.error(err);
				await this.stop();
			}
		}

    async switchScope(scope) {
      scope = normalizeMode(scope);

      if (!this.running) {
        await this.start(scope);
        return;
      }

      if (this.scope === scope) {
        return;
      }

      // 如果 WebSocket 已經不在，就退回原本完整重啟流程。
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        await this.stop();
        await this.start(scope);
        return;
      }

      const oldScope = this.scope;

      this.scope = scope;
      this.clientId = makeClientId(scope);
      this.pendingPcm = new Float32Array(0);
      this.sentChunkCount = 0;
      this.hasReceivedAudioInput = false;
      this.lastLevelLogTime = 0;
      this.stopping = false;

      // 不送 stop、不關 WebSocket，只送新的 start。
      this.ws.send(JSON.stringify(this.buildStartMessage(scope)));

      this.log(`🔁 Browser mic agent switched ${oldScope} → ${scope}`);
      this.onStatusChange?.();
    }

		async stop() {
			if (!this.running && this.stopping) return;

			const oldScope = this.scope;

			this.stopping = true;
			this.running = false;
			this.scope = null;

			this.onStatusChange?.();

			if (oldScope) {
				this.log(`🛑 Stopping browser mic agent: ${oldScope}`);
			}

			if (this.processor) {
				try {
					this.processor.onaudioprocess = null;
					this.processor.disconnect();
				} catch {}

				this.processor = null;
			}

			if (this.micSource) {
				try {
					this.micSource.disconnect();
				} catch {}

				this.micSource = null;
			}

			if (this.silentGain) {
				try {
					this.silentGain.disconnect();
				} catch {}

				this.silentGain = null;
			}

			if (this.micStream) {
				try {
					this.micStream.getTracks().forEach(track => track.stop());
				} catch {}

				this.micStream = null;
			}

			await this.closeWebSocket(oldScope);

			if (this.audioContext) {
				try {
					await this.audioContext.close();
				} catch {}

				this.audioContext = null;
			}

			this.pendingPcm = new Float32Array(0);
			this.sentChunkCount = 0;
			this.hasReceivedAudioInput = false;

			if (oldScope) {
				this.log(`✅ Browser mic agent stopped: ${oldScope}`);
			}

			this.onStatusChange?.();
		}

		async connectWebSocket(scope) {
			const config = this.getConfig();
			this.clientId = makeClientId(scope);

			return new Promise(resolve => {
				let settled = false;

				const finish = message => {
					if (settled) return;
					settled = true;

					if (message) this.log(message);
					resolve();
				};

				try {
					this.ws = new WebSocket(config.apiWsUrl);
					this.ws.binaryType = "arraybuffer";
				} catch (err) {
					finish(`⚠️ WebSocket create failed: ${err.message || err}`);
					return;
				}

				this.ws.onopen = () => {
					this.log(`✅ ${scope} connected to backend`);
					this.ws.send(JSON.stringify(this.buildStartMessage(scope)));
					finish();
				};

				this.ws.onerror = err => {
					console.error("WebSocket error:", err);
					finish(`⚠️ ${scope} backend not connected`);
				};

				this.ws.onmessage = event => {
					this.handleBackendMessage(event);
				};

				this.ws.onclose = () => {
					this.debug(`${scope} WebSocket closed`);
				};

				setTimeout(() => {
					if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
						finish(`⚠️ ${scope} backend connection timeout`);
					}
				}, 1500);
			});
		}

		async closeWebSocket(scopeForStop) {
			if (!this.ws) return;

			try {
				if (this.ws.readyState === WebSocket.OPEN && scopeForStop) {
					this.ws.send(JSON.stringify(this.buildStopMessage(scopeForStop)));
				}
			} catch (err) {
				console.warn("Failed to send stop message:", err);
			}

			try {
				this.ws.close();
			} catch {}

			this.ws = null;
			this.clientId = null;
		}

		buildStartMessage(scope) {
			const config = this.getConfig();

			return {
				type: "start",
				source: sourceForScope(scope),
				scope,
				agentType: agentTypeForScope(scope),

				roomName: config.roomName,
				participantId: config.userId,
				userId: config.userId,
				displayName: config.displayName,
				clientId: this.clientId,

				sampleRate: SAMPLE_RATE,
				channels: 1,
				encoding: "float32",
				format: "float32"
			};
		}

		buildStopMessage(scope) {
			const config = this.getConfig();

			return {
				type: "stop",
				source: sourceForScope(scope),
				scope,
				agentType: agentTypeForScope(scope),

				roomName: config.roomName,
				participantId: config.userId,
				userId: config.userId,
				displayName: config.displayName,
				clientId: this.clientId
			};
		}

		handleBackendMessage(event) {
			if (typeof event.data !== "string") {
				this.debug("Backend binary message ignored");
				return;
			}

			const text = event.data;

			try {
				const data = JSON.parse(text);

				if (data.type === "vad") {
					this.log(`Backend VAD: ${JSON.stringify(data.event)}`);
					return;
				}

				if (data.type === "segment_saved") {
					const startText = typeof data.start === "number" ? data.start.toFixed(2) : data.start;
					const endText = typeof data.end === "number" ? data.end.toFixed(2) : data.end;

					this.log(`💾 segment saved: ${data.displayName || data.userId || this.getConfig().displayName}, ` + `${startText}s-${endText}s, reason=${data.reason || "unknown"}`);
					return;
				}

				if (data.type === "transcript" || data.type === "transcript.final") {
					const speaker = data.displayName || data.userId || this.getConfig().displayName;

					this.log(`📝 ${data.scope || this.scope} transcript / ${speaker}: ${data.text}`);
					return;
				}

				this.debug("Backend: " + text);
			} catch {
				this.debug("Backend: " + text);
			}
		}

		startMicPipeline() {
			if (!this.audioContext || !this.micStream) {
				throw new Error("audioContext or micStream not ready");
			}

			this.micSource = this.audioContext.createMediaStreamSource(this.micStream);

			this.processor = this.audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);

			this.silentGain = this.audioContext.createGain();
			this.silentGain.gain.value = 0.00001;

			this.micSource.connect(this.processor);
			this.processor.connect(this.silentGain);
			this.silentGain.connect(this.audioContext.destination);

			this.processor.onaudioprocess = event => {
				if (this.stopping || !this.running) return;

				const input = event.inputBuffer.getChannelData(0);

				const downsampled = downsampleTo16k(input, this.audioContext.sampleRate);

				const rms = calculateRms(downsampled);
				const peak = calculatePeak(downsampled);

				if (SHOW_RMS) {
					const now = Date.now();

					if (now - this.lastLevelLogTime > 1000) {
						this.lastLevelLogTime = now;

						this.log(`🎙️ ${this.scope} pcm rms=${rms.toFixed(6)}, ` + `peak=${peak.toFixed(6)}, chunks=${this.sentChunkCount}`);
					}
				}

				if ((rms > 0.0005 || peak > 0.01) && !this.hasReceivedAudioInput) {
					this.hasReceivedAudioInput = true;
					this.log(`✅ 成功接收到 ${this.scope} microphone input`);
				}

				this.appendAndSendPcm(downsampled);
			};
		}

		appendAndSendPcm(newPcm) {
			if (!newPcm || newPcm.length === 0) return;

			const merged = new Float32Array(this.pendingPcm.length + newPcm.length);

      merged.set(this.pendingPcm, 0);
      merged.set(newPcm, this.pendingPcm.length);

      let offset = 0;

      while (offset + SEND_CHUNK_SIZE <= merged.length) {
        const chunk = merged.slice(offset, offset + SEND_CHUNK_SIZE);

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          const safeChunk = new Float32Array(chunk);
          this.ws.send(safeChunk.buffer);
          this.sentChunkCount++;

          if (this.sentChunkCount % 100 === 0) {
            this.debug(
              `📤 sent ${this.scope} PCM chunks: ${this.sentChunkCount}, ws=${this.ws.readyState}`
            );
          }
        }

        offset += SEND_CHUNK_SIZE;
      }

      this.pendingPcm = merged.slice(offset);
    }
  }

  class JitsiIframeController {
    constructor({
      getConfig,
      log,
      debug,
      onJoined,
      onLeft,
      onAudioMuteStatusChanged
    }) {
      this.getConfig = getConfig;
      this.log = log;
      this.debug = debug;
      this.onJoined = onJoined;
      this.onLeft = onLeft;
      this.onAudioMuteStatusChanged = onAudioMuteStatusChanged;

      this.api = null;
      this.joined = false;
    }

    isJoined() {
      return this.joined && !!this.api;
    }

    async join() {
      if (this.api) {
        this.log("ℹ️ Jitsi iframe already exists");
        return;
      }

      const config = this.getConfig();
      const parsed = parseJitsiUrl(config.jitsiUrl, config.roomName);

      await loadScriptOnce(
        `https://${parsed.domain}/external_api.js`,
        "jitsi-external-api-script"
      );

      if (!window.JitsiMeetExternalAPI) {
        throw new Error("JitsiMeetExternalAPI is not available");
      }

      const parentNode = document.getElementById("jitsiContainer");
      parentNode.innerHTML = "";

      this.log(`Joining Jitsi iframe: domain=${parsed.domain}, room=${config.roomName}`);

      this.api = new JitsiMeetExternalAPI(parsed.domain, {
        roomName: config.roomName,
        parentNode,
        width: "100%",
        height: 560,

        userInfo: {
          displayName: config.displayName
        },

        configOverwrite: {
          prejoinPageEnabled: false,
          startWithVideoMuted: true,
          startWithAudioMuted: state.mode === "private",
          disableDeepLinking: true
        },

        interfaceConfigOverwrite: {
          SHOW_JITSI_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false
        }
      });

      this.api.addListener("videoConferenceJoined", async () => {
        this.joined = true;

        try {
          this.api.executeCommand("displayName", config.displayName);
        } catch {}

        await this.onJoined?.();
      });

      this.api.addListener("videoConferenceLeft", async () => {
        this.joined = false;
        this.log("⚠️ Jitsi meeting left");
        await this.onLeft?.();
      });

      this.api.addListener("readyToClose", async () => {
        this.joined = false;
        this.log("⚠️ Jitsi iframe ready to close");
        await this.onLeft?.();
      });

      this.api.addListener("audioMuteStatusChanged", async (event) => {
        const muted = !!event.muted;
        await this.onAudioMuteStatusChanged?.(muted);
      });
    }

    async leave() {
      if (!this.api) return;

      try {
        this.api.executeCommand("hangup");
      } catch {}

      try {
        this.api.dispose();
      } catch {}

      this.api = null;
      this.joined = false;

      const parentNode = document.getElementById("jitsiContainer");
      if (parentNode) parentNode.innerHTML = "";

      this.log("✅ Jitsi iframe disposed");
    }

    setDisplayName(displayName) {
      if (!this.api) return;
      this.api.executeCommand("displayName", displayName);
    }

    async isAudioMuted() {
      if (!this.api) return true;

      if (typeof this.api.isAudioMuted === "function") {
        return await this.api.isAudioMuted();
      }

      return state.jitsiMicMuted;
    }

    async ensureAudioMuted() {
      if (!this.api) return;

      let muted = true;

      try {
        muted = await this.isAudioMuted();
      } catch {
        muted = state.jitsiMicMuted;
      }

      if (!muted) {
        this.log("🔇 Muting Jitsi mic for private mode");

        try {
          this.api.executeCommand("toggleAudio");
        } catch (err) {
          this.log("⚠️ Failed to mute Jitsi mic: " + (err.message || err));
        }

        state.jitsiMicMuted = true;
      }
    }

    async ensureAudioUnmuted() {
      if (!this.api) return;

      let muted = true;

      try {
        muted = await this.isAudioMuted();
      } catch {
        muted = state.jitsiMicMuted;
      }

      if (muted) {
        this.log("🎙️ Unmuting Jitsi mic for public mode");

        try {
          this.api.executeCommand("toggleAudio");
        } catch (err) {
          this.log("⚠️ Failed to unmute Jitsi mic: " + (err.message || err));
          return;
        }

        await sleep(300);

        try {
          state.jitsiMicMuted = await this.isAudioMuted();
        } catch {
          state.jitsiMicMuted = false;
        }
      }
    }
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

  function buildDefaultJitsiUrl(roomName, displayName) {
    const base = String(DEFAULT_JITSI_BASE_URL || "https://meet.omni.elvismao.com")
        .trim()
        .replace(/\/+$/g, "");

    const safeRoomName = encodeURIComponent(normalizeRoomName(roomName));
    const safeDisplayName = encodeURIComponent(displayName || "anonymous");

    return `${base}/?room=${safeRoomName}&id=${safeDisplayName}`;
    }

  function buildDefaultApiWsUrl(roomName, participantId) {
    const base = String(DEFAULT_API_BASE_WS_URL || "ws://" + window.location.hostname + ":8001")
      .trim()
      .replace(/\/+$/g, "");

    return (
      `${base}/sessions/${encodeURIComponent(roomName)}` +
      `/audio-stream?participant_id=${encodeURIComponent(participantId)}`
    );
  }

  function sourceForScope(scope) {
    return normalizeMode(scope) === "private"
      ? "browser_private"
      : "browser_public";
  }

  function agentTypeForScope(scope) {
    return normalizeMode(scope) === "private"
      ? "private_browser"
      : "public_browser";
  }

  function parseJitsiUrl(url, fallbackRoomName) {
    try {
      const parsed = new URL(url);

      const domain = parsed.hostname;
      const roomName = normalizeRoomName(
        parsed.pathname.replace(/^\/+/, "").split("/")[0] ||
        fallbackRoomName ||
        DEFAULT_ROOM_NAME
      );

      return {
        domain,
        roomName
      };
    } catch {
      return {
        domain: "meet.omni.elvismao.com",
        roomName: normalizeRoomName(fallbackRoomName || DEFAULT_ROOM_NAME)
      };
    }
  }

  function parseRoomNameFromUrl(url) {
    try {
      const parsed = new URL(url);

      return normalizeRoomName(
        parsed.pathname.replace(/^\/+/, "").split("/")[0]
      );
    } catch {
      return "";
    }
  }

  function normalizeRoomName(roomName) {
    return String(roomName || DEFAULT_ROOM_NAME)
      .trim()
      .replace(/^\/+|\/+$/g, "")
      .split("/")[0]
      .toLowerCase();
  }

  function normalizeMode(mode) {
    mode = String(mode || "public").toLowerCase();

    if (mode === "private") return "private";
    return "public";
  }

  function getRoomNameFromPath() {
    const firstSegment = window.location.pathname
      .split("/")
      .filter(Boolean)[0];

    if (!firstSegment) return "";
    if (firstSegment.includes(".")) return "";

    return normalizeRoomName(firstSegment);
  }

  function makeClientId(prefix = "client") {
    if (window.crypto?.randomUUID) {
      return `${prefix}_${crypto.randomUUID()}`;
    }

    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function getOrCreateAnonymousUserId() {
    const existing = localStorageGet("omni.userId", "");

    if (existing) return existing;

    const id = "user_" + Math.random().toString(16).slice(2, 10);

    localStorageSet("omni.userId", id);

    return id;
  }

  function loadScriptOnce(src, id) {
    return new Promise((resolve, reject) => {
      const existing = document.getElementById(id);

      if (existing) {
        if (existing.dataset.loaded === "true") {
          resolve();
        } else {
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener(
            "error",
            () => reject(new Error("Failed to load script: " + src)),
            { once: true }
          );
        }

        return;
      }

      const script = document.createElement("script");
      script.id = id;
      script.src = src;
      script.async = true;

      script.onload = () => {
        script.dataset.loaded = "true";
        resolve();
      };

      script.onerror = () => {
        reject(new Error("Failed to load script: " + src));
      };

      document.head.appendChild(script);
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function localStorageGet(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }

  function localStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }

  function createUi() {
    const requiredIds = [
      "omniAgentRoot",

      "roomNameInput",
      "jitsiUrlInput",
      "apiWsUrlInput",
      "userIdInput",
      "displayNameInput",

      "applyConfigBtn",
      "joinBtn",
      "leaveBtn",

      "publicModeBtn",
      "privateModeBtn",

      "refreshMicBtn",
      "stopAgentBtn",
      "clearLogBtn",

      "modeStatus",
      "jitsiStatus",
      "jitsiMicStatus",
      "agentStatus",
      "currentInfo",
      "computedWsUrl",

      "log"
    ];

    for (const id of requiredIds) {
      if (!document.getElementById(id)) {
        throw new Error(`Missing HTML element: #${id}`);
      }
    }

    return {
      root: document.getElementById("omniAgentRoot"),

      roomNameInput: document.getElementById("roomNameInput"),
      jitsiUrlInput: document.getElementById("jitsiUrlInput"),
      apiWsUrlInput: document.getElementById("apiWsUrlInput"),
      userIdInput: document.getElementById("userIdInput"),
      displayNameInput: document.getElementById("displayNameInput"),

      applyConfigBtn: document.getElementById("applyConfigBtn"),
      joinBtn: document.getElementById("joinBtn"),
      leaveBtn: document.getElementById("leaveBtn"),

      publicModeBtn: document.getElementById("publicModeBtn"),
      privateModeBtn: document.getElementById("privateModeBtn"),

      refreshMicBtn: document.getElementById("refreshMicBtn"),
      stopAgentBtn: document.getElementById("stopAgentBtn"),
      clearLogBtn: document.getElementById("clearLogBtn"),

      modeStatus: document.getElementById("modeStatus"),
      jitsiStatus: document.getElementById("jitsiStatus"),
      jitsiMicStatus: document.getElementById("jitsiMicStatus"),
      agentStatus: document.getElementById("agentStatus"),
      currentInfo: document.getElementById("currentInfo"),
      computedWsUrl: document.getElementById("computedWsUrl"),

      logBox: document.getElementById("log")
    };
  }

  async function applyConfigFromUi() {
    const config = getConfig();

    localStorageSet("omni.roomName", config.roomName);
    localStorageSet("omni.jitsiUrl", config.jitsiUrl);
    localStorageSet("omni.apiWsUrl", ui.apiWsUrlInput.value.trim());
    localStorageSet("omni.userId", config.userId);
    localStorageSet("omni.displayName", config.displayName);

    log("✅ Settings applied");
    log(`Room name: ${config.roomName}`);
    log(`Jitsi URL: ${config.jitsiUrl}`);
    log(`Audio WebSocket: ${config.apiWsUrl}`);
    log(`User ID: ${config.userId}`);
    log(`Display Name: ${config.displayName}`);

    if (jitsiController.isJoined()) {
      log("⚠️ Room / user settings changed while meeting is joined.");

      try {
        jitsiController.setDisplayName(config.displayName);
        log("✅ Jitsi display name updated");
      } catch (err) {
        log("⚠️ Failed to update Jitsi display name: " + (err.message || err));
      }

      log("ℹ️ If you changed Room Name or Jitsi URL, please Leave Meeting and Join again.");
    }

    updateUiState();
  }
})();
