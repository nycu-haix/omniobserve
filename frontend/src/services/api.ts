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
	template_description?: string;
	topic_description: string;
	task_detail: string;
	reference_image_src?: string;
	reference_image_alt?: string;
	items: TaskConfigItem[];
}

export interface TaskTemplate {
	task_id: string;
	title: string;
	session_prefix: string;
	description: string;
	is_default: boolean;
}

interface FetchTaskConfigOptions {
	sessionName?: string;
	taskId?: string;
	signal?: AbortSignal;
}

export async function fetchTaskTemplates(signal?: AbortSignal) {
	const response = await fetch(apiUrl("/api/task-templates"), { signal });
	if (!response.ok) {
		throw new Error(`Failed to fetch task templates: ${response.status}`);
	}
	return (await response.json()) as TaskTemplate[];
}

export async function fetchTaskConfig(options: FetchTaskConfigOptions = {}) {
	const params = new URLSearchParams();
	if (options.sessionName) {
		params.set("session_name", options.sessionName);
	}
	if (options.taskId) {
		params.set("task_id", options.taskId);
	}
	const path = params.size > 0 ? `/api/task-config?${params.toString()}` : "/api/task-config";
	const response = await fetch(apiUrl(path), { signal: options.signal });
	if (!response.ok) {
		throw new Error(`Failed to fetch task config: ${response.status}`);
	}
	return (await response.json()) as TaskConfig;
}
