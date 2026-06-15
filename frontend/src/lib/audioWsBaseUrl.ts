function isOmniApiHost(hostname: string): boolean {
	return hostname === "api.omni.elvismao.com" || hostname.endsWith(".api.omni.elvismao.com");
}

function branchFromOmniHost(hostname: string): string | null {
	const normalizedHostname = hostname.trim().toLowerCase();
	if (!normalizedHostname) {
		return null;
	}

	const apiSuffix = ".api.omni.elvismao.com";
	if (normalizedHostname.endsWith(apiSuffix)) {
		const branch = normalizedHostname.slice(0, -apiSuffix.length);
		return branch && !branch.includes(".") ? branch : null;
	}

	const appSuffix = ".omni.elvismao.com";
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
				return `${url.protocol}//${branch}.ai.omni.elvismao.com`;
			}

			url.pathname = "/asr";
			return url.toString().replace(/\/+$/, "");
		}
	} catch {
		return normalized;
	}

	return normalized;
}
