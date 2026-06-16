export interface TaskReferenceOption {
	id: string;
	label_zh: string;
	label_en?: string;
	category?: string;
	description_zh?: string;
	template_zh?: string;
	allowed_action_ids?: string[];
	requires_detail?: boolean | null;
	detail_input?: {
		label_zh?: string | null;
		placeholder_zh?: string | null;
	} | null;
}

function normalizeText(value: string | null | undefined): string {
	return value?.trim() ?? "";
}

export function getTaskReferenceLabel(option: TaskReferenceOption): string {
	return normalizeText(option.label_zh) || normalizeText(option.label_en) || option.id;
}

export function getComponentReferenceDescription(option: TaskReferenceOption): string {
	return normalizeText(option.description_zh) || normalizeText(option.label_en) || "尚無補充說明";
}

export function isBackgroundReferenceOption(option: TaskReferenceOption): boolean {
	return normalizeText(option.category) === "background" || option.id === "background";
}

export function getComponentReferenceCategoryLabel(option: TaskReferenceOption): string {
	return isBackgroundReferenceOption(option) ? "背景/底色" : "";
}

export function getComponentReferenceMeta(option: TaskReferenceOption): string {
	return isBackgroundReferenceOption(option) ? "背景類元件，只提供改顏色與透明度。" : "";
}

export function getActionReferenceDescription(option: TaskReferenceOption): string {
	const description = normalizeText(option.description_zh);
	if (description) {
		return description;
	}

	const template = normalizeText(option.template_zh);
	if (template) {
		return `範例：${template}`;
	}

	return normalizeText(option.label_en) || "尚無補充說明";
}

export function getActionDetailHint(option: TaskReferenceOption): string {
	if (!option.requires_detail) {
		return "";
	}

	const label = normalizeText(option.detail_input?.label_zh);
	const placeholder = normalizeText(option.detail_input?.placeholder_zh);
	if (label && placeholder) {
		return `${label}：${placeholder}`;
	}
	if (label) {
		return `需要${label}`;
	}
	return "需要補充內容";
}
