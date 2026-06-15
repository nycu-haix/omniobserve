import { isGroupPhase, isPrivatePhase1, isPrivatePhase2, type SessionPhase } from "./sessionPhase.ts";

export type TaskPaneContent = "task-instructions" | "phase-task-items" | "private-ranking" | "public-ranking";
export type TaskSplitDirection = "horizontal" | "vertical";

export interface TaskPaneLeaf {
	type: "leaf";
	id: string;
	content: TaskPaneContent;
}

export interface TaskPaneSplit {
	type: "split";
	id: string;
	direction: TaskSplitDirection;
	ratio: number;
	first: TaskPaneNode;
	second: TaskPaneNode;
}

export type TaskPaneNode = TaskPaneLeaf | TaskPaneSplit;

export type TaskPaneLayoutConfig =
	| {
			type: "leaf";
			content: string;
	  }
	| {
			type: "split";
			direction?: string;
			ratio?: number;
			first?: TaskPaneLayoutConfig;
			second?: TaskPaneLayoutConfig;
	  };

export const TASK_PANE_CONTENT_LABELS: Record<TaskPaneContent, string> = {
	"task-instructions": "Task Instructions",
	"phase-task-items": "Task Items",
	"private-ranking": "Private Ranking",
	"public-ranking": "Public Ranking"
};

const MAX_TASK_PANES = 3;
const MIN_TASK_PANE_RATIO = 24;

function createTaskPaneLeaf(content: TaskPaneContent): TaskPaneLeaf {
	return {
		type: "leaf",
		id: `task-pane-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		content
	};
}

function isTaskPaneContent(value: unknown): value is TaskPaneContent {
	return typeof value === "string" && value in TASK_PANE_CONTENT_LABELS;
}

function createTaskPaneLayoutFromConfig(config: TaskPaneLayoutConfig | undefined, phase: SessionPhase, phase1BuilderEnabled = false): TaskPaneNode | null {
	if (!config) {
		return null;
	}

	if (config.type === "leaf") {
		if (!isTaskPaneContent(config.content) || !getTaskPaneContentAvailability(config.content, phase, phase1BuilderEnabled)) {
			return null;
		}
		return createTaskPaneLeaf(config.content);
	}

	if (config.type !== "split" || !config.first || !config.second) {
		return null;
	}

	const first = createTaskPaneLayoutFromConfig(config.first, phase, phase1BuilderEnabled);
	const second = createTaskPaneLayoutFromConfig(config.second, phase, phase1BuilderEnabled);
	if (!first || !second) {
		return null;
	}

	const configuredLayout: TaskPaneSplit = {
		type: "split",
		id: `task-split-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		direction: config.direction === "vertical" ? "vertical" : "horizontal",
		ratio: Math.min(Math.max(Number(config.ratio) || 50, MIN_TASK_PANE_RATIO), 100 - MIN_TASK_PANE_RATIO),
		first,
		second
	};

	return countTaskPaneLeaves(configuredLayout) <= MAX_TASK_PANES ? configuredLayout : null;
}

export function createDefaultTaskPaneLayout(phase: SessionPhase, phase1BuilderEnabled = false, layoutConfig?: TaskPaneLayoutConfig): TaskPaneNode {
	const configuredLayout = createTaskPaneLayoutFromConfig(layoutConfig, phase, phase1BuilderEnabled);
	if (configuredLayout) {
		return configuredLayout;
	}

	if (isGroupPhase(phase)) {
		return {
			type: "split",
			id: `task-split-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			direction: "horizontal",
			ratio: 58,
			first: createTaskPaneLeaf("public-ranking"),
			second: {
				type: "split",
				id: `task-split-${Date.now()}-${Math.random().toString(36).slice(2)}`,
				direction: "vertical",
				ratio: 50,
				first: createTaskPaneLeaf("private-ranking"),
				second: createTaskPaneLeaf("task-instructions")
			}
		};
	}

	if (isPrivatePhase1(phase) && phase1BuilderEnabled) {
		return createTaskPaneLeaf("phase-task-items");
	}

	if (isPrivatePhase2(phase)) {
		return createTaskPaneLeaf("private-ranking");
	}

	return createTaskPaneLeaf("private-ranking");
}

export function countTaskPaneLeaves(node: TaskPaneNode): number {
	return node.type === "leaf" ? 1 : countTaskPaneLeaves(node.first) + countTaskPaneLeaves(node.second);
}

export function getTaskPaneContents(node: TaskPaneNode): TaskPaneContent[] {
	return node.type === "leaf" ? [node.content] : [...getTaskPaneContents(node.first), ...getTaskPaneContents(node.second)];
}

export function getTaskPaneContentAvailability(content: TaskPaneContent, phase: SessionPhase, phase1BuilderEnabled = false): boolean {
	if (content === "phase-task-items") {
		return isPrivatePhase1(phase) && phase1BuilderEnabled;
	}
	if (content === "private-ranking") {
		return !isPrivatePhase1(phase) || !phase1BuilderEnabled;
	}
	if (content === "public-ranking") {
		return isGroupPhase(phase);
	}
	return true;
}
