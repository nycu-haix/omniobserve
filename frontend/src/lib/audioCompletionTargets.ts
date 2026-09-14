export interface CompletionTargetFields {
	transcript_segment_id?: string | number | null;
	transcript_segment_ids?: Array<string | number | null> | null;
	segment_id?: string | number | null;
	segment_ids?: Array<string | number | null> | null;
	participant_id?: string | number | null;
	userId?: string | number | null;
	user_id?: string | number | null;
	client_segment_id?: string | number | null;
	client_segment_ids?: Array<string | number | null> | null;
	replace_segment_id?: string | number | null;
	replace_segment_ids?: Array<string | number | null> | null;
	scope?: string | null;
	mic_mode?: string | null;
	local_mic_mode?: string | null;
}

export interface CompletionTargetDraft {
	id?: string;
	source?: string;
	userId?: string;
}

function appendSegmentIds(segmentIds: Set<string>, values: Array<string | number | null> | null | undefined): void {
	if (!Array.isArray(values)) {
		return;
	}

	values.forEach(value => {
		if (value == null) {
			return;
		}
		const segmentId = String(value).trim();
		if (segmentId) {
			segmentIds.add(segmentId);
		}
	});
}

function addSegmentId(segmentIds: Set<string>, value: string | number | null | undefined): void {
	if (value == null) {
		return;
	}
	const segmentId = String(value).trim();
	if (segmentId) {
		segmentIds.add(segmentId);
	}
}

export function completionTargetSource(message: CompletionTargetFields): string {
	return message.scope ?? message.mic_mode ?? message.local_mic_mode ?? "private";
}

export function completionTargetUserId(message: CompletionTargetFields, participantId: string): string {
	return String(message.participant_id ?? message.userId ?? message.user_id ?? participantId);
}

export function completionTargetSegmentIds(message: CompletionTargetFields): string[] {
	const segmentIds = new Set<string>();
	appendSegmentIds(segmentIds, message.replace_segment_ids);
	appendSegmentIds(segmentIds, message.client_segment_ids);
	appendSegmentIds(segmentIds, message.transcript_segment_ids);
	appendSegmentIds(segmentIds, message.segment_ids);
	addSegmentId(segmentIds, message.replace_segment_id);
	addSegmentId(segmentIds, message.client_segment_id);
	addSegmentId(segmentIds, message.transcript_segment_id);
	addSegmentId(segmentIds, message.segment_id);
	return Array.from(segmentIds);
}

export function completionTargetKeys(message: CompletionTargetFields, participantId: string): string[] {
	const source = completionTargetSource(message);
	const userId = completionTargetUserId(message, participantId);
	return completionTargetSegmentIds(message).map(segmentId => [source, userId, segmentId].join("|"));
}

export function activeCompletionTargetKey(message: CompletionTargetFields, participantId: string): string {
	return [completionTargetSource(message), completionTargetUserId(message, participantId), "active"].join("|");
}

export function matchingDraftCompletionTargetKeys(options: { drafts: Iterable<[string, CompletionTargetDraft]>; segmentIds: string[]; source: string; userId: string }): string[] {
	const segmentIdSet = new Set(options.segmentIds);
	if (segmentIdSet.size === 0) {
		return [];
	}

	const keys: string[] = [];
	for (const [key, draft] of options.drafts) {
		if (draft.id && segmentIdSet.has(draft.id) && draft.source === options.source && String(draft.userId ?? "") === options.userId) {
			keys.push(key);
		}
	}
	return keys;
}
