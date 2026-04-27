class FrontendSileroVad {
  constructor(options = {}) {
    this.modelPath = options.modelPath || "./models/silero_vad.onnx";

    this.sampleRate = options.sampleRate || 16000;
    this.frameSize = options.frameSize || 512;

    // Silero ONNX model expects 64 samples of previous context at 16kHz.
    this.contextSize = options.contextSize || 64;
    this.effectiveFrameSize = this.frameSize + this.contextSize;

    this.startThreshold = options.startThreshold ?? 0.45;
    this.endThreshold = options.endThreshold ?? 0.2;

    this.minSpeechMs = options.minSpeechMs ?? 800;
    this.maxSpeechMs = options.maxSpeechMs ?? 20000;
    this.minSilenceMs = options.minSilenceMs ?? 1200;
    this.preBufferMs = options.preBufferMs ?? 500;

    this.minSpeechChunks = Math.ceil(
      (this.minSpeechMs / 1000) * this.sampleRate / this.frameSize
    );

    this.maxSpeechChunks = Math.ceil(
    (this.maxSpeechMs / 1000) * this.sampleRate / this.frameSize
    );

    this.minSilenceChunks = Math.ceil(
      (this.minSilenceMs / 1000) * this.sampleRate / this.frameSize
    );

    this.preBufferChunks = Math.ceil(
      (this.preBufferMs / 1000) * this.sampleRate / this.frameSize
    );

    this.onReady = options.onReady || (() => {});
    this.onError = options.onError || (() => {});
    this.onSpeechStart = options.onSpeechStart || (() => {});
    this.onSpeechChunk = options.onSpeechChunk || (() => {});
    this.onSpeechEnd = options.onSpeechEnd || (() => {});
    this.onProbability = options.onProbability || (() => {});
    this.onDebug = options.onDebug || (() => {});

    this.session = null;

    this.inputName = "input";
    this.stateName = "state";
    this.srName = "sr";

    this.outputName = "output";
    this.stateOutputName = "stateN";

    this.state = new Float32Array(2 * 1 * 128);
    this.context = new Float32Array(this.contextSize);

    this.pendingPcm = new Float32Array(0);
    this.processing = false;

    this.speechStarted = false;
    this.speechChunks = 0;
    this.silenceChunks = 0;
    this.preBuffer = [];

    this.segmentId = 0;
    this.totalProcessedSamples = 0;

    this.ready = false;
  }

  async init() {
    if (typeof ort === "undefined") {
      throw new Error("onnxruntime-web is not loaded. Please load ort.min.js first.");
    }

    this.onDebug(`Loading Silero VAD ONNX model: ${this.modelPath}`);

    this.session = await ort.InferenceSession.create(this.modelPath, {
      executionProviders: ["wasm"]
    });

    this.onDebug(`Silero input names: ${this.session.inputNames.join(", ")}`);
    this.onDebug(`Silero output names: ${this.session.outputNames.join(", ")}`);

    this.resolveModelNames();

    this.reset();

    this.ready = true;
    this.onReady();

    return this;
  }

  resolveModelNames() {
    const inputNames = this.session.inputNames || [];
    const outputNames = this.session.outputNames || [];

    if (inputNames.includes("input")) this.inputName = "input";
    else this.inputName = inputNames[0];

    if (inputNames.includes("state")) this.stateName = "state";
    else this.stateName = inputNames.find(name => name.toLowerCase().includes("state")) || "state";

    if (inputNames.includes("sr")) this.srName = "sr";
    else this.srName = inputNames.find(name => name.toLowerCase().includes("sr")) || "sr";

    if (outputNames.includes("output")) this.outputName = "output";
    else this.outputName = outputNames[0];

    if (outputNames.includes("stateN")) this.stateOutputName = "stateN";
    else this.stateOutputName = outputNames.find(name => name.toLowerCase().includes("state")) || outputNames[1];
  }

  reset() {
    this.state = new Float32Array(2 * 1 * 128);
    this.context = new Float32Array(this.contextSize);

    this.pendingPcm = new Float32Array(0);
    this.processing = false;

    this.speechStarted = false;
    this.speechChunks = 0;
    this.silenceChunks = 0;
    this.preBuffer = [];

    this.segmentId = 0;
    this.totalProcessedSamples = 0;
  }

  processAudio(pcm16kFloat32) {
    if (!this.ready) return;

    const input = pcm16kFloat32 instanceof Float32Array
      ? pcm16kFloat32
      : new Float32Array(pcm16kFloat32);

    const merged = new Float32Array(this.pendingPcm.length + input.length);

    merged.set(this.pendingPcm, 0);
    merged.set(input, this.pendingPcm.length);

    let offset = 0;

    while (offset + this.frameSize <= merged.length) {
      const frame = merged.slice(offset, offset + this.frameSize);
      this.enqueueFrame(frame);
      offset += this.frameSize;
    }

    this.pendingPcm = merged.slice(offset);

    if (!this.processing) {
      this.processing = true;
      this.processQueue().catch(err => {
        this.processing = false;
        this.onError(err);
      });
    }
  }

  enqueueFrame(frame) {
    if (!this.frameQueue) {
      this.frameQueue = [];
    }

    this.frameQueue.push(frame);
  }

  async processQueue() {
    while (this.frameQueue && this.frameQueue.length > 0) {
      const frame = this.frameQueue.shift();
      const probability = await this.predictFrame(frame);

      this.totalProcessedSamples += this.frameSize;

      this.onProbability({
        probability,
        speechStarted: this.speechStarted,
        timeSec: this.totalProcessedSamples / this.sampleRate
      });

      this.updateSpeechState(frame, probability);
    }

    this.processing = false;
  }

  async predictFrame(frame) {
    const modelInput = new Float32Array(this.effectiveFrameSize);

    // Model input = previous context + current 512-sample frame.
    modelInput.set(this.context, 0);
    modelInput.set(frame, this.contextSize);

    const inputTensor = new ort.Tensor(
      "float32",
      modelInput,
      [1, this.effectiveFrameSize]
    );

    const stateTensor = new ort.Tensor(
      "float32",
      this.state,
      [2, 1, 128]
    );

    const srTensor = new ort.Tensor(
      "int64",
      BigInt64Array.from([BigInt(this.sampleRate)]),
      [1]
    );

    const feeds = {};
    feeds[this.inputName] = inputTensor;
    feeds[this.stateName] = stateTensor;
    feeds[this.srName] = srTensor;

    const results = await this.session.run(feeds);

    const outputTensor = results[this.outputName];
    const stateOutputTensor = results[this.stateOutputName];

    if (!outputTensor) {
      throw new Error(`Silero output tensor not found: ${this.outputName}`);
    }

    if (!stateOutputTensor) {
      throw new Error(`Silero state output tensor not found: ${this.stateOutputName}`);
    }

    const probability = Number(outputTensor.data[0]);

    this.state = new Float32Array(stateOutputTensor.data);

    // Update context to last 64 samples of current model input.
    this.context = modelInput.slice(
      this.effectiveFrameSize - this.contextSize,
      this.effectiveFrameSize
    );

    return probability;
  }

  updateSpeechState(frame, probability) {
    if (!this.speechStarted) {
      this.preBuffer.push(frame.slice(0));

      if (this.preBuffer.length > this.preBufferChunks) {
        this.preBuffer.shift();
      }

      if (probability >= this.startThreshold) {
        this.speechStarted = true;
        this.speechChunks = 0;
        this.silenceChunks = 0;
        this.segmentId += 1;

        const segmentId = this.segmentId;
        const startTimeSec = Math.max(
          0,
          (this.totalProcessedSamples / this.sampleRate) - (this.preBuffer.length * this.frameSize / this.sampleRate)
        );

        this.onSpeechStart({
          segmentId,
          probability,
          startTimeSec
        });

        // Send pre-buffer first so first syllable is less likely to be cut.
        for (const preFrame of this.preBuffer) {
          this.onSpeechChunk({
            segmentId,
            chunk: preFrame.slice(0),
            isPreBuffer: true
          });
        }

        this.preBuffer = [];

        this.onDebug(
          `Silero start: segment=${segmentId}, prob=${probability.toFixed(4)}`
        );
      }

      return;
    }

    const segmentId = this.segmentId;

    this.speechChunks += 1;

    this.onSpeechChunk({
      segmentId,
      chunk: frame.slice(0),
      isPreBuffer: false
    });

    if (probability < this.endThreshold) {
      this.silenceChunks += 1;
    } else {
      this.silenceChunks = 0;
    }

    if (this.speechChunks < this.minSpeechChunks) {
      return;
    }

    const isSilenceEnd = this.silenceChunks >= this.minSilenceChunks;
    const isMaxLengthEnd = this.speechChunks >= this.maxSpeechChunks;

    if (isSilenceEnd || isMaxLengthEnd) {
        const endTimeSec = this.totalProcessedSamples / this.sampleRate;
        const endReason = isMaxLengthEnd ? "max_speech_ms" : "silence";

        // 先 reset 狀態，避免 callback 出錯時無限重複觸發 end
        this.speechStarted = false;
        this.speechChunks = 0;
        this.silenceChunks = 0;
        this.preBuffer = [];

        try {
            this.onSpeechEnd({
            segmentId,
            probability,
            endTimeSec,
            reason: endReason
            });
        } catch (err) {
            this.onError(err);
        }

        this.onDebug(
            `Silero end: segment=${segmentId}, reason=${endReason}, prob=${probability.toFixed(4)}`
        );
        }
    }
}

window.FrontendSileroVad = FrontendSileroVad;