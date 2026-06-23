function isOmniApiHost(hostname: string): boolean {
	return hostname === "api.omni.observe.tw" || hostname.endsWith(".api.omni.observe.tw");
}

function branchFromOmniHost(hostname: string): string | null {
	const normalizedHostname = hostname.trim().toLowerCase();
	if (!normalizedHostname) {
		return null;
	}

	const apiSuffix = ".api.omni.observe.tw";
	if (normalizedHostname.endsWith(apiSuffix)) {
		const branch = normalizedHostname.slice(0, -apiSuffix.length);
		return branch && !branch.includes(".") ? branch : null;
	}

	const appSuffix = ".omni.observe.tw";
	if (normalizedHostname.endsWith(appSuffix)) {
		const branch = normalizedHostname.slice(0, -appSuffix.length);
		return branch && !branch.includes(".") && !["ai", "api", "meet"].includes(branch) ? branch : null;
	}

	return null;
}

interface NormalizeAudioWsBaseUrlOptions {
	frontendHostname?: string;
}

export function normalizeAudioWsBaseUrl(baseUrl: string, options: NormalizeAudioWsBaseUrlOptions = {}): string {
	const normalized = baseUrl.trim().replace(/\/+$/, "");
	if (!normalized) {
		return normalized;
	}

	try {
		const url = new URL(normalized);
		if ((url.protocol === "ws:" || url.protocol === "wss:") && isOmniApiHost(url.hostname) && (url.pathname === "" || url.pathname === "/")) {
			const branch = branchFromOmniHost(options.frontendHostname ?? "") ?? branchFromOmniHost(url.hostname);
			if (branch) {
				return `${url.protocol}//${branch}.ai.omni.observe.tw`;
			}

			url.pathname = "/asr";
			return url.toString().replace(/\/+$/, "");
		}
	} catch {
		return normalized;
	}

	return normalized;
}
