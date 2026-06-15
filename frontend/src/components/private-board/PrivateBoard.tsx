import { AlertTriangle, CheckCircle2, ChevronRight, Eye, Loader2, RotateCcw, X } from "lucide-react";
import type { UIEvent } from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildIdeaBlockChatMessage, MAX_PUBLIC_CHAT_MESSAGE_LENGTH, parseIdeaBlockChatMessage } from "../../lib/chatMessages";
import { getDisplayedIdeaBlocks } from "../../lib/ideaBlockDisplay";
import { hasIdeaBlockJumpTarget } from "../../lib/ideaBlockJumpTargets";
import { NOTIFICATION_AUTO_DISMISS_MS } from "../../lib/notificationTiming";
import { DEFAULT_SESSION_PHASE, getSessionPhaseLabel, isGroupPhase, normalizeSessionPhase, type SessionPhase } from "../../lib/sessionPhase";
import { canShareSimilarityReasonInPhase, getUnrespondedSimilarityPairCues, isSimilarityCueDisplayPhase, removeSimilarityPairCues } from "../../lib/similarityCueLifecycle";
import { getTranscriptIdeaBlockStatus, getTranscriptIdeaBlockTargetId, linkTranscriptLinesToReadyBlocks } from "../../lib/transcriptIdeaBlockDisplay";
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
import { shouldClearPublicChatUnreadCount, shouldCountPublicChatMessageUnread } from "./publicChatUnread";
import { formatUnreadCount, getIdeaBlockUnreadState, type IdeaBlockUnreadState } from "./unreadIdeaBlocks";

export interface PrivateBoardHandle {
	openLatestUnreadIdeaBlock: () => void;
	openPublicChat: () => void;
	markVisiblePublicChatRead: () => void;
}

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
	onIdeaBlockUnreadStateChange?: (state: IdeaBlockUnreadState) => void;
	onPublicChatUnreadCountChange?: (count: number) => void;
}

type BoardMessage =
	| ({ type: "new_idea_block"; payload: BoardIdeaBlockPayload } & IdeaBlockCompletionTargetFields)
	| ({ type: "update_idea_block"; payload: BoardIdeaBlockUpdatePayload } & IdeaBlockCompletionTargetFields)
	| { type: "new_transcript_line"; payload: TranscriptLineType }
	| { type: "similarity_cue"; payload: SimilarityPairCueData }
	| { type: "public_context_matches"; payload: PublicContextMatchesPayload }
	| { type: "similarity_reason_shared"; payload: SimilarityReasonSharedData }
	| { type: "similarity_reason_share_sent"; payload: SimilarityReasonShareSentData }
	| SimilarityReasonShareErrorMessage
	| { type: "public_chat_message"; payload: PublicChatMessagePayload }
	| { type: "public_chat_error"; reason?: string; clientMessageId?: string }
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

interface ProvisionalIdeaBlockResponse {
	id?: string | number | null;
	provisional_id?: string | number | null;
	index?: number | null;
	title?: string | null;
	summary?: string | null;
	transcript_id?: string | number | null;
	transcript?: string | null;
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
	clientMessageId?: string;
}

interface PublicContextMatchPayload {
	ideaBlockId?: string | number | null;
	userId?: string | number | null;
	score?: number | null;
	reason?: string | null;
	taskItemIds?: number[];
	componentIds?: string[];
}

interface PublicContextMatchesPayload {
	transcriptId?: string | number | null;
	participantId?: string | number | null;
	textChars?: number;
	replaceExisting?: boolean;
	pinMode?: string;
	matches?: PublicContextMatchPayload[];
}

interface SimilarityReasonShareSentData {
	blockId: string;
	recipientCount?: number;
	deliveredCount?: number;
}

interface SimilarityReasonShareErrorMessage {
	type: "similarity_reason_share_error";
	reason?: string;
	blockId?: string | number | null;
	block_id?: string | number | null;
}

type SimilarityCueResponseStatus = "shown" | "accepted" | "ignored" | "dismissed" | "shared";
type SimilarityCueTerminalResponseStatus = Exclude<SimilarityCueResponseStatus, "shown">;

interface IdeaBlockNotice {
	id: string;
	blockId?: string;
	title: string;
	message: string;
}

type IdeaBlockChatShareNoticeStatus = "sending" | "sent" | "failed";

interface IdeaBlockChatShareNotice {
	id: string;
	message: string;
	status: IdeaBlockChatShareNoticeStatus;
}

interface PendingIdeaBlockChatShare {
	noticeId: string;
	message: string;
	attemptId: string;
}

interface IdeaBlockCompletionTargetFields {
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
	generation_complete?: boolean | null;
	scope?: string | null;
	mic_mode?: string | null;
	local_mic_mode?: string | null;
}

interface BoardIdeaBlockPayload extends IdeaBlock {
	is_deleted?: boolean;
	transcript_id?: string | number | null;
	source_transcript_ids?: Array<string | number | null> | null;
}

interface BoardIdeaBlockUpdatePayload extends Omit<Partial<BoardIdeaBlockPayload>, "id"> {
	id: string | number;
}

interface AudioIdeaBlocksUpdateMessage extends IdeaBlockCompletionTargetFields {
	type: "idea_blocks_update";
	idea_blocks?: IdeaBlockResponse[];
	duplicate_idea_blocks?: IdeaBlockResponse[];
}

interface AudioProvisionalIdeaBlocksUpdateMessage extends IdeaBlockCompletionTargetFields {
	type: "idea_blocks_provisional_update";
	provisional_idea_blocks?: ProvisionalIdeaBlockResponse[];
}

interface AudioTerminalErrorMessage extends IdeaBlockCompletionTargetFields {
	type: "transcript_error" | "pipeline_error" | "asr_error";
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
const WHISPER_FINAL_TEXT_HOLD_MS = 5000;
const PHASE_TRANSITION_CUE_BATCH_MS = 2000;
const IDEA_BLOCK_CHAT_SHARE_ACK_TIMEOUT_MS = 8000;
const PUBLIC_CHAT_SEND_ACK_TIMEOUT_MS = 5000;
const VOICE_GENERATING_ID_PREFIX = "voice-generating";
const VOICE_GENERATING_TIMEOUT_MS = 15000;
const MAX_PENDING_IDEA_BLOCK_PREVIEW_COUNT = 3;

function createClientNoticeId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface PhaseTransitionCueBatch {
	cues: SimilarityPairCueData[];
	timeoutId: number | null;
}

interface WhisperTransient {
	status: "idle" | "listening" | "generating";
	text: string;
	segmentKey?: string;
}

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
		message.type === "public_context_matches" ||
		message.type === "similarity_reason_shared" ||
		message.type === "similarity_reason_share_sent" ||
		message.type === "similarity_reason_share_error" ||
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

function isAudioProvisionalIdeaBlocksUpdateMessage(message: object | null): message is AudioProvisionalIdeaBlocksUpdateMessage {
	return !!message && "type" in message && message.type === "idea_blocks_provisional_update";
}

function isAudioTerminalErrorMessage(message: object | null): message is AudioTerminalErrorMessage {
	return !!message && "type" in message && (message.type === "transcript_error" || message.type === "pipeline_error" || message.type === "asr_error");
}

function isPrivateAudioCompletionScope(message: { scope?: string | null; mic_mode?: string | null; local_mic_mode?: string | null }): boolean {
	const source = message.scope ?? message.mic_mode ?? message.local_mic_mode;
	return source == null || source === "private";
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

function normalizeClientIdPart(value: string): string {
	return (
		value
			.replace(/[^a-zA-Z0-9_-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "active"
	);
}

function createGeneratingIdeaBlock(
	content: string,
	options: {
		id?: string;
		idPrefix?: string;
		summary?: string;
		transcript?: string;
		transcriptLineId?: string;
		createdAtMs?: number;
	} = {}
): IdeaBlock {
	const block: IdeaBlock = {
		id: options.id ?? `${options.idPrefix ?? "manual-generating"}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		summary: options.summary ?? "正在生成...",
		aiSummary: content,
		transcript: options.transcript ?? "",
		expanded: false,
		createdAtMs: options.createdAtMs ?? Date.now(),
		status: "generating"
	};
	if (options.transcriptLineId) {
		block.transcriptLineId = options.transcriptLineId;
		block.sourceTranscriptIds = [options.transcriptLineId];
	}
	return block;
}

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
		isDeleted: payload.isDeleted ?? false,
		clientMessageId: payload.clientMessageId
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

function normalizeSourceTranscriptIds(values: Array<string | number | null> | null | undefined): string[] | undefined {
	if (!Array.isArray(values)) {
		return undefined;
	}

	const ids = values.map(value => (value == null ? "" : String(value).trim())).filter(Boolean);
	return ids.length > 0 ? Array.from(new Set(ids)) : undefined;
}

function boardIdeaBlockPayloadToBlock(payload: BoardIdeaBlockPayload): IdeaBlock {
	const sourceTranscriptIds = normalizeSourceTranscriptIds(payload.sourceTranscriptIds ?? payload.source_transcript_ids);
	const transcriptLineId = payload.transcriptLineId ?? (payload.transcript_id == null ? undefined : String(payload.transcript_id)) ?? sourceTranscriptIds?.[0];

	return {
		...payload,
		id: String(payload.id),
		isDeleted: payload.isDeleted ?? payload.is_deleted ?? false,
		transcriptLineId,
		sourceTranscriptIds: sourceTranscriptIds ?? (transcriptLineId ? [transcriptLineId] : undefined),
		status: payload.status ?? "ready"
	};
}

function boardIdeaBlockUpdatePayloadToBlock(payload: BoardIdeaBlockUpdatePayload): IdeaBlock | null {
	if (typeof payload.summary !== "string") {
		return null;
	}

	return boardIdeaBlockPayloadToBlock({
		...payload,
		id: payload.id,
		summary: payload.summary,
		status: payload.status ?? "ready"
	} as BoardIdeaBlockPayload);
}

function ideaBlockToSimilarityCue(block: IdeaBlock): SimilarityPairCueData | null {
	if (!block.hasCue || block.isDeleted) {
		return null;
	}

	const blockSummary = block.cueText || block.aiSummary || block.summary;
	if (!blockSummary.trim()) {
		return null;
	}

	const hasSameReason = block.similarityHasSameReason ?? block.similarityIsSameReason === true;
	const hasDifferentReason = block.similarityHasDifferentReason ?? block.similarityIsSameReason === false;
	return {
		id: `block-cue-${block.id}`,
		blockId: block.id,
		blockSummary,
		hasSameReason: hasSameReason || hasDifferentReason ? hasSameReason : undefined,
		hasDifferentReason: hasSameReason || hasDifferentReason ? hasDifferentReason : undefined,
		isSameReason: hasDifferentReason && !hasSameReason ? false : hasSameReason && !hasDifferentReason ? true : (block.similarityIsSameReason ?? undefined)
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

function isPrivateAudioLineForParticipant(line: TranscriptLineType, participantId: string): boolean {
	return line.source === "private" && (line.userId == null || isOwnTranscriptUser(line.userId, participantId));
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
		return collapseRepeatedTranscriptTail(next);
	}
	if (!next) {
		return collapseRepeatedTranscriptTail(previous);
	}
	if (previous.endsWith(next)) {
		return collapseRepeatedTranscriptTail(previous);
	}
	if (next.startsWith(previous)) {
		return collapseRepeatedTranscriptTail(next);
	}
	if (previous.includes(next)) {
		return collapseRepeatedTranscriptTail(previous);
	}
	if (next.includes(previous)) {
		return collapseRepeatedTranscriptTail(next);
	}
	const maxOverlap = Math.min(previous.length, next.length);
	for (let overlap = maxOverlap; overlap > 1; overlap -= 1) {
		if (previous.slice(-overlap) === next.slice(0, overlap)) {
			return collapseRepeatedTranscriptTail(`${previous}${next.slice(overlap)}`);
		}
	}
	return collapseRepeatedTranscriptTail(`${previous}${next}`);
}

function collapseRepeatedTranscriptTail(text: string): string {
	const cleaned = text.trim();
	const maxUnitLength = Math.min(Math.floor(cleaned.length / 2), 80);
	for (let unitLength = maxUnitLength; unitLength > 3; unitLength -= 1) {
		const unit = cleaned.slice(-unitLength);
		if (!unit.trim()) {
			continue;
		}
		let prefix = cleaned.slice(0, -unitLength);
		let repeats = 1;
		while (prefix.endsWith(unit)) {
			repeats += 1;
			prefix = prefix.slice(0, -unitLength);
		}
		if (repeats > 1) {
			return collapseRepeatedTranscriptTail(`${prefix}${unit}`);
		}
	}
	return cleaned;
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
	if (existingLine.text.trim() === normalizedText && existingLine.time === line.time && existingLine.linkedBlockId === line.linkedBlockId && existingLine.ideaBlockStatus === line.ideaBlockStatus) {
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
						linkedBlockId: line.linkedBlockId ?? item.linkedBlockId,
						ideaBlockStatus: line.ideaBlockStatus ?? item.ideaBlockStatus
					}
				: item
		)
	);
}

function ideaBlockTranscriptLineIds(block: IdeaBlock): string[] {
	return [block.transcriptLineId, ...(block.sourceTranscriptIds ?? [])].filter((id): id is string => !!id);
}

function getIdeaBlockTranscriptLineIdsForBlockIds(blocks: IdeaBlock[], blockIds: Set<string>): Set<string> {
	const transcriptLineIds = new Set<string>();
	blocks.forEach(block => {
		if (!blockIds.has(block.id)) {
			return;
		}
		ideaBlockTranscriptLineIds(block).forEach(transcriptLineId => transcriptLineIds.add(transcriptLineId));
	});
	return transcriptLineIds;
}

function markTranscriptLinesIdeaBlockStatus(lines: TranscriptLineType[], transcriptLineIds: Set<string>, ideaBlockStatus: TranscriptLineType["ideaBlockStatus"]): TranscriptLineType[] {
	if (transcriptLineIds.size === 0) {
		return lines;
	}

	let didChange = false;
	const nextLines = lines.map(line => {
		if (line.source !== "private" || !transcriptLineIds.has(line.id) || line.ideaBlockStatus === ideaBlockStatus) {
			return line;
		}
		didChange = true;
		return {
			...line,
			ideaBlockStatus
		};
	});
	return didChange ? nextLines : lines;
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

function appendAudioCompletionSegmentIds(segmentIds: Set<string>, values: Array<string | number | null> | null | undefined): void {
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

function addAudioCompletionSegmentId(segmentIds: Set<string>, value: string | number | null | undefined): void {
	if (value == null) {
		return;
	}
	const segmentId = String(value).trim();
	if (segmentId) {
		segmentIds.add(segmentId);
	}
}

function completionTargetKeys(message: IdeaBlockCompletionTargetFields, participantId: string): string[] {
	const source = message.scope ?? message.mic_mode ?? message.local_mic_mode ?? "private";
	const userId = message.participant_id ?? message.userId ?? message.user_id ?? participantId;
	const segmentIds = new Set<string>();
	appendAudioCompletionSegmentIds(segmentIds, message.replace_segment_ids);
	appendAudioCompletionSegmentIds(segmentIds, message.client_segment_ids);
	appendAudioCompletionSegmentIds(segmentIds, message.transcript_segment_ids);
	appendAudioCompletionSegmentIds(segmentIds, message.segment_ids);
	addAudioCompletionSegmentId(segmentIds, message.replace_segment_id);
	addAudioCompletionSegmentId(segmentIds, message.client_segment_id);
	addAudioCompletionSegmentId(segmentIds, message.transcript_segment_id);
	addAudioCompletionSegmentId(segmentIds, message.segment_id);
	return Array.from(segmentIds, segmentId => [source, String(userId), segmentId].join("|"));
}

function activeCompletionTargetKey(message: IdeaBlockCompletionTargetFields, participantId: string): string {
	const source = message.scope ?? message.mic_mode ?? message.local_mic_mode ?? "private";
	const userId = message.participant_id ?? message.userId ?? message.user_id ?? participantId;
	return [source, String(userId), "active"].join("|");
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

function isMatchingPendingPublicChatMessage(pendingMessage: PublicChatMessage, confirmedMessage: PublicChatMessage): boolean {
	if (!pendingMessage.isPending || confirmedMessage.isPending) {
		return false;
	}

	if (pendingMessage.clientMessageId && confirmedMessage.clientMessageId) {
		return pendingMessage.clientMessageId === confirmedMessage.clientMessageId;
	}

	if (!pendingMessage.isOwn || !confirmedMessage.isOwn || pendingMessage.message.trim() !== confirmedMessage.message.trim()) {
		return false;
	}

	if (pendingMessage.userId && confirmedMessage.userId && pendingMessage.userId !== confirmedMessage.userId) {
		return false;
	}

	if (pendingMessage.timestampMs && confirmedMessage.timestampMs) {
		return Math.abs(confirmedMessage.timestampMs - pendingMessage.timestampMs) <= PUBLIC_CHAT_SEND_ACK_TIMEOUT_MS * 3;
	}

	return true;
}

function removePendingPublicChatMessage(messages: PublicChatMessage[], clientMessageId: string): PublicChatMessage[] {
	return messages.filter(message => message.clientMessageId !== clientMessageId || !message.isPending);
}

function appendPublicChatMessage(messages: PublicChatMessage[], message: PublicChatMessage): PublicChatMessage[] {
	const normalizedMessage = message.message.trim();
	if (!normalizedMessage) {
		return messages;
	}

	const existingMessage = messages.find(item => item.id === message.id);
	if (!existingMessage) {
		const pendingMessage = messages.find(item => isMatchingPendingPublicChatMessage(item, { ...message, message: normalizedMessage }));
		if (pendingMessage) {
			return sortPublicChatMessages(
				messages.map(item =>
					item.id === pendingMessage.id
						? {
								...message,
								clientMessageId: message.clientMessageId ?? item.clientMessageId,
								isPending: false,
								message: normalizedMessage,
								timestampMs: message.timestampMs ?? item.timestampMs
							}
						: item
				)
			);
		}

		return sortPublicChatMessages([...messages, { ...message, message: normalizedMessage }]);
	}

	return sortPublicChatMessages(
		messages.map(item =>
			item.id === existingMessage.id
				? {
						...item,
						...message,
						isPending: message.isPending ?? item.isPending,
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

				return blocks.map(block => {
					if (block.id !== nextBlock.id) {
						return block;
					}

					const isClearingPublicContext = nextBlock.publicContextRelevant === false;
					return {
						...block,
						...nextBlock,
						expanded: block.expanded,
						isUnread: block.isUnread || nextBlock.isUnread || (!!nextBlock.hasCue && !block.hasCue && !block.expanded),
						cueText: nextBlock.cueText ?? block.cueText,
						hasCue: nextBlock.hasCue ?? block.hasCue,
						similarityIsSameReason: nextBlock.similarityIsSameReason ?? block.similarityIsSameReason,
						similarityHasSameReason: nextBlock.similarityHasSameReason ?? block.similarityHasSameReason ?? false,
						similarityHasDifferentReason: nextBlock.similarityHasDifferentReason ?? block.similarityHasDifferentReason ?? false,
						publicContextRelevant: nextBlock.publicContextRelevant ?? block.publicContextRelevant,
						publicContextScore: isClearingPublicContext ? null : (nextBlock.publicContextScore ?? block.publicContextScore),
						publicContextReason: isClearingPublicContext ? undefined : (nextBlock.publicContextReason ?? block.publicContextReason),
						publicContextExpiresAtMs: isClearingPublicContext ? undefined : Math.max(block.publicContextExpiresAtMs ?? 0, nextBlock.publicContextExpiresAtMs ?? 0) || undefined,
						sharedReasons: mergeSharedReasons(block.sharedReasons, nextBlock.sharedReasons),
						createdAtMs: block.createdAtMs ?? nextBlock.createdAtMs
					};
				});
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
	const sameReasonCount = uniqueCues.filter(cue => getSimilarityCueReasonFlags(cue).hasSameReason).length;
	const differentReasonCount = uniqueCues.filter(cue => getSimilarityCueReasonFlags(cue).hasDifferentReason).length;
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

function getSimilarityCueReasonFlags(cue: SimilarityPairCueData): { hasSameReason: boolean; hasDifferentReason: boolean } {
	return {
		hasSameReason: cue.hasSameReason ?? cue.isSameReason !== false,
		hasDifferentReason: cue.hasDifferentReason ?? cue.isSameReason === false
	};
}

function resolveSimilarityCueReasonType(hasSameReason: boolean, hasDifferentReason: boolean, fallback?: boolean): boolean | undefined {
	if (hasDifferentReason && !hasSameReason) {
		return false;
	}
	if (hasSameReason && !hasDifferentReason) {
		return true;
	}
	return fallback;
}

function mergeSimilarityPairCue(existingCue: SimilarityPairCueData, incomingCue: SimilarityPairCueData): SimilarityPairCueData {
	const existingFlags = getSimilarityCueReasonFlags(existingCue);
	const incomingFlags = getSimilarityCueReasonFlags(incomingCue);
	const hasSameReason = existingFlags.hasSameReason || incomingFlags.hasSameReason;
	const hasDifferentReason = existingFlags.hasDifferentReason || incomingFlags.hasDifferentReason;
	return {
		...existingCue,
		...incomingCue,
		id: existingCue.id,
		hasSameReason,
		hasDifferentReason,
		isSameReason: resolveSimilarityCueReasonType(hasSameReason, hasDifferentReason, incomingCue.isSameReason ?? existingCue.isSameReason)
	};
}

function upsertSimilarityPairCue(cues: SimilarityPairCueData[], incomingCue: SimilarityPairCueData): SimilarityPairCueData[] {
	const existingIndex = cues.findIndex(cue => cue.id === incomingCue.id || cue.blockId === incomingCue.blockId);
	if (existingIndex < 0) {
		return [...cues, incomingCue];
	}
	return cues.map((cue, index) => (index === existingIndex ? mergeSimilarityPairCue(cue, incomingCue) : cue));
}

function buildDuplicateIdeaBlockNotice(block: IdeaBlock): IdeaBlockNotice {
	const blockTitle = (block.aiSummary || block.summary).trim() || "既有想法";
	const message = `已找到相似的既有想法：「${blockTitle}」`;

	return {
		id: `duplicate-${block.id}-${Date.now()}`,
		blockId: block.id,
		title: "這個 idea block 已存在",
		message
	};
}

function buildMissingIdeaBlockJumpTargetNotice(cue: SimilarityPairCueData): IdeaBlockNotice {
	return {
		id: `missing-jump-target-${cue.blockId}-${Date.now()}`,
		title: "找不到可以查看的想法",
		message: "這個提示指向的 idea block 尚未載入或已移除，請稍後重新整理 Idea Blocks。"
	};
}

function buildSimilarityReasonShareNotice(payload: SimilarityReasonShareSentData): IdeaBlockNotice {
	const deliveredCount = typeof payload.deliveredCount === "number" ? payload.deliveredCount : payload.recipientCount;
	const message =
		deliveredCount == null || deliveredCount === 1 ? "已分享我的理由給另一個人" : deliveredCount > 1 ? `已分享我的理由給 ${deliveredCount} 個人` : "已送出分享，但目前沒有送達在線上的對象";

	return {
		id: `similarity-reason-share-${payload.blockId}-${Date.now()}`,
		blockId: payload.blockId,
		title: "已分享我的理由",
		message
	};
}

function formatSimilarityReasonShareError(reason: string | undefined): string {
	switch (reason) {
		case "similarity cues are disabled":
			return "目前相似提示已關閉，不能分享理由";
		case "invalid idea block":
			return "找不到可分享的 idea block";
		case "similar idea block not found":
			return "這個 idea block 已不存在或不屬於目前參與者";
		case "recipient idea blocks not found":
			return "沒有可接收分享的相似想法對象";
		default:
			return reason || "分享理由失敗";
	}
}

function buildSimilarityReasonShareErrorNotice(message: SimilarityReasonShareErrorMessage): IdeaBlockNotice {
	const blockId = message.blockId ?? message.block_id;
	return {
		id: `similarity-reason-share-error-${blockId ?? "unknown"}-${Date.now()}`,
		blockId: blockId == null ? undefined : String(blockId),
		title: "無法分享理由",
		message: formatSimilarityReasonShareError(message.reason)
	};
}

function applyPublicContextMatches(blocks: IdeaBlock[], payload: PublicContextMatchesPayload): IdeaBlock[] {
	const matches = Array.isArray(payload.matches) ? payload.matches : [];
	const replaceExisting = payload.replaceExisting !== false;
	if (matches.length === 0 && !replaceExisting) {
		return blocks;
	}
	const matchesByBlockId = new Map<string, PublicContextMatchPayload>();
	for (const match of matches) {
		if (match.ideaBlockId == null) {
			continue;
		}
		matchesByBlockId.set(String(match.ideaBlockId), match);
	}
	if (matchesByBlockId.size === 0) {
		if (!replaceExisting) {
			return blocks;
		}
		return blocks.map(block => {
			if (!block.publicContextRelevant) {
				return block;
			}
			return {
				...block,
				publicContextRelevant: false,
				publicContextScore: null,
				publicContextReason: undefined,
				publicContextExpiresAtMs: undefined
			};
		});
	}

	return blocks.map(block => {
		const match = matchesByBlockId.get(block.id);
		if (!match || block.isDeleted) {
			if (!replaceExisting || !block.publicContextRelevant) {
				return block;
			}
			return {
				...block,
				publicContextRelevant: false,
				publicContextScore: null,
				publicContextReason: undefined,
				publicContextExpiresAtMs: undefined
			};
		}
		return {
			...block,
			isUnread: true,
			publicContextRelevant: true,
			publicContextScore: typeof match.score === "number" ? match.score : null,
			publicContextReason: typeof match.reason === "string" ? match.reason : undefined,
			publicContextExpiresAtMs: undefined
		};
	});
}

function isDuplicateIdeaBlockResponse(response: IdeaBlockResponse): boolean {
	return response.is_duplicate === true || response.duplicate_of_id != null;
}

function sortIdeaBlocks(blocks: IdeaBlock[]): IdeaBlock[] {
	return [...blocks].sort((left, right) => {
		if (!!left.isDeleted !== !!right.isDeleted) {
			return left.isDeleted ? 1 : -1;
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
	return linkTranscriptLinesToReadyBlocks(lines, blocks);
}

function TranscriptLines({
	lines,
	emptyText,
	onJumpToBlock,
	ideaBlocks,
	onTranscriptRef,
	highlightedTranscriptId
}: {
	lines: TranscriptLineType[];
	emptyText: string;
	onJumpToBlock?: (blockId: string) => void;
	ideaBlocks: IdeaBlock[];
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
					<TranscriptLine
						line={line}
						onJumpToBlock={onJumpToBlock}
						ideaBlockStatus={getTranscriptIdeaBlockStatus(line, ideaBlocks)}
						ideaBlockTargetId={getTranscriptIdeaBlockTargetId(line, ideaBlocks)}
					/>
				</div>
			))}
		</div>
	);
}

function IdeaBlockChatShareCueContent({
	notices,
	onView,
	onRetry,
	onDismiss
}: {
	notices: IdeaBlockChatShareNotice[];
	onView: (noticeId: string) => void;
	onRetry: (notice: IdeaBlockChatShareNotice) => void;
	onDismiss: (noticeId: string) => void;
}) {
	useEffect(() => {
		const timers = notices.filter(notice => notice.status !== "sending").map(notice => window.setTimeout(() => onDismiss(notice.id), NOTIFICATION_AUTO_DISMISS_MS));
		return () => timers.forEach(timer => window.clearTimeout(timer));
	}, [notices, onDismiss]);

	if (notices.length === 0) {
		return null;
	}

	return (
		<>
			{notices.map(notice => {
				const title = notice.status === "sending" ? "正在送到聊天室" : notice.status === "failed" ? "傳送失敗" : "已送到聊天室";
				const ideaBlockMessage = parseIdeaBlockChatMessage(notice.message);
				const preview = ideaBlockMessage ? `Idea block：${ideaBlockMessage.title}` : notice.message.trim();
				return (
					<div className="animate-in slide-in-from-right-4 fade-in-0 rounded-lg border bg-background p-3 shadow-lg" key={notice.id} role="status" aria-live="polite">
						<div className="mb-3 flex items-start gap-2 text-sm">
							{notice.status === "sending" ? (
								<Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
							) : notice.status === "failed" ? (
								<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
							) : (
								<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
							)}
							<div className="grid min-w-0 gap-2">
								<span className="font-medium">{title}</span>
								<div className="truncate rounded-md bg-muted px-2 py-1.5 text-xs leading-5 text-muted-foreground" title={preview}>
									{preview}
								</div>
							</div>
						</div>
						<div className="flex flex-wrap justify-end gap-2">
							{notice.status === "sent" && (
								<Button className="gap-1.5" size="sm" onClick={() => onView(notice.id)}>
									<Eye className="h-3.5 w-3.5" />
									查看
								</Button>
							)}
							{notice.status === "failed" && (
								<Button className="gap-1.5" size="sm" onClick={() => onRetry(notice)}>
									<RotateCcw className="h-3.5 w-3.5" />
									重試
								</Button>
							)}
							<Button aria-label="Dismiss idea block chat notification" size="icon" variant="ghost" onClick={() => onDismiss(notice.id)}>
								<X className="h-4 w-4" />
							</Button>
						</div>
					</div>
				);
			})}
		</>
	);
}

export const PrivateBoard = forwardRef<PrivateBoardHandle, PrivateBoardProps>(function PrivateBoard(
	{
		sessionId,
		participantId,
		lastMessage,
		lastAudioMessage,
		isConnected,
		micMode,
		onSendBoardMessage,
		displayName,
		currentPhase: controlledPhase,
		timerEndTime: controlledTimerEndTime,
		onCollapse,
		isCollapsed = false,
		onRequestOpen,
		onIdeaBlockUnreadStateChange,
		onPublicChatUnreadCountChange
	},
	ref
) {
	const [activeTab, setActiveTab] = useState<BoardTab>("ideablock");
	const [currentPhase, setCurrentPhase] = useState<SessionPhase>(DEFAULT_SESSION_PHASE);
	const [cueCondition, setCueCondition] = useState<CueCondition>("experimental");
	const [timerEndTime, setTimerEndTime] = useState<number>(0);
	const visiblePhase = controlledPhase ?? currentPhase;
	const visibleTimerEndTime = controlledTimerEndTime ?? timerEndTime;
	const canShowSimilarityCues = cueCondition === "experimental";
	const visibleActiveTab = activeTab;
	const [ideaBlocks, setIdeaBlocks] = useState<IdeaBlock[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_IDEA_BLOCKS : []);
	const [transcriptLines, setTranscriptLines] = useState<TranscriptLineType[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_TRANSCRIPT_LINES : []);
	const [publicChatMessages, setPublicChatMessages] = useState<PublicChatMessage[]>([]);
	const [ideaBlockRefreshKey, setIdeaBlockRefreshKey] = useState(0);
	const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
	const [highlightedTranscriptId, setHighlightedTranscriptId] = useState<string | null>(null);
	const [manualIdeaText, setManualIdeaText] = useState("");
	const [manualIdeaError, setManualIdeaError] = useState<string | null>(null);
	const [ideaBlockNotice, setIdeaBlockNotice] = useState<IdeaBlockNotice | null>(null);
	const [ideaBlockChatShareNotices, setIdeaBlockChatShareNotices] = useState<IdeaBlockChatShareNotice[]>([]);
	const [publicChatText, setPublicChatText] = useState("");
	const [publicChatError, setPublicChatError] = useState<string | null>(null);
	const [isSendingPublicChat, setIsSendingPublicChat] = useState(false);
	const [cues, setCues] = useState<SimilarityCueData[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_SIMILARITY_CUES : []);
	const [unreadPublicChatCount, setUnreadPublicChatCount] = useState(0);
	const [whisperTransient, setWhisperTransient] = useState<WhisperTransient>({ status: "idle", text: "" });
	const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
	const previousIdeaBlockTopsRef = useRef<Record<string, number>>({});
	const transcriptRefs = useRef<Record<string, HTMLDivElement | null>>({});
	const manualIdeaTextareaRef = useRef<HTMLTextAreaElement | null>(null);
	const publicChatTextareaRef = useRef<HTMLTextAreaElement | null>(null);
	const ideaBlocksRef = useRef<IdeaBlock[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_IDEA_BLOCKS : []);
	const activeTranscriptDraftsRef = useRef<Map<string, { id: string; text: string; source?: TranscriptLineType["source"]; userId?: string; timestampMs?: number; isFinal?: boolean }>>(new Map());
	const publicChatMessagesRef = useRef<PublicChatMessage[]>([]);
	const pendingIdeaBlockChatSharesRef = useRef<PendingIdeaBlockChatShare[]>([]);
	const voiceGeneratingBlocksRef = useRef<Map<string, Set<string>>>(new Map());
	const voiceGeneratingTimeoutsRef = useRef<Map<string, number>>(new Map());
	const transcriptScrollViewportRef = useRef<HTMLDivElement | null>(null);
	const ideaBlocksScrollViewportRef = useRef<HTMLDivElement | null>(null);
	const publicChatScrollViewportRef = useRef<HTMLDivElement | null>(null);
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
	const lastProcessedProvisionalIdeaBlocksUpdateMessageRef = useRef<object | null>(null);
	const lastDisplayedAudioTranscriptRef = useRef<{ signature: string; displayedAt: number } | null>(null);
	const unreadIdeaBlockIdsFromRefreshRef = useRef<Set<string>>(new Set());
	const lastVisibleActiveTabRef = useRef<BoardTab>(visibleActiveTab);
	const shouldAutoScrollRef = useRef<Record<BoardTab, boolean>>({
		transcript: true,
		ideablock: true,
		"public-chat": true
	});
	const sendSimilarityCueResponse = useCallback(
		(cue: { id?: string; cueId?: string; blockId?: string | number | null }, response: SimilarityCueResponseStatus) => {
			const cueId = cue.cueId || cue.id;
			if (!cueId) {
				return;
			}
			onSendBoardMessage({
				type: "similarity_cue_response",
				cueId,
				blockId: cue.blockId ?? null,
				response,
				timestampMs: Date.now()
			});
		},
		[onSendBoardMessage]
	);
	const markSimilarityCueResponse = useCallback((target: { id?: string; cueId?: string; blockId?: string | number | null }, responseStatus: SimilarityCueTerminalResponseStatus) => {
		const targetCueId = target.cueId || target.id;
		const targetBlockId = target.blockId == null ? null : String(target.blockId);
		const nextCues = cuesRef.current.map(cue => {
			if (!isSimilarityPairCue(cue)) {
				return cue;
			}
			const cueIdMatches = !!targetCueId && (cue.id === targetCueId || cue.cueId === targetCueId);
			const blockIdMatches = !!targetBlockId && cue.blockId === targetBlockId;
			return cueIdMatches || blockIdMatches ? { ...cue, responseStatus } : cue;
		});
		cuesRef.current = nextCues;
		setCues(nextCues);
	}, []);
	const queueSimilarityCueFromBlock = useCallback(
		(block: IdeaBlock) => {
			if (!canShowSimilarityCues) {
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
				const nextCues = alreadyQueued
					? prev.map(item => (isSimilarityPairCue(item) && (item.id === cue.id || item.blockId === cue.blockId) ? mergeSimilarityPairCue(item, cue) : item))
					: [...prev, cue];
				console.info("[private-board] similarity cue fallback detected", {
					blockId: cue.blockId,
					isSameReason: cue.isSameReason,
					hasSameReason: cue.hasSameReason,
					hasDifferentReason: cue.hasDifferentReason,
					alreadyQueued,
					currentBlockExpanded: !!currentBlock?.expanded
				});
				cuesRef.current = nextCues;
				return nextCues;
			});
		},
		[canShowSimilarityCues, cueCondition]
	);

	const isIdeaBlocksTabActive = visibleActiveTab === "ideablock";
	const ideaBlockUnreadState = useMemo(() => getIdeaBlockUnreadState(ideaBlocks), [ideaBlocks]);
	const displayedIdeaBlocks = useMemo(() => getDisplayedIdeaBlocks(ideaBlocks), [ideaBlocks]);
	const unreadIdeaBlockCount = ideaBlockUnreadState.count;
	const latestUnreadIdeaBlockId = ideaBlockUnreadState.latestBlockId;

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

	const clearSimilarityPairCuesSoon = useCallback(() => {
		window.setTimeout(() => {
			const previousCues = cuesRef.current;
			getUnrespondedSimilarityPairCues(previousCues).forEach(cue => sendSimilarityCueResponse(cue, "ignored"));
			const nextCues = removeSimilarityPairCues(previousCues);
			cuesRef.current = nextCues;
			setCues(nextCues);
		}, 0);
	}, [sendSimilarityCueResponse]);

	const syncPhaseTransitionCueBatch = useCallback(
		(nextPhase: SessionPhase) => {
			const previousPhase = previousVisiblePhaseRef.current;
			const isEnteringSimilarityCueDisplayPhase = !isSimilarityCueDisplayPhase(previousPhase) && isSimilarityCueDisplayPhase(nextPhase);
			const isLeavingSimilarityCueDisplayPhase = isSimilarityCueDisplayPhase(previousPhase) && !isSimilarityCueDisplayPhase(nextPhase);

			if (isEnteringSimilarityCueDisplayPhase && canShowSimilarityCues) {
				const queuedPrivatePhaseCues = cuesRef.current.filter(isSimilarityPairCue);
				clearCuesSoon();
				startPhaseTransitionCueBatch(queuedPrivatePhaseCues);
			}

			if (isLeavingSimilarityCueDisplayPhase || !canShowSimilarityCues) {
				clearPhaseTransitionCueBatchTimer();
				phaseTransitionCueBatchRef.current = null;
				if (!canShowSimilarityCues) {
					clearCuesSoon();
				} else if (isLeavingSimilarityCueDisplayPhase) {
					clearSimilarityPairCuesSoon();
				}
			}

			previousVisiblePhaseRef.current = nextPhase;
		},
		[canShowSimilarityCues, clearCuesSoon, clearPhaseTransitionCueBatchTimer, clearSimilarityPairCuesSoon, startPhaseTransitionCueBatch]
	);

	const markIdeaBlocksRead = useCallback((blockIds: Set<string>) => {
		if (blockIds.size === 0) {
			return;
		}
		blockIds.forEach(blockId => {
			unreadIdeaBlockIdsFromRefreshRef.current.delete(blockId);
		});
		setIdeaBlocks(prev => {
			let didChange = false;
			const nextBlocks = prev.map(block => {
				if (!blockIds.has(block.id) || !block.isUnread) {
					return block;
				}
				didChange = true;
				return { ...block, isUnread: false };
			});
			if (!didChange) {
				return prev;
			}
			ideaBlocksRef.current = nextBlocks;
			return nextBlocks;
		});
	}, []);

	const selectBoardTab = useCallback((tab: BoardTab) => {
		if (tab === "public-chat") {
			setUnreadPublicChatCount(0);
		}
		setActiveTab(tab);
	}, []);

	const canJumpToRenderedBlock = useCallback((blockId: string) => hasIdeaBlockJumpTarget(ideaBlocks, blockId), [ideaBlocks]);
	const canJumpToBlock = useCallback((blockId: string) => hasIdeaBlockJumpTarget(ideaBlocksRef.current, blockId), []);

	const jumpToBlock = useCallback(
		(blockId: string) => {
			if (!canJumpToBlock(blockId)) {
				return false;
			}

			onRequestOpen?.();
			selectBoardTab("ideablock");
			setHighlightedBlockId(blockId);
			markIdeaBlocksRead(new Set([blockId]));
			return true;
		},
		[canJumpToBlock, markIdeaBlocksRead, onRequestOpen, selectBoardTab]
	);

	const openLatestUnreadIdeaBlock = useCallback(() => {
		const targetBlockId = latestUnreadIdeaBlockId ?? getIdeaBlockUnreadState(ideaBlocksRef.current).latestBlockId;
		onRequestOpen?.();
		selectBoardTab("ideablock");
		if (!targetBlockId) {
			return;
		}
		setHighlightedBlockId(targetBlockId);
		markIdeaBlocksRead(new Set([targetBlockId]));
	}, [latestUnreadIdeaBlockId, markIdeaBlocksRead, onRequestOpen, selectBoardTab]);

	const openPublicChat = useCallback(() => {
		onRequestOpen?.();
		selectBoardTab("public-chat");
	}, [onRequestOpen, selectBoardTab]);

	const markVisiblePublicChatRead = useCallback(() => {
		if (shouldClearPublicChatUnreadCount({ activeTab: visibleActiveTab, isCollapsed: false })) {
			setUnreadPublicChatCount(0);
		}
	}, [visibleActiveTab]);

	useImperativeHandle(ref, () => ({ openLatestUnreadIdeaBlock, openPublicChat, markVisiblePublicChatRead }), [openLatestUnreadIdeaBlock, openPublicChat, markVisiblePublicChatRead]);

	useEffect(() => {
		onIdeaBlockUnreadStateChange?.(ideaBlockUnreadState);
	}, [ideaBlockUnreadState, onIdeaBlockUnreadStateChange]);

	useEffect(() => {
		onPublicChatUnreadCountChange?.(unreadPublicChatCount);
	}, [onPublicChatUnreadCountChange, unreadPublicChatCount]);

	const dismissIdeaBlockChatShareNotice = useCallback((noticeId: string) => {
		setIdeaBlockChatShareNotices(prev => prev.filter(notice => notice.id !== noticeId));
	}, []);

	const viewIdeaBlockChatShareNotice = useCallback(
		(noticeId: string) => {
			onRequestOpen?.();
			selectBoardTab("public-chat");
			setIdeaBlockChatShareNotices(prev => prev.filter(notice => notice.id !== noticeId));
		},
		[onRequestOpen, selectBoardTab]
	);

	const queueIdeaBlockChatShareNotice = useCallback((message: string, noticeId = createClientNoticeId("idea-block-chat-share")) => {
		const attemptId = createClientNoticeId("idea-block-chat-share-attempt");
		pendingIdeaBlockChatSharesRef.current = [...pendingIdeaBlockChatSharesRef.current.filter(pendingShare => pendingShare.noticeId !== noticeId), { noticeId, message, attemptId }];
		setIdeaBlockChatShareNotices(prev =>
			[
				...prev.filter(notice => notice.id !== noticeId),
				{
					id: noticeId,
					message,
					status: "sending" as const
				}
			].slice(-3)
		);
		window.setTimeout(() => {
			const pendingShare = pendingIdeaBlockChatSharesRef.current.find(item => item.noticeId === noticeId && item.attemptId === attemptId);
			if (!pendingShare) {
				return;
			}
			pendingIdeaBlockChatSharesRef.current = pendingIdeaBlockChatSharesRef.current.filter(item => item.noticeId !== noticeId || item.attemptId !== attemptId);
			setIdeaBlockChatShareNotices(prev => prev.map(notice => (notice.id === noticeId ? { ...notice, status: "failed" } : notice)));
		}, IDEA_BLOCK_CHAT_SHARE_ACK_TIMEOUT_MS);
		return noticeId;
	}, []);

	const clearVoiceGeneratingTimeoutsByIds = useCallback((blockIds: Set<string>) => {
		blockIds.forEach(blockId => {
			const timeoutId = voiceGeneratingTimeoutsRef.current.get(blockId);
			if (timeoutId != null) {
				window.clearTimeout(timeoutId);
				voiceGeneratingTimeoutsRef.current.delete(blockId);
			}
		});
	}, []);

	const removeVoiceGeneratingBlockIdsFromRegistry = useCallback((blockIds: Set<string>) => {
		if (blockIds.size === 0) {
			return;
		}
		for (const [segmentKey, segmentBlockIds] of voiceGeneratingBlocksRef.current.entries()) {
			blockIds.forEach(blockId => segmentBlockIds.delete(blockId));
			if (segmentBlockIds.size === 0) {
				voiceGeneratingBlocksRef.current.delete(segmentKey);
			}
		}
	}, []);

	const takeVoiceGeneratingBlockIds = useCallback(
		(segmentKeys: string[]) => {
			const blockIds = new Set<string>();
			segmentKeys.forEach(segmentKey => {
				const segmentBlockIds = voiceGeneratingBlocksRef.current.get(segmentKey);
				if (!segmentBlockIds) {
					return;
				}

				voiceGeneratingBlocksRef.current.delete(segmentKey);
				segmentBlockIds.forEach(blockId => blockIds.add(blockId));
			});
			if (blockIds.size > 0) {
				for (const [segmentKey, segmentBlockIds] of voiceGeneratingBlocksRef.current.entries()) {
					blockIds.forEach(blockId => segmentBlockIds.delete(blockId));
					if (segmentBlockIds.size === 0) {
						voiceGeneratingBlocksRef.current.delete(segmentKey);
					}
				}
			}
			clearVoiceGeneratingTimeoutsByIds(blockIds);
			return blockIds;
		},
		[clearVoiceGeneratingTimeoutsByIds]
	);

	const registerVoiceGeneratingBlockIds = useCallback((segmentKeys: string[], blockIds: string[]) => {
		if (segmentKeys.length === 0 || blockIds.length === 0) {
			return;
		}

		segmentKeys.forEach(segmentKey => {
			const nextIds = new Set(voiceGeneratingBlocksRef.current.get(segmentKey) ?? []);
			blockIds.forEach(blockId => nextIds.add(blockId));
			voiceGeneratingBlocksRef.current.set(segmentKey, nextIds);
		});
	}, []);

	const resolveActiveCompletionSegmentKeys = useCallback(
		(message: IdeaBlockCompletionTargetFields) => {
			const baseCompletionSegmentKeys = completionTargetKeys(message, participantId);
			const activeCompletionKey = activeCompletionTargetKey(message, participantId);
			const hasMatchingCompletionKey = baseCompletionSegmentKeys.some(segmentKey => voiceGeneratingBlocksRef.current.has(segmentKey));
			if (!hasMatchingCompletionKey && activeCompletionKey && voiceGeneratingBlocksRef.current.has(activeCompletionKey)) {
				return [...baseCompletionSegmentKeys, activeCompletionKey];
			}
			return baseCompletionSegmentKeys;
		},
		[participantId]
	);

	const isCurrentWhisperSegmentComplete = useCallback((current: WhisperTransient, segmentKeys: string[]) => {
		if (current.status !== "generating") {
			return false;
		}

		return !!current.segmentKey && segmentKeys.includes(current.segmentKey);
	}, []);

	const removeVoiceGeneratingBlocksByIds = useCallback(
		(blockIds: Set<string>) => {
			if (blockIds.size === 0) {
				return;
			}

			clearVoiceGeneratingTimeoutsByIds(blockIds);
			removeVoiceGeneratingBlockIdsFromRegistry(blockIds);
			setIdeaBlocks(prev => {
				const nextBlocks = prev.filter(block => !blockIds.has(block.id));
				if (nextBlocks.length === prev.length) {
					return prev;
				}
				const sortedBlocks = sortIdeaBlocks(nextBlocks);
				ideaBlocksRef.current = sortedBlocks;
				return sortedBlocks;
			});
		},
		[clearVoiceGeneratingTimeoutsByIds, removeVoiceGeneratingBlockIdsFromRegistry]
	);

	const clearAllVoiceGeneratingBlocks = useCallback(() => {
		const blockIds = new Set<string>();
		for (const segmentBlockIds of voiceGeneratingBlocksRef.current.values()) {
			segmentBlockIds.forEach(blockId => blockIds.add(blockId));
		}
		voiceGeneratingBlocksRef.current.clear();
		removeVoiceGeneratingBlocksByIds(blockIds);
		setWhisperTransient({ status: "idle", text: "" });
	}, [removeVoiceGeneratingBlocksByIds]);

	const markTranscriptIdeaBlockStatusByLineIds = useCallback((transcriptLineIds: Set<string>, ideaBlockStatus: TranscriptLineType["ideaBlockStatus"]) => {
		setTranscriptLines(prev => markTranscriptLinesIdeaBlockStatus(prev, transcriptLineIds, ideaBlockStatus));
	}, []);

	const markTranscriptIdeaBlockStatusByBlockIds = useCallback((blockIds: Set<string>, ideaBlockStatus: TranscriptLineType["ideaBlockStatus"]) => {
		const transcriptLineIds = getIdeaBlockTranscriptLineIdsForBlockIds(ideaBlocksRef.current, blockIds);
		if (transcriptLineIds.size === 0) {
			return;
		}
		setTranscriptLines(prev => markTranscriptLinesIdeaBlockStatus(prev, transcriptLineIds, ideaBlockStatus));
	}, []);

	const getTranscriptLineIdsForDraftKeys = useCallback((segmentKeys: string[]) => {
		const transcriptLineIds = new Set<string>();
		segmentKeys.forEach(segmentKey => {
			const draft = activeTranscriptDraftsRef.current.get(segmentKey);
			if (draft?.id) {
				transcriptLineIds.add(draft.id);
			}
		});
		return transcriptLineIds;
	}, []);

	const scheduleVoiceGeneratingTimeout = useCallback(
		(segmentKey: string, blockId: string) => {
			clearVoiceGeneratingTimeoutsByIds(new Set([blockId]));
			const timeoutId = window.setTimeout(() => {
				markTranscriptIdeaBlockStatusByBlockIds(new Set([blockId]), "failed");
				removeVoiceGeneratingBlockIdsFromRegistry(new Set([blockId]));
				removeVoiceGeneratingBlocksByIds(new Set([blockId]));
				setWhisperTransient(current => (current.segmentKey === segmentKey ? { status: "idle", text: "" } : current));
				console.info("[private-board] voice generating block timed out", { segmentKey, blockId, timeoutMs: VOICE_GENERATING_TIMEOUT_MS });
			}, VOICE_GENERATING_TIMEOUT_MS);
			voiceGeneratingTimeoutsRef.current.set(blockId, timeoutId);
		},
		[clearVoiceGeneratingTimeoutsByIds, markTranscriptIdeaBlockStatusByBlockIds, removeVoiceGeneratingBlockIdsFromRegistry, removeVoiceGeneratingBlocksByIds]
	);

	const queueVoiceGeneratingIdeaBlock = useCallback(
		({ segmentKey, text, transcriptLineId, timestampMs }: { segmentKey: string; text: string; transcriptLineId?: string; timestampMs?: number }) => {
			const normalizedText = text.trim();
			if (!normalizedText) {
				return;
			}

			const existingBlockIds = voiceGeneratingBlocksRef.current.get(segmentKey);
			const existingBlockId = existingBlockIds ? Array.from(existingBlockIds)[0] : undefined;
			const blockId = existingBlockId ?? `${VOICE_GENERATING_ID_PREFIX}-${normalizeClientIdPart(segmentKey)}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			voiceGeneratingBlocksRef.current.set(segmentKey, new Set([...(existingBlockIds ?? []), blockId]));
			scheduleVoiceGeneratingTimeout(segmentKey, blockId);
			const generatingBlock = createGeneratingIdeaBlock(normalizedText, {
				id: blockId,
				transcript: normalizedText,
				transcriptLineId,
				createdAtMs: timestampMs
			});
			if (transcriptLineId) {
				markTranscriptIdeaBlockStatusByLineIds(new Set([transcriptLineId]), "pending");
			}

			setIdeaBlocks(prev => {
				const nextBlocks = sortIdeaBlocks(
					prev.some(block => block.id === blockId)
						? prev.map(block =>
								block.id === blockId
									? {
											...block,
											...generatingBlock,
											isUnread: block.isUnread,
											createdAtMs: block.createdAtMs ?? generatingBlock.createdAtMs
										}
									: block
							)
						: [...prev, generatingBlock]
				);
				ideaBlocksRef.current = nextBlocks;
				return nextBlocks;
			});
		},
		[markTranscriptIdeaBlockStatusByLineIds, scheduleVoiceGeneratingTimeout]
	);

	useEffect(() => {
		if (whisperTransient.status !== "generating" || !whisperTransient.text.trim()) {
			return;
		}

		const segmentKey = whisperTransient.segmentKey;
		const timer = window.setTimeout(() => {
			setWhisperTransient(current => {
				if (current.status !== "generating" || current.segmentKey !== segmentKey) {
					return current;
				}
				return {
					...current,
					text: ""
				};
			});
		}, WHISPER_FINAL_TEXT_HOLD_MS);

		return () => window.clearTimeout(timer);
	}, [whisperTransient.segmentKey, whisperTransient.status, whisperTransient.text]);

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

			if (event.code === "Digit2") {
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
	}, [focusActiveComposer, selectBoardTab]);

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
		publicChatMessagesRef.current = publicChatMessages;
	}, [publicChatMessages]);

	useEffect(() => {
		cuesRef.current = cues;
	}, [cues]);

	useEffect(() => {
		const voiceGeneratingTimeouts = voiceGeneratingTimeoutsRef.current;
		const voiceGeneratingBlocks = voiceGeneratingBlocksRef.current;
		return () => {
			clearPhaseTransitionCueBatchTimer();
			phaseTransitionCueBatchRef.current = null;
			voiceGeneratingTimeouts.forEach(timeoutId => window.clearTimeout(timeoutId));
			voiceGeneratingTimeouts.clear();
			voiceGeneratingBlocks.clear();
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
				clearAllVoiceGeneratingBlocks();
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
	}, [clearAllVoiceGeneratingBlocks, lastMessage, syncPhaseTransitionCueBatch]);

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
				const failedPendingMessage = lastMessage.clientMessageId
					? publicChatMessagesRef.current.find(message => message.clientMessageId === lastMessage.clientMessageId && message.isPending)
					: publicChatMessagesRef.current.find(message => message.isOwn && message.isPending);
				if (failedPendingMessage?.clientMessageId) {
					setPublicChatMessages(prev => {
						const nextMessages = removePendingPublicChatMessage(prev, failedPendingMessage.clientMessageId || "");
						setIsSendingPublicChat(nextMessages.some(message => message.isOwn && message.isPending));
						return nextMessages;
					});
					if (!parseIdeaBlockChatMessage(failedPendingMessage.message)) {
						setPublicChatText(current => current || failedPendingMessage.message);
					}
				} else {
					setIsSendingPublicChat(publicChatMessagesRef.current.some(message => message.isOwn && message.isPending));
				}
				setPublicChatError(lastMessage.reason || "公開訊息傳送失敗");
				const failedShare = pendingIdeaBlockChatSharesRef.current[0];
				if (failedShare) {
					pendingIdeaBlockChatSharesRef.current = pendingIdeaBlockChatSharesRef.current.filter(item => item.noticeId !== failedShare.noticeId);
					setIdeaBlockChatShareNotices(prev => prev.map(notice => (notice.id === failedShare.noticeId ? { ...notice, status: "failed" } : notice)));
				}
				return;
			}

			if (lastMessage.type === "new_idea_block") {
				const nextBlock = boardIdeaBlockPayloadToBlock(lastMessage.payload);
				const completionSegmentKeys = resolveActiveCompletionSegmentKeys(lastMessage);
				const pendingVoiceBlockIds = completionSegmentKeys.length > 0 ? takeVoiceGeneratingBlockIds(completionSegmentKeys) : new Set<string>();
				const removePendingVoiceBlocks = (blocks: IdeaBlock[]) => (pendingVoiceBlockIds.size === 0 ? blocks : blocks.filter(block => !pendingVoiceBlockIds.has(block.id)));
				if (completionSegmentKeys.length > 0) {
					setWhisperTransient(current => (isCurrentWhisperSegmentComplete(current, completionSegmentKeys) ? { status: "idle", text: "" } : current));
				}
				unreadIdeaBlockIdsFromRefreshRef.current.add(nextBlock.id);
				setIdeaBlocks(prev => {
					const baseBlocks = removePendingVoiceBlocks(prev);
					const nextBlocks = mergeIdeaBlocks(baseBlocks, [{ ...nextBlock, isUnread: true }], { markNewUnread: true });
					ideaBlocksRef.current = nextBlocks;
					return nextBlocks;
				});
				setIdeaBlockRefreshKey(current => current + 1);
			}

			if (lastMessage.type === "update_idea_block") {
				const completionSegmentKeys = resolveActiveCompletionSegmentKeys(lastMessage);
				const pendingVoiceBlockIds = completionSegmentKeys.length > 0 ? takeVoiceGeneratingBlockIds(completionSegmentKeys) : new Set<string>();
				const updatedBlock = boardIdeaBlockUpdatePayloadToBlock(lastMessage.payload);
				const removePendingVoiceBlocks = (blocks: IdeaBlock[]) => (pendingVoiceBlockIds.size === 0 ? blocks : blocks.filter(block => !pendingVoiceBlockIds.has(block.id)));
				if (completionSegmentKeys.length > 0) {
					setWhisperTransient(current => (isCurrentWhisperSegmentComplete(current, completionSegmentKeys) ? { status: "idle", text: "" } : current));
				}
				if (pendingVoiceBlockIds.size > 0 || updatedBlock) {
					setIdeaBlocks(prev => {
						const baseBlocks = removePendingVoiceBlocks(prev);
						const nextBlocks = updatedBlock ? mergeIdeaBlocks(baseBlocks, [updatedBlock]) : sortIdeaBlocks(baseBlocks);
						ideaBlocksRef.current = nextBlocks;
						return nextBlocks;
					});
				}
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
				if (!canShowSimilarityCues) {
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
				const hasSameReason = cueTargetBlock?.similarityHasSameReason || lastMessage.payload.isSameReason === true;
				const hasDifferentReason = cueTargetBlock?.similarityHasDifferentReason || lastMessage.payload.isSameReason === false;
				const incomingCue: SimilarityPairCueData = {
					...lastMessage.payload,
					hasSameReason,
					hasDifferentReason,
					isSameReason: resolveSimilarityCueReasonType(hasSameReason, hasDifferentReason, lastMessage.payload.isSameReason)
				};
				sendSimilarityCueResponse(incomingCue, "shown");
				if (!cueTargetBlock?.expanded) {
					unreadIdeaBlockIdsFromRefreshRef.current.add(lastMessage.payload.blockId);
				}
				if (phaseTransitionCueBatchRef.current) {
					phaseTransitionCueBatchRef.current.cues = upsertSimilarityPairCue(phaseTransitionCueBatchRef.current.cues, incomingCue);
				} else {
					const nextCues = cuesRef.current.some(cue => cue.id === incomingCue.id || (isSimilarityPairCue(cue) && cue.blockId === incomingCue.blockId))
						? cuesRef.current.map(cue => (isSimilarityPairCue(cue) && (cue.id === incomingCue.id || cue.blockId === incomingCue.blockId) ? mergeSimilarityPairCue(cue, incomingCue) : cue))
						: [...cuesRef.current, incomingCue];
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
				if (matchedIds.size > 0 || lastMessage.payload.replaceExisting === true) {
					matchedIds.forEach(blockId => {
						unreadIdeaBlockIdsFromRefreshRef.current.add(blockId);
					});
					setIdeaBlocks(prev => {
						const nextBlocks = applyPublicContextMatches(prev, lastMessage.payload);
						ideaBlocksRef.current = nextBlocks;
						return nextBlocks;
					});
				}
			}

			if (lastMessage.type === "similarity_reason_shared") {
				if (!canShowSimilarityCues) {
					return;
				}
				const sharedReason = lastMessage.payload;
				const sharedIsSameReason = sharedReason.isSameReason === true;
				sendSimilarityCueResponse(sharedReason, "shown");
				console.info("[private-board] similarity_reason_shared received", {
					sessionId,
					participantId,
					blockId: sharedReason.blockId,
					isSameReason: sharedReason.isSameReason
				});
				unreadIdeaBlockIdsFromRefreshRef.current.add(sharedReason.blockId);
				setIdeaBlocks(prev => {
					const nextBlocks = prev.map(block =>
						block.id === sharedReason.blockId
							? {
									...block,
									expanded: true,
									hasCue: true,
									isUnread: true,
									similarityIsSameReason: sharedIsSameReason,
									similarityHasSameReason: block.similarityHasSameReason || sharedIsSameReason,
									similarityHasDifferentReason: block.similarityHasDifferentReason || !sharedIsSameReason,
									sharedReasons: mergeSharedReasons(block.sharedReasons, [sharedReason])
								}
							: block
					);
					ideaBlocksRef.current = nextBlocks;
					return nextBlocks;
				});
				setHighlightedBlockId(sharedReason.blockId);
			}

			if (lastMessage.type === "similarity_reason_share_sent") {
				setIdeaBlockNotice(buildSimilarityReasonShareNotice(lastMessage.payload));
			}

			if (lastMessage.type === "similarity_reason_share_error") {
				setIdeaBlockNotice(buildSimilarityReasonShareErrorNotice(lastMessage));
			}

			if (lastMessage.type === "public_chat_message") {
				const nextMessage = publicChatPayloadToMessage(lastMessage.payload, participantId);
				const isNewUnreadMessage = shouldCountPublicChatMessageUnread(nextMessage, publicChatMessagesRef.current, { activeTab: visibleActiveTab, isCollapsed });
				setPublicChatMessages(prev => {
					const nextMessages = appendPublicChatMessage(prev, nextMessage);
					setIsSendingPublicChat(nextMessages.some(message => message.isOwn && message.isPending));
					return nextMessages;
				});
				if (nextMessage.isOwn && !nextMessage.isDeleted) {
					const nextMessageText = nextMessage.message.trim();
					const pendingShareIndex = pendingIdeaBlockChatSharesRef.current.findIndex(item => item.message === nextMessageText);
					if (pendingShareIndex >= 0) {
						const pendingShare = pendingIdeaBlockChatSharesRef.current[pendingShareIndex];
						pendingIdeaBlockChatSharesRef.current = pendingIdeaBlockChatSharesRef.current.filter((_, index) => index !== pendingShareIndex);
						setIdeaBlockChatShareNotices(prev =>
							prev.map(notice =>
								notice.id === pendingShare.noticeId
									? {
											...notice,
											message: nextMessage.message,
											status: "sent"
										}
									: notice
							)
						);
					}
				}
				if (isNewUnreadMessage) {
					setUnreadPublicChatCount(current => current + 1);
				}
			}
		}, 0);

		return () => window.clearTimeout(timer);
	}, [
		canShowSimilarityCues,
		captureIdeaBlockPositions,
		isCollapsed,
		isCurrentWhisperSegmentComplete,
		lastMessage,
		participantId,
		queueSimilarityCueFromBlock,
		resolveActiveCompletionSegmentKeys,
		sendSimilarityCueResponse,
		sessionId,
		takeVoiceGeneratingBlockIds,
		visibleActiveTab,
		visiblePhase
	]);

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
			const isOwnPrivateBoundary = isPrivateAudioLineForParticipant(transcriptLine, participantId);
			if (isOwnPrivateBoundary) {
				setWhisperTransient({
					status: "generating",
					text: boundaryText,
					segmentKey: draftKey
				});
				queueVoiceGeneratingIdeaBlock({
					segmentKey: draftKey,
					text: boundaryText,
					transcriptLineId: finalDraftId,
					timestampMs: matchingDraft?.timestampMs ?? transcriptLine.timestampMs
				});
			}

			activeTranscriptDraftsRef.current.set(draftKey, {
				id: finalDraftId,
				text: boundaryText,
				source: transcriptLine.source,
				userId: transcriptLine.userId ?? participantId,
				timestampMs: matchingDraft?.timestampMs ?? transcriptLine.timestampMs,
				isFinal: true
			});

			const frozenLine: TranscriptLineType = {
				...transcriptLine,
				id: finalDraftId,
				text: boundaryText,
				displayName: transcriptLine.displayName ?? displayName,
				isOwn: transcriptLine.userId == null ? true : isOwnTranscriptUser(transcriptLine.userId, participantId),
				isDraft: false,
				ideaBlockStatus: isOwnPrivateBoundary ? "pending" : undefined
			};
			setTranscriptLines(prev => linkTranscriptLinesToBlocks(matchingDraft ? replaceTranscriptLine(prev, matchingDraft.id, frozenLine) : appendTranscriptLine(prev, frozenLine), ideaBlocks));
		}, 0);

		return () => window.clearTimeout(timer);
	}, [displayName, ideaBlocks, lastAudioMessage, participantId, queueVoiceGeneratingIdeaBlock]);

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
				let voiceGeneratingSegmentKey = draftKey;
				let shouldQueueVoiceGeneratingBlock = false;
				const matchingDraft = activeTranscriptDraftsRef.current.get(draftKey) ?? null;
				const matchingFinalDraft = isTranscriptFinal && matchingDraft && !matchingDraft.isFinal ? matchingDraft : null;
				const isOwnPrivateAudioMessage = isPrivateAudioLineForParticipant(transcriptLine, participantId);

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
					if (isOwnPrivateAudioMessage) {
						setWhisperTransient({
							status: "listening",
							text: draftText,
							segmentKey: draftKey
						});
					}
					displayLine = {
						...transcriptLine,
						id: currentDraft.id,
						text: draftText,
						isDraft: true,
						ideaBlockStatus: isOwnPrivateAudioMessage ? "captured" : undefined
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
					if (isOwnPrivateAudioMessage) {
						setWhisperTransient({
							status: "generating",
							text: transcriptLine.text,
							segmentKey: draftKey
						});
						shouldQueueVoiceGeneratingBlock = true;
					}
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
					if (isOwnPrivateAudioMessage) {
						setWhisperTransient({
							status: "generating",
							text: transcriptLine.text,
							segmentKey: draftKey
						});
						shouldQueueVoiceGeneratingBlock = true;
					}
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
								voiceGeneratingSegmentKey = key;
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
					if (isOwnPrivateAudioMessage) {
						setWhisperTransient({
							status: "generating",
							text: transcriptLine.text,
							segmentKey: voiceGeneratingSegmentKey
						});
						shouldQueueVoiceGeneratingBlock = true;
					}
				}

				if (isOwnPrivateAudioMessage && (shouldQueueVoiceGeneratingBlock || isTranscriptFinal || isPersistedFinal) && displayLine.text.trim()) {
					displayLine = {
						...displayLine,
						ideaBlockStatus: "pending"
					};
					if (!shouldQueueVoiceGeneratingBlock) {
						setWhisperTransient({
							status: "generating",
							text: displayLine.text,
							segmentKey: voiceGeneratingSegmentKey
						});
					}
					queueVoiceGeneratingIdeaBlock({
						segmentKey: voiceGeneratingSegmentKey,
						text: displayLine.text,
						transcriptLineId: displayLine.id,
						timestampMs: displayLine.timestampMs
					});
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
	}, [displayName, ideaBlocks, lastAudioMessage, participantId, queueVoiceGeneratingIdeaBlock]);

	useEffect(() => {
		if (!isAudioProvisionalIdeaBlocksUpdateMessage(lastAudioMessage) || !isPrivateAudioCompletionScope(lastAudioMessage)) {
			return;
		}

		const timer = window.setTimeout(() => {
			if (lastProcessedProvisionalIdeaBlocksUpdateMessageRef.current === lastAudioMessage) {
				return;
			}
			lastProcessedProvisionalIdeaBlocksUpdateMessageRef.current = lastAudioMessage;

			const provisionalIdeaBlockResponses = Array.isArray(lastAudioMessage.provisional_idea_blocks) ? lastAudioMessage.provisional_idea_blocks : [];
			if (provisionalIdeaBlockResponses.length === 0) {
				return;
			}

			const segmentKeys = resolveActiveCompletionSegmentKeys(lastAudioMessage);
			if (segmentKeys.length === 0) {
				return;
			}

			const primarySegmentKey = segmentKeys.find(segmentKey => voiceGeneratingBlocksRef.current.has(segmentKey)) ?? segmentKeys[0];
			const existingBlockIds = voiceGeneratingBlocksRef.current.get(primarySegmentKey);
			const existingPrimaryBlockId = existingBlockIds ? Array.from(existingBlockIds)[0] : undefined;
			const firstTranscriptSegmentId =
				lastAudioMessage.transcript_segment_id ??
				lastAudioMessage.segment_id ??
				lastAudioMessage.transcript_segment_ids?.find(value => value != null) ??
				lastAudioMessage.segment_ids?.find(value => value != null);
			const fallbackTranscriptLineId = firstTranscriptSegmentId == null ? undefined : String(firstTranscriptSegmentId);
			const fallbackCreatedAtMs = ideaBlocksRef.current.find(block => block.id === existingPrimaryBlockId)?.createdAtMs ?? Date.now();
			const previewText = provisionalIdeaBlockResponses
				.map(item => String(item.title ?? item.summary ?? "").trim())
				.filter(Boolean)
				.slice(0, MAX_PENDING_IDEA_BLOCK_PREVIEW_COUNT)
				.join(" / ");
			const pendingSummary = provisionalIdeaBlockResponses.length === 1 ? "正在整理 1 個候選 idea block..." : `正在整理 ${provisionalIdeaBlockResponses.length} 個候選 idea blocks...`;
			const blockId = existingPrimaryBlockId ?? `${VOICE_GENERATING_ID_PREFIX}-${normalizeClientIdPart(primarySegmentKey)}-pending`;
			const block = createGeneratingIdeaBlock(previewText || pendingSummary, {
				id: blockId,
				summary: pendingSummary,
				transcript: previewText,
				transcriptLineId: fallbackTranscriptLineId,
				createdAtMs: fallbackCreatedAtMs
			});
			const provisionalBlockIds = [block.id];
			if (fallbackTranscriptLineId) {
				markTranscriptIdeaBlockStatusByLineIds(new Set([fallbackTranscriptLineId]), "pending");
			}

			registerVoiceGeneratingBlockIds(segmentKeys, provisionalBlockIds);
			scheduleVoiceGeneratingTimeout(primarySegmentKey, block.id);
			setIdeaBlocks(prev => {
				const previousBlocksById = new Map(prev.map(block => [block.id, block]));
				const provisionalBlockIdsSet = new Set(provisionalBlockIds);
				const nextBlocks = sortIdeaBlocks([
					...prev.filter(block => !provisionalBlockIdsSet.has(block.id)),
					{
						...block,
						isUnread: previousBlocksById.get(block.id)?.isUnread,
						createdAtMs: previousBlocksById.get(block.id)?.createdAtMs ?? block.createdAtMs
					}
				]);
				ideaBlocksRef.current = nextBlocks;
				return nextBlocks;
			});
		}, 0);

		return () => window.clearTimeout(timer);
	}, [lastAudioMessage, markTranscriptIdeaBlockStatusByLineIds, registerVoiceGeneratingBlockIds, resolveActiveCompletionSegmentKeys, scheduleVoiceGeneratingTimeout]);

	useEffect(() => {
		if (!isAudioIdeaBlocksUpdateMessage(lastAudioMessage)) {
			return;
		}
		const timer = window.setTimeout(() => {
			if (lastProcessedIdeaBlocksUpdateMessageRef.current === lastAudioMessage) {
				return;
			}
			lastProcessedIdeaBlocksUpdateMessageRef.current = lastAudioMessage;
			const ideaBlockResponses = Array.isArray(lastAudioMessage.idea_blocks) ? lastAudioMessage.idea_blocks : [];
			const duplicateIdeaBlockResponses = Array.isArray(lastAudioMessage.duplicate_idea_blocks) ? lastAudioMessage.duplicate_idea_blocks : [];
			const hasNewIdeaBlockResult = ideaBlockResponses.length > 0;
			const hasAnyIdeaBlockResult = hasNewIdeaBlockResult || duplicateIdeaBlockResponses.length > 0;
			const hasCompletedIdeaBlockGeneration = lastAudioMessage.generation_complete === true || hasAnyIdeaBlockResult;
			const shouldResolvePendingAsNoIdea = hasCompletedIdeaBlockGeneration && !hasNewIdeaBlockResult;
			const shouldClearVoiceGeneratingBlocks = isPrivateAudioCompletionScope(lastAudioMessage) && hasCompletedIdeaBlockGeneration;
			const completionSegmentKeys = shouldClearVoiceGeneratingBlocks ? resolveActiveCompletionSegmentKeys(lastAudioMessage) : [];
			if (shouldClearVoiceGeneratingBlocks && completionSegmentKeys.length === 0) {
				if (shouldResolvePendingAsNoIdea) {
					const allPendingVoiceBlockIds = new Set<string>();
					for (const segmentBlockIds of voiceGeneratingBlocksRef.current.values()) {
						segmentBlockIds.forEach(blockId => allPendingVoiceBlockIds.add(blockId));
					}
					markTranscriptIdeaBlockStatusByBlockIds(allPendingVoiceBlockIds, "no_idea");
				}
				clearAllVoiceGeneratingBlocks();
			}
			const pendingVoiceBlockIds = completionSegmentKeys.length > 0 ? takeVoiceGeneratingBlockIds(completionSegmentKeys) : new Set<string>();
			const removePendingVoiceBlocks = (blocks: IdeaBlock[]) => (pendingVoiceBlockIds.size === 0 ? blocks : blocks.filter(block => !pendingVoiceBlockIds.has(block.id)));
			if (shouldClearVoiceGeneratingBlocks && completionSegmentKeys.length > 0) {
				setWhisperTransient(current => (isCurrentWhisperSegmentComplete(current, completionSegmentKeys) ? { status: "idle", text: "" } : current));
			}
			if (pendingVoiceBlockIds.size > 0 && shouldResolvePendingAsNoIdea) {
				markTranscriptIdeaBlockStatusByBlockIds(pendingVoiceBlockIds, "no_idea");
			}
			if (completionSegmentKeys.length > 0 && shouldResolvePendingAsNoIdea) {
				markTranscriptIdeaBlockStatusByLineIds(getTranscriptLineIdsForDraftKeys(completionSegmentKeys), "no_idea");
			}
			let shouldRefreshIdeaBlocks = false;

			if (ideaBlockResponses.length > 0) {
				const previousBlocksById = new Map(ideaBlocksRef.current.map(block => [block.id, block]));
				const existingBlockIds = new Set(previousBlocksById.keys());
				const updatedBlocks = ideaBlockResponses.map(item => {
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
					const baseBlocks = removePendingVoiceBlocks(prev);
					mergedBlocksSnapshot = mergeIdeaBlocks(baseBlocks, updatedBlocks, { markNewUnread: true });
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
					const mergedBlocks = mergeIdeaBlocks(removePendingVoiceBlocks(prev), duplicateBlocks);
					ideaBlocksRef.current = mergedBlocks;
					return mergedBlocks;
				});
				const firstDuplicateResponse = duplicateIdeaBlockResponses[0];
				const firstDuplicateBlock = duplicateBlocks[0];
				if (firstDuplicateResponse && firstDuplicateBlock) {
					setIdeaBlockNotice(buildDuplicateIdeaBlockNotice(firstDuplicateBlock));
					jumpToBlock(firstDuplicateBlock.id);
				}
				shouldRefreshIdeaBlocks = true;
			}

			if (pendingVoiceBlockIds.size > 0 && !shouldRefreshIdeaBlocks) {
				setIdeaBlocks(prev => {
					const nextBlocks = sortIdeaBlocks(removePendingVoiceBlocks(prev));
					ideaBlocksRef.current = nextBlocks;
					return nextBlocks;
				});
			}

			if (shouldRefreshIdeaBlocks) {
				setIdeaBlockRefreshKey(current => current + 1);
			}
		}, 0);

		return () => window.clearTimeout(timer);
	}, [
		clearAllVoiceGeneratingBlocks,
		getTranscriptLineIdsForDraftKeys,
		isCurrentWhisperSegmentComplete,
		jumpToBlock,
		lastAudioMessage,
		markTranscriptIdeaBlockStatusByBlockIds,
		markTranscriptIdeaBlockStatusByLineIds,
		queueSimilarityCueFromBlock,
		resolveActiveCompletionSegmentKeys,
		takeVoiceGeneratingBlockIds
	]);

	useEffect(() => {
		if (!isAudioTerminalErrorMessage(lastAudioMessage) || !isPrivateAudioCompletionScope(lastAudioMessage)) {
			return;
		}

		const timer = window.setTimeout(() => {
			const completionSegmentKeys = resolveActiveCompletionSegmentKeys(lastAudioMessage);
			if (completionSegmentKeys.length === 0) {
				const allPendingVoiceBlockIds = new Set<string>();
				for (const segmentBlockIds of voiceGeneratingBlocksRef.current.values()) {
					segmentBlockIds.forEach(blockId => allPendingVoiceBlockIds.add(blockId));
				}
				markTranscriptIdeaBlockStatusByBlockIds(allPendingVoiceBlockIds, "failed");
				clearAllVoiceGeneratingBlocks();
				return;
			}

			const pendingVoiceBlockIds = takeVoiceGeneratingBlockIds(completionSegmentKeys);
			markTranscriptIdeaBlockStatusByBlockIds(pendingVoiceBlockIds, "failed");
			markTranscriptIdeaBlockStatusByLineIds(getTranscriptLineIdsForDraftKeys(completionSegmentKeys), "failed");
			removeVoiceGeneratingBlocksByIds(pendingVoiceBlockIds);
			setWhisperTransient(current => (isCurrentWhisperSegmentComplete(current, completionSegmentKeys) ? { status: "idle", text: "" } : current));
		}, 0);

		return () => window.clearTimeout(timer);
	}, [
		clearAllVoiceGeneratingBlocks,
		getTranscriptLineIdsForDraftKeys,
		isCurrentWhisperSegmentComplete,
		lastAudioMessage,
		markTranscriptIdeaBlockStatusByBlockIds,
		markTranscriptIdeaBlockStatusByLineIds,
		removeVoiceGeneratingBlocksByIds,
		resolveActiveCompletionSegmentKeys,
		takeVoiceGeneratingBlockIds
	]);

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

		const timer = window.setTimeout(() => setIdeaBlockNotice(null), NOTIFICATION_AUTO_DISMISS_MS);
		return () => window.clearTimeout(timer);
	}, [ideaBlockNotice]);

	const jumpToTranscript = (block: IdeaBlock) => {
		const transcriptId = block.transcriptLineId ?? block.sourceTranscriptIds?.[0];
		if (!transcriptId) {
			return;
		}

		selectBoardTab("transcript");
		window.setTimeout(() => setHighlightedTranscriptId(transcriptId), 0);
	};

	const canJumpToTranscript = (block: IdeaBlock) => {
		const transcriptIds = [block.transcriptLineId, ...(block.sourceTranscriptIds ?? [])].filter((id): id is string => !!id);
		return transcriptIds.length > 0;
	};

	const handleTranscriptScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
		shouldAutoScrollRef.current.transcript = isNearScrollBottom(event.currentTarget);
	}, []);

	const markVisibleUnreadIdeaBlocksRead = useCallback(() => {
		if (!isIdeaBlocksTabActive || isCollapsed) {
			return;
		}
		const viewport = ideaBlocksScrollViewportRef.current;
		if (!viewport) {
			return;
		}
		const viewportRect = viewport.getBoundingClientRect();
		const visibleUnreadBlockIds = new Set<string>();
		ideaBlocksRef.current.forEach(block => {
			if (!block.isUnread || block.isDeleted || block.status === "generating") {
				return;
			}
			const node = blockRefs.current[block.id];
			if (!node) {
				return;
			}
			const rect = node.getBoundingClientRect();
			if (rect.height <= 0) {
				return;
			}
			const visibleHeight = Math.min(rect.bottom, viewportRect.bottom) - Math.max(rect.top, viewportRect.top);
			const minimumVisibleHeight = Math.min(rect.height, 64);
			if (visibleHeight >= minimumVisibleHeight * 0.5) {
				visibleUnreadBlockIds.add(block.id);
			}
		});
		markIdeaBlocksRead(visibleUnreadBlockIds);
	}, [isCollapsed, isIdeaBlocksTabActive, markIdeaBlocksRead]);

	const handleIdeaBlocksScroll = useCallback(
		(event: UIEvent<HTMLDivElement>) => {
			shouldAutoScrollRef.current.ideablock = isNearScrollBottom(event.currentTarget);
			window.requestAnimationFrame(markVisibleUnreadIdeaBlocksRead);
		},
		[markVisibleUnreadIdeaBlocksRead]
	);

	const handlePublicChatScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
		shouldAutoScrollRef.current["public-chat"] = isNearScrollBottom(event.currentTarget);
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

	useLayoutEffect(() => {
		const frameId = window.requestAnimationFrame(markVisibleUnreadIdeaBlocksRead);
		return () => window.cancelAnimationFrame(frameId);
	}, [ideaBlocks, isCollapsed, isIdeaBlocksTabActive, markVisibleUnreadIdeaBlocksRead]);

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
			setIdeaBlockNotice(buildDuplicateIdeaBlockNotice(savedBlock));
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
					isDraft: false,
					isUnread: true
				};
				setIdeaBlocks(prev => {
					const nextBlocks = sortIdeaBlocks(prev.map(block => (block.id === generatingBlock.id ? newBlock : block)));
					ideaBlocksRef.current = nextBlocks;
					return nextBlocks;
				});
				if (lastVisibleActiveTabRef.current === "ideablock") {
					setHighlightedBlockId(newBlock.id);
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
			setIdeaBlocks(prev => {
				const withoutGeneratingBlock = prev.filter(block => block.id !== generatingBlock.id);
				const nextBlocks = mergeIdeaBlocks(withoutGeneratingBlock, [{ ...savedBlock, isUnread: true }], { markNewUnread: true });
				ideaBlocksRef.current = nextBlocks;
				return nextBlocks;
			});
			if (isDuplicateBlock) {
				setIdeaBlockNotice(buildDuplicateIdeaBlockNotice(savedBlock));
				jumpToBlock(savedBlock.id);
			} else if (lastVisibleActiveTabRef.current === "ideablock") {
				setHighlightedBlockId(savedBlock.id);
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

	const sendPublicChatPayload = useCallback(
		(message: string) => {
			const normalizedMessage = message.trim();
			if (!normalizedMessage) {
				return null;
			}

			if (!isConnected) {
				setPublicChatError("公開聊天室尚未連線");
				return null;
			}

			const sentMessage = normalizedMessage.slice(0, MAX_PUBLIC_CHAT_MESSAGE_LENGTH).trimEnd();
			const clientMessageId = createClientNoticeId("public-chat");
			const timestampMs = Date.now();
			setIsSendingPublicChat(true);
			setPublicChatError(null);
			setPublicChatMessages(prev =>
				appendPublicChatMessage(prev, {
					id: clientMessageId,
					sessionName: sessionId,
					userId: String(getTranscriptUserId(participantId)),
					displayName,
					message: sentMessage,
					time: formatTranscriptTime(timestampMs),
					timestampMs,
					isOwn: true,
					isPending: true,
					clientMessageId
				})
			);
			onSendBoardMessage({
				type: "public_chat_send",
				message: sentMessage,
				displayName,
				clientMessageId
			});
			window.setTimeout(() => {
				const stillPending = publicChatMessagesRef.current.some(message => message.clientMessageId === clientMessageId && message.isPending);
				if (!stillPending) {
					return;
				}
				setIsSendingPublicChat(publicChatMessagesRef.current.some(message => message.isOwn && message.isPending && message.clientMessageId !== clientMessageId));
			}, PUBLIC_CHAT_SEND_ACK_TIMEOUT_MS);
			return sentMessage;
		},
		[displayName, isConnected, onSendBoardMessage, participantId, sessionId]
	);

	const sendPublicChatMessage = () => {
		if (sendPublicChatPayload(publicChatText)) {
			setPublicChatText("");
		}
	};

	const retryIdeaBlockChatShareNotice = useCallback(
		(notice: IdeaBlockChatShareNotice) => {
			const sentMessage = sendPublicChatPayload(notice.message);
			if (!sentMessage) {
				setIdeaBlockChatShareNotices(prev => prev.map(item => (item.id === notice.id ? { ...item, status: "failed" } : item)));
				return;
			}
			queueIdeaBlockChatShareNotice(sentMessage, notice.id);
		},
		[queueIdeaBlockChatShareNotice, sendPublicChatPayload]
	);

	const shareIdeaBlockToChat = useCallback(
		(block: IdeaBlock) => {
			if (!isGroupPhase(visiblePhase) || block.status === "generating" || block.isDeleted) {
				return;
			}
			const sentMessage = sendPublicChatPayload(buildIdeaBlockChatMessage(block));
			if (sentMessage) {
				queueIdeaBlockChatShareNotice(sentMessage);
			}
		},
		[queueIdeaBlockChatShareNotice, sendPublicChatPayload, visiblePhase]
	);

	const shareSimilarityReason = (cue: SimilarityCueData) => {
		if (!canShowSimilarityCues) {
			return;
		}
		if (cue.kind === "phase-transition-summary") {
			return;
		}
		onSendBoardMessage({
			type: "share_similarity_reason",
			blockId: cue.blockId,
			cueId: cue.cueId || cue.id
		});
		setCues(prev => {
			const nextCues = prev.filter(item => !isSimilarityPairCue(item) || item.blockId !== cue.blockId);
			cuesRef.current = nextCues;
			return nextCues;
		});
	};

	const viewSimilarityCue = (cue: SimilarityPairCueData) => {
		if (!jumpToBlock(cue.blockId)) {
			setIdeaBlockNotice(buildMissingIdeaBlockJumpTargetNotice(cue));
			return;
		}
		sendSimilarityCueResponse(cue, "accepted");
		markSimilarityCueResponse(cue, "accepted");
	};

	const shareSimilarityReasonFromBlock = useCallback(
		(block: IdeaBlock) => {
			if (!canShowSimilarityCues || !canShareSimilarityReasonInPhase(visiblePhase) || !block.hasCue || block.status === "generating" || block.isDeleted) {
				return;
			}
			onSendBoardMessage({
				type: "share_similarity_reason",
				blockId: block.id
			});
			markSimilarityCueResponse({ blockId: block.id }, "shared");
		},
		[canShowSimilarityCues, markSimilarityCueResponse, onSendBoardMessage, visiblePhase]
	);

	const dismissSimilarityCue = (cue: SimilarityCueData, status: "dismissed" | "ignored") => {
		if (isSimilarityPairCue(cue)) {
			sendSimilarityCueResponse(cue, status);
		}
		setCues(prev => {
			const nextCues = prev.filter(item => item.id !== cue.id);
			cuesRef.current = nextCues;
			return nextCues;
		});
	};

	const publicTranscriptLines = transcriptLines.filter(line => line.source === "public");
	const publicSubtitleLines = micMode === "private" ? publicTranscriptLines.filter(line => line.text.trim()).slice(-2) : [];
	const showPublicSubtitlePanel = isIdeaBlocksTabActive && publicSubtitleLines.length > 0;
	const whisperStatusLabel = whisperTransient.status === "listening" ? "正在聽悄悄話" : whisperTransient.status === "generating" ? "正在生成" : null;
	const whisperTransientText = whisperTransient.text.trim();
	const showWhisperTransient = isIdeaBlocksTabActive && whisperTransient.status === "listening" && !!whisperTransientText;
	const unreadIdeaBlockCountLabel = formatUnreadCount(unreadIdeaBlockCount);
	const unreadPublicChatCountLabel = unreadPublicChatCount > 99 ? "99+" : String(unreadPublicChatCount);
	const visibleSimilarityCues = canShowSimilarityCues && isSimilarityCueDisplayPhase(visiblePhase) ? cues : [];
	const ideaBlockChatShareCueContent =
		ideaBlockChatShareNotices.length > 0 ? (
			<IdeaBlockChatShareCueContent notices={ideaBlockChatShareNotices} onView={viewIdeaBlockChatShareNotice} onRetry={retryIdeaBlockChatShareNotice} onDismiss={dismissIdeaBlockChatShareNotice} />
		) : undefined;
	const ideaBlockNoticeBlockId = ideaBlockNotice?.blockId;
	const ideaBlockNoticeContent = ideaBlockNotice ? (
		<div className="animate-in slide-in-from-right-4 fade-in-0 rounded-md border bg-card p-3 text-card-foreground shadow-lg" role="status" aria-live="polite">
			<div className="flex items-start gap-3">
				{ideaBlockNoticeBlockId ? (
					<button type="button" className="min-w-0 flex-1 text-left" onClick={() => jumpToBlock(ideaBlockNoticeBlockId)}>
						<div className="text-sm font-medium">{ideaBlockNotice.title}</div>
						<div className="mt-1 text-xs leading-5 text-muted-foreground">{ideaBlockNotice.message}</div>
					</button>
				) : (
					<div className="min-w-0 flex-1">
						<div className="text-sm font-medium">{ideaBlockNotice.title}</div>
						<div className="mt-1 text-xs leading-5 text-muted-foreground">{ideaBlockNotice.message}</div>
					</div>
				)}
				<Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="關閉通知" onClick={() => setIdeaBlockNotice(null)}>
					<X className="h-4 w-4" />
				</Button>
			</div>
		</div>
	) : undefined;
	const notificationCueContent =
		ideaBlockNoticeContent || ideaBlockChatShareCueContent ? (
			<>
				{ideaBlockNoticeContent}
				{ideaBlockChatShareCueContent}
			</>
		) : undefined;

	return (
		<>
			<section className="flex h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-lg border bg-card text-card-foreground">
				<header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b p-3">
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
						{onCollapse && (
							<Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label="收合 Private Board" title="收合 Private Board" onClick={onCollapse}>
								<ChevronRight className="h-4 w-4" />
							</Button>
						)}
						<div className="flex min-w-0 max-w-full flex-wrap rounded-lg bg-muted p-1">
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
							<Button
								aria-pressed={visibleActiveTab === "ideablock"}
								className={cn(
									"relative transition-all active:translate-y-px active:scale-[0.98]",
									visibleActiveTab === "ideablock" && "translate-y-px bg-primary text-primary-foreground shadow-inner ring-2 ring-primary/20 hover:bg-primary/90"
								)}
								variant={visibleActiveTab === "ideablock" ? "default" : "ghost"}
								onClick={() => {
									if (unreadIdeaBlockCount > 0) {
										openLatestUnreadIdeaBlock();
										return;
									}
									selectBoardTab("ideablock");
								}}
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
					<div className="ml-auto flex shrink-0 items-center gap-2">
						<PhaseBadge phase={visiblePhase} />
						{visibleTimerEndTime > 0 && <PhaseTimer endTimeMs={visibleTimerEndTime} />}
						<span className={`hidden h-2 w-2 rounded-full ${isConnected ? "bg-primary" : "bg-muted-foreground"}`} />
					</div>
				</header>

				{visibleActiveTab === "transcript" && (
					<section className="m-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background">
						<div className="border-b px-3 py-2 text-sm font-medium">逐字稿</div>
						<ScrollArea className="min-h-0 flex-1 p-3" viewportRef={transcriptScrollViewportRef} viewportProps={{ onScroll: handleTranscriptScroll }}>
							<TranscriptLines
								lines={transcriptLines}
								emptyText="尚無逐字稿"
								onJumpToBlock={jumpToBlock}
								ideaBlocks={ideaBlocks}
								onTranscriptRef={setTranscriptRef}
								highlightedTranscriptId={highlightedTranscriptId}
							/>
						</ScrollArea>
					</section>
				)}

				{isIdeaBlocksTabActive && (
					<div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
						{showPublicSubtitlePanel && (
							<section className="shrink-0 overflow-hidden rounded-lg border bg-muted/35 px-3 py-2" aria-label="公開討論字幕">
								<div className="mb-1 flex items-center justify-between gap-3">
									<div className="text-xs font-semibold text-muted-foreground">公開討論字幕</div>
									<Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => selectBoardTab("transcript")}>
										查看逐字稿
									</Button>
								</div>
								<div className="grid gap-1">
									{publicSubtitleLines.map(line => (
										<div key={line.id} className="min-w-0 text-sm leading-6">
											{line.displayName && <span className="mr-1 font-semibold text-muted-foreground">{line.displayName}:</span>}
											<span className="overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{line.text}</span>
										</div>
									))}
								</div>
							</section>
						)}
						<section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
							<div className="flex items-center justify-between gap-3 border-b px-3 py-2">
								<div className="text-sm font-medium">Idea Blocks</div>
								{whisperStatusLabel && (
									<span className="inline-flex shrink-0 items-center rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{whisperStatusLabel}</span>
								)}
							</div>
							<ScrollArea className="min-h-0 flex-1 p-3" viewportRef={ideaBlocksScrollViewportRef} viewportProps={{ onScroll: handleIdeaBlocksScroll }}>
								<div className="grid gap-2 pb-3">
									{ideaBlocks.length === 0 && <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-muted-foreground">尚無 Idea Blocks</div>}
									{displayedIdeaBlocks.map(block => (
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
												onShareToChat={shareIdeaBlockToChat}
												onShareSimilarityReason={shareSimilarityReasonFromBlock}
												canJumpToTranscript={canJumpToTranscript(block)}
												canShareToChat={isConnected && isGroupPhase(visiblePhase)}
												currentPhase={visiblePhase}
												showSimilarityCue={canShowSimilarityCues}
											/>
										</div>
									))}
									{showWhisperTransient && (
										<div className="rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-sm" role="status" aria-live="polite">
											<div className="mb-1 text-xs font-semibold text-muted-foreground">你的悄悄話</div>
											<p className="overflow-hidden leading-6 text-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]">{whisperTransientText}</p>
										</div>
									)}
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

			<SimilarityCue
				cues={visibleSimilarityCues}
				onJump={viewSimilarityCue}
				onDismiss={dismissSimilarityCue}
				onShareReason={shareSimilarityReason}
				canJumpToBlock={canJumpToRenderedBlock}
				topContent={notificationCueContent}
			/>
		</>
	);
});

function PhaseBadge({ phase }: { phase: SessionPhase }) {
	const label = getSessionPhaseLabel(phase);
	return (
		<div
			className={cn(
				"shrink-0 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
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
		<div className="shrink-0 whitespace-nowrap rounded-md bg-secondary px-2.5 py-1 font-mono text-sm font-medium tabular-nums text-secondary-foreground shadow-sm">
			{m}:{s.toString().padStart(2, "0")}
		</div>
	);
}
