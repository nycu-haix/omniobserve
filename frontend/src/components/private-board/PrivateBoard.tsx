import { ChevronRight } from "lucide-react";
import type { UIEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatParticipantDisplayName } from "../../lib/participantDefaults";
import { cn } from "../../lib/utils";
import { ENABLE_PRIVATE_BOARD_MOCK_DATA, MOCK_IDEA_BLOCKS, MOCK_SIMILARITY_CUES, MOCK_TRANSCRIPT_LINES } from "../../mock/privateBoard";
import { apiUrl } from "../../services/api";
import type { BoardTab, IdeaBlock, MicMode, PublicChatMessage, SimilarityCueData, TranscriptLine as TranscriptLineType } from "../../types";
import { Button } from "../ui/Button";
import { ScrollArea } from "../ui/ScrollArea";
import { IdeaBlockItem } from "./IdeaBlockItem";
import { PublicChatComposer, PublicChatMessages } from "./PublicChatPanel";
import { SimilarityCue } from "./SimilarityCue";
import { TranscriptLine } from "./TranscriptLine";

interface PrivateBoardProps {
	sessionId: string;
	participantId: string;
	lastMessage: object | null;
	lastAudioMessage: object | null;
	isConnected: boolean;
	micMode: MicMode;
	onMicModeChange: (mode: MicMode) => void | Promise<void>;
	onSendBoardMessage: (message: object) => void;
	displayName: string;
	currentPhase?: SessionPhase;
	timerEndTime?: number;
	onCollapse?: () => void;
	isCollapsed?: boolean;
	onRequestOpen?: () => void;
}

type BoardMessage =
	| { type: "new_idea_block"; payload: IdeaBlock }
	| { type: "update_idea_block"; payload: Partial<IdeaBlock> & { id: string } }
	| { type: "new_transcript_line"; payload: TranscriptLineType }
	| { type: "similarity_cue"; payload: SimilarityCueData }
	| { type: "public_chat_message"; payload: PublicChatMessagePayload }
	| { type: "public_chat_error"; reason?: string }
	| { type: "phase_changed"; phase: SessionPhase; end_time_ms: number; duration_s: number }
	| { type: "countdown_changed"; current_phase?: SessionPhase; timer_end_time_ms?: number; end_time_ms?: number; duration_s: number }
	| { type: "board_state"; current_phase?: SessionPhase; timer_end_time_ms?: number; cue_condition?: CueCondition }
	| { type: "cue_condition_changed"; cue_condition?: CueCondition; condition?: CueCondition };

type SessionPhase = "private" | "group";
type CueCondition = "experimental" | "control";

interface TranscriptResponse {
	id: number;
	user_id: number;
	session_name: string;
	display_name?: string | null;
	visibility?: string;
	time_stamp: string;
	transcript: string;
}

interface IdeaBlockResponse {
	id: number;
	title: string;
	summary: string;
	transcript_id?: number | null;
	transcript: string | null;
	similarity_id: number | null;
	similarity_is_same_reason?: boolean | null;
	is_deleted?: boolean;
	time_stamp?: string | null;
}

interface ChatMessageResponse {
	id: number;
	session_name: string;
	user_id: number;
	display_name?: string | null;
	message: string;
	time_stamp: string;
	is_deleted?: boolean;
}

interface PublicChatMessagePayload {
	id: string;
	sessionName?: string;
	userId?: string;
	displayName?: string | null;
	message: string;
	timestampMs?: number;
	isDeleted?: boolean;
}

interface AudioIdeaBlocksUpdateMessage {
	type: "idea_blocks_update";
	idea_blocks?: IdeaBlockResponse[];
}

type AudioTranscriptMessage =
	| {
			type: "transcript_update";
			transcript_segment_id?: string | number | null;
			participant_id?: string | number | null;
			userId?: string | number | null;
			user_id?: string | number | null;
			mic_mode?: string | null;
			scope?: string | null;
			text?: string;
			timestamp_ms?: number | null;
			local_mic_mode?: string | null;
			reason?: string | null;
			persisted?: boolean | null;
	  }
	| {
			type: "transcript";
			segment_id?: string | number | null;
			participant_id?: string | number | null;
			userId?: string | number | null;
			user_id?: string | number | null;
			mic_mode?: string | null;
			scope?: string | null;
			text?: string;
			timestamp_ms?: number | null;
			local_mic_mode?: string | null;
			reason?: string | null;
			persisted?: boolean | null;
	  };

const AUTO_SCROLL_BOTTOM_THRESHOLD = 48;
const PUBLIC_CHAT_NOTIFICATION_AUTO_DISMISS_MS = 7000;
const MAX_SPEECH_TRANSCRIPT_REASON = "max_speech_ms";
const LIVE_TRANSCRIPT_REASON = "sliding_window";
const FINAL_TRANSCRIPT_REASONS = new Set(["silence", "client_stop", "mic_mode_switch", "disconnect", "error"]);

function isNearScrollBottom(element: HTMLElement): boolean {
	return element.scrollHeight - element.scrollTop - element.clientHeight <= AUTO_SCROLL_BOTTOM_THRESHOLD;
}

function isEditableShortcutTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	const editableElement = target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']");
	if (!editableElement) {
		return false;
	}

	if (editableElement instanceof HTMLInputElement) {
		return editableElement.type !== "button" && editableElement.type !== "checkbox" && editableElement.type !== "radio" && editableElement.type !== "submit";
	}

	return true;
}

function isBoardMessage(message: object | null): message is BoardMessage {
	if (!message || !("type" in message)) {
		return false;
	}

	return (
		message.type === "new_idea_block" ||
		message.type === "update_idea_block" ||
		message.type === "new_transcript_line" ||
		message.type === "similarity_cue" ||
		message.type === "public_chat_message" ||
		message.type === "public_chat_error" ||
		message.type === "phase_changed" ||
		message.type === "countdown_changed" ||
		message.type === "board_state" ||
		message.type === "cue_condition_changed"
	);
}

function isAudioTranscriptMessage(message: object | null): message is AudioTranscriptMessage {
	return (
		!!message && "type" in message && (message.type === "transcript_update" || message.type === "transcript") && "text" in message && typeof message.text === "string" && message.text.trim().length > 0
	);
}

function isAudioIdeaBlocksUpdateMessage(message: object | null): message is AudioIdeaBlocksUpdateMessage {
	return !!message && "type" in message && message.type === "idea_blocks_update";
}

const createDraftIdeaBlock = (): IdeaBlock => ({
	id: `draft-${Date.now()}`,
	summary: "新增 idea block",
	aiSummary: "",
	transcript: "",
	expanded: true,
	isDraft: true,
	createdAtMs: Date.now(),
	status: "ready"
});

function getTranscriptUserId(participantId: string): number {
	const userId = Number(participantId);
	return Number.isInteger(userId) ? userId : 0;
}

function buildPrivateTranscriptUrl(sessionId: string, participantId: string): string {
	const encodedSessionId = encodeURIComponent(sessionId);
	const userId = getTranscriptUserId(participantId);
	return apiUrl(`/api/sessions/${encodedSessionId}/users/${encodeURIComponent(String(userId))}/transcripts?visibility=private`);
}

function buildPublicTranscriptUrl(sessionId: string): string {
	const encodedSessionId = encodeURIComponent(sessionId);
	return apiUrl(`/api/sessions/${encodedSessionId}/transcripts?visibility=public`);
}

function buildAllSessionTranscriptUrl(sessionId: string): string {
	const encodedSessionId = encodeURIComponent(sessionId);
	return apiUrl(`/api/sessions/${encodedSessionId}/transcripts`);
}

function buildIdeaBlocksUrl(sessionId: string, participantId: string): string {
	const encodedSessionId = encodeURIComponent(sessionId);
	const userId = getTranscriptUserId(participantId);
	return apiUrl(`/api/sessions/${encodedSessionId}/users/${encodeURIComponent(String(userId))}/idea-blocks`);
}

function buildIdeaBlockDetailUrl(sessionId: string, participantId: string, ideaBlockId: string): string {
	return `${buildIdeaBlocksUrl(sessionId, participantId)}/${encodeURIComponent(ideaBlockId)}`;
}

function buildChatMessagesUrl(sessionId: string): string {
	const encodedSessionId = encodeURIComponent(sessionId);
	return apiUrl(`/api/sessions/${encodedSessionId}/chat-messages`);
}

async function getResponseErrorMessage(response: Response, fallback: string): Promise<string> {
	try {
		const payload = (await response.json()) as { detail?: unknown; message?: unknown };
		const detail = typeof payload.detail === "string" ? payload.detail : undefined;
		const message = typeof payload.message === "string" ? payload.message : undefined;
		return detail || message || `${fallback} (${response.status})`;
	} catch {
		return `${fallback} (${response.status})`;
	}
}

function isOwnTranscriptUser(userId: string | number | null | undefined, participantId: string): boolean {
	if (userId == null) {
		return false;
	}

	const userIdText = String(userId);
	return userIdText === participantId || Number(userIdText) === getTranscriptUserId(participantId);
}

function transcriptResponseToLine(item: TranscriptResponse, participantId: string, sourceOverride?: TranscriptLineType["source"]): TranscriptLineType {
	const source = sourceOverride ?? (item.visibility === "public" || item.visibility === "private" ? item.visibility : "private");
	const timestampMs = Date.parse(item.time_stamp);
	return {
		id: String(item.id),
		source,
		origin: "history",
		userId: String(item.user_id),
		displayName: item.display_name ?? undefined,
		isOwn: isOwnTranscriptUser(item.user_id, participantId),
		time: formatTranscriptTime(item.time_stamp),
		timestampMs: Number.isNaN(timestampMs) ? undefined : timestampMs,
		text: item.transcript
	};
}

function chatMessageResponseToMessage(item: ChatMessageResponse, participantId: string): PublicChatMessage {
	const timestampMs = Date.parse(item.time_stamp);
	return {
		id: String(item.id),
		sessionName: item.session_name,
		userId: String(item.user_id),
		displayName: item.display_name ?? undefined,
		message: item.message,
		time: formatTranscriptTime(item.time_stamp),
		timestampMs: Number.isNaN(timestampMs) ? undefined : timestampMs,
		isOwn: isOwnTranscriptUser(item.user_id, participantId),
		isDeleted: item.is_deleted ?? false
	};
}

function publicChatPayloadToMessage(payload: PublicChatMessagePayload, participantId: string): PublicChatMessage {
	const timestampMs = payload.timestampMs ?? Date.now();
	return {
		id: payload.id,
		sessionName: payload.sessionName,
		userId: payload.userId,
		displayName: payload.displayName ?? undefined,
		message: payload.message,
		time: formatTranscriptTime(timestampMs),
		timestampMs,
		isOwn: isOwnTranscriptUser(payload.userId, participantId),
		isDeleted: payload.isDeleted ?? false
	};
}

async function fetchTranscriptHistory(url: string, signal: AbortSignal): Promise<TranscriptResponse[]> {
	try {
		const response = await fetch(url, { signal });
		if (!response.ok) {
			console.warn("[private-board] failed transcript history response", response.status, url);
			return [];
		}
		return (await response.json()) as TranscriptResponse[];
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			throw error;
		}
		console.warn("[private-board] failed transcript history fetch", url, error);
		return [];
	}
}

async function fetchChatMessageHistory(url: string, signal: AbortSignal): Promise<ChatMessageResponse[]> {
	const response = await fetch(url, { signal });
	if (!response.ok) {
		console.warn("[private-board] failed chat history response", response.status, url);
		return [];
	}
	return (await response.json()) as ChatMessageResponse[];
}

function ideaBlockResponseToBlock(item: IdeaBlockResponse): IdeaBlock {
	const transcriptLineId = item.transcript_id == null ? undefined : String(item.transcript_id);
	const createdAtMs = parseIdeaBlockCreatedAt(item.time_stamp);

	return {
		id: String(item.id),
		summary: item.title || item.summary,
		aiSummary: item.summary,
		transcript: item.transcript ?? undefined,
		transcriptLineId,
		sourceTranscriptIds: transcriptLineId ? [transcriptLineId] : undefined,
		hasCue: !!item.similarity_id,
		similarityIsSameReason: item.similarity_is_same_reason ?? null,
		isDeleted: item.is_deleted ?? false,
		createdAtMs,
		status: "ready"
	};
}

function ideaBlockToSimilarityCue(block: IdeaBlock): SimilarityCueData | null {
	if (!block.hasCue || block.isDeleted) {
		return null;
	}

	const blockSummary = block.cueText || block.aiSummary || block.summary;
	if (!blockSummary.trim()) {
		return null;
	}

	return {
		id: `block-cue-${block.id}`,
		blockId: block.id,
		blockSummary,
		isSameReason: block.similarityIsSameReason ?? undefined
	};
}

function parseIdeaBlockCreatedAt(value: string | null | undefined): number | undefined {
	if (!value) {
		return undefined;
	}

	const timestampMs = Date.parse(value);
	return Number.isNaN(timestampMs) ? undefined : timestampMs;
}

function formatTranscriptTime(value: string | number | null | undefined): string | undefined {
	if (value == null) {
		return undefined;
	}

	const date = new Date(typeof value === "number" ? value : value);
	if (Number.isNaN(date.getTime())) {
		return undefined;
	}

	return new Intl.DateTimeFormat("zh-TW", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false
	}).format(date);
}

function transcriptSourceFromAudioMessage(message: AudioTranscriptMessage): TranscriptLineType["source"] {
	const source = message.local_mic_mode ?? message.mic_mode ?? message.scope;
	if (source === "public" || source === "private") {
		return source;
	}
	if (message.type === "transcript_update") {
		return "private";
	}
	if (message.type === "transcript" && (message.reason === MAX_SPEECH_TRANSCRIPT_REASON || message.reason === LIVE_TRANSCRIPT_REASON)) {
		return "private";
	}
	return undefined;
}

function audioTranscriptMessageToLine(message: AudioTranscriptMessage): TranscriptLineType {
	const segmentId = message.type === "transcript_update" ? message.transcript_segment_id : message.segment_id;
	const userId = message.participant_id ?? message.userId ?? message.user_id;
	const source = transcriptSourceFromAudioMessage(message);
	const timestampMs = typeof message.timestamp_ms === "number" ? message.timestamp_ms : Date.now();
	return {
		id: segmentId == null ? `audio-${Date.now()}` : String(segmentId),
		source,
		origin: "live",
		userId: userId == null ? undefined : String(userId),
		time: formatTranscriptTime(timestampMs),
		timestampMs,
		text: message.text?.trim() ?? ""
	};
}

function shouldAppendAudioTranscriptToTranscriptTab(message: AudioTranscriptMessage, line: TranscriptLineType, participantId: string): boolean {
	if (message.type === "transcript") {
		return (
			line.source === "private" &&
			(message.persisted === false || message.persisted == null) &&
			(message.reason === MAX_SPEECH_TRANSCRIPT_REASON || message.reason === LIVE_TRANSCRIPT_REASON || FINAL_TRANSCRIPT_REASONS.has(String(message.reason ?? "")))
		);
	}
	if (message.type === "transcript_update" && message.persisted !== true) {
		return false;
	}
	if (line.source !== "private") {
		return false;
	}
	return line.userId == null || isOwnTranscriptUser(line.userId, participantId);
}

function mergeTranscriptText(previousText: string, nextText: string): string {
	const previous = previousText.trim();
	const next = nextText.trim();
	if (!previous) {
		return next;
	}
	if (!next) {
		return previous;
	}
	if (previous.endsWith(next)) {
		return previous;
	}
	if (next.startsWith(previous)) {
		return next;
	}
	if (previous.includes(next)) {
		return previous;
	}
	if (next.includes(previous)) {
		return next;
	}
	const maxOverlap = Math.min(previous.length, next.length);
	for (let overlap = maxOverlap; overlap > 1; overlap -= 1) {
		if (previous.slice(-overlap) === next.slice(0, overlap)) {
			return `${previous}${next.slice(overlap)}`;
		}
	}
	return `${previous}${next}`;
}

function audioTranscriptDisplaySignature(message: AudioTranscriptMessage, line: TranscriptLineType): string {
	return [message.type, line.source ?? "", message.reason ?? "", line.text.trim()].join("|");
}

function appendTranscriptLine(lines: TranscriptLineType[], line: TranscriptLineType): TranscriptLineType[] {
	const normalizedText = line.text.trim();
	if (!normalizedText) {
		return lines;
	}

	const normalizedUserId = line.userId == null ? undefined : String(line.userId);
	const existingLine = lines.find(item => {
		if (item.id === line.id) {
			return true;
		}

		const itemUserId = item.userId == null ? undefined : String(item.userId);
		const isSameUser = itemUserId == null || normalizedUserId == null || itemUserId === normalizedUserId;
		return item.text.trim() === normalizedText && item.source === line.source && isSameUser;
	});
	if (!existingLine) {
		return sortTranscriptLines([...lines, { ...line, text: normalizedText }]);
	}
	if (existingLine.text.trim() === normalizedText && existingLine.time === line.time && existingLine.linkedBlockId === line.linkedBlockId) {
		return lines;
	}
	return sortTranscriptLines(
		lines.map(item =>
			item.id === existingLine.id
				? {
						...item,
						...line,
						id: existingLine.origin === "live" && line.origin === "history" ? line.id : existingLine.id,
						origin: item.origin === "history" || line.origin === "history" ? "history" : line.origin,
						text: normalizedText,
						timestampMs: line.timestampMs ?? item.timestampMs,
						linkedBlockId: line.linkedBlockId ?? item.linkedBlockId
					}
				: item
		)
	);
}

function mergeTranscriptLines(baseLines: TranscriptLineType[], nextLines: TranscriptLineType[]): TranscriptLineType[] {
	return nextLines.reduce((lines, line) => appendTranscriptLine(lines, line), baseLines);
}

function replaceTranscriptLine(lines: TranscriptLineType[], draftLineId: string, finalLine: TranscriptLineType): TranscriptLineType[] {
	const withoutDraft = lines.filter(line => line.id !== draftLineId || line.id === finalLine.id);
	return appendTranscriptLine(withoutDraft, finalLine);
}

function canMergeAdjacentPublicTranscriptLines(left: TranscriptLineType, right: TranscriptLineType): boolean {
	return left.source === "public" && right.source === "public" && left.userId != null && right.userId != null && String(left.userId) === String(right.userId);
}

function mergeAdjacentPublicTranscriptLines(lines: TranscriptLineType[]): TranscriptLineType[] {
	return lines.reduce<TranscriptLineType[]>((mergedLines, line) => {
		const previousLine = mergedLines[mergedLines.length - 1];
		if (!previousLine || !canMergeAdjacentPublicTranscriptLines(previousLine, line)) {
			mergedLines.push(line);
			return mergedLines;
		}

		mergedLines[mergedLines.length - 1] = {
			...previousLine,
			displayName: previousLine.displayName ?? line.displayName,
			text: mergeTranscriptText(previousLine.text, line.text),
			timestampMs: previousLine.timestampMs ?? line.timestampMs,
			linkedBlockId: previousLine.linkedBlockId ?? line.linkedBlockId
		};
		return mergedLines;
	}, []);
}

function sortTranscriptLines(lines: TranscriptLineType[]): TranscriptLineType[] {
	const sortedLines = [...lines].sort((left, right) => {
		const leftTime = left.timestampMs ?? Number(left.id);
		const rightTime = right.timestampMs ?? Number(right.id);

		if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
			return leftTime - rightTime;
		}

		return left.id.localeCompare(right.id, undefined, { numeric: true });
	});
	return mergeAdjacentPublicTranscriptLines(sortedLines);
}

function appendPublicChatMessage(messages: PublicChatMessage[], message: PublicChatMessage): PublicChatMessage[] {
	const normalizedMessage = message.message.trim();
	if (!normalizedMessage) {
		return messages;
	}

	const existingMessage = messages.find(item => item.id === message.id);
	if (!existingMessage) {
		return sortPublicChatMessages([...messages, { ...message, message: normalizedMessage }]);
	}

	return sortPublicChatMessages(
		messages.map(item =>
			item.id === existingMessage.id
				? {
						...item,
						...message,
						message: normalizedMessage,
						timestampMs: message.timestampMs ?? item.timestampMs
					}
				: item
		)
	);
}

function mergePublicChatMessages(baseMessages: PublicChatMessage[], nextMessages: PublicChatMessage[]): PublicChatMessage[] {
	return nextMessages.reduce((messages, message) => appendPublicChatMessage(messages, message), baseMessages);
}

function appendUnreadPublicChatMessage(messages: PublicChatMessage[], message: PublicChatMessage): PublicChatMessage[] {
	const normalizedMessage = message.message.trim();
	if (!normalizedMessage || messages.some(item => item.id === message.id)) {
		return messages;
	}

	return sortPublicChatMessages([...messages, { ...message, message: normalizedMessage }]);
}

function sortPublicChatMessages(messages: PublicChatMessage[]): PublicChatMessage[] {
	return [...messages].sort((left, right) => {
		const leftTime = left.timestampMs ?? Number(left.id);
		const rightTime = right.timestampMs ?? Number(right.id);

		if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
			return leftTime - rightTime;
		}

		return left.id.localeCompare(right.id, undefined, { numeric: true });
	});
}

function mergeIdeaBlocks(baseBlocks: IdeaBlock[], nextBlocks: IdeaBlock[], options?: { markNewUnread?: boolean }): IdeaBlock[] {
	return deduplicateIdeaBlocks(
		sortIdeaBlocks(
			nextBlocks.reduce((blocks, nextBlock) => {
				const existingBlock = blocks.find(block => block.id === nextBlock.id);
				if (!existingBlock) {
					return [...blocks, { ...nextBlock, isUnread: options?.markNewUnread ? true : nextBlock.isUnread }];
				}

				return blocks.map(block =>
					block.id === nextBlock.id
						? {
								...block,
								...nextBlock,
								expanded: block.expanded,
								isUnread: block.isUnread || nextBlock.isUnread || (!!nextBlock.hasCue && !block.hasCue && !block.expanded),
								cueText: nextBlock.cueText ?? block.cueText,
								hasCue: block.hasCue || nextBlock.hasCue,
								similarityIsSameReason: nextBlock.similarityIsSameReason ?? block.similarityIsSameReason,
								createdAtMs: block.createdAtMs ?? nextBlock.createdAtMs
							}
						: block
				);
			}, baseBlocks)
		)
	);
}

function deduplicateIdeaBlocks(blocks: IdeaBlock[]): IdeaBlock[] {
	const seenKeys = new Set<string>();
	const deduplicatedBlocks: IdeaBlock[] = [];

	for (const block of blocks) {
		const key = ideaBlockDedupKey(block);
		if (key && seenKeys.has(key)) {
			continue;
		}
		if (key) {
			seenKeys.add(key);
		}
		deduplicatedBlocks.push(block);
	}

	return deduplicatedBlocks;
}

function ideaBlockDedupKey(block: IdeaBlock): string {
	return normalizeIdeaBlockText(block.aiSummary || block.summary);
}

function normalizeIdeaBlockText(value: string): string {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase()
		.replace(/[\s\p{P}]/gu, "");
}

function sortIdeaBlocks(blocks: IdeaBlock[]): IdeaBlock[] {
	return [...blocks].sort((left, right) => {
		if (!!left.isDeleted !== !!right.isDeleted) {
			return left.isDeleted ? -1 : 1;
		}

		const leftTime = left.createdAtMs ?? Number(left.id);
		const rightTime = right.createdAtMs ?? Number(right.id);

		if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
			return leftTime - rightTime;
		}

		return left.id.localeCompare(right.id, undefined, { numeric: true });
	});
}

function linkTranscriptLinesToBlocks(lines: TranscriptLineType[], blocks: IdeaBlock[]): TranscriptLineType[] {
	const transcriptBlockIds = new Map<string, string>();
	const transcriptBlockTexts = new Map<string, string>();

	blocks.forEach(block => {
		const transcriptIds = [block.transcriptLineId, ...(block.sourceTranscriptIds ?? [])].filter((id): id is string => !!id);
		transcriptIds.forEach(transcriptId => {
			if (!transcriptBlockIds.has(transcriptId)) {
				transcriptBlockIds.set(transcriptId, block.id);
			}
		});
		const normalizedTranscript = block.transcript?.trim();
		if (normalizedTranscript && !transcriptBlockTexts.has(normalizedTranscript)) {
			transcriptBlockTexts.set(normalizedTranscript, block.id);
		}
	});

	let didChange = false;
	const linkedLines = lines.map(line => {
		if (line.source !== "private") {
			if (!line.linkedBlockId) {
				return line;
			}

			didChange = true;
			return {
				...line,
				linkedBlockId: undefined
			};
		}

		const linkedBlockId = transcriptBlockIds.get(line.id) ?? transcriptBlockTexts.get(line.text.trim());
		if (!linkedBlockId || line.linkedBlockId === linkedBlockId) {
			return line;
		}

		didChange = true;
		return {
			...line,
			linkedBlockId
		};
	});

	return didChange ? linkedLines : lines;
}

function TranscriptLines({
	lines,
	emptyText,
	onJumpToBlock,
	onTranscriptRef,
	highlightedTranscriptId
}: {
	lines: TranscriptLineType[];
	emptyText: string;
	onJumpToBlock?: (blockId: string) => void;
	onTranscriptRef: (lineId: string, node: HTMLDivElement | null) => void;
	highlightedTranscriptId: string | null;
}) {
	const firstLiveLineIndex = lines.findIndex(line => line.origin === "live");
	const shouldShowLiveDivider = firstLiveLineIndex > 0 && lines.some((line, index) => index < firstLiveLineIndex && line.origin === "history");

	return (
		<div className="grid gap-1">
			{lines.length === 0 && <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-muted-foreground">{emptyText}</div>}
			{lines.map((line, index) => (
				<div
					key={line.id}
					ref={node => {
						onTranscriptRef(line.id, node);
					}}
					className={cn("scroll-mt-3 rounded-md transition-shadow", highlightedTranscriptId === line.id && "ring-2 ring-primary")}
				>
					{shouldShowLiveDivider && index === firstLiveLineIndex && (
						<div className="my-3 flex items-center gap-3 text-xs text-muted-foreground">
							<div className="h-px flex-1 bg-border" />
							<span className="shrink-0">即時逐字稿</span>
							<div className="h-px flex-1 bg-border" />
						</div>
					)}
					<TranscriptLine line={line} onJumpToBlock={onJumpToBlock} />
				</div>
			))}
		</div>
	);
}

export function PrivateBoard({
	sessionId,
	participantId,
	lastMessage,
	lastAudioMessage,
	isConnected,
	onSendBoardMessage,
	displayName,
	currentPhase: controlledPhase,
	timerEndTime: controlledTimerEndTime,
	onCollapse,
	isCollapsed = false,
	onRequestOpen
}: PrivateBoardProps) {
	const [activeTab, setActiveTab] = useState<BoardTab>("ideablock");
	const [currentPhase, setCurrentPhase] = useState<SessionPhase>("private");
	const [cueCondition, setCueCondition] = useState<CueCondition>("experimental");
	const [timerEndTime, setTimerEndTime] = useState<number>(0);
	const visiblePhase = controlledPhase ?? currentPhase;
	const visibleTimerEndTime = controlledTimerEndTime ?? timerEndTime;
	const canShowIdeaBlocks = cueCondition === "experimental";
	const visibleActiveTab = !canShowIdeaBlocks && activeTab === "ideablock" ? "transcript" : activeTab;
	const [ideaBlocks, setIdeaBlocks] = useState<IdeaBlock[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_IDEA_BLOCKS : []);
	const [transcriptLines, setTranscriptLines] = useState<TranscriptLineType[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_TRANSCRIPT_LINES : []);
	const [publicChatMessages, setPublicChatMessages] = useState<PublicChatMessage[]>([]);
	const [unreadPublicChatMessages, setUnreadPublicChatMessages] = useState<PublicChatMessage[]>([]);
	const [isPublicChatNotificationVisible, setIsPublicChatNotificationVisible] = useState(false);
	const [publicChatNotificationMessageId, setPublicChatNotificationMessageId] = useState<string | null>(null);
	const [ideaBlockRefreshKey, setIdeaBlockRefreshKey] = useState(0);
	const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
	const [highlightedTranscriptId, setHighlightedTranscriptId] = useState<string | null>(null);
	const [manualIdeaText, setManualIdeaText] = useState("");
	const [manualIdeaError, setManualIdeaError] = useState<string | null>(null);
	const [manualIdeaPendingCount, setManualIdeaPendingCount] = useState(0);
	const [publicChatText, setPublicChatText] = useState("");
	const [publicChatError, setPublicChatError] = useState<string | null>(null);
	const [isSendingPublicChat, setIsSendingPublicChat] = useState(false);
	const [cues, setCues] = useState<SimilarityCueData[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_SIMILARITY_CUES : []);
	const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
	const transcriptRefs = useRef<Record<string, HTMLDivElement | null>>({});
	const manualIdeaTextareaRef = useRef<HTMLTextAreaElement | null>(null);
	const publicChatTextareaRef = useRef<HTMLTextAreaElement | null>(null);
	const ideaBlocksRef = useRef<IdeaBlock[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_IDEA_BLOCKS : []);
	const scrollViewportRef = useRef<HTMLDivElement | null>(null);
	const activeMaxSpeechTranscriptDraftRef = useRef<{ id: string; text: string; isFinal?: boolean } | null>(null);
	const setTranscriptRef = useCallback((lineId: string, node: HTMLDivElement | null) => {
		transcriptRefs.current[lineId] = node;
	}, []);
	const lastProcessedBoardMessageRef = useRef<object | null>(null);
	const lastProcessedAudioMessageRef = useRef<object | null>(null);
	const lastDisplayedAudioTranscriptRef = useRef<{ signature: string; displayedAt: number } | null>(null);
	const unreadIdeaBlockIdsFromRefreshRef = useRef<Set<string>>(new Set());
	const lastVisibleActiveTabRef = useRef<BoardTab>(visibleActiveTab);
	const shouldAutoScrollRef = useRef<Record<BoardTab, boolean>>({
		transcript: true,
		ideablock: true,
		"public-chat": true
	});
	const isSavingManualIdea = manualIdeaPendingCount > 0;
	const unreadIdeaBlockCount = ideaBlocks.filter(block => block.isUnread && !block.isDeleted).length;
	const publicChatNotificationMessage = publicChatNotificationMessageId ? unreadPublicChatMessages.find(message => message.id === publicChatNotificationMessageId) ?? null : unreadPublicChatMessages[0] ?? null;
	const firstUnreadPublicChatMessage = publicChatNotificationMessage ?? unreadPublicChatMessages[0] ?? null;
	const hasMultipleUnreadPublicChatMessages = unreadPublicChatMessages.length > 1;
	const firstUnreadPublicChatSenderName = firstUnreadPublicChatMessage ? formatParticipantDisplayName(firstUnreadPublicChatMessage.userId, firstUnreadPublicChatMessage.displayName) || "聊天室" : "";

	const clearPublicChatNotification = useCallback(() => {
		setUnreadPublicChatMessages([]);
		setIsPublicChatNotificationVisible(false);
		setPublicChatNotificationMessageId(null);
	}, []);

	const queueSimilarityCueFromBlock = useCallback(
		(block: IdeaBlock) => {
			if (cueCondition !== "experimental") {
				console.info("[private-board] similarity cue fallback skipped", {
					reason: "cue_condition",
					cueCondition,
					blockId: block.id
				});
				return;
			}

			const cue = ideaBlockToSimilarityCue(block);
			if (!cue) {
				console.info("[private-board] similarity cue fallback skipped", {
					reason: "missing_cue_payload",
					blockId: block.id,
					hasCue: block.hasCue,
					isDeleted: block.isDeleted
				});
				return;
			}

			const currentBlock = ideaBlocksRef.current.find(item => item.id === block.id);
			if (!currentBlock?.expanded) {
				unreadIdeaBlockIdsFromRefreshRef.current.add(block.id);
			}

			setCues(prev => {
				const alreadyQueued = prev.some(item => item.id === cue.id || item.blockId === cue.blockId);
				console.info("[private-board] similarity cue fallback detected", {
					blockId: cue.blockId,
					isSameReason: cue.isSameReason,
					alreadyQueued,
					currentBlockExpanded: !!currentBlock?.expanded
				});
				return alreadyQueued ? prev : [...prev, cue];
			});
		},
		[cueCondition]
	);

	const openPublicChatTab = useCallback(() => {
		setActiveTab("public-chat");
		clearPublicChatNotification();
	}, [clearPublicChatNotification]);

	const openPublicChatFromNotification = useCallback(() => {
		onRequestOpen?.();
		openPublicChatTab();
	}, [onRequestOpen, openPublicChatTab]);

	const focusActiveComposer = useCallback(() => {
		if (canShowIdeaBlocks && visibleActiveTab === "ideablock") {
			manualIdeaTextareaRef.current?.focus();
			return true;
		}

		if (visibleActiveTab === "public-chat") {
			publicChatTextareaRef.current?.focus();
			return true;
		}

		return false;
	}, [canShowIdeaBlocks, visibleActiveTab]);

	useEffect(() => {
		const handleComposerShortcutKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.repeat || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || isEditableShortcutTarget(event.target)) {
				return;
			}

			if (event.code === "Digit1") {
				event.preventDefault();
				setActiveTab("transcript");
				return;
			}

			if (event.code === "Digit2" && canShowIdeaBlocks) {
				event.preventDefault();
				setActiveTab("ideablock");
				return;
			}

			if (event.code === "Digit3") {
				event.preventDefault();
				openPublicChatTab();
				return;
			}

			if (event.key === "Enter" && focusActiveComposer()) {
				event.preventDefault();
			}
		};

		window.addEventListener("keydown", handleComposerShortcutKeyDown);
		return () => window.removeEventListener("keydown", handleComposerShortcutKeyDown);
	}, [canShowIdeaBlocks, focusActiveComposer, openPublicChatTab]);

	useEffect(() => {
		if (visibleActiveTab === "public-chat" && !isCollapsed) {
			clearPublicChatNotification();
		}
	}, [clearPublicChatNotification, isCollapsed, visibleActiveTab]);

	useEffect(() => {
		if (!isPublicChatNotificationVisible || unreadPublicChatMessages.length === 0) {
			return;
		}

		const timer = window.setTimeout(() => {
			setIsPublicChatNotificationVisible(false);
		}, PUBLIC_CHAT_NOTIFICATION_AUTO_DISMISS_MS);

		return () => window.clearTimeout(timer);
	}, [isPublicChatNotificationVisible, unreadPublicChatMessages.length]);

	useEffect(() => {
		if (ENABLE_PRIVATE_BOARD_MOCK_DATA) {
			return;
		}

		const controller = new AbortController();

		async function loadTranscripts() {
			try {
				const [publicTranscripts, privateTranscripts] = await Promise.all([
					fetchTranscriptHistory(buildPublicTranscriptUrl(sessionId), controller.signal),
					fetchTranscriptHistory(buildPrivateTranscriptUrl(sessionId, participantId), controller.signal)
				]);
				const allSessionTranscripts = await fetchTranscriptHistory(buildAllSessionTranscriptUrl(sessionId), controller.signal);
				const legacyPublicTranscripts = publicTranscripts.length === 0 ? allSessionTranscripts.filter(item => item.visibility === "private" && !isOwnTranscriptUser(item.user_id, participantId)) : [];
				const visibleSessionTranscripts = allSessionTranscripts.filter(item => item.visibility === "public" || (item.visibility === "private" && isOwnTranscriptUser(item.user_id, participantId)));
				const transcriptLinesById = new Map<string, TranscriptLineType>();
				[...publicTranscripts, ...privateTranscripts, ...visibleSessionTranscripts, ...legacyPublicTranscripts].forEach(item => {
					const line = transcriptResponseToLine(item, participantId, legacyPublicTranscripts.includes(item) ? "public" : undefined);
					transcriptLinesById.set(line.id, line);
				});
				const transcriptLinesFromDb = sortTranscriptLines(Array.from(transcriptLinesById.values()));
				console.info("[private-board] loaded transcript history", {
					sessionId,
					participantId,
					publicCount: publicTranscripts.length,
					sessionCount: allSessionTranscripts.length,
					legacyPublicCount: legacyPublicTranscripts.length,
					privateCount: privateTranscripts.length,
					totalCount: transcriptLinesFromDb.length
				});
				setTranscriptLines(prev => mergeTranscriptLines(transcriptLinesFromDb, prev));
				setTranscriptLines(prev => linkTranscriptLinesToBlocks(prev, ideaBlocksRef.current));
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") {
					return;
				}
				console.warn("[private-board] failed to load transcripts", error);
			}
		}

		void loadTranscripts();

		return () => controller.abort();
	}, [participantId, sessionId]);

	useEffect(() => {
		if (ENABLE_PRIVATE_BOARD_MOCK_DATA) {
			return;
		}

		const controller = new AbortController();

		async function loadPublicChatMessages() {
			try {
				const chatMessagesFromDb = (await fetchChatMessageHistory(buildChatMessagesUrl(sessionId), controller.signal)).map(item => chatMessageResponseToMessage(item, participantId));
				setPublicChatMessages(prev => mergePublicChatMessages(chatMessagesFromDb, prev));
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") {
					return;
				}
				console.warn("[private-board] failed to load public chat messages", error);
			}
		}

		void loadPublicChatMessages();

		return () => controller.abort();
	}, [participantId, sessionId]);

	useEffect(() => {
		if (ENABLE_PRIVATE_BOARD_MOCK_DATA) {
			return;
		}

		const controller = new AbortController();

		async function loadIdeaBlocks() {
			try {
				const response = await fetch(buildIdeaBlocksUrl(sessionId, participantId), { signal: controller.signal });
				if (!response.ok) {
					throw new Error("Failed to load idea blocks");
				}

				const ideaBlockResponses = (await response.json()) as IdeaBlockResponse[];
				console.info("[private-board] loaded idea blocks", {
					sessionId,
					participantId,
					blocks: ideaBlockResponses.map(item => ({
						id: item.id,
						hasSimilarity: !!item.similarity_id,
						similarity_id: item.similarity_id,
						similarity_is_same_reason: item.similarity_is_same_reason
					}))
				});
				const unreadIdsFromRefresh = unreadIdeaBlockIdsFromRefreshRef.current;
				const ideaBlocksFromDb = ideaBlockResponses.map(item => {
					const block = ideaBlockResponseToBlock(item);
					return unreadIdsFromRefresh.has(block.id) ? { ...block, isUnread: true } : block;
				});
				const previousBlocksById = new Map(ideaBlocksRef.current.map(block => [block.id, block]));
				const newlyCuedBlocks = ideaBlocksFromDb.filter(block => {
					const previousBlock = previousBlocksById.get(block.id);
					return !!previousBlock && !!block.hasCue && !previousBlock.hasCue;
				});
				console.info("[private-board] similarity cue refresh check", {
					sessionId,
					participantId,
					newlyCuedBlockIds: newlyCuedBlocks.map(block => block.id),
					cuedBlockIds: ideaBlocksFromDb.filter(block => block.hasCue).map(block => block.id)
				});
				newlyCuedBlocks.forEach(queueSimilarityCueFromBlock);
				setIdeaBlocks(prev => mergeIdeaBlocks(prev, ideaBlocksFromDb));
				ideaBlocksFromDb.forEach(block => unreadIdsFromRefresh.delete(block.id));
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") {
					return;
				}
				console.warn("[private-board] failed to load idea blocks", error);
			}
		}

		void loadIdeaBlocks();

		return () => controller.abort();
	}, [ideaBlockRefreshKey, participantId, queueSimilarityCueFromBlock, sessionId]);

	useEffect(() => {
		ideaBlocksRef.current = ideaBlocks;
		const timer = window.setTimeout(() => {
			setTranscriptLines(prev => linkTranscriptLinesToBlocks(prev, ideaBlocks));
		}, 0);

		return () => window.clearTimeout(timer);
	}, [ideaBlocks]);

	useEffect(() => {
		if (!isBoardMessage(lastMessage)) {
			return;
		}

		if (lastMessage.type === "phase_changed") {
			const timer = window.setTimeout(() => {
				setCurrentPhase(lastMessage.phase);
				setTimerEndTime(lastMessage.end_time_ms || 0);
			}, 0);
			return () => window.clearTimeout(timer);
		}

		if (lastMessage.type === "countdown_changed") {
			const timer = window.setTimeout(() => {
				if (lastMessage.current_phase) setCurrentPhase(lastMessage.current_phase);
				setTimerEndTime(lastMessage.timer_end_time_ms ?? lastMessage.end_time_ms ?? 0);
			}, 0);
			return () => window.clearTimeout(timer);
		}

		if (lastMessage.type === "board_state") {
			const timer = window.setTimeout(() => {
				if (lastMessage.current_phase) setCurrentPhase(lastMessage.current_phase);
				if (typeof lastMessage.timer_end_time_ms === "number") setTimerEndTime(lastMessage.timer_end_time_ms);
				if (lastMessage.cue_condition) setCueCondition(lastMessage.cue_condition);
			}, 0);
			return () => window.clearTimeout(timer);
		}

		if (lastMessage.type === "cue_condition_changed") {
			const timer = window.setTimeout(() => {
				const nextCondition = lastMessage.cue_condition ?? lastMessage.condition;
				if (nextCondition) setCueCondition(nextCondition);
				if (nextCondition === "control") setCues([]);
			}, 0);
			return () => window.clearTimeout(timer);
		}
	}, [lastMessage]);

	useEffect(() => {
		if (!isBoardMessage(lastMessage)) {
			return;
		}
		if (lastProcessedBoardMessageRef.current === lastMessage) {
			return;
		}
		lastProcessedBoardMessageRef.current = lastMessage;

		if (lastMessage.type === "phase_changed" || lastMessage.type === "board_state" || lastMessage.type === "cue_condition_changed") {
			return;
		}

		const timer = window.setTimeout(() => {
			if (lastMessage.type === "public_chat_error") {
				setIsSendingPublicChat(false);
				setPublicChatError(lastMessage.reason || "公開訊息傳送失敗");
				return;
			}

			if (lastMessage.type === "new_idea_block") {
				unreadIdeaBlockIdsFromRefreshRef.current.add(lastMessage.payload.id);
				setIdeaBlocks(prev => mergeIdeaBlocks(prev, [{ ...lastMessage.payload, isUnread: true }], { markNewUnread: true }));
				setIdeaBlockRefreshKey(current => current + 1);
			}

			if (lastMessage.type === "update_idea_block") {
				console.info("[private-board] update_idea_block received; refreshing idea blocks", {
					sessionId,
					participantId,
					ideaBlockId: lastMessage.payload.id
				});
				setIdeaBlockRefreshKey(current => current + 1);
			}

			if (lastMessage.type === "new_transcript_line") {
				setTranscriptLines(prev =>
					linkTranscriptLinesToBlocks(
						appendTranscriptLine(prev, {
							...lastMessage.payload,
							origin: "live",
							isOwn: isOwnTranscriptUser(lastMessage.payload.userId, participantId),
							timestampMs: lastMessage.payload.timestampMs ?? Date.now(),
							time: lastMessage.payload.time ?? formatTranscriptTime(Date.now())
						}),
						ideaBlocksRef.current
					)
				);
			}

			if (lastMessage.type === "similarity_cue") {
				if (cueCondition !== "experimental") {
					return;
				}
				console.info("[private-board] similarity_cue received", {
					sessionId,
					participantId,
					visiblePhase,
					ideaBlockId: lastMessage.payload.blockId,
					isSameReason: lastMessage.payload.isSameReason
				});
				setCues(prev => (prev.some(cue => cue.id === lastMessage.payload.id || cue.blockId === lastMessage.payload.blockId) ? prev : [...prev, lastMessage.payload]));
				const cueTargetBlock = ideaBlocksRef.current.find(block => block.id === lastMessage.payload.blockId);
				if (!cueTargetBlock?.expanded) {
					unreadIdeaBlockIdsFromRefreshRef.current.add(lastMessage.payload.blockId);
				}
				setIdeaBlockRefreshKey(current => current + 1);
				setIdeaBlocks(prev =>
					prev.map(block =>
						block.id === lastMessage.payload.blockId
							? {
									...block,
									hasCue: true,
									cueText: lastMessage.payload.blockSummary,
									similarityIsSameReason: lastMessage.payload.isSameReason,
									isUnread: !block.expanded
								}
							: block
					)
				);
			}

			if (lastMessage.type === "public_chat_message") {
				const chatMessage = publicChatPayloadToMessage(lastMessage.payload, participantId);
				setIsSendingPublicChat(false);
				setPublicChatMessages(prev => appendPublicChatMessage(prev, chatMessage));
				if (isCollapsed || visibleActiveTab !== "public-chat") {
					setUnreadPublicChatMessages(prev => appendUnreadPublicChatMessage(prev, chatMessage));
					setPublicChatNotificationMessageId(current => (isPublicChatNotificationVisible ? current ?? chatMessage.id : chatMessage.id));
					setIsPublicChatNotificationVisible(true);
				}
			}
		}, 0);

		return () => window.clearTimeout(timer);
	}, [cueCondition, isCollapsed, isPublicChatNotificationVisible, lastMessage, participantId, sessionId, visibleActiveTab, visiblePhase]);

	useEffect(() => {
		if (!isAudioTranscriptMessage(lastAudioMessage)) {
			return;
		}
		if (lastProcessedAudioMessageRef.current === lastAudioMessage) {
			return;
		}
		lastProcessedAudioMessageRef.current = lastAudioMessage;

		const timer = window.setTimeout(() => {
			const transcriptLine = audioTranscriptMessageToLine(lastAudioMessage);
			if (shouldAppendAudioTranscriptToTranscriptTab(lastAudioMessage, transcriptLine, participantId)) {
				const isLiveTranscriptDraft =
					lastAudioMessage.type === "transcript" &&
					(lastAudioMessage.reason === MAX_SPEECH_TRANSCRIPT_REASON || lastAudioMessage.reason === LIVE_TRANSCRIPT_REASON) &&
					(lastAudioMessage.persisted === false || lastAudioMessage.persisted == null);
				const isTranscriptFinal =
					lastAudioMessage.type === "transcript" &&
					FINAL_TRANSCRIPT_REASONS.has(String(lastAudioMessage.reason ?? "")) &&
					(lastAudioMessage.persisted === false || lastAudioMessage.persisted == null);
				const isPersistedFinal = lastAudioMessage.type === "transcript_update" && lastAudioMessage.persisted === true;
				let displayLine = transcriptLine;
				let replaceDraftLineId: string | null = null;

				if (isLiveTranscriptDraft) {
					const currentDraft =
						activeMaxSpeechTranscriptDraftRef.current && !activeMaxSpeechTranscriptDraftRef.current.isFinal
							? activeMaxSpeechTranscriptDraftRef.current
							:
						{
							id: `live-batch-${transcriptLine.userId ?? participantId}-${Date.now()}`,
							text: ""
						};
					const mergedText = mergeTranscriptText(currentDraft.text, transcriptLine.text);
					activeMaxSpeechTranscriptDraftRef.current = {
						id: currentDraft.id,
						text: mergedText
					};
					displayLine = {
						...transcriptLine,
						id: currentDraft.id,
						text: mergedText
					};
				} else if (isTranscriptFinal && activeMaxSpeechTranscriptDraftRef.current) {
					replaceDraftLineId = activeMaxSpeechTranscriptDraftRef.current.id;
					activeMaxSpeechTranscriptDraftRef.current = {
						id: replaceDraftLineId,
						text: transcriptLine.text,
						isFinal: true
					};
					displayLine = {
						...transcriptLine,
						id: replaceDraftLineId,
						text: transcriptLine.text
					};
				} else if (isPersistedFinal && activeMaxSpeechTranscriptDraftRef.current) {
					replaceDraftLineId = activeMaxSpeechTranscriptDraftRef.current.id;
					displayLine = {
						...transcriptLine,
						text: transcriptLine.text
					};
					activeMaxSpeechTranscriptDraftRef.current = null;
				}

				const signature = audioTranscriptDisplaySignature(lastAudioMessage, displayLine);
				const displayed = lastDisplayedAudioTranscriptRef.current;
				const now = Date.now();
				if (displayed && displayed.signature === signature && now - displayed.displayedAt < 2000) {
					return;
				}
				lastDisplayedAudioTranscriptRef.current = { signature, displayedAt: now };
				setTranscriptLines(prev =>
					{
						const nextLine = {
							...displayLine,
							displayName: displayLine.displayName ?? displayName,
							isOwn: displayLine.userId == null ? true : isOwnTranscriptUser(displayLine.userId, participantId)
						};
						return linkTranscriptLinesToBlocks(
							replaceDraftLineId ? replaceTranscriptLine(prev, replaceDraftLineId, nextLine) : appendTranscriptLine(prev, nextLine),
							ideaBlocks
						);
					}
				);
			}
		}, 0);

		return () => window.clearTimeout(timer);
	}, [displayName, ideaBlocks, lastAudioMessage, participantId]);

	useEffect(() => {
		if (!isAudioIdeaBlocksUpdateMessage(lastAudioMessage)) {
			return;
		}

		const timer = window.setTimeout(() => {
			if (Array.isArray(lastAudioMessage.idea_blocks) && lastAudioMessage.idea_blocks.length > 0) {
				const previousBlocksById = new Map(ideaBlocksRef.current.map(block => [block.id, block]));
				const existingBlockIds = new Set(previousBlocksById.keys());
				const updatedBlocks = lastAudioMessage.idea_blocks.map(item => {
					const block = ideaBlockResponseToBlock(item);
					return existingBlockIds.has(block.id) ? block : { ...block, isUnread: true };
				});
				updatedBlocks
					.filter(block => {
						const previousBlock = previousBlocksById.get(block.id);
						return !!previousBlock && !!block.hasCue && !previousBlock.hasCue;
					})
					.forEach(queueSimilarityCueFromBlock);
				console.info("[private-board] similarity cue audio update check", {
					updatedBlockIds: updatedBlocks.map(block => block.id),
					cuedBlockIds: updatedBlocks.filter(block => block.hasCue).map(block => block.id)
				});
				let mergedBlocksSnapshot: IdeaBlock[] = [];
				setIdeaBlocks(prev => {
					mergedBlocksSnapshot = mergeIdeaBlocks(prev, updatedBlocks, { markNewUnread: true });
					ideaBlocksRef.current = mergedBlocksSnapshot;
					return mergedBlocksSnapshot;
				});
				window.setTimeout(() => {
					setTranscriptLines(lines => linkTranscriptLinesToBlocks(lines, mergedBlocksSnapshot.length > 0 ? mergedBlocksSnapshot : updatedBlocks));
				}, 0);
			}

			setIdeaBlockRefreshKey(current => current + 1);
		}, 0);

		return () => window.clearTimeout(timer);
	}, [lastAudioMessage, queueSimilarityCueFromBlock]);

	useEffect(() => {
		if (!highlightedBlockId) {
			return;
		}

		blockRefs.current[highlightedBlockId]?.scrollIntoView({
			behavior: "smooth",
			block: "center"
		});

		const timer = window.setTimeout(() => setHighlightedBlockId(null), 1500);
		return () => window.clearTimeout(timer);
	}, [highlightedBlockId]);

	useEffect(() => {
		if (!highlightedTranscriptId) {
			return;
		}

		transcriptRefs.current[highlightedTranscriptId]?.scrollIntoView({
			behavior: "smooth",
			block: "center"
		});

		const timer = window.setTimeout(() => setHighlightedTranscriptId(null), 1500);
		return () => window.clearTimeout(timer);
	}, [highlightedTranscriptId, visibleActiveTab]);

	const jumpToBlock = (blockId: string) => {
		if (!canShowIdeaBlocks) {
			return;
		}
		onRequestOpen?.();
		setActiveTab("ideablock");
		setHighlightedBlockId(blockId);
	};

	const jumpToTranscript = (block: IdeaBlock) => {
		const transcriptId = block.transcriptLineId ?? block.sourceTranscriptIds?.[0];
		if (!transcriptId) {
			return;
		}

		setActiveTab("transcript");
		window.setTimeout(() => setHighlightedTranscriptId(transcriptId), 0);
	};

	const canJumpToTranscript = (block: IdeaBlock) => {
		const transcriptIds = [block.transcriptLineId, ...(block.sourceTranscriptIds ?? [])].filter((id): id is string => !!id);
		return transcriptIds.length > 0;
	};

	const handleBoardScroll = (event: UIEvent<HTMLDivElement>) => {
		shouldAutoScrollRef.current[visibleActiveTab] = isNearScrollBottom(event.currentTarget);
	};

	useLayoutEffect(() => {
		const viewport = scrollViewportRef.current;
		const didEnterTranscript = lastVisibleActiveTabRef.current !== "transcript" && visibleActiveTab === "transcript";
		lastVisibleActiveTabRef.current = visibleActiveTab;

		if (didEnterTranscript) {
			shouldAutoScrollRef.current.transcript = true;
			if (viewport) {
				viewport.scrollTop = viewport.scrollHeight;
			}
			return;
		}

		if (!viewport || !shouldAutoScrollRef.current[visibleActiveTab]) {
			return;
		}

		viewport.scrollTop = viewport.scrollHeight;
	}, [visibleActiveTab, ideaBlocks, publicChatMessages, transcriptLines]);

	const toggleBlock = (id: string) => {
		setIdeaBlocks(prev => prev.map(block => (block.id === id && !block.isDeleted ? { ...block, expanded: !block.expanded, isUnread: false } : block)));
	};

	const saveIdeaBlock = async (id: string, values: { summary: string; aiSummary: string; transcript: string; updateTitle?: boolean }) => {
		const normalizedContent = values.aiSummary.trim();
		const currentBlock = ideaBlocks.find(block => block.id === id);
		if (currentBlock?.isDeleted) {
			throw new Error("Deleted idea blocks cannot be edited");
		}

		const isDraft = currentBlock ? !!currentBlock.isDraft : id.startsWith("draft-");
		const derivedTitle = isDraft
			? normalizedContent.slice(0, 10) || values.summary.trim() || "Idea"
			: values.updateTitle
				? values.summary.trim() || currentBlock?.summary || "Idea"
				: currentBlock?.summary || values.summary.trim() || "Idea";

		if (ENABLE_PRIVATE_BOARD_MOCK_DATA) {
			setIdeaBlocks(prev =>
				sortIdeaBlocks(
					prev.map(block =>
						block.id === id
							? {
									...block,
									summary: block.isDraft || values.updateTitle ? derivedTitle : block.summary,
									aiSummary: normalizedContent,
									transcript: values.transcript,
									isDraft: false
								}
							: block
					)
				)
			);
			return;
		}

		const response = await fetch(isDraft ? buildIdeaBlocksUrl(sessionId, participantId) : buildIdeaBlockDetailUrl(sessionId, participantId, id), {
			method: isDraft ? "POST" : "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(
				isDraft
					? {
							title: derivedTitle,
							summary: normalizedContent
						}
					: values.updateTitle
						? {
								title: derivedTitle
							}
						: {
								summary: normalizedContent,
								transcript: values.transcript
							}
			)
		});

		if (!response.ok) {
			throw new Error(await getResponseErrorMessage(response, "Failed to save idea block"));
		}

		const savedBlock = ideaBlockResponseToBlock((await response.json()) as IdeaBlockResponse);
		setIdeaBlocks(prev => {
			const nextBlocks = prev.map(block =>
				block.id === id
					? {
							...block,
							...savedBlock,
							expanded: block.expanded,
							cueText: block.cueText,
							hasCue: block.hasCue || savedBlock.hasCue,
							similarityIsSameReason: savedBlock.similarityIsSameReason ?? block.similarityIsSameReason,
							isDraft: false,
							createdAtMs: block.createdAtMs ?? savedBlock.createdAtMs
						}
					: block
			);
			return sortIdeaBlocks(nextBlocks);
		});
		setIdeaBlockRefreshKey(current => current + 1);
	};

	const deleteIdeaBlock = async (id: string) => {
		const currentBlock = ideaBlocks.find(block => block.id === id);

		if (currentBlock?.isDraft) {
			setIdeaBlocks(prev => prev.filter(block => block.id !== id));
			return;
		}

		if (ENABLE_PRIVATE_BOARD_MOCK_DATA) {
			setIdeaBlocks(prev => sortIdeaBlocks(prev.map(block => (block.id === id ? { ...block, expanded: false, isDeleted: true } : block))));
			return;
		}

		const response = await fetch(buildIdeaBlockDetailUrl(sessionId, participantId, id), {
			method: "DELETE"
		});

		if (!response.ok) {
			throw new Error("Failed to delete idea block");
		}

		setIdeaBlocks(prev => sortIdeaBlocks(prev.map(block => (block.id === id ? { ...block, expanded: false, isDeleted: true } : block))));
	};

	const addManualIdeaBlock = async () => {
		const normalizedContent = manualIdeaText.trim();
		if (!normalizedContent) {
			return;
		}

		setManualIdeaText("");
		setManualIdeaPendingCount(current => current + 1);
		setManualIdeaError(null);
		window.requestAnimationFrame(() => manualIdeaTextareaRef.current?.focus());
		try {
			if (ENABLE_PRIVATE_BOARD_MOCK_DATA) {
				const derivedTitle = normalizedContent.slice(0, 10) || "Idea";
				const newBlock: IdeaBlock = {
					...createDraftIdeaBlock(),
					id: `manual-${Date.now()}`,
					summary: derivedTitle,
					aiSummary: normalizedContent,
					transcript: "",
					expanded: false,
					isDraft: false
				};
				setIdeaBlocks(prev => sortIdeaBlocks([...prev, newBlock]));
				setHighlightedBlockId(newBlock.id);
				return;
			}

			const response = await fetch(buildIdeaBlocksUrl(sessionId, participantId), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					content: normalizedContent
				})
			});

			if (!response.ok) {
				throw new Error(await getResponseErrorMessage(response, "Failed to save idea block"));
			}

			const savedBlock = ideaBlockResponseToBlock((await response.json()) as IdeaBlockResponse);
			setIdeaBlocks(prev => mergeIdeaBlocks(prev, [{ ...savedBlock, isUnread: true }], { markNewUnread: true }));
			setIdeaBlockRefreshKey(current => current + 1);
		} catch (error) {
			setManualIdeaError(error instanceof Error ? error.message : "Failed to save idea block");
		} finally {
			setManualIdeaPendingCount(current => Math.max(0, current - 1));
		}
	};

	const sendPublicChatMessage = () => {
		const normalizedMessage = publicChatText.trim();
		if (!normalizedMessage) {
			return;
		}

		setIsSendingPublicChat(true);
		setPublicChatError(null);
		onSendBoardMessage({
			type: "public_chat_send",
			message: normalizedMessage,
			displayName
		});
		setPublicChatText("");
		window.setTimeout(() => {
			setIsSendingPublicChat(false);
		}, 5000);
	};

	const hasVisibleSimilarityCues = canShowIdeaBlocks && visiblePhase === "group" && cues.length > 0;
	const renderPublicChatNotification = (isStackedAboveCue: boolean) =>
		firstUnreadPublicChatMessage && isPublicChatNotificationVisible ? (
			<button
				type="button"
				className={cn(
					"grid gap-0.5 rounded-lg border bg-card px-3 py-1.5 text-left text-card-foreground shadow-lg ring-1 ring-black/5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
					isStackedAboveCue ? "w-full" : "fixed bottom-20 right-4 z-[60] w-[min(360px,calc(100vw-2rem))]"
				)}
				aria-label="開啟聊天室新留言"
				onClick={openPublicChatFromNotification}
			>
				<div>
					<span className="text-xs font-semibold leading-4 text-muted-foreground">聊天室有新留言</span>
				</div>
				<div className="truncate text-sm font-medium leading-5">{firstUnreadPublicChatSenderName}</div>
				<div className="line-clamp-1 text-xs leading-4 text-muted-foreground">{firstUnreadPublicChatMessage.message}</div>
				{hasMultipleUnreadPublicChatMessages && <div className="justify-self-end text-xs font-medium leading-4 text-muted-foreground">多則留言</div>}
			</button>
		) : null;
	const standalonePublicChatNotification = hasVisibleSimilarityCues ? null : renderPublicChatNotification(false);
	const similarityCueNotification =
		canShowIdeaBlocks && visiblePhase === "group" ? (
			<SimilarityCue cues={cues} onJump={jumpToBlock} onDismiss={cueId => setCues(prev => prev.filter(cue => cue.id !== cueId))} topContent={renderPublicChatNotification(true)} />
		) : null;

	return (
		<>
			<section className="flex h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-lg border bg-card text-card-foreground">
				<header className="flex items-center justify-between gap-3 border-b p-3">
					<div className="flex items-center gap-2">
						{onCollapse && (
							<Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label="收合 Private Board" title="收合 Private Board" onClick={onCollapse}>
								<ChevronRight className="h-4 w-4" />
							</Button>
						)}
						<div className="flex rounded-lg bg-muted p-1">
							<Button
								aria-pressed={visibleActiveTab === "transcript"}
								className={cn(
									"transition-all active:translate-y-px active:scale-[0.98]",
									visibleActiveTab === "transcript" && "translate-y-px bg-primary text-primary-foreground shadow-inner ring-2 ring-primary/20 hover:bg-primary/90"
								)}
								variant={visibleActiveTab === "transcript" ? "default" : "ghost"}
								onClick={() => setActiveTab("transcript")}
							>
								逐字稿
							</Button>
							{canShowIdeaBlocks && (
								<Button
									aria-pressed={activeTab === "ideablock"}
									className={cn(
										"transition-all active:translate-y-px active:scale-[0.98]",
										activeTab === "ideablock" && "translate-y-px bg-primary text-primary-foreground shadow-inner ring-2 ring-primary/20 hover:bg-primary/90"
									)}
									variant={activeTab === "ideablock" ? "default" : "ghost"}
									onClick={() => setActiveTab("ideablock")}
								>
									Idea Blocks
									{unreadIdeaBlockCount > 0 && (
										<span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold leading-none text-destructive-foreground">
											{unreadIdeaBlockCount > 99 ? "99+" : unreadIdeaBlockCount}
										</span>
									)}
								</Button>
							)}
							<Button
								aria-pressed={visibleActiveTab === "public-chat"}
								className={cn(
									"transition-all active:translate-y-px active:scale-[0.98]",
									visibleActiveTab === "public-chat" && "translate-y-px bg-primary text-primary-foreground shadow-inner ring-2 ring-primary/20 hover:bg-primary/90"
								)}
								variant={visibleActiveTab === "public-chat" ? "default" : "ghost"}
								onClick={openPublicChatTab}
							>
								聊天室
							</Button>
						</div>
					</div>
					<div className="flex items-center gap-3">
						<PhaseBadge phase={visiblePhase} />
						{visibleTimerEndTime > 0 && <PhaseTimer endTimeMs={visibleTimerEndTime} />}
						<span className={`hidden h-2 w-2 rounded-full ${isConnected ? "bg-primary" : "bg-muted-foreground"}`} />
					</div>
				</header>

				<ScrollArea className="min-h-0 flex-1 p-3" viewportRef={scrollViewportRef} viewportProps={{ onScroll: handleBoardScroll }}>
					{canShowIdeaBlocks && visibleActiveTab === "ideablock" && (
						<div className="grid gap-2 pb-3">
							{ideaBlocks.length === 0 && <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-muted-foreground">尚無想法</div>}
							{ideaBlocks.map(block => (
								<div
									key={block.id}
									ref={node => {
										blockRefs.current[block.id] = node;
									}}
								>
									<IdeaBlockItem
										block={block}
										isHighlighted={highlightedBlockId === block.id}
										onToggle={toggleBlock}
										onSave={saveIdeaBlock}
										onDelete={deleteIdeaBlock}
										onJumpToTranscript={jumpToTranscript}
										canJumpToTranscript={canJumpToTranscript(block)}
										currentPhase={visiblePhase}
									/>
								</div>
							))}
						</div>
					)}
					{visibleActiveTab === "transcript" && (
						<TranscriptLines
							lines={transcriptLines}
							emptyText="尚無逐字稿"
							onJumpToBlock={canShowIdeaBlocks ? jumpToBlock : undefined}
							onTranscriptRef={setTranscriptRef}
							highlightedTranscriptId={highlightedTranscriptId}
						/>
					)}
					{visibleActiveTab === "public-chat" && <PublicChatMessages messages={publicChatMessages} />}
				</ScrollArea>

				{canShowIdeaBlocks && visibleActiveTab === "ideablock" && (
					<footer className="border-t bg-card p-3">
						<div className="grid gap-2">
							<div className="flex items-end gap-2">
								<div className="relative flex-1">
									<textarea
										ref={manualIdeaTextareaRef}
										aria-label="Manual idea block input"
										className="block h-11 w-full resize-none overflow-hidden rounded-md border bg-background px-3 py-2.5 pr-24 text-sm leading-6 outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
										placeholder="手動輸入 idea block"
										value={manualIdeaText}
										onChange={event => {
											setManualIdeaText(event.target.value);
											setManualIdeaError(null);
										}}
										onKeyDown={event => {
											if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
												event.preventDefault();
												if (!manualIdeaText.trim()) {
													event.currentTarget.blur();
													return;
												}
												void addManualIdeaBlock();
											}
										}}
									/>
									{!manualIdeaText.trim() && <span className="pointer-events-none absolute bottom-2 right-3 text-xs text-muted-foreground">shift + enter 換行</span>}
								</div>
								<Button className="h-11 shrink-0 px-4" onClick={() => void addManualIdeaBlock()} disabled={!manualIdeaText.trim()}>
									{isSavingManualIdea ? "儲存中" : "新增"}
								</Button>
							</div>
							{manualIdeaError && <p className="text-xs text-destructive">{manualIdeaError}</p>}
						</div>
					</footer>
				)}
				{visibleActiveTab === "public-chat" && (
					<footer className="border-t bg-card p-3">
						<div className="grid gap-2">
							<PublicChatComposer
								ref={publicChatTextareaRef}
								messageText={publicChatText}
								error={publicChatError}
								isConnected={isConnected}
								isSending={isSendingPublicChat}
								onMessageTextChange={value => {
									setPublicChatText(value);
									setPublicChatError(null);
								}}
								onSend={sendPublicChatMessage}
							/>
						</div>
					</footer>
				)}
			</section>

			{typeof document !== "undefined" && similarityCueNotification ? createPortal(similarityCueNotification, document.body) : null}
			{typeof document !== "undefined" && standalonePublicChatNotification ? createPortal(standalonePublicChatNotification, document.body) : null}
		</>
	);
}

function PhaseBadge({ phase }: { phase: SessionPhase }) {
	const label = phase === "group" ? "Group Phase" : "Private Phase";
	return (
		<div
			className={cn(
				"rounded-md border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
				phase === "group" ? "border-primary/25 bg-primary/10 text-primary" : "border-muted-foreground/20 bg-muted text-muted-foreground"
			)}
		>
			{label}
		</div>
	);
}

function PhaseTimer({ endTimeMs }: { endTimeMs: number }) {
	const [timeLeft, setTimeLeft] = useState(() => Math.max(0, Math.floor((endTimeMs - Date.now()) / 1000)));

	useEffect(() => {
		const updateTimer = () => {
			setTimeLeft(Math.max(0, Math.floor((endTimeMs - Date.now()) / 1000)));
		};
		updateTimer();
		const interval = setInterval(updateTimer, 1000);
		return () => clearInterval(interval);
	}, [endTimeMs]);

	const m = Math.floor(timeLeft / 60);
	const s = timeLeft % 60;
	return (
		<div className="rounded-md bg-secondary px-2.5 py-1 text-sm font-medium text-secondary-foreground shadow-sm">
			{m}:{s.toString().padStart(2, "0")}
		</div>
	);
}
