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
	component_id?: string;
	action_id?: string;
	source_user_ids?: number[];
}

export interface Phase1BuilderOption {
	id: string;
	label_zh: string;
	label_en?: string;
	description_zh?: string;
	template_zh?: string;
	allowed_action_ids?: string[];
	requires_detail?: boolean | null;
}

export interface Phase1BuilderConfig {
	enabled: boolean;
	title?: string;
	detail_placeholder?: string;
	minimum_items?: number;
	components: Phase1BuilderOption[];
	actions: Phase1BuilderOption[];
}

export type TaskPaneLayoutConfig =
	| {
			type: "leaf";
			content: string;
	  }
	| {
			type: "split";
			direction: "horizontal" | "vertical";
			ratio: number;
			first: TaskPaneLayoutConfig;
			second: TaskPaneLayoutConfig;
	  };

export interface TaskPhaseConfig {
	id: string;
	label: string;
	default_layout?: TaskPaneLayoutConfig;
}

export interface TaskConfig {
	task_id: string;
	title: string;
	template_description?: string;
	topic_description: string;
	task_detail: string;
	reference_image_src?: string;
	reference_image_alt?: string;
	phases?: TaskPhaseConfig[];
	phase1_builder?: Phase1BuilderConfig;
	ranking_limit?: number;
	items: TaskConfigItem[];
}

export interface TaskTemplate {
	task_id: string;
	title: string;
	session_prefix: string;
	phases?: TaskPhaseConfig[];
	description: string;
	is_default: boolean;
}

interface FetchTaskConfigOptions {
	sessionName?: string;
	taskId?: string;
	signal?: AbortSignal;
}

export interface PrivatePhaseTaskItem {
	id: number;
	session_name: string;
	user_id: number;
	task_id: string;
	component_id: string;
	component_label: string;
	action_id: string;
	action_label: string;
	detail: string;
	statement: string;
	priority: number;
	created_at: string;
	updated_at: string;
}

export interface PrivatePhaseTaskItemPayload {
	task_id?: string;
	component_id: string;
	action_id: string;
	detail?: string;
	priority?: number;
}

export type PrivatePhaseTaskItemUpdatePayload = Partial<Pick<PrivatePhaseTaskItemPayload, "component_id" | "action_id" | "detail" | "priority">>;

async function getResponseErrorMessage(response: Response, fallback: string): Promise<string> {
	try {
		const payload = (await response.json()) as { detail?: unknown; message?: unknown };
		const detail = typeof payload.detail === "string" ? payload.detail : undefined;
		const message = typeof payload.message === "string" ? payload.message : undefined;
		return detail || message || `${fallback}: ${response.status}`;
	} catch {
		return `${fallback}: ${response.status}`;
	}
}

function privatePhaseTaskItemsPath(sessionName: string, userId: string | number) {
	return `/api/sessions/${encodeURIComponent(sessionName)}/users/${encodeURIComponent(String(userId))}/private-phase-task-items`;
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

export async function fetchPrivatePhaseTaskItems(options: { sessionName: string; userId: string | number; signal?: AbortSignal }) {
	const response = await fetch(apiUrl(privatePhaseTaskItemsPath(options.sessionName, options.userId)), { signal: options.signal });
	if (!response.ok) {
		throw new Error(await getResponseErrorMessage(response, "Failed to fetch private phase task items"));
	}
	return (await response.json()) as PrivatePhaseTaskItem[];
}

export async function createPrivatePhaseTaskItem(sessionName: string, userId: string | number, payload: PrivatePhaseTaskItemPayload) {
	const response = await fetch(apiUrl(privatePhaseTaskItemsPath(sessionName, userId)), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload)
	});
	if (!response.ok) {
		throw new Error(await getResponseErrorMessage(response, "Failed to create private phase task item"));
	}
	return (await response.json()) as PrivatePhaseTaskItem;
}

export async function updatePrivatePhaseTaskItem(sessionName: string, userId: string | number, itemId: number, payload: PrivatePhaseTaskItemUpdatePayload) {
	const response = await fetch(apiUrl(`${privatePhaseTaskItemsPath(sessionName, userId)}/${encodeURIComponent(String(itemId))}`), {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload)
	});
	if (!response.ok) {
		throw new Error(await getResponseErrorMessage(response, "Failed to update private phase task item"));
	}
	return (await response.json()) as PrivatePhaseTaskItem;
}

export async function deletePrivatePhaseTaskItem(sessionName: string, userId: string | number, itemId: number) {
	const response = await fetch(apiUrl(`${privatePhaseTaskItemsPath(sessionName, userId)}/${encodeURIComponent(String(itemId))}`), {
		method: "DELETE"
	});
	if (!response.ok) {
		throw new Error(await getResponseErrorMessage(response, "Failed to delete private phase task item"));
	}
}

export async function reorderPrivatePhaseTaskItems(sessionName: string, userId: string | number, itemIds: number[]) {
	const response = await fetch(apiUrl(`${privatePhaseTaskItemsPath(sessionName, userId)}/reorder`), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ item_ids: itemIds })
	});
	if (!response.ok) {
		throw new Error(await getResponseErrorMessage(response, "Failed to reorder private phase task items"));
	}
	return (await response.json()) as PrivatePhaseTaskItem[];
}
