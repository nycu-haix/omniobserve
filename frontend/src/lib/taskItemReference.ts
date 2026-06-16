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

export interface ComponentReferenceGroup<T extends TaskReferenceOption = TaskReferenceOption> {
	id: string;
	label: string;
	items: T[];
}

const COMPONENT_GROUPS = [
	{
		id: "title-copy",
		label: "標題與說明",
		componentIds: new Set(["main_title", "subtitle", "description1", "description2", "title_group"])
	},
	{
		id: "visuals",
		label: "圖像與圖示",
		componentIds: new Set(["people_icon1", "people_icon2", "activity_icon1", "activity_icon2"])
	},
	{
		id: "signup",
		label: "報名資訊",
		componentIds: new Set(["qr_code", "qr_caption", "contact_info"])
	},
	{
		id: "footer",
		label: "下方資訊",
		componentIds: new Set(["organizer_list", "reminder", "event_info", "info_group2"])
	},
	{
		id: "background",
		label: "背景/底色",
		componentIds: new Set(["background"])
	}
] as const;

function normalizeText(value: string | null | undefined): string {
	return value?.trim() ?? "";
}

function getComponentGroup(option: TaskReferenceOption): (typeof COMPONENT_GROUPS)[number] | undefined {
	const category = normalizeText(option.category);
	if (category === "background") {
		return COMPONENT_GROUPS.find(group => group.id === "background");
	}
	return COMPONENT_GROUPS.find(group => group.componentIds.has(option.id));
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
	return getComponentGroup(option)?.label ?? "";
}

export function getComponentReferenceMeta(option: TaskReferenceOption): string {
	if (isBackgroundReferenceOption(option)) {
		return "背景類元件，只提供改顏色與透明度。";
	}
	const categoryLabel = getComponentReferenceCategoryLabel(option);
	return categoryLabel ? `分類：${categoryLabel}` : "";
}

export function groupComponentReferenceOptions<T extends TaskReferenceOption>(options: T[]): ComponentReferenceGroup<T>[] {
	const groups = new Map<string, ComponentReferenceGroup<T>>();

	for (const option of options) {
		const group = getComponentGroup(option);
		const groupId = group?.id ?? "other";
		const label = group?.label ?? "其他元件";
		const currentGroup = groups.get(groupId);
		if (currentGroup) {
			currentGroup.items.push(option);
		} else {
			groups.set(groupId, { id: groupId, label, items: [option] });
		}
	}

	return Array.from(groups.values());
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
