const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") || "";

export function apiUrl(path: string) {
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	return `${apiBaseUrl}${normalizedPath}`;
}
