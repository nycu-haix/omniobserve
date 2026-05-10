const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") || "";

export function apiUrl(path: string) {
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	return `${apiBaseUrl}${normalizedPath}`;
}

export interface TaskConfigItem {
	id: string;
	label: string;
	label_zh: string;
	label_en: string;
	description_zh?: string;
	aliases: string[];
	image_title: string;
	image_bg: string;
	image_fg: string;
	image_mark: string;
}

export interface TaskConfig {
	task_id: string;
	title: string;
	topic_description: string;
	task_detail: string;
	items: TaskConfigItem[];
}

export async function fetchTaskConfig(signal?: AbortSignal) {
	const response = await fetch(apiUrl("/api/task-config"), { signal });
	if (!response.ok) {
		throw new Error(`Failed to fetch task config: ${response.status}`);
	}
	return (await response.json()) as TaskConfig;
}
