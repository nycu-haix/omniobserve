import { ChevronRight, X } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, UIEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DEFAULT_SESSION_PHASE, getSessionPhaseLabel, isGroupPhase, normalizeSessionPhase, type SessionPhase } from "../../lib/sessionPhase";
import { cn } from "../../lib/utils";
import { ENABLE_PRIVATE_BOARD_MOCK_DATA, MOCK_IDEA_BLOCKS, MOCK_SIMILARITY_CUES, MOCK_TRANSCRIPT_LINES } from "../../mock/privateBoard";
import { apiUrl } from "../../services/api";
import type { BoardTab, IdeaBlock, MicMode, PublicChatMessage, SimilarityCueData, SimilarityPairCueData, SimilarityReasonSharedData, TranscriptLine as TranscriptLineType } from "../../types";
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
	| { type: "similarity_cue"; payload: SimilarityPairCueData }
	| { type: "public_context_matches"; payload: PublicContextMatchesPayload }
	| { type: "similarity_reason_shared"; payload: SimilarityReasonSharedData }
	| { type: "public_chat_message"; payload: PublicChatMessagePayload }
	| { type: "public_chat_error"; reason?: string }
	| { type: "phase_changed"; phase: unknown; end_time_ms: number; duration_s: number }
	| { type: "countdown_changed"; current_phase?: unknown; timer_end_time_ms?: number; end_time_ms?: number; duration_s: number }
	| { type: "board_state"; current_phase?: unknown; timer_end_time_ms?: number; cue_condition?: CueCondition }
	| { type: "cue_condition_changed"; cue_condition?: CueCondition; condition?: CueCondition };

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
	similarity_has_same_reason?: boolean | null;
	similarity_has_different_reason?: boolean | null;
	is_deleted?: boolean;
	time_stamp?: string | null;
	is_duplicate?: boolean;
	duplicate_of_id?: number | null;
	duplicate_reason?: string | null;
	duplicate_similarity?: number | null;
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

interface PublicContextMatchPayload {
	ideaBlockId?: string | number | null;
	userId?: string | number | null;
	score?: number | null;
	reason?: string | null;
	taskItemIds?: number[];
}

interface PublicContextMatchesPayload {
	transcriptId?: string | number | null;
	participantId?: string | number | null;
	textChars?: number;
	matches?: PublicContextMatchPayload[];
}

interface IdeaBlockNotice {
	id: string;
	blockId: string;
	title: string;
	message: string;
}

interface AudioIdeaBlocksUpdateMessage {
	type: "idea_blocks_update";
	idea_blocks?: IdeaBlockResponse[];
	duplicate_idea_blocks?: IdeaBlockResponse[];
}

interface AudioTranscriptBoundaryMessage {
	type: "transcript_boundary";
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
	client_segment_id?: string | number | null;
	replace_segment_id?: string | number | null;
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
			replaceDraft?: boolean | null;
			client_segment_id?: string | number | null;
			replace_segment_id?: string | number | null;
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
			replaceDraft?: boolean | null;
			client_segment_id?: string | number | null;
			replace_segment_id?: string | number | null;
	  };

type AudioDraftTargetMessage = AudioTranscriptMessage | AudioTranscriptBoundaryMessage;

const AUTO_SCROLL_BOTTOM_THRESHOLD = 48;
const AUDIO_FINAL_DUPLICATE_WINDOW_MS = 5000;
const MAX_SPEECH_TRANSCRIPT_REASON = "max_speech_ms";
const LIVE_TRANSCRIPT_REASON = "sliding_window";
const FINAL_TRANSCRIPT_REASONS = new Set(["silence", "client_stop", "mic_mode_switch", "disconnect", "error"]);
const MIN_IDEA_BLOCKS_SPLIT_RATIO = 24;
const PUBLIC_CONTEXT_RELEVANCE_MS = 30_000;
const PHASE_TRANSITION_CUE_BATCH_MS = 2000;

interface PhaseTransitionCueBatch {
	cues: SimilarityPairCueData[];
	timeoutId: number | null;
}

function isNearScrollBottom(element: HTMLElement): boolean {
	return element.scrollHeight - element.scrollTop - element.clientHeight <= AUTO_SCROLL_BOTTOM_THRESHOLD;
}

function clampIdeaBlocksSplitRatio(ratio: number): number {
	return Math.min(Math.max(ratio, MIN_IDEA_BLOCKS_SPLIT_RATIO), 100 - MIN_IDEA_BLOCKS_SPLIT_RATIO);
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
		message.type === "public_context_matches" ||
		message.type === "similarity_reason_shared" ||
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

function isAudioTranscriptBoundaryMessage(message: object | null): message is AudioTranscriptBoundaryMessage {
	return !!message && "type" in message && message.type === "transcript_boundary";
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

const createGeneratingIdeaBlock = (content: string): IdeaBlock => ({
	id: `manual-generating-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	summary: "正在生成...",
	aiSummary: content,
	transcript: "",
	expanded: false,
	createdAtMs: Date.now(),
	status: "generating"
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
	const hasSameReason = item.similarity_has_same_reason ?? item.similarity_is_same_reason === true;
	const hasDifferentReason = item.similarity_has_different_reason ?? item.similarity_is_same_reason === false;

	return {
		id: String(item.id),
		summary: item.title || item.summary,
		aiSummary: item.summary,
		transcript: item.transcript ?? undefined,
		transcriptLineId,
		sourceTranscriptIds: transcriptLineId ? [transcriptLineId] : undefined,
		hasCue: hasSameReason || hasDifferentReason || !!item.similarity_id,
		similarityIsSameReason: item.similarity_is_same_reason ?? null,
		similarityHasSameReason: hasSameReason,
		similarityHasDifferentReason: hasDifferentReason,
		isDeleted: item.is_deleted ?? false,
		createdAtMs,
		status: "ready"
	};
}

function ideaBlockToSimilarityCue(block: IdeaBlock): SimilarityPairCueData | null {
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
		isSameReason:
			block.similarityHasDifferentReason && !block.similarityHasSameReason
				? false
				: block.similarityHasSameReason && !block.similarityHasDifferentReason
					? true
					: (block.similarityIsSameReason ?? undefined)
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

function transcriptSourceFromAudioMessage(message: AudioDraftTargetMessage): TranscriptLineType["source"] {
	if (message.type === "transcript_update") {
		const persistedSource = message.scope ?? message.mic_mode ?? message.local_mic_mode;
		if (persistedSource === "public" || persistedSource === "private") {
			return persistedSource;
		}
		return "private";
	}

	const source = message.local_mic_mode ?? message.mic_mode ?? message.scope;
	if (source === "public" || source === "private") {
		return source;
	}
	if (message.type === "transcript" && (message.reason === MAX_SPEECH_TRANSCRIPT_REASON || message.reason === LIVE_TRANSCRIPT_REASON)) {
		return "private";
	}
	return undefined;
}

function stripWhisperArtifacts(text: string): string {
	const cjkPattern = /[\u3400-\u9fff]/;
	const artifactPattern = /\b(?:audio|drop|out|sound|silence|noise|else|elsewhat\w*|going|so)\b/gi;
	const promptLeakPattern = /(?:請以|请以)?(?:繁體|繁体)?(?:用)?中文(?:逐字稿|逐字轉錄|转录|輸出|输出|字幕|中文字幕|輸請用中文字幕)?|只保留明確英文專有名詞|明確英文專有名詞|英文專有名詞/g;
	const labelPattern =
		/^(?:聽不清|听不清|不清楚|無法辨識|无法辨识|噪音|雜音|杂音|音樂|音乐|笑聲|笑声|掌聲|掌声|台語|臺語|台语|閩南語|闽南语|客語|客家話|粵語|粤语|廣東話|广东话|英文|英語|中文|普通話|國語|国语|日語|韓語)$/;
	let cleaned = text
		.replace(/<\|[^>]*\|>/g, "")
		.replace(/<\|\d+(?:\.\d*)?(?:\|>)?/g, "")
		.replace(/<\|[^\s>]*/g, "")
		.replace(/[<>]/g, "")
		.replace(promptLeakPattern, "")
		.replace(/[[(【（]([^\])】）]{0,80})[\])】）]/g, (_match, content: string) => {
			const trimmed = content.trim();
			if (!trimmed || labelPattern.test(trimmed) || !cjkPattern.test(trimmed)) {
				return "";
			}
			return trimmed
				.replace(artifactPattern, "")
				.replace(/\b(?:no)\b/gi, "")
				.replace(/^[\s,，.。:：;；、!?！？'"`~\-–—…]+|[\s,，:：;；、'"`~\-–—…]+$/g, "")
				.trim();
		})
		.replace(/\s+/g, " ")
		.trim();

	if (cjkPattern.test(cleaned)) {
		const fragments = cleaned.match(/[^。！？!?]+[。！？!?]?/g) ?? [];
		const keptFragments = fragments.filter(fragment => {
			const trimmed = fragment.trim();
			if (!trimmed) return false;
			const hasCjk = cjkPattern.test(trimmed);
			const hasAscii = /[A-Za-z]/.test(trimmed);
			const isArtifactEnglish = artifactPattern.test(trimmed);
			artifactPattern.lastIndex = 0;
			return hasCjk || !hasAscii || !isArtifactEnglish;
		});
		if (keptFragments.length > 0) {
			cleaned = keptFragments.join("");
		}
	}

	return cleaned
		.replace(/\s*([。！？!?])\s*/g, "$1")
		.replace(/\s*([,，、:：;；])\s*/g, "$1")
		.replace(/([,，、:：;；])([。！？!?])/g, "$2")
		.replace(/([。！？!?]){2,}/g, "$1")
		.replace(/([,，、:：;；]){2,}/g, "$1")
		.replace(/^[\s,，.。:：;；、!?！？'"`~\-–—…]+|[\s,，:：;；、'"`~\-–—…]+$/g, "")
		.trim();
}

function audioTranscriptMessageToLine(message: AudioDraftTargetMessage): TranscriptLineType {
	const segmentId = message.type === "transcript_update" ? message.transcript_segment_id : message.segment_id;
	const userId = message.participant_id ?? message.userId ?? message.user_id;
	const source = transcriptSourceFromAudioMessage(message);
	const timestampMs = typeof message.timestamp_ms === "number" ? message.timestamp_ms : Date.now();
	return {
		id: segmentId == null ? `audio-${Date.now()}` : String(segmentId),
		source,
		origin: message.type === "transcript_update" && message.persisted === true ? "history" : "live",
		userId: userId == null ? undefined : String(userId),
		time: message.type === "transcript_update" && message.persisted === true ? formatTranscriptTime(timestampMs) : undefined,
		timestampMs,
		text: stripWhisperArtifacts(message.text ?? "").trim()
	};
}

function shouldAppendAudioTranscriptToTranscriptTab(message: AudioTranscriptMessage, line: TranscriptLineType, participantId: string): boolean {
	if (message.type === "transcript") {
		return (
			(line.source === "private" || line.source === "public") &&
			(message.persisted === false || message.persisted == null) &&
			(message.reason === MAX_SPEECH_TRANSCRIPT_REASON || message.reason === LIVE_TRANSCRIPT_REASON)
		);
	}
	if (message.type === "transcript_update" && message.persisted !== true) {
		return false;
	}
	if (line.source !== "private" && line.source !== "public") {
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

function audioTranscriptDisplaySignature(message: AudioDraftTargetMessage, line: TranscriptLineType): string {
	return [message.type, line.source ?? "", message.reason ?? "", line.text.trim()].join("|");
}

function appendTranscriptLine(lines: TranscriptLineType[], line: TranscriptLineType): TranscriptLineType[] {
	const normalizedText = line.text.trim();
	if (!normalizedText) {
		return lines;
	}

	const existingLine = lines.find(item => item.id === line.id);
	if (!existingLine) {
		if (!line.isDraft && (line.source === "public" || line.source === "private")) {
			const lineTimestampMs = line.timestampMs ?? Date.now();
			const duplicateFinalLine = lines.find(item => {
				if (item.isDraft || item.source !== line.source || item.userId !== line.userId || item.text.trim() !== normalizedText) {
					return false;
				}
				const itemTimestampMs = item.timestampMs ?? lineTimestampMs;
				return Math.abs(lineTimestampMs - itemTimestampMs) <= AUDIO_FINAL_DUPLICATE_WINDOW_MS;
			});
			if (duplicateFinalLine) {
				return lines;
			}
		}
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

function audioTranscriptDraftSegmentId(message: AudioDraftTargetMessage): string | undefined {
	const segmentId = message.replace_segment_id ?? message.client_segment_id ?? (message.type === "transcript_update" ? message.transcript_segment_id : message.segment_id);
	return segmentId == null ? undefined : String(segmentId);
}

function transcriptDraftTargetKey(message: AudioDraftTargetMessage, line: TranscriptLineType, participantId: string): string {
	return [line.source ?? "unknown", line.userId ?? participantId, audioTranscriptDraftSegmentId(message) ?? "active"].join("|");
}

function isUnpersistedTranscriptDraftId(id: string): boolean {
	return id.startsWith("live-batch-") || id.startsWith("wlk-live-") || id.startsWith("audio-");
}

function sortTranscriptLines(lines: TranscriptLineType[]): TranscriptLineType[] {
	return [...lines].sort((left, right) => {
		const leftTime = left.timestampMs ?? Number(left.id);
		const rightTime = right.timestampMs ?? Number(right.id);

		if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
			return leftTime - rightTime;
		}

		return left.id.localeCompare(right.id, undefined, { numeric: true });
	});
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
								hasCue: nextBlock.hasCue ?? block.hasCue,
								similarityIsSameReason: nextBlock.similarityIsSameReason,
								similarityHasSameReason: nextBlock.similarityHasSameReason ?? false,
								similarityHasDifferentReason: nextBlock.similarityHasDifferentReason ?? false,
								publicContextRelevant: block.publicContextRelevant || nextBlock.publicContextRelevant,
								publicContextScore: nextBlock.publicContextScore ?? block.publicContextScore,
								publicContextReason: nextBlock.publicContextReason ?? block.publicContextReason,
								publicContextExpiresAtMs: Math.max(block.publicContextExpiresAtMs ?? 0, nextBlock.publicContextExpiresAtMs ?? 0) || undefined,
								sharedReasons: mergeSharedReasons(block.sharedReasons, nextBlock.sharedReasons),
								createdAtMs: block.createdAtMs ?? nextBlock.createdAtMs
							}
						: block
				);
			}, baseBlocks)
		)
	);
}

function mergeSharedReasons(left: IdeaBlock["sharedReasons"], right: IdeaBlock["sharedReasons"]): IdeaBlock["sharedReasons"] {
	const merged = [...(left ?? []), ...(right ?? [])];
	if (merged.length === 0) {
		return undefined;
	}

	return Array.from(new Map(merged.map(reason => [reason.id, reason])).values());
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
	if (block.status === "generating") {
		return "";
	}
	return normalizeIdeaBlockText(block.aiSummary || block.summary);
}

function normalizeIdeaBlockText(value: string): string {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase()
		.replace(/[\s\p{P}]/gu, "");
}

function createPhaseTransitionSummaryCue(cues: SimilarityPairCueData[]): SimilarityCueData | null {
	if (cues.length === 0) {
		return null;
	}

	const uniqueCues = Array.from(new Map(cues.map(cue => [cue.id, cue])).values());
	const differentReasonCount = uniqueCues.filter(cue => cue.isSameReason === false).length;
	const sameReasonCount = uniqueCues.length - differentReasonCount;
	return {
		kind: "phase-transition-summary",
		id: `phase-transition-summary-${Date.now()}`,
		sameReasonCount,
		differentReasonCount
	};
}

function isSimilarityPairCue(cue: SimilarityCueData): cue is SimilarityPairCueData {
	return cue.kind !== "phase-transition-summary";
}

function buildDuplicateIdeaBlockNotice(response: IdeaBlockResponse, block: IdeaBlock): IdeaBlockNotice {
	const similarity = typeof response.duplicate_similarity === "number" ? Math.round(response.duplicate_similarity * 100) : null;
	const similarityText = similarity == null ? "" : `相似度 ${similarity}%`;
	const blockTitle = (block.aiSummary || block.summary).trim() || "既有想法";
	const message = similarityText ? `已找到相似的既有想法：「${blockTitle}」(${similarityText})` : `已找到相似的既有想法：「${blockTitle}」`;

	return {
		id: `duplicate-${block.id}-${Date.now()}`,
		blockId: block.id,
		title: "這個 idea block 已存在",
		message
	};
}

function applyPublicContextMatches(blocks: IdeaBlock[], payload: PublicContextMatchesPayload): IdeaBlock[] {
	const matches = Array.isArray(payload.matches) ? payload.matches : [];
	if (matches.length === 0) {
		return blocks;
	}

	const expiresAtMs = Date.now() + PUBLIC_CONTEXT_RELEVANCE_MS;
	const matchesByBlockId = new Map<string, PublicContextMatchPayload>();
	for (const match of matches) {
		if (match.ideaBlockId == null) {
			continue;
		}
		matchesByBlockId.set(String(match.ideaBlockId), match);
	}
	if (matchesByBlockId.size === 0) {
		return blocks;
	}

	return blocks.map(block => {
		const match = matchesByBlockId.get(block.id);
		if (!match || block.isDeleted) {
			return block;
		}
		return {
			...block,
			publicContextRelevant: true,
			publicContextScore: typeof match.score === "number" ? match.score : null,
			publicContextReason: typeof match.reason === "string" ? match.reason : undefined,
			publicContextExpiresAtMs: expiresAtMs
		};
	});
}

function clearExpiredPublicContextMatches(blocks: IdeaBlock[], nowMs: number): IdeaBlock[] {
	let didChange = false;
	const nextBlocks = blocks.map(block => {
		if (!block.publicContextRelevant || !block.publicContextExpiresAtMs || block.publicContextExpiresAtMs > nowMs) {
			return block;
		}
		didChange = true;
		return {
			...block,
			publicContextRelevant: false,
			publicContextScore: null,
			publicContextReason: undefined,
			publicContextExpiresAtMs: undefined
		};
	});
	return didChange ? nextBlocks : blocks;
}

function isDuplicateIdeaBlockResponse(response: IdeaBlockResponse): boolean {
	return response.is_duplicate === true || response.duplicate_of_id != null;
}

function sortIdeaBlocks(blocks: IdeaBlock[]): IdeaBlock[] {
	return [...blocks].sort((left, right) => {
		if (!!left.isDeleted !== !!right.isDeleted) {
			return left.isDeleted ? 1 : -1;
		}

		if (!!left.publicContextRelevant !== !!right.publicContextRelevant) {
			return left.publicContextRelevant ? -1 : 1;
		}

		if (left.publicContextRelevant && right.publicContextRelevant) {
			const leftScore = left.publicContextScore ?? 0;
			const rightScore = right.publicContextScore ?? 0;
			if (leftScore !== rightScore) {
				return rightScore - leftScore;
			}
		}

		if ((left.status === "generating") !== (right.status === "generating")) {
			return left.status === "generating" ? 1 : -1;
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
	onRequestOpen
}: PrivateBoardProps) {
	const [activeTab, setActiveTab] = useState<BoardTab>("ideablock");
	const [currentPhase, setCurrentPhase] = useState<SessionPhase>(DEFAULT_SESSION_PHASE);
	const [cueCondition, setCueCondition] = useState<CueCondition>("experimental");
	const [timerEndTime, setTimerEndTime] = useState<number>(0);
	const visiblePhase = controlledPhase ?? currentPhase;
	const visibleTimerEndTime = controlledTimerEndTime ?? timerEndTime;
	const canShowIdeaBlocks = cueCondition === "experimental";
	const visibleActiveTab = !canShowIdeaBlocks && activeTab === "ideablock" ? "transcript" : activeTab;
	const [ideaBlocks, setIdeaBlocks] = useState<IdeaBlock[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_IDEA_BLOCKS : []);
	const [transcriptLines, setTranscriptLines] = useState<TranscriptLineType[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_TRANSCRIPT_LINES : []);
	const [publicChatMessages, setPublicChatMessages] = useState<PublicChatMessage[]>([]);
	const [ideaBlockRefreshKey, setIdeaBlockRefreshKey] = useState(0);
	const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
	const [highlightedTranscriptId, setHighlightedTranscriptId] = useState<string | null>(null);
	const [manualIdeaText, setManualIdeaText] = useState("");
	const [manualIdeaError, setManualIdeaError] = useState<string | null>(null);
	const [ideaBlockNotice, setIdeaBlockNotice] = useState<IdeaBlockNotice | null>(null);
	const [publicChatText, setPublicChatText] = useState("");
	const [publicChatError, setPublicChatError] = useState<string | null>(null);
	const [isSendingPublicChat, setIsSendingPublicChat] = useState(false);
	const [cues, setCues] = useState<SimilarityCueData[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_SIMILARITY_CUES : []);
	const [unreadIdeaBlockCount, setUnreadIdeaBlockCount] = useState(0);
	const [unreadPublicChatCount, setUnreadPublicChatCount] = useState(0);
	const [ideaBlocksSplitRatio, setIdeaBlocksSplitRatio] = useState(50);
	const [resizeCursor, setResizeCursor] = useState<"row-resize" | null>(null);
	const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
	const previousIdeaBlockTopsRef = useRef<Record<string, number>>({});
	const transcriptRefs = useRef<Record<string, HTMLDivElement | null>>({});
	const manualIdeaTextareaRef = useRef<HTMLTextAreaElement | null>(null);
	const publicChatTextareaRef = useRef<HTMLTextAreaElement | null>(null);
	const ideaBlocksRef = useRef<IdeaBlock[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_IDEA_BLOCKS : []);
	const activeTranscriptDraftsRef = useRef<Map<string, { id: string; text: string; source?: TranscriptLineType["source"]; userId?: string; timestampMs?: number; isFinal?: boolean }>>(new Map());
	const publicChatMessagesRef = useRef<PublicChatMessage[]>([]);
	const ideaBlocksSplitContainerRef = useRef<HTMLDivElement | null>(null);
	const transcriptScrollViewportRef = useRef<HTMLDivElement | null>(null);
	const ideaBlocksScrollViewportRef = useRef<HTMLDivElement | null>(null);
	const publicChatScrollViewportRef = useRef<HTMLDivElement | null>(null);
	const splitResizeCleanupRef = useRef<(() => void) | null>(null);
	const previousVisiblePhaseRef = useRef<SessionPhase>(visiblePhase);
	const phaseTransitionCueBatchRef = useRef<PhaseTransitionCueBatch | null>(null);
	const cuesRef = useRef<SimilarityCueData[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_SIMILARITY_CUES : []);
	const setTranscriptRef = useCallback((lineId: string, node: HTMLDivElement | null) => {
		transcriptRefs.current[lineId] = node;
	}, []);
	const lastProcessedBoardMessageRef = useRef<object | null>(null);
	const lastProcessedAudioMessageRef = useRef<object | null>(null);
	const lastProcessedAudioBoundaryRef = useRef<object | null>(null);
	const lastProcessedIdeaBlocksUpdateMessageRef = useRef<object | null>(null);
	const lastDisplayedAudioTranscriptRef = useRef<{ signature: string; displayedAt: number } | null>(null);
	const unreadIdeaBlockIdsFromRefreshRef = useRef<Set<string>>(new Set());
	const lastVisibleActiveTabRef = useRef<BoardTab>(visibleActiveTab);
	const shouldAutoScrollRef = useRef<Record<BoardTab, boolean>>({
		transcript: true,
		ideablock: true,
		"public-chat": true
	});
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
				const alreadyQueued = prev.some(item => item.id === cue.id || (isSimilarityPairCue(item) && item.blockId === cue.blockId));
				const nextCues = alreadyQueued ? prev : [...prev, cue];
				console.info("[private-board] similarity cue fallback detected", {
					blockId: cue.blockId,
					isSameReason: cue.isSameReason,
					alreadyQueued,
					currentBlockExpanded: !!currentBlock?.expanded
				});
				cuesRef.current = nextCues;
				return nextCues;
			});
		},
		[cueCondition]
	);

	const isIdeaBlocksTabActive = canShowIdeaBlocks && visibleActiveTab === "ideablock";

	const captureIdeaBlockPositions = useCallback(() => {
		const nextTops: Record<string, number> = {};
		Object.entries(blockRefs.current).forEach(([blockId, node]) => {
			if (node) {
				nextTops[blockId] = node.getBoundingClientRect().top;
			}
		});
		previousIdeaBlockTopsRef.current = nextTops;
	}, []);

	const clearPhaseTransitionCueBatchTimer = useCallback(() => {
		const batch = phaseTransitionCueBatchRef.current;
		if (batch?.timeoutId != null) {
			window.clearTimeout(batch.timeoutId);
			batch.timeoutId = null;
		}
	}, []);

	const flushPhaseTransitionCueBatch = useCallback(() => {
		const batch = phaseTransitionCueBatchRef.current;
		if (!batch) {
			return;
		}

		clearPhaseTransitionCueBatchTimer();
		phaseTransitionCueBatchRef.current = null;
		const summaryCue = createPhaseTransitionSummaryCue(batch.cues);
		if (!summaryCue) {
			return;
		}

		setCues(prev => {
			const nextCues = [...prev.filter(cue => cue.kind !== "phase-transition-summary"), summaryCue];
			cuesRef.current = nextCues;
			return nextCues;
		});
	}, [clearPhaseTransitionCueBatchTimer]);

	const startPhaseTransitionCueBatch = useCallback(
		(initialCues: SimilarityPairCueData[] = []) => {
			clearPhaseTransitionCueBatchTimer();
			phaseTransitionCueBatchRef.current = {
				cues: initialCues,
				timeoutId: window.setTimeout(() => flushPhaseTransitionCueBatch(), PHASE_TRANSITION_CUE_BATCH_MS)
			};
		},
		[clearPhaseTransitionCueBatchTimer, flushPhaseTransitionCueBatch]
	);

	const clearCuesSoon = useCallback(() => {
		window.setTimeout(() => {
			cuesRef.current = [];
			setCues([]);
		}, 0);
	}, []);

	const syncPhaseTransitionCueBatch = useCallback(
		(nextPhase: SessionPhase) => {
			const previousPhase = previousVisiblePhaseRef.current;
			const isEnteringGroupPhase = !isGroupPhase(previousPhase) && isGroupPhase(nextPhase);
			const isLeavingGroupPhase = isGroupPhase(previousPhase) && !isGroupPhase(nextPhase);

			if (isEnteringGroupPhase && cueCondition === "experimental") {
				const queuedPrivatePhaseCues = cuesRef.current.filter(isSimilarityPairCue);
				clearCuesSoon();
				startPhaseTransitionCueBatch(queuedPrivatePhaseCues);
			}

			if (isLeavingGroupPhase || cueCondition !== "experimental") {
				clearPhaseTransitionCueBatchTimer();
				phaseTransitionCueBatchRef.current = null;
				if (cueCondition !== "experimental") {
					clearCuesSoon();
				}
			}

			previousVisiblePhaseRef.current = nextPhase;
		},
		[clearCuesSoon, clearPhaseTransitionCueBatchTimer, cueCondition, startPhaseTransitionCueBatch]
	);

	const selectBoardTab = useCallback((tab: BoardTab) => {
		if (tab === "ideablock") {
			setUnreadIdeaBlockCount(0);
		}
		if (tab === "public-chat") {
			setUnreadPublicChatCount(0);
		}
		setActiveTab(tab);
	}, []);

	const jumpToBlock = useCallback(
		(blockId: string) => {
			if (!canShowIdeaBlocks) {
				return;
			}
			onRequestOpen?.();
			selectBoardTab("ideablock");
			setHighlightedBlockId(blockId);
		},
		[canShowIdeaBlocks, onRequestOpen, selectBoardTab]
	);

	const focusActiveComposer = useCallback(() => {
		if (isIdeaBlocksTabActive) {
			manualIdeaTextareaRef.current?.focus();
			return true;
		}

		if (visibleActiveTab === "public-chat") {
			publicChatTextareaRef.current?.focus();
			return true;
		}

		return false;
	}, [isIdeaBlocksTabActive, visibleActiveTab]);

	useEffect(() => {
		const handleComposerShortcutKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.repeat || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || isEditableShortcutTarget(event.target)) {
				return;
			}

			if (event.code === "Digit1") {
				event.preventDefault();
				selectBoardTab("transcript");
				return;
			}

			if (event.code === "Digit2" && canShowIdeaBlocks) {
				event.preventDefault();
				selectBoardTab("ideablock");
				return;
			}

			if (event.code === "Digit3") {
				event.preventDefault();
				selectBoardTab("public-chat");
				return;
			}

			if (event.key === "Enter" && focusActiveComposer()) {
				event.preventDefault();
			}
		};

		window.addEventListener("keydown", handleComposerShortcutKeyDown);
		return () => window.removeEventListener("keydown", handleComposerShortcutKeyDown);
	}, [canShowIdeaBlocks, focusActiveComposer, selectBoardTab]);

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
				const initiallyLoadedPrivatePhaseCuedBlocks = isGroupPhase(visiblePhase) ? [] : ideaBlocksFromDb.filter(block => block.hasCue && !previousBlocksById.has(block.id));
				const cueBlocksToQueue = [...newlyCuedBlocks, ...initiallyLoadedPrivatePhaseCuedBlocks];
				console.info("[private-board] similarity cue refresh check", {
					sessionId,
					participantId,
					newlyCuedBlockIds: newlyCuedBlocks.map(block => block.id),
					initiallyLoadedPrivatePhaseCuedBlockIds: initiallyLoadedPrivatePhaseCuedBlocks.map(block => block.id),
					cuedBlockIds: ideaBlocksFromDb.filter(block => block.hasCue).map(block => block.id)
				});
				cueBlocksToQueue.forEach(queueSimilarityCueFromBlock);
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
	}, [ideaBlockRefreshKey, participantId, queueSimilarityCueFromBlock, sessionId, visiblePhase]);

	useEffect(() => {
		ideaBlocksRef.current = ideaBlocks;
		const timer = window.setTimeout(() => {
			setTranscriptLines(prev => linkTranscriptLinesToBlocks(prev, ideaBlocks));
		}, 0);

		return () => window.clearTimeout(timer);
	}, [ideaBlocks]);

	useEffect(() => {
		if (!ideaBlocks.some(block => block.publicContextRelevant)) {
			return;
		}

		const interval = window.setInterval(() => {
			captureIdeaBlockPositions();
			setIdeaBlocks(prev => {
				const clearedBlocks = clearExpiredPublicContextMatches(prev, Date.now());
				if (clearedBlocks === prev) {
					return prev;
				}
				const nextBlocks = sortIdeaBlocks(clearedBlocks);
				ideaBlocksRef.current = nextBlocks;
				return nextBlocks;
			});
		}, 1000);
		return () => window.clearInterval(interval);
	}, [captureIdeaBlockPositions, ideaBlocks]);

	useEffect(() => {
		publicChatMessagesRef.current = publicChatMessages;
	}, [publicChatMessages]);

	useEffect(() => {
		cuesRef.current = cues;
	}, [cues]);

	useEffect(() => {
		return () => {
			clearPhaseTransitionCueBatchTimer();
			phaseTransitionCueBatchRef.current = null;
		};
	}, [clearPhaseTransitionCueBatchTimer]);

	useEffect(() => {
		syncPhaseTransitionCueBatch(visiblePhase);
	}, [syncPhaseTransitionCueBatch, visiblePhase]);

	useEffect(() => {
		if (!isBoardMessage(lastMessage)) {
			return;
		}

		if (lastMessage.type === "phase_changed") {
			const nextPhase = normalizeSessionPhase(lastMessage.phase);
			if (nextPhase) {
				syncPhaseTransitionCueBatch(nextPhase);
			}
			const timer = window.setTimeout(() => {
				if (nextPhase) setCurrentPhase(nextPhase);
				setTimerEndTime(lastMessage.end_time_ms || 0);
			}, 0);
			return () => window.clearTimeout(timer);
		}

		if (lastMessage.type === "countdown_changed") {
			const timer = window.setTimeout(() => {
				const nextPhase = normalizeSessionPhase(lastMessage.current_phase);
				if (nextPhase) setCurrentPhase(nextPhase);
				setTimerEndTime(lastMessage.timer_end_time_ms ?? lastMessage.end_time_ms ?? 0);
			}, 0);
			return () => window.clearTimeout(timer);
		}

		if (lastMessage.type === "board_state") {
			const timer = window.setTimeout(() => {
				const nextPhase = normalizeSessionPhase(lastMessage.current_phase);
				if (nextPhase) setCurrentPhase(nextPhase);
				if (typeof lastMessage.timer_end_time_ms === "number") setTimerEndTime(lastMessage.timer_end_time_ms);
				if (lastMessage.cue_condition) setCueCondition(lastMessage.cue_condition);
			}, 0);
			return () => window.clearTimeout(timer);
		}

		if (lastMessage.type === "cue_condition_changed") {
			const timer = window.setTimeout(() => {
				const nextCondition = lastMessage.cue_condition ?? lastMessage.condition;
				if (nextCondition) setCueCondition(nextCondition);
				if (nextCondition === "control") {
					cuesRef.current = [];
					setCues([]);
				}
			}, 0);
			return () => window.clearTimeout(timer);
		}
	}, [lastMessage, syncPhaseTransitionCueBatch]);

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
				const isNewActiveBlock = !lastMessage.payload.isDeleted && !ideaBlocksRef.current.some(block => !block.isDeleted && block.id === lastMessage.payload.id);
				if (isNewActiveBlock && visibleActiveTab !== "ideablock") {
					setUnreadIdeaBlockCount(current => current + 1);
				}
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
				const newLine = {
					...lastMessage.payload,
					origin: "live" as const,
					isOwn: isOwnTranscriptUser(lastMessage.payload.userId, participantId),
					timestampMs: lastMessage.payload.timestampMs ?? Date.now(),
					time: lastMessage.payload.time ?? formatTranscriptTime(Date.now())
				};
				// Only an unpersisted live ID may be replaced by this DB-backed broadcast.
				// Older finalized entries remain in the map for late acknowledgements, so
				// selecting the first final entry can overwrite a previous transcript box.
				const frozenDraftCandidates = [...activeTranscriptDraftsRef.current.entries()]
					.filter(([, draft]) => draft.isFinal && isUnpersistedTranscriptDraftId(draft.id) && draft.source === newLine.source && draft.userId === newLine.userId)
					.sort(([, left], [, right]) => {
						const leftTextMatches = left.text.trim() === newLine.text.trim() ? 1 : 0;
						const rightTextMatches = right.text.trim() === newLine.text.trim() ? 1 : 0;
						if (leftTextMatches !== rightTextMatches) {
							return rightTextMatches - leftTextMatches;
						}
						return (right.timestampMs ?? 0) - (left.timestampMs ?? 0);
					});
				const frozenDraftEntry = frozenDraftCandidates[0] ?? null;
				const frozenDraftId = frozenDraftEntry?.[1].id ?? null;
				if (frozenDraftEntry) {
					const [key, draft] = frozenDraftEntry;
					// Keep the DB ID available for the transcript_update acknowledgement.
					activeTranscriptDraftsRef.current.set(key, { ...draft, id: newLine.id });
				}
				setTranscriptLines(prev => linkTranscriptLinesToBlocks(frozenDraftId ? replaceTranscriptLine(prev, frozenDraftId, newLine) : appendTranscriptLine(prev, newLine), ideaBlocksRef.current));
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
				const cueTargetBlock = ideaBlocksRef.current.find(block => block.id === lastMessage.payload.blockId);
				if (!cueTargetBlock?.expanded) {
					unreadIdeaBlockIdsFromRefreshRef.current.add(lastMessage.payload.blockId);
				}
				if (phaseTransitionCueBatchRef.current) {
					if (!phaseTransitionCueBatchRef.current.cues.some(cue => cue.id === lastMessage.payload.id)) {
						phaseTransitionCueBatchRef.current.cues.push(lastMessage.payload);
					}
				} else {
					const nextCues = cuesRef.current.some(cue => cue.id === lastMessage.payload.id || (isSimilarityPairCue(cue) && cue.blockId === lastMessage.payload.blockId))
						? cuesRef.current
						: [...cuesRef.current, lastMessage.payload];
					cuesRef.current = nextCues;
					setCues(nextCues);
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
									similarityHasSameReason: block.similarityHasSameReason || lastMessage.payload.isSameReason === true,
									similarityHasDifferentReason: block.similarityHasDifferentReason || lastMessage.payload.isSameReason === false,
									isUnread: !block.expanded
								}
							: block
					)
				);
			}

			if (lastMessage.type === "public_context_matches") {
				const matchedIds = new Set((lastMessage.payload.matches ?? []).map(match => (match.ideaBlockId == null ? null : String(match.ideaBlockId))).filter((id): id is string => !!id));
				if (matchedIds.size > 0) {
					const visibleMatchedIds = [...matchedIds].filter(id => ideaBlocksRef.current.some(block => block.id === id && !block.isDeleted));
					captureIdeaBlockPositions();
					setIdeaBlocks(prev => {
						const nextBlocks = sortIdeaBlocks(applyPublicContextMatches(prev, lastMessage.payload));
						ideaBlocksRef.current = nextBlocks;
						return nextBlocks;
					});
					const firstVisibleMatchId = visibleMatchedIds[0];
					if (firstVisibleMatchId && visibleActiveTab === "ideablock") {
						setHighlightedBlockId(firstVisibleMatchId);
					} else if (visibleMatchedIds.length > 0 && visibleActiveTab !== "ideablock") {
						setUnreadIdeaBlockCount(current => current + visibleMatchedIds.length);
					}
				}
			}

			if (lastMessage.type === "similarity_reason_shared") {
				if (cueCondition !== "experimental") {
					return;
				}
				const sharedReason = lastMessage.payload;
				console.info("[private-board] similarity_reason_shared received", {
					sessionId,
					participantId,
					blockId: sharedReason.blockId
				});
				setIdeaBlocks(prev =>
					prev.map(block =>
						block.id === sharedReason.blockId
							? {
									...block,
									expanded: true,
									hasCue: true,
									similarityIsSameReason: false,
									similarityHasDifferentReason: true,
									sharedReasons: mergeSharedReasons(block.sharedReasons, [sharedReason])
								}
							: block
					)
				);
				setHighlightedBlockId(sharedReason.blockId);
				if (visibleActiveTab !== "ideablock") {
					setUnreadIdeaBlockCount(current => current + 1);
				}
			}

			if (lastMessage.type === "public_chat_message") {
				const nextMessage = publicChatPayloadToMessage(lastMessage.payload, participantId);
				const isNewUnreadMessage = !nextMessage.isOwn && !nextMessage.isDeleted && !publicChatMessagesRef.current.some(message => message.id === nextMessage.id);
				setIsSendingPublicChat(false);
				setPublicChatMessages(prev => appendPublicChatMessage(prev, nextMessage));
				if (isNewUnreadMessage && visibleActiveTab !== "public-chat") {
					setUnreadPublicChatCount(current => current + 1);
				}
			}
		}, 0);

		return () => window.clearTimeout(timer);
	}, [captureIdeaBlockPositions, cueCondition, lastMessage, participantId, queueSimilarityCueFromBlock, sessionId, visibleActiveTab, visiblePhase]);

	useEffect(() => {
		if (!isAudioTranscriptBoundaryMessage(lastAudioMessage)) {
			return;
		}
		if (lastProcessedAudioBoundaryRef.current === lastAudioMessage) {
			return;
		}
		lastProcessedAudioBoundaryRef.current = lastAudioMessage;

		const timer = window.setTimeout(() => {
			const transcriptLine = audioTranscriptMessageToLine(lastAudioMessage);
			const draftKey = transcriptDraftTargetKey(lastAudioMessage, transcriptLine, participantId);
			const matchingDraft = activeTranscriptDraftsRef.current.get(draftKey) ?? null;
			const boundaryText = (matchingDraft?.text || transcriptLine.text || "").trim();
			if (!boundaryText) {
				return;
			}

			const finalDraftId = matchingDraft?.id ?? transcriptLine.id;
			activeTranscriptDraftsRef.current.set(draftKey, {
				id: finalDraftId,
				text: boundaryText,
				source: transcriptLine.source,
				userId: transcriptLine.userId ?? participantId,
				timestampMs: matchingDraft?.timestampMs ?? transcriptLine.timestampMs,
				isFinal: true
			});

			const frozenLine = {
				...transcriptLine,
				id: finalDraftId,
				text: boundaryText,
				displayName: transcriptLine.displayName ?? displayName,
				isOwn: transcriptLine.userId == null ? true : isOwnTranscriptUser(transcriptLine.userId, participantId),
				isDraft: false
			};
			setTranscriptLines(prev => linkTranscriptLinesToBlocks(matchingDraft ? replaceTranscriptLine(prev, matchingDraft.id, frozenLine) : appendTranscriptLine(prev, frozenLine), ideaBlocks));
		}, 0);

		return () => window.clearTimeout(timer);
	}, [displayName, ideaBlocks, lastAudioMessage, participantId]);

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
					lastAudioMessage.type === "transcript" && FINAL_TRANSCRIPT_REASONS.has(String(lastAudioMessage.reason ?? "")) && (lastAudioMessage.persisted === false || lastAudioMessage.persisted == null);
				const isPersistedFinal = lastAudioMessage.type === "transcript_update" && lastAudioMessage.persisted === true;
				let displayLine = transcriptLine;
				let replaceDraftLineId: string | null = null;
				let persistedReplacementDraft: { id: string; text: string; source?: TranscriptLineType["source"]; userId?: string; timestampMs?: number; isFinal?: boolean } | null = null;
				const draftKey = transcriptDraftTargetKey(lastAudioMessage, transcriptLine, participantId);
				const matchingDraft = activeTranscriptDraftsRef.current.get(draftKey) ?? null;
				const matchingFinalDraft = isTranscriptFinal && matchingDraft && !matchingDraft.isFinal ? matchingDraft : null;

				if (isLiveTranscriptDraft) {
					if (matchingDraft?.isFinal) {
						return;
					}
					const draftUserId = transcriptLine.userId ?? participantId;
					const currentDraft =
						matchingDraft && !matchingDraft.isFinal && matchingDraft.source === transcriptLine.source && matchingDraft.userId === draftUserId
							? matchingDraft
							: {
									id: `live-batch-${draftUserId}-${transcriptLine.source ?? "unknown"}-${Date.now()}`,
									text: "",
									source: transcriptLine.source,
									userId: draftUserId,
									timestampMs: transcriptLine.timestampMs
								};
					const mergedText = mergeTranscriptText(currentDraft.text, transcriptLine.text);
					const draftText = lastAudioMessage.replaceDraft === true ? transcriptLine.text : mergedText;
					activeTranscriptDraftsRef.current.set(draftKey, {
						id: currentDraft.id,
						text: draftText,
						source: transcriptLine.source,
						userId: draftUserId,
						timestampMs: currentDraft.timestampMs ?? transcriptLine.timestampMs
					});
					displayLine = {
						...transcriptLine,
						id: currentDraft.id,
						text: draftText,
						isDraft: true
					};
				} else if (matchingFinalDraft) {
					replaceDraftLineId = matchingFinalDraft.id;
					activeTranscriptDraftsRef.current.set(draftKey, {
						id: replaceDraftLineId,
						text: transcriptLine.text,
						source: transcriptLine.source,
						userId: transcriptLine.userId ?? participantId,
						timestampMs: matchingFinalDraft.timestampMs ?? transcriptLine.timestampMs,
						isFinal: true
					});
					displayLine = {
						...transcriptLine,
						id: replaceDraftLineId,
						text: transcriptLine.text,
						timestampMs: matchingFinalDraft.timestampMs ?? transcriptLine.timestampMs,
						isDraft: false
					};
				} else if (isTranscriptFinal && matchingDraft?.isFinal) {
					replaceDraftLineId = matchingDraft.id;
					activeTranscriptDraftsRef.current.set(draftKey, {
						id: replaceDraftLineId,
						text: transcriptLine.text,
						source: transcriptLine.source,
						userId: transcriptLine.userId ?? participantId,
						timestampMs: matchingDraft.timestampMs ?? transcriptLine.timestampMs,
						isFinal: true
					});
					displayLine = {
						...transcriptLine,
						id: replaceDraftLineId,
						text: transcriptLine.text,
						timestampMs: matchingDraft.timestampMs ?? transcriptLine.timestampMs,
						isDraft: false
					};
				} else if (isPersistedFinal) {
					if (matchingDraft) {
						replaceDraftLineId = matchingDraft.id;
						persistedReplacementDraft = matchingDraft;
						activeTranscriptDraftsRef.current.set(draftKey, {
							id: transcriptLine.id,
							text: transcriptLine.text,
							source: transcriptLine.source,
							userId: transcriptLine.userId ?? participantId,
							timestampMs: matchingDraft.timestampMs ?? transcriptLine.timestampMs,
							isFinal: true
						});
					} else {
						// Fallback: the live draft used "active" as segment key but the persisted
						// final arrived with a real DB segment ID — keys won't match, so scan for
						// any non-final draft with the same source and userId.
						const userId = transcriptLine.userId ?? participantId;
						for (const [key, draft] of activeTranscriptDraftsRef.current) {
							if (draft.source === transcriptLine.source && draft.userId === userId && !draft.isFinal) {
								replaceDraftLineId = draft.id;
								persistedReplacementDraft = draft;
								activeTranscriptDraftsRef.current.set(key, {
									...draft,
									id: transcriptLine.id,
									text: transcriptLine.text,
									timestampMs: draft.timestampMs ?? transcriptLine.timestampMs,
									isFinal: true
								});
								break;
							}
						}
					}
					displayLine = {
						...transcriptLine,
						id: transcriptLine.id,
						text: transcriptLine.text,
						timestampMs: persistedReplacementDraft?.timestampMs ?? transcriptLine.timestampMs,
						origin: "history",
						isDraft: false
					};
				}

				const signature = audioTranscriptDisplaySignature(lastAudioMessage, displayLine);
				const displayed = lastDisplayedAudioTranscriptRef.current;
				const now = Date.now();
				if (displayed && displayed.signature === signature && now - displayed.displayedAt < 2000) {
					return;
				}
				lastDisplayedAudioTranscriptRef.current = { signature, displayedAt: now };
				setTranscriptLines(prev => {
					const nextLine = {
						...displayLine,
						displayName: displayLine.displayName ?? displayName,
						isOwn: displayLine.userId == null ? true : isOwnTranscriptUser(displayLine.userId, participantId)
					};
					return linkTranscriptLinesToBlocks(replaceDraftLineId ? replaceTranscriptLine(prev, replaceDraftLineId, nextLine) : appendTranscriptLine(prev, nextLine), ideaBlocks);
				});
			}
		}, 0);

		return () => window.clearTimeout(timer);
	}, [displayName, ideaBlocks, lastAudioMessage, participantId]);

	useEffect(() => {
		if (!isAudioIdeaBlocksUpdateMessage(lastAudioMessage)) {
			return;
		}
		const timer = window.setTimeout(() => {
			if (lastProcessedIdeaBlocksUpdateMessageRef.current === lastAudioMessage) {
				return;
			}
			lastProcessedIdeaBlocksUpdateMessageRef.current = lastAudioMessage;
			const duplicateIdeaBlockResponses = Array.isArray(lastAudioMessage.duplicate_idea_blocks) ? lastAudioMessage.duplicate_idea_blocks : [];
			let shouldRefreshIdeaBlocks = false;

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
					const existingActiveBlockIds = new Set(prev.filter(block => !block.isDeleted).map(block => block.id));
					mergedBlocksSnapshot = mergeIdeaBlocks(prev, updatedBlocks, { markNewUnread: true });
					const newActiveBlockCount = mergedBlocksSnapshot.filter(block => !block.isDeleted && !existingActiveBlockIds.has(block.id)).length;
					if (newActiveBlockCount > 0 && lastVisibleActiveTabRef.current !== "ideablock") {
						setUnreadIdeaBlockCount(current => current + newActiveBlockCount);
					}
					ideaBlocksRef.current = mergedBlocksSnapshot;
					return mergedBlocksSnapshot;
				});
				window.setTimeout(() => {
					setTranscriptLines(lines => linkTranscriptLinesToBlocks(lines, mergedBlocksSnapshot.length > 0 ? mergedBlocksSnapshot : updatedBlocks));
				}, 0);
				shouldRefreshIdeaBlocks = true;
			}

			if (duplicateIdeaBlockResponses.length > 0) {
				const duplicateBlocks = duplicateIdeaBlockResponses.map(item => ideaBlockResponseToBlock(item));
				setIdeaBlocks(prev => {
					const mergedBlocks = mergeIdeaBlocks(prev, duplicateBlocks);
					ideaBlocksRef.current = mergedBlocks;
					return mergedBlocks;
				});
				const firstDuplicateResponse = duplicateIdeaBlockResponses[0];
				const firstDuplicateBlock = duplicateBlocks[0];
				if (firstDuplicateResponse && firstDuplicateBlock) {
					setIdeaBlockNotice(buildDuplicateIdeaBlockNotice(firstDuplicateResponse, firstDuplicateBlock));
					jumpToBlock(firstDuplicateBlock.id);
				}
				shouldRefreshIdeaBlocks = true;
			}

			if (shouldRefreshIdeaBlocks) {
				setIdeaBlockRefreshKey(current => current + 1);
			}
		}, 0);

		return () => window.clearTimeout(timer);
	}, [jumpToBlock, lastAudioMessage, queueSimilarityCueFromBlock]);

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

	useEffect(() => {
		if (!ideaBlockNotice) {
			return;
		}

		const timer = window.setTimeout(() => setIdeaBlockNotice(null), 4000);
		return () => window.clearTimeout(timer);
	}, [ideaBlockNotice]);

	const jumpToTranscript = (block: IdeaBlock) => {
		const transcriptId = block.transcriptLineId ?? block.sourceTranscriptIds?.[0];
		if (!transcriptId) {
			return;
		}

		selectBoardTab("ideablock");
		window.setTimeout(() => setHighlightedTranscriptId(transcriptId), 0);
	};

	const canJumpToTranscript = (block: IdeaBlock) => {
		const transcriptIds = [block.transcriptLineId, ...(block.sourceTranscriptIds ?? [])].filter((id): id is string => !!id);
		return transcriptIds.length > 0;
	};

	const handleTranscriptScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
		shouldAutoScrollRef.current.transcript = isNearScrollBottom(event.currentTarget);
	}, []);

	const handleIdeaBlocksScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
		shouldAutoScrollRef.current.ideablock = isNearScrollBottom(event.currentTarget);
	}, []);

	const handlePublicChatScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
		shouldAutoScrollRef.current["public-chat"] = isNearScrollBottom(event.currentTarget);
	}, []);

	const handleIdeaBlocksSplitResizeStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
		splitResizeCleanupRef.current?.();
		const resizeHandle = event.currentTarget;
		resizeHandle.setPointerCapture(event.pointerId);

		const updateSplitRatio = (clientY: number) => {
			const container = ideaBlocksSplitContainerRef.current;
			if (!container) {
				return;
			}

			const rect = container.getBoundingClientRect();
			if (rect.height <= 0) {
				return;
			}

			setIdeaBlocksSplitRatio(clampIdeaBlocksSplitRatio(((clientY - rect.top) / rect.height) * 100));
		};

		const handlePointerMove = (moveEvent: PointerEvent) => {
			updateSplitRatio(moveEvent.clientY);
		};

		const cleanupResizeListeners = () => {
			if (resizeHandle.hasPointerCapture(event.pointerId)) {
				resizeHandle.releasePointerCapture(event.pointerId);
			}
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			window.removeEventListener("pointercancel", handlePointerUp);
			splitResizeCleanupRef.current = null;
		};

		const handlePointerUp = () => {
			setResizeCursor(null);
			cleanupResizeListeners();
		};

		updateSplitRatio(event.clientY);
		setResizeCursor("row-resize");
		document.body.style.cursor = "row-resize";
		document.body.style.userSelect = "none";
		splitResizeCleanupRef.current = cleanupResizeListeners;
		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
		window.addEventListener("pointercancel", handlePointerUp);
	};

	const handleIdeaBlocksSplitResizeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
			return;
		}

		event.preventDefault();
		const direction = event.key === "ArrowUp" ? -1 : 1;
		setIdeaBlocksSplitRatio(current => clampIdeaBlocksSplitRatio(current + direction * 4));
	};

	useEffect(() => {
		return () => {
			splitResizeCleanupRef.current?.();
		};
	}, []);

	useLayoutEffect(() => {
		const previousTops = previousIdeaBlockTopsRef.current;
		if (Object.keys(previousTops).length === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			previousIdeaBlockTopsRef.current = {};
			return;
		}

		const animatedNodes: HTMLDivElement[] = [];
		Object.entries(blockRefs.current).forEach(([blockId, node]) => {
			if (!node) {
				return;
			}
			const previousTop = previousTops[blockId];
			if (previousTop == null) {
				return;
			}
			const nextTop = node.getBoundingClientRect().top;
			const deltaY = previousTop - nextTop;
			if (Math.abs(deltaY) < 1) {
				return;
			}
			node.style.transition = "none";
			node.style.transform = `translateY(${deltaY}px)`;
			node.style.willChange = "transform";
			animatedNodes.push(node);
		});
		previousIdeaBlockTopsRef.current = {};

		if (animatedNodes.length === 0) {
			return;
		}

		const animationFrame = window.requestAnimationFrame(() => {
			animatedNodes.forEach(node => {
				node.style.transition = "transform 650ms cubic-bezier(0.22, 1, 0.36, 1)";
				node.style.transform = "";
			});
		});

		const cleanupTimer = window.setTimeout(() => {
			animatedNodes.forEach(node => {
				node.style.transition = "";
				node.style.willChange = "";
			});
		}, 700);

		return () => {
			window.cancelAnimationFrame(animationFrame);
			window.clearTimeout(cleanupTimer);
			animatedNodes.forEach(node => {
				node.style.transition = "";
				node.style.transform = "";
				node.style.willChange = "";
			});
		};
	}, [ideaBlocks]);

	useLayoutEffect(() => {
		const transcriptViewport = transcriptScrollViewportRef.current;
		const ideaBlocksViewport = ideaBlocksScrollViewportRef.current;
		const publicChatViewport = publicChatScrollViewportRef.current;
		const didEnterIdeaBlocks = lastVisibleActiveTabRef.current !== "ideablock" && isIdeaBlocksTabActive;
		const didEnterTranscript = lastVisibleActiveTabRef.current !== "transcript" && visibleActiveTab === "transcript";
		const didEnterPublicChat = lastVisibleActiveTabRef.current !== "public-chat" && visibleActiveTab === "public-chat";
		lastVisibleActiveTabRef.current = visibleActiveTab;

		if (didEnterIdeaBlocks) {
			shouldAutoScrollRef.current.transcript = true;
			shouldAutoScrollRef.current.ideablock = true;
			if (transcriptViewport) {
				transcriptViewport.scrollTop = transcriptViewport.scrollHeight;
			}
			if (ideaBlocksViewport) {
				ideaBlocksViewport.scrollTop = ideaBlocksViewport.scrollHeight;
			}
			return;
		}

		if (isIdeaBlocksTabActive) {
			if (transcriptViewport && shouldAutoScrollRef.current.transcript) {
				transcriptViewport.scrollTop = transcriptViewport.scrollHeight;
			}
			if (ideaBlocksViewport && shouldAutoScrollRef.current.ideablock) {
				ideaBlocksViewport.scrollTop = ideaBlocksViewport.scrollHeight;
			}
			return;
		}

		if (didEnterTranscript) {
			shouldAutoScrollRef.current.transcript = true;
		}

		if (visibleActiveTab === "transcript" && transcriptViewport && shouldAutoScrollRef.current.transcript) {
			transcriptViewport.scrollTop = transcriptViewport.scrollHeight;
			return;
		}

		if (didEnterPublicChat) {
			shouldAutoScrollRef.current["public-chat"] = true;
		}

		if (publicChatViewport && shouldAutoScrollRef.current["public-chat"]) {
			publicChatViewport.scrollTop = publicChatViewport.scrollHeight;
		}
	}, [isIdeaBlocksTabActive, visibleActiveTab, ideaBlocks, publicChatMessages, transcriptLines]);

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
			? normalizedContent.slice(0, 20) || values.summary.trim() || "Idea"
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

		const savedIdeaBlockResponse = (await response.json()) as IdeaBlockResponse;
		const savedBlock = ideaBlockResponseToBlock(savedIdeaBlockResponse);
		const isDuplicateBlock = isDuplicateIdeaBlockResponse(savedIdeaBlockResponse);
		if (isDraft && isDuplicateBlock) {
			setIdeaBlocks(prev => {
				const nextBlocks = mergeIdeaBlocks(
					prev.filter(block => block.id !== id),
					[{ ...savedBlock, isUnread: true }],
					{ markNewUnread: true }
				);
				ideaBlocksRef.current = nextBlocks;
				return nextBlocks;
			});
			setIdeaBlockNotice(buildDuplicateIdeaBlockNotice(savedIdeaBlockResponse, savedBlock));
			jumpToBlock(savedBlock.id);
			setIdeaBlockRefreshKey(current => current + 1);
			return;
		}

		setIdeaBlocks(prev => {
			const nextBlocks = prev.map(block =>
				block.id === id
					? {
							...block,
							...savedBlock,
							expanded: block.expanded,
							cueText: block.cueText,
							hasCue: savedBlock.hasCue,
							similarityIsSameReason: savedBlock.similarityIsSameReason,
							similarityHasSameReason: savedBlock.similarityHasSameReason ?? false,
							similarityHasDifferentReason: savedBlock.similarityHasDifferentReason ?? false,
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
		setManualIdeaError(null);
		window.requestAnimationFrame(() => manualIdeaTextareaRef.current?.focus());
		const generatingBlock = createGeneratingIdeaBlock(normalizedContent);
		setIdeaBlocks(prev => {
			const nextBlocks = sortIdeaBlocks([...prev, generatingBlock]);
			ideaBlocksRef.current = nextBlocks;
			return nextBlocks;
		});
		try {
			if (ENABLE_PRIVATE_BOARD_MOCK_DATA) {
				const derivedTitle = normalizedContent.slice(0, 20) || "Idea";
				const newBlock: IdeaBlock = {
					...createDraftIdeaBlock(),
					id: `manual-${Date.now()}`,
					summary: derivedTitle,
					aiSummary: normalizedContent,
					transcript: "",
					expanded: false,
					isDraft: false
				};
				setIdeaBlocks(prev => {
					const nextBlocks = sortIdeaBlocks(prev.map(block => (block.id === generatingBlock.id ? newBlock : block)));
					ideaBlocksRef.current = nextBlocks;
					return nextBlocks;
				});
				if (lastVisibleActiveTabRef.current === "ideablock") {
					setHighlightedBlockId(newBlock.id);
				} else {
					setUnreadIdeaBlockCount(current => current + 1);
				}
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

			const savedIdeaBlockResponse = (await response.json()) as IdeaBlockResponse;
			const savedBlock = ideaBlockResponseToBlock(savedIdeaBlockResponse);
			const isDuplicateBlock = isDuplicateIdeaBlockResponse(savedIdeaBlockResponse);
			const isNewActiveBlock = !savedBlock.isDeleted && !ideaBlocksRef.current.some(block => !block.isDeleted && block.id === savedBlock.id);
			setIdeaBlocks(prev => {
				const withoutGeneratingBlock = prev.filter(block => block.id !== generatingBlock.id);
				const nextBlocks = mergeIdeaBlocks(withoutGeneratingBlock, [{ ...savedBlock, isUnread: true }], { markNewUnread: true });
				ideaBlocksRef.current = nextBlocks;
				return nextBlocks;
			});
			if (isDuplicateBlock) {
				setIdeaBlockNotice(buildDuplicateIdeaBlockNotice(savedIdeaBlockResponse, savedBlock));
				jumpToBlock(savedBlock.id);
			} else if (lastVisibleActiveTabRef.current === "ideablock") {
				setHighlightedBlockId(savedBlock.id);
			} else if (isNewActiveBlock) {
				setUnreadIdeaBlockCount(current => current + 1);
			}
			setIdeaBlockRefreshKey(current => current + 1);
		} catch (error) {
			setIdeaBlocks(prev => {
				const nextBlocks = prev.filter(block => block.id !== generatingBlock.id);
				ideaBlocksRef.current = nextBlocks;
				return nextBlocks;
			});
			setManualIdeaError(error instanceof Error ? error.message : "Failed to save idea block");
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

	const shareSimilarityReason = (cue: SimilarityCueData) => {
		if (cue.kind === "phase-transition-summary") {
			return;
		}
		if (cue.isSameReason !== false) {
			return;
		}
		onSendBoardMessage({
			type: "share_similarity_reason",
			blockId: cue.blockId,
			cueId: cue.id
		});
		setCues(prev => {
			const nextCues = prev.filter(item => !isSimilarityPairCue(item) || item.blockId !== cue.blockId || item.isSameReason !== false);
			cuesRef.current = nextCues;
			return nextCues;
		});
	};

	const dismissSimilarityCue = (cueId: string) => {
		setCues(prev => {
			const nextCues = prev.filter(cue => cue.id !== cueId);
			cuesRef.current = nextCues;
			return nextCues;
		});
	};

	const privateTranscriptLines = transcriptLines.filter(line => line.source !== "public");
	const publicTranscriptLines = transcriptLines.filter(line => line.source === "public");
	const transcriptTabLines = canShowIdeaBlocks ? publicTranscriptLines : transcriptLines;
	const transcriptTabEmptyText = canShowIdeaBlocks ? "尚無公開逐字稿" : "尚無逐字稿";
	const unreadIdeaBlockCountLabel = unreadIdeaBlockCount > 99 ? "99+" : String(unreadIdeaBlockCount);
	const unreadPublicChatCountLabel = unreadPublicChatCount > 99 ? "99+" : String(unreadPublicChatCount);

	return (
		<>
			{resizeCursor && <div className="fixed inset-0 z-50 touch-none select-none" style={{ cursor: resizeCursor }} />}
			{ideaBlockNotice && (
				<div className="fixed right-4 top-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-md border bg-card p-3 text-card-foreground shadow-lg" role="status" aria-live="polite">
					<div className="flex items-start gap-3">
						<button type="button" className="min-w-0 flex-1 text-left" onClick={() => jumpToBlock(ideaBlockNotice.blockId)}>
							<div className="text-sm font-medium">{ideaBlockNotice.title}</div>
							<div className="mt-1 text-xs leading-5 text-muted-foreground">{ideaBlockNotice.message}</div>
						</button>
						<Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="關閉通知" onClick={() => setIdeaBlockNotice(null)}>
							<X className="h-4 w-4" />
						</Button>
					</div>
				</div>
			)}
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
								onClick={() => selectBoardTab("transcript")}
							>
								逐字稿
							</Button>
							{canShowIdeaBlocks && (
								<Button
									aria-pressed={visibleActiveTab === "ideablock"}
									className={cn(
										"relative transition-all active:translate-y-px active:scale-[0.98]",
										visibleActiveTab === "ideablock" && "translate-y-px bg-primary text-primary-foreground shadow-inner ring-2 ring-primary/20 hover:bg-primary/90"
									)}
									variant={visibleActiveTab === "ideablock" ? "default" : "ghost"}
									onClick={() => selectBoardTab("ideablock")}
								>
									Idea Blocks
									{unreadIdeaBlockCount > 0 && (
										<span
											className="absolute -right-1.5 -top-1.5 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-card bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground shadow-sm"
											aria-label={`${unreadIdeaBlockCount} unread idea blocks`}
										>
											{unreadIdeaBlockCountLabel}
										</span>
									)}
								</Button>
							)}
							<Button
								aria-pressed={visibleActiveTab === "public-chat"}
								className={cn(
									"relative transition-all active:translate-y-px active:scale-[0.98]",
									visibleActiveTab === "public-chat" && "translate-y-px bg-primary text-primary-foreground shadow-inner ring-2 ring-primary/20 hover:bg-primary/90"
								)}
								variant={visibleActiveTab === "public-chat" ? "default" : "ghost"}
								onClick={() => selectBoardTab("public-chat")}
							>
								聊天室
								{unreadPublicChatCount > 0 && (
									<span
										className="absolute -right-1.5 -top-1.5 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-card bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground shadow-sm"
										aria-label={`${unreadPublicChatCount} unread chat messages`}
									>
										{unreadPublicChatCountLabel}
									</span>
								)}
							</Button>
						</div>
					</div>
					<div className="flex items-center gap-3">
						<PhaseBadge phase={visiblePhase} />
						{visibleTimerEndTime > 0 && <PhaseTimer endTimeMs={visibleTimerEndTime} />}
						<span className={`hidden h-2 w-2 rounded-full ${isConnected ? "bg-primary" : "bg-muted-foreground"}`} />
					</div>
				</header>

				{visibleActiveTab === "transcript" && (
					<ScrollArea className="min-h-0 flex-1 p-3" viewportRef={transcriptScrollViewportRef} viewportProps={{ onScroll: handleTranscriptScroll }}>
						<TranscriptLines
							lines={transcriptTabLines}
							emptyText={transcriptTabEmptyText}
							onJumpToBlock={undefined}
							onTranscriptRef={setTranscriptRef}
							highlightedTranscriptId={highlightedTranscriptId}
						/>
					</ScrollArea>
				)}

				{isIdeaBlocksTabActive && (
					<div
						ref={ideaBlocksSplitContainerRef}
						className="grid min-h-0 flex-1 p-3"
						style={{
							gridTemplateRows: `minmax(0, ${ideaBlocksSplitRatio}fr) 1rem minmax(0, ${100 - ideaBlocksSplitRatio}fr)`
						}}
					>
						<section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
							<div className="border-b px-3 py-2 text-sm font-medium">私人逐字稿</div>
							<ScrollArea className="min-h-0 flex-1 p-3" viewportRef={transcriptScrollViewportRef} viewportProps={{ onScroll: handleTranscriptScroll }}>
								<TranscriptLines
									lines={privateTranscriptLines}
									emptyText="尚無逐字稿"
									onJumpToBlock={canShowIdeaBlocks ? jumpToBlock : undefined}
									onTranscriptRef={setTranscriptRef}
									highlightedTranscriptId={highlightedTranscriptId}
								/>
							</ScrollArea>
						</section>

						<div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
							<div />
							<button
								type="button"
								className="group grid h-4 w-20 cursor-row-resize place-items-center rounded-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								aria-label="調整私人逐字稿與 Idea Blocks 高度"
								aria-orientation="horizontal"
								aria-valuemin={MIN_IDEA_BLOCKS_SPLIT_RATIO}
								aria-valuemax={100 - MIN_IDEA_BLOCKS_SPLIT_RATIO}
								aria-valuenow={Math.round(ideaBlocksSplitRatio)}
								role="separator"
								onPointerDown={handleIdeaBlocksSplitResizeStart}
								onKeyDown={handleIdeaBlocksSplitResizeKeyDown}
							>
								<span className="h-0.5 w-20 rounded-full bg-border transition-colors group-hover:bg-primary/30" aria-hidden="true" />
							</button>
							<div />
						</div>

						<section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
							<div className="border-b px-3 py-2 text-sm font-medium">Idea Blocks</div>
							<ScrollArea className="min-h-0 flex-1 p-3" viewportRef={ideaBlocksScrollViewportRef} viewportProps={{ onScroll: handleIdeaBlocksScroll }}>
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
							</ScrollArea>
						</section>
					</div>
				)}
				{visibleActiveTab === "public-chat" && (
					<ScrollArea className="min-h-0 flex-1 p-3" viewportRef={publicChatScrollViewportRef} viewportProps={{ onScroll: handlePublicChatScroll }}>
						<PublicChatMessages messages={publicChatMessages} />
					</ScrollArea>
				)}

				{isIdeaBlocksTabActive && (
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
									新增
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

			{canShowIdeaBlocks && isGroupPhase(visiblePhase) && <SimilarityCue cues={cues} onJump={jumpToBlock} onDismiss={dismissSimilarityCue} onShareReason={shareSimilarityReason} />}
		</>
	);
}

function PhaseBadge({ phase }: { phase: SessionPhase }) {
	const label = getSessionPhaseLabel(phase);
	return (
		<div
			className={cn(
				"rounded-md border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
				isGroupPhase(phase) ? "border-primary/25 bg-primary/10 text-primary" : "border-muted-foreground/20 bg-muted text-muted-foreground"
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
