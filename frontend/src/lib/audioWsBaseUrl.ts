function isOmniApiHost(hostname: string): boolean {
	return hostname === "api.omni.observe.tw" || hostname.endsWith(".api.omni.observe.tw");
}

interface NormalizeAudioWsBaseUrlOptions {
	frontendHostname?: string;
}

export function normalizeAudioWsBaseUrl(baseUrl: string, _options: NormalizeAudioWsBaseUrlOptions = {}): string {
	void _options;

	const normalized = baseUrl.trim().replace(/\/+$/, "");
	if (!normalized) {
		return normalized;
	}

	try {
		const url = new URL(normalized);
		if ((url.protocol === "ws:" || url.protocol === "wss:") && isOmniApiHost(url.hostname) && (url.pathname === "" || url.pathname === "/")) {
			url.pathname = "/asr";
			return url.toString().replace(/\/+$/, "");
		}
	} catch {
		return normalized;
	}

	return normalized;
}
