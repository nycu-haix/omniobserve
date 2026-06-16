import {
	AlertCircle,
	ArrowRight,
	Check,
	ClipboardList,
	Clock,
	Copy,
	Download,
	Eye,
	FileText,
	Lightbulb,
	Link2,
	MessageSquare,
	Radio,
	RefreshCw,
	Search,
	Undo2,
	UserCheck,
	Users,
	X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
	getInitialLatestTranscriptIdeaBlockStatus,
	getLatestTranscriptIdeaBlockStatusAfterUpdate,
	latestTranscriptMatchesSegmentIds,
	type LatestTranscriptIdeaBlockStatus
} from "../lib/adminLatestTranscriptStatus";
import { PUBLIC_NOW_STALE_BUDGET_MS, buildPublicNowLabel, computePublicNowAgeMs, formatPublicNowLatency, isPublicNowStale } from "../lib/adminPublicNow";
import { getAdminRankingDisplayItemIds } from "../lib/adminRankings";
import { getDefaultRoomName } from "../lib/defaultRoomName";
import { getValidIdeaBlockJumpTargetIds, isValidIdeaBlockJumpTarget } from "../lib/ideaBlockJumpTargets";
import { formatParticipantDisplayName } from "../lib/participantDefaults";
import { isAdminParticipantId, isAdminRankingRole, isAudioTranscriptionRole, isParticipantAnalysisRole, normalizeParticipantRole, type ParticipantRole } from "../lib/participantRoles";
import {
	DEFAULT_SESSION_PHASE,
	DEFAULT_SESSION_PHASE_OPTIONS,
	getSessionPhaseLabel,
	isGroupPhase,
	normalizeSessionPhase,
	normalizeSessionPhaseOptions,
	type SessionPhase,
	type SessionPhaseOption
} from "../lib/sessionPhase";
import { isSimilarityCueDisplayPhase } from "../lib/similarityCueLifecycle";
import { cn } from "../lib/utils";
import { apiUrl, fetchTaskConfig, type Phase1BuilderOption, type TaskConfigItem } from "../services/api";
import { normalizePresenceParticipantsPayload, type ParticipantPresence } from "../services/presence";
import type { PublicChatMessage } from "../types";
import { PublicChatComposer, PublicChatMessages } from "./private-board/PublicChatPanel";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { ScrollArea } from "./ui/ScrollArea";

interface RealtimeMessage {
	type?: string;
	[key: string]: unknown;
}

interface BoardStateMessage extends RealtimeMessage {
	type: "board_state";
	revision: number;
	ranking?: { items?: string[] };
	public_ranking?: RankingSnapshot;
	private_ranking?: RankingSnapshot;
	private_rankings?: Record<string, RankingSnapshot>;
	ranking_items?: TaskConfigItem[] | null;
}

interface RankingSnapshot {
	revision: number;
	items: string[];
	change_count?: number;
}

interface AdminRankingStateMessage extends RealtimeMessage {
	type: "admin_ranking_state";
	revision: number;
	public_ranking: RankingSnapshot;
	private_rankings: Record<string, RankingSnapshot>;
	ranking_items?: TaskConfigItem[] | null;
}

interface TranscriptRecord {
	id: number | string;
	user_id: number;
	session_name: string;
	time_stamp: string;
	transcript: string;
}

interface IdeaBlockRecord {
	id: number;
	user_id: number;
	session_name: string;
	title?: string;
	summary?: string;
	transcript?: string | null;
	similarity_id?: number | null;
	content?: string;
}

interface SimilarityIdeaSummary {
	id: number;
	summary: string;
}

interface SimilarityRecord {
	id: number;
	idea_block_id_1: number;
	idea_block_id_2: number;
	reason: string;
	is_same_reason: boolean;
	idea_block_1: SimilarityIdeaSummary;
	idea_block_2: SimilarityIdeaSummary;
}

interface ParticipantTranscriptMessage extends RealtimeMessage {
	type: "participant_transcript";
	participant_id: string;
	scope?: string;
	text?: string;
	is_final?: boolean;
	persisted?: boolean;
	transcript_segment_id?: string | number | null;
	timestamp_ms?: number;
}

interface PresenceStateMessage extends RealtimeMessage {
	type: "presence_state";
	participants?: unknown;
	participant_ids?: unknown;
}

interface IdeaBlocksUpdateMessage extends RealtimeMessage {
	type: "idea_blocks_update";
	participant_id?: unknown;
	idea_blocks?: unknown;
	duplicate_idea_blocks?: unknown;
	generation_complete?: unknown;
	transcript_segment_id?: unknown;
	transcript_segment_ids?: unknown;
}

interface AudioTerminalErrorMessage extends RealtimeMessage {
	type: "transcript_error" | "pipeline_error" | "asr_error";
	participant_id?: unknown;
	user_id?: unknown;
	userId?: unknown;
	transcript_segment_id?: unknown;
	transcript_segment_ids?: unknown;
}

interface PublicContextComponentStateMessage extends RealtimeMessage {
	type: "public_context_component_state";
	componentIds?: unknown;
	component_ids?: unknown;
	taskItemIds?: unknown;
	task_item_ids?: unknown;
	source?: unknown;
	matchCount?: unknown;
	match_count?: unknown;
	deliveredCount?: unknown;
	delivered_count?: unknown;
	timestamp_ms?: unknown;
	stateUpdatedAtMs?: unknown;
	state_updated_at_ms?: unknown;
	adminBroadcastAtMs?: unknown;
	admin_broadcast_at_ms?: unknown;
	eventTimestampMs?: unknown;
	event_timestamp_ms?: unknown;
	eventToAdminBroadcastMs?: unknown;
	event_to_admin_broadcast_ms?: unknown;
	eventToStateMs?: unknown;
	event_to_state_ms?: unknown;
	matchingDurationMs?: unknown;
	matching_duration_ms?: unknown;
	queueDelayMs?: unknown;
	queue_delay_ms?: unknown;
	debounceMs?: unknown;
	debounce_ms?: unknown;
	textChars?: unknown;
	text_chars?: unknown;
	contextChars?: unknown;
	context_chars?: unknown;
	targetParticipantCount?: unknown;
	target_participant_count?: unknown;
	boardConnectionCount?: unknown;
	board_connection_count?: unknown;
	adminConnectionCount?: unknown;
	admin_connection_count?: unknown;
	transcriptSegmentId?: unknown;
	transcript_segment_id?: unknown;
}

type PublicNowTarget =
	| {
			kind: "component";
			id: string;
			label: string;
			title: string;
	  }
	| {
			kind: "task_item";
			id: string;
			taskItemId: number;
			label: string;
			title: string;
	  };

interface LatestParticipantTranscript {
	scope: string;
	text: string;
	isFinal: boolean;
	persisted: boolean;
	receivedAt: string;
	transcriptSegmentId: string | null;
	ideaBlockStatus: LatestTranscriptIdeaBlockStatus;
}

interface PublicNowDiagnostics {
	stateUpdatedAtMs: number | null;
	adminBroadcastAtMs: number | null;
	receivedAtMs: number | null;
	eventTimestampMs: number | null;
	eventToAdminBroadcastMs: number | null;
	eventToStateMs: number | null;
	displayLatencyMs: number | null;
	matchingDurationMs: number | null;
	queueDelayMs: number | null;
	debounceMs: number | null;
	textChars: number | null;
	contextChars: number | null;
	targetParticipantCount: number | null;
	boardConnectionCount: number | null;
	adminConnectionCount: number | null;
	transcriptSegmentId: string | null;
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

type CueCondition = "experimental" | "control";
type AdminTab = "ranking" | "transcript" | "chat";
type ManualCueReasonType = "same" | "different";
type SimilarityReasonKind = "same" | "different" | "mixed";
type PublicNowSource = "auto" | "manual" | "manual_clear" | string;

interface SimilarityLink {
	id: number;
	relatedBlockId: number;
	relatedSummary: string;
	isSameReason: boolean;
	reason: string;
}

const API_REFRESH_INTERVAL_MS = 5000;
const ADMIN_PARTICIPANT_ID = "admin";
const ADMIN_PARTICIPANT_ID_PREFIX = `${ADMIN_PARTICIPANT_ID}-`;
const PUBLIC_CHAT_SEND_ACK_TIMEOUT_MS = 5000;
const DEFAULT_ADMIN_LEFT_SIDEBAR_WIDTH = 360;
const DEFAULT_ADMIN_RIGHT_SIDEBAR_WIDTH = 360;
const MIN_ADMIN_LEFT_SIDEBAR_WIDTH = 360;
const MIN_ADMIN_RIGHT_SIDEBAR_WIDTH = 320;
const MIN_ADMIN_CENTER_COLUMN_WIDTH = 520;
const ADMIN_LEFT_SIDEBAR_WIDTH_STORAGE_KEY = "omni.admin.leftSidebarWidth";
const ADMIN_RIGHT_SIDEBAR_WIDTH_STORAGE_KEY = "omni.admin.rightSidebarWidth";
const PRIVATE_PUBLIC_RANK_CONFLICT_THRESHOLD = 3;
const MANUAL_CUE_REASON_PREFIX = "Manual cue from admin:";
const MANUAL_CUE_REASON_LABELS: Record<ManualCueReasonType, string> = {
	same: "Same reason",
	different: "Different reason"
};
const SIMILARITY_REASON_LABELS: Record<SimilarityReasonKind, string> = {
	same: "same reason",
	different: "different reason",
	mixed: "same + different"
};
const SIMILARITY_REASON_TAG_CLASSES: Record<SimilarityReasonKind, string> = {
	same: "border-green-700/30 bg-green-100 text-green-900",
	different: "border-yellow-700/30 bg-yellow-100 text-yellow-900",
	mixed: "border-neutral-900/30 bg-[#ffeace] text-neutral-900"
};
const LATEST_TRANSCRIPT_STATUS_LABELS: Record<LatestParticipantTranscript["ideaBlockStatus"], string> = {
	captured: "speech captured",
	pending: "idea pending",
	generated: "idea generated",
	no_idea: "no new idea",
	failed: "idea failed"
};
const LATEST_TRANSCRIPT_STATUS_CLASSES: Record<LatestParticipantTranscript["ideaBlockStatus"], string> = {
	captured: "border-sky-200 bg-sky-50 text-sky-900",
	pending: "border-slate-200 bg-slate-50 text-slate-800",
	generated: "border-emerald-200 bg-emerald-50 text-emerald-900",
	no_idea: "border-amber-200 bg-amber-50 text-amber-900",
	failed: "border-destructive/30 bg-destructive/10 text-destructive"
};
const PARTICIPANT_ROLE_LABELS: Record<ParticipantRole, string> = {
	participant: "Participant",
	confederate: "Confederate",
	observer: "Observer",
	facilitator: "Facilitator",
	test: "Test"
};
const PARTICIPANT_ROLE_SEGMENT_CLASSES: Record<ParticipantRole, string> = {
	participant: "bg-emerald-50 text-emerald-900 shadow-sm ring-1 ring-emerald-700/20",
	confederate: "bg-sky-50 text-sky-900 shadow-sm ring-1 ring-sky-700/25",
	observer: "bg-amber-50 text-amber-900 shadow-sm ring-1 ring-amber-700/25",
	facilitator: "bg-violet-50 text-violet-900 shadow-sm ring-1 ring-violet-700/25",
	test: "bg-neutral-100 text-neutral-900 shadow-sm ring-1 ring-neutral-700/20"
};
const PARTICIPANT_ROLE_OPTIONS: ParticipantRole[] = ["participant", "confederate", "observer", "facilitator", "test"];
const EMPTY_PUBLIC_NOW_DIAGNOSTICS: PublicNowDiagnostics = {
	stateUpdatedAtMs: null,
	adminBroadcastAtMs: null,
	receivedAtMs: null,
	eventTimestampMs: null,
	eventToAdminBroadcastMs: null,
	eventToStateMs: null,
	displayLatencyMs: null,
	matchingDurationMs: null,
	queueDelayMs: null,
	debounceMs: null,
	textChars: null,
	contextChars: null,
	targetParticipantCount: null,
	boardConnectionCount: null,
	adminConnectionCount: null,
	transcriptSegmentId: null
};

function getAdminAvailableLayoutWidth() {
	return window.innerWidth - 32 - 32;
}

function clampAdminLeftSidebarWidth(width: number, rightSidebarWidth: number) {
	const maxWidth = Math.max(MIN_ADMIN_LEFT_SIDEBAR_WIDTH, getAdminAvailableLayoutWidth() - rightSidebarWidth - MIN_ADMIN_CENTER_COLUMN_WIDTH);
	return Math.min(Math.max(width, MIN_ADMIN_LEFT_SIDEBAR_WIDTH), maxWidth);
}

function clampAdminRightSidebarWidth(width: number, leftSidebarWidth: number) {
	const maxWidth = Math.max(MIN_ADMIN_RIGHT_SIDEBAR_WIDTH, getAdminAvailableLayoutWidth() - leftSidebarWidth - MIN_ADMIN_CENTER_COLUMN_WIDTH);
	return Math.min(Math.max(width, MIN_ADMIN_RIGHT_SIDEBAR_WIDTH), maxWidth);
}

function normalizeCueCondition(value: unknown): CueCondition | null {
	return value === "experimental" || value === "control" ? value : null;
}

function durationSecondsFromMinutes(value: string) {
	const minutes = Number.parseFloat(value);
	if (!Number.isFinite(minutes) || minutes <= 0) {
		return 0;
	}
	return Math.round(minutes * 60);
}

function formatDurationLabel(value: string) {
	const seconds = durationSecondsFromMinutes(value);
	if (seconds <= 0) {
		return "No Timer";
	}
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	return remainder === 0 ? `${minutes} Min` : `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function getRoomName() {
	const params = new URLSearchParams(window.location.search);
	const fallbackRoomName = getDefaultRoomName();
	return (
		params
			.get("room_name")
			?.trim()
			.replace(/^["']|["']$/g, "") || fallbackRoomName
	);
}

function getWsBaseUrl() {
	const protocol = window.location.protocol === "https:" ? "wss" : "ws";
	return (import.meta.env.VITE_WS_BASE_URL as string | undefined) || `${protocol}://${window.location.host}`;
}

function createAdminClientId() {
	const randomId = typeof window.crypto?.randomUUID === "function" ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return `${ADMIN_PARTICIPANT_ID_PREFIX}${randomId}`;
}

function createClientMessageId(prefix: string) {
	const randomId = typeof window.crypto?.randomUUID === "function" ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return `${prefix}-${randomId}`;
}

function buildSessionApiUrl(roomName: string, path: string) {
	return apiUrl(`/api/sessions/${encodeURIComponent(roomName)}${path}`);
}

function getDownloadFilename(response: Response, fallback: string) {
	const contentDisposition = response.headers.get("content-disposition") || "";
	const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
	if (utf8Match?.[1]) {
		return decodeURIComponent(utf8Match[1].replace(/^"|"$/g, ""));
	}
	const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
	return filenameMatch?.[1] || fallback;
}

function formatApiTime(value: string | number | null | undefined) {
	if (!value) {
		return "-";
	}

	const date = new Date(typeof value === "number" ? value : value);
	if (Number.isNaN(date.getTime())) {
		return String(value);
	}

	return new Intl.DateTimeFormat("zh-TW", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false
	}).format(date);
}

function matchesQuery(value: string | null | undefined, query: string) {
	return !query || (value || "").toLowerCase().includes(query);
}

function getSimilarityReasonKind(hasSameReason: boolean, hasDifferentReason: boolean): SimilarityReasonKind | null {
	if (hasSameReason && hasDifferentReason) {
		return "mixed";
	}
	if (hasSameReason) {
		return "same";
	}
	if (hasDifferentReason) {
		return "different";
	}
	return null;
}

function getSimilarityReasonTagLabel(kind: SimilarityReasonKind, count?: number) {
	const countText = count && count > 1 ? ` ${count}` : "";
	return `${SIMILARITY_REASON_LABELS[kind]}${countText}`;
}

function getSimilarityPeerSummary(similarity: SimilarityRecord, currentBlockId: number) {
	if (similarity.idea_block_id_1 === currentBlockId) {
		return similarity.idea_block_2.summary || "Idea block";
	}
	return similarity.idea_block_1.summary || "Idea block";
}

function getManualCuePairCount(selectedBlockCount: number) {
	return Math.max(0, selectedBlockCount - 1);
}

function isBoardStateMessage(message: RealtimeMessage | null): message is BoardStateMessage {
	return message?.type === "board_state";
}

function isJoinRejectedMessage(message: RealtimeMessage | null): message is RealtimeMessage & { type: "join_rejected"; message?: string } {
	return message?.type === "join_rejected";
}

function isRankingSnapshot(value: unknown): value is RankingSnapshot {
	return (
		typeof value === "object" &&
		value !== null &&
		"revision" in value &&
		typeof value.revision === "number" &&
		"items" in value &&
		Array.isArray(value.items) &&
		value.items.every(item => typeof item === "string") &&
		(!("change_count" in value) || typeof value.change_count === "number")
	);
}

function isTaskConfigItemList(value: unknown): value is TaskConfigItem[] {
	return Array.isArray(value) && value.every(item => typeof item === "object" && item !== null && "id" in item && typeof item.id === "string" && "label" in item && typeof item.label === "string");
}

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const seen = new Set<string>();
	const normalized: string[] = [];
	value.forEach(item => {
		const id = String(item ?? "").trim();
		if (!id || seen.has(id)) {
			return;
		}
		seen.add(id);
		normalized.push(id);
	});
	return normalized;
}

function normalizeNumberList(value: unknown): number[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const seen = new Set<number>();
	const normalized: number[] = [];
	value.forEach(item => {
		const id = Number(item);
		if (!Number.isInteger(id) || id <= 0 || seen.has(id)) {
			return;
		}
		seen.add(id);
		normalized.push(id);
	});
	return normalized;
}

function normalizeNumberValue(value: unknown, fallback: number) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeOptionalNumberValue(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeOptionalStringValue(value: unknown): string | null {
	const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
	return text || null;
}

function normalizeOptionalStringValues(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const seen = new Set<string>();
	const normalized: string[] = [];
	value.forEach(item => {
		const text = normalizeOptionalStringValue(item);
		if (!text || seen.has(text)) {
			return;
		}
		seen.add(text);
		normalized.push(text);
	});
	return normalized;
}

function isAdminRankingStateMessage(message: RealtimeMessage | null): message is AdminRankingStateMessage {
	if (message?.type !== "admin_ranking_state" || !isRankingSnapshot(message.public_ranking)) {
		return false;
	}
	const privateRankings = message.private_rankings;
	return typeof privateRankings === "object" && privateRankings !== null && Object.values(privateRankings).every(isRankingSnapshot);
}

function readNestedAdminRankingState(message: RealtimeMessage): AdminRankingStateMessage | null {
	const rankingState = message.ranking_state;
	return isAdminRankingStateMessage(rankingState as RealtimeMessage | null) ? (rankingState as AdminRankingStateMessage) : null;
}

function isParticipantTranscriptMessage(message: RealtimeMessage | null): message is ParticipantTranscriptMessage {
	return message?.type === "participant_transcript" && typeof message.participant_id === "string" && typeof message.text === "string";
}

function isPresenceStateMessage(message: RealtimeMessage | null): message is PresenceStateMessage {
	return message?.type === "presence_state";
}

function isIdeaBlocksUpdateMessage(message: RealtimeMessage | null): message is IdeaBlocksUpdateMessage {
	return message?.type === "idea_blocks_update";
}

function isAudioTerminalErrorMessage(message: RealtimeMessage | null): message is AudioTerminalErrorMessage {
	return message?.type === "transcript_error" || message?.type === "pipeline_error" || message?.type === "asr_error";
}

function isPublicContextComponentStateMessage(message: RealtimeMessage | null): message is PublicContextComponentStateMessage {
	return message?.type === "public_context_component_state";
}

function normalizePresenceParticipants(message: PresenceStateMessage) {
	return normalizePresenceParticipantsPayload(message, { includeAdmin: false });
}

function participantIdToNumber(value: string | number | null | undefined) {
	const numericId = Number(value);
	return Number.isInteger(numericId) ? numericId : 0;
}

function normalizeWsIdeaBlock(item: unknown, fallbackParticipantId: string | number | undefined): IdeaBlockRecord | null {
	if (!item || typeof item !== "object" || !("id" in item)) {
		return null;
	}

	const block = item as Record<string, unknown>;
	const id = Number(block.id);
	if (!Number.isInteger(id)) {
		return null;
	}

	return {
		id,
		user_id: participantIdToNumber(block.user_id as string | number | null | undefined) || participantIdToNumber(fallbackParticipantId),
		session_name: typeof block.session_name === "string" ? block.session_name : "",
		title: typeof block.title === "string" ? block.title : undefined,
		summary: typeof block.summary === "string" ? block.summary : undefined,
		transcript: typeof block.transcript === "string" ? block.transcript : null,
		similarity_id: typeof block.similarity_id === "number" ? block.similarity_id : null,
		content: typeof block.content === "string" ? block.content : undefined
	};
}

function upsertById<T extends { id: string | number }>(current: T[], nextItems: T[]) {
	const byId = new Map(current.map(item => [item.id, item]));
	nextItems.forEach(item => {
		byId.set(item.id, { ...byId.get(item.id), ...item });
	});
	return Array.from(byId.values());
}

function isOwnTranscriptUser(userId: string | number | null | undefined, participantId: string): boolean {
	if (userId == null) {
		return false;
	}

	const userIdText = String(userId);
	return userIdText === participantId || Number(userIdText) === participantIdToNumber(participantId);
}

function chatMessageResponseToMessage(item: ChatMessageResponse, participantId: string): PublicChatMessage {
	const timestampMs = Date.parse(item.time_stamp);
	return {
		id: String(item.id),
		sessionName: item.session_name,
		userId: String(item.user_id),
		displayName: item.display_name ?? undefined,
		message: item.message,
		time: formatApiTime(timestampMs),
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
		time: formatApiTime(timestampMs),
		timestampMs,
		isOwn: isOwnTranscriptUser(payload.userId, participantId),
		isDeleted: payload.isDeleted ?? false,
		clientMessageId: payload.clientMessageId
	};
}

function sortPublicChatMessages(messages: PublicChatMessage[]) {
	return [...messages].sort((left, right) => {
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

function mergePublicChatMessages(baseMessages: PublicChatMessage[], nextMessages: PublicChatMessage[]) {
	const byId = new Map(baseMessages.map(message => [message.id, message]));
	nextMessages.forEach(message => {
		const normalizedMessage = message.message.trim();
		if (!normalizedMessage) {
			return;
		}
		const pendingMessage = !byId.has(message.id) ? baseMessages.find(item => isMatchingPendingPublicChatMessage(item, { ...message, message: normalizedMessage })) : undefined;
		if (pendingMessage) {
			byId.delete(pendingMessage.id);
		}
		byId.set(message.id, {
			...pendingMessage,
			...byId.get(message.id),
			...message,
			clientMessageId: message.clientMessageId ?? pendingMessage?.clientMessageId,
			isPending: message.isPending ?? false,
			message: normalizedMessage,
			timestampMs: message.timestampMs ?? byId.get(message.id)?.timestampMs ?? pendingMessage?.timestampMs
		});
	});
	return sortPublicChatMessages([...byId.values()]);
}

function getRankConflict(itemId: string | undefined, publicRank: number, privateRankIndexById: Map<string, number>) {
	if (!itemId) {
		return null;
	}
	const privateRank = privateRankIndexById.get(itemId);
	if (privateRank == null) {
		return null;
	}
	const delta = privateRank - publicRank;
	return {
		amount: Math.abs(delta),
		direction: delta < 0 ? "up" : "down",
		isConflict: Math.abs(delta) > PRIVATE_PUBLIC_RANK_CONFLICT_THRESHOLD
	} as const;
}

function useAdminRealtimeSocket(source: "admin" | "board", sessionId: string, adminClientId: string, onEvent: (source: "admin" | "board", message: RealtimeMessage) => void) {
	const [isConnected, setIsConnected] = useState(false);
	const [lastMessage, setLastMessage] = useState<RealtimeMessage | null>(null);
	const retryCountRef = useRef(0);
	const retryTimerRef = useRef<number | null>(null);
	const onEventRef = useRef(onEvent);
	const socketRef = useRef<WebSocket | null>(null);

	useEffect(() => {
		onEventRef.current = onEvent;
	}, [onEvent]);

	useEffect(() => {
		let disposed = false;
		let socket: WebSocket | null = null;

		const connect = () => {
			if (!sessionId || disposed) {
				return;
			}

			const queryParam = source === "admin" ? `admin_id=${encodeURIComponent(adminClientId)}` : `participant_id=${encodeURIComponent(adminClientId)}`;
			const wsUrl = `${getWsBaseUrl()}/ws/sessions/${encodeURIComponent(sessionId)}/${source}?${queryParam}`;
			socket = new WebSocket(wsUrl);
			socketRef.current = socket;

			socket.onopen = () => {
				retryCountRef.current = 0;
				setIsConnected(true);
				socket?.send(
					JSON.stringify({
						type: "join",
						participant_id: adminClientId
					})
				);
			};

			socket.onmessage = event => {
				let parsedMessage: RealtimeMessage;
				try {
					parsedMessage = JSON.parse(event.data) as RealtimeMessage;
				} catch {
					parsedMessage = { type: "raw_message", payload: event.data };
				}
				setLastMessage(parsedMessage);
				onEventRef.current(source, parsedMessage);
			};

			socket.onclose = event => {
				setIsConnected(false);
				if (event.code === 1008) {
					return;
				}
				if (!disposed && retryCountRef.current < 5) {
					retryCountRef.current += 1;
					retryTimerRef.current = window.setTimeout(connect, 3000);
				}
			};

			socket.onerror = () => {
				socket?.close();
			};
		};

		connect();

		return () => {
			disposed = true;
			if (retryTimerRef.current !== null) {
				window.clearTimeout(retryTimerRef.current);
			}
			socket?.close();
		};
	}, [adminClientId, sessionId, source]);

	const sendMessage = useCallback((msg: object) => {
		if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
			socketRef.current.send(JSON.stringify(msg));
		}
	}, []);

	return { isConnected, lastMessage, sendMessage };
}

function useAdminPresenceSocket(sessionId: string, adminClientId: string, onEvent: (source: "presence", message: RealtimeMessage) => void) {
	const [isConnected, setIsConnected] = useState(false);
	const retryCountRef = useRef(0);
	const retryTimerRef = useRef<number | null>(null);
	const onEventRef = useRef(onEvent);

	useEffect(() => {
		onEventRef.current = onEvent;
	}, [onEvent]);

	useEffect(() => {
		let disposed = false;
		let socket: WebSocket | null = null;

		const connect = () => {
			if (!sessionId || disposed) {
				return;
			}

			const wsUrl = `${getWsBaseUrl()}/ws/sessions/${encodeURIComponent(sessionId)}/presence?participant_id=${encodeURIComponent(adminClientId)}`;
			socket = new WebSocket(wsUrl);

			socket.onopen = () => {
				retryCountRef.current = 0;
				setIsConnected(true);
				socket?.send(JSON.stringify({ type: "join", participant_id: adminClientId }));
			};

			socket.onmessage = event => {
				let parsedMessage: RealtimeMessage;
				try {
					parsedMessage = JSON.parse(event.data) as RealtimeMessage;
				} catch {
					parsedMessage = { type: "raw_message", payload: event.data };
				}
				onEventRef.current("presence", parsedMessage);
			};

			socket.onclose = event => {
				setIsConnected(false);
				if (event.code === 1008) {
					return;
				}
				if (!disposed && retryCountRef.current < 5) {
					retryCountRef.current += 1;
					retryTimerRef.current = window.setTimeout(connect, 3000);
				}
			};

			socket.onerror = () => {
				socket?.close();
			};
		};

		connect();

		return () => {
			disposed = true;
			if (retryTimerRef.current !== null) {
				window.clearTimeout(retryTimerRef.current);
			}
			socket?.close();
		};
	}, [adminClientId, sessionId]);

	return { isConnected };
}

function ConnectionBadge({ connected }: { connected: boolean }) {
	return (
		<Badge variant={connected ? "secondary" : "outline"} className={cn("gap-2", connected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "text-muted-foreground")}>
			<span className={cn("h-2 w-2 rounded-full", connected ? "bg-emerald-500" : "bg-muted-foreground")} />
			{connected ? "connected" : "disconnected"}
		</Badge>
	);
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
	return (
		<div className="grid min-h-32 place-items-center rounded-lg border border-dashed bg-background p-4 text-center">
			<div>
				<p className="text-sm font-medium">{title}</p>
				<p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{detail}</p>
			</div>
		</div>
	);
}

function AdminPhaseTimer({ endTimeMs }: { endTimeMs: number }) {
	const [timeLeft, setTimeLeft] = useState(() => Math.max(0, Math.floor((endTimeMs - Date.now()) / 1000)));

	useEffect(() => {
		const updateTimer = () => {
			setTimeLeft(Math.max(0, Math.floor((endTimeMs - Date.now()) / 1000)));
		};
		updateTimer();
		const timer = window.setInterval(updateTimer, 1000);
		return () => window.clearInterval(timer);
	}, [endTimeMs]);

	const minutes = Math.floor(timeLeft / 60);
	const seconds = timeLeft % 60;
	return (
		<span className="font-mono text-sm font-semibold">
			{minutes}:{seconds.toString().padStart(2, "0")}
		</span>
	);
}

export function AdminPage() {
	const roomName = useMemo(() => getRoomName(), []);
	const adminClientId = useMemo(() => createAdminClientId(), []);
	const [activeTab, setActiveTab] = useState<AdminTab>("ranking");
	const [boardState, setBoardState] = useState<BoardStateMessage | null>(null);
	const [adminRankingState, setAdminRankingState] = useState<AdminRankingStateMessage | null>(null);
	const [participants, setParticipants] = useState<ParticipantPresence[]>([]);
	const [transcripts, setTranscripts] = useState<TranscriptRecord[]>([]);
	const [ideaBlocks, setIdeaBlocks] = useState<IdeaBlockRecord[]>([]);
	const [similarities, setSimilarities] = useState<SimilarityRecord[]>([]);
	const [publicChatMessages, setPublicChatMessages] = useState<PublicChatMessage[]>([]);
	const [publicChatText, setPublicChatText] = useState("");
	const [publicChatError, setPublicChatError] = useState<string | null>(null);
	const [isSendingPublicChat, setIsSendingPublicChat] = useState(false);
	const [isApiLoading, setIsApiLoading] = useState(false);
	const [apiError, setApiError] = useState<string | null>(null);
	const [lastApiLoadedAt, setLastApiLoadedAt] = useState<string | null>(null);
	const [isExportingTaskPackage, setIsExportingTaskPackage] = useState(false);
	const [taskPackageError, setTaskPackageError] = useState<string | null>(null);
	const [lastTaskPackageDownloadedAt, setLastTaskPackageDownloadedAt] = useState<string | null>(null);
	const [roleUpdatingParticipantId, setRoleUpdatingParticipantId] = useState<string | null>(null);
	const [participantRoleError, setParticipantRoleError] = useState<string | null>(null);
	const [latestTranscripts, setLatestTranscripts] = useState<Record<string, LatestParticipantTranscript>>({});
	const [taskItems, setTaskItems] = useState<TaskConfigItem[]>([]);
	const [phase1Components, setPhase1Components] = useState<Phase1BuilderOption[]>([]);
	const [query, setQuery] = useState("");
	const [selectedUserId, setSelectedUserId] = useState<number | "all">("all");
	const [selectedCueBlockIds, setSelectedCueBlockIds] = useState<number[]>([]);
	const [manualCueReasonType, setManualCueReasonType] = useState<ManualCueReasonType>("same");
	const [isCreatingManualCue, setIsCreatingManualCue] = useState(false);
	const [undoingManualCueId, setUndoingManualCueId] = useState<number | null>(null);
	const [manualCueError, setManualCueError] = useState<string | null>(null);
	const [publicNowComponentIds, setPublicNowComponentIds] = useState<string[]>([]);
	const [publicNowTaskItemIds, setPublicNowTaskItemIds] = useState<number[]>([]);
	const [publicNowSource, setPublicNowSource] = useState<PublicNowSource | null>(null);
	const [publicNowMatchCount, setPublicNowMatchCount] = useState(0);
	const [publicNowDeliveredCount, setPublicNowDeliveredCount] = useState(0);
	const [publicNowDiagnostics, setPublicNowDiagnostics] = useState<PublicNowDiagnostics>(EMPTY_PUBLIC_NOW_DIAGNOSTICS);
	const [isSettingPublicNow, setIsSettingPublicNow] = useState(false);
	const [publicNowError, setPublicNowError] = useState<string | null>(null);
	const [clockNowMs, setClockNowMs] = useState(() => Date.now());
	const [currentPhase, setCurrentPhase] = useState<SessionPhase>(DEFAULT_SESSION_PHASE);
	const [taskPhases, setTaskPhases] = useState<SessionPhaseOption[]>(DEFAULT_SESSION_PHASE_OPTIONS);
	const [cueCondition, setCueCondition] = useState<CueCondition>("experimental");
	const [timerEndTime, setTimerEndTime] = useState(0);
	const [countdownDurationMinutes, setCountdownDurationMinutes] = useState("15");
	const [leftSidebarWidth, setLeftSidebarWidth] = useState(() => {
		const storedWidth = Number(window.localStorage.getItem(ADMIN_LEFT_SIDEBAR_WIDTH_STORAGE_KEY));
		return clampAdminLeftSidebarWidth(Number.isFinite(storedWidth) ? storedWidth : DEFAULT_ADMIN_LEFT_SIDEBAR_WIDTH, DEFAULT_ADMIN_RIGHT_SIDEBAR_WIDTH);
	});
	const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
		const storedWidth = Number(window.localStorage.getItem(ADMIN_RIGHT_SIDEBAR_WIDTH_STORAGE_KEY));
		return clampAdminRightSidebarWidth(Number.isFinite(storedWidth) ? storedWidth : DEFAULT_ADMIN_RIGHT_SIDEBAR_WIDTH, DEFAULT_ADMIN_LEFT_SIDEBAR_WIDTH);
	});
	const [resizeCursor, setResizeCursor] = useState<"col-resize" | null>(null);
	const [rankingsCopied, setRankingsCopied] = useState(false);
	const [highlightedIdeaBlockIds, setHighlightedIdeaBlockIds] = useState<number[]>([]);
	const [pendingJumpBlockIds, setPendingJumpBlockIds] = useState<number[]>([]);
	const publicChatMessagesRef = useRef<PublicChatMessage[]>([]);
	const ideaBlockRefs = useRef(new Map<number, HTMLElement>());
	const jumpHighlightTimerRef = useRef<number | null>(null);
	const rankingLabels = useMemo(() => Object.fromEntries(taskItems.map(item => [item.id, item.label])), [taskItems]);
	const defaultRankingItemIds = useMemo(() => taskItems.map(item => item.id), [taskItems]);
	const phase1ComponentById = useMemo(() => new Map(phase1Components.map(component => [component.id, component])), [phase1Components]);
	const publicNowTaskItemTargets = useMemo<PublicNowTarget[]>(
		() =>
			taskItems.map((item, index) => {
				const label = item.label_zh || item.label || item.label_en || item.id;
				return {
					kind: "task_item",
					id: item.id,
					taskItemId: index + 1,
					label,
					title: item.label_en ? `${label} / ${item.label_en}` : label
				};
			}),
		[taskItems]
	);
	const publicNowTaskItemTargetById = useMemo(
		() => new Map(publicNowTaskItemTargets.filter((target): target is Extract<PublicNowTarget, { kind: "task_item" }> => target.kind === "task_item").map(target => [target.taskItemId, target])),
		[publicNowTaskItemTargets]
	);
	const publicNowTargets = useMemo<PublicNowTarget[]>(
		() =>
			phase1Components.length > 0
				? phase1Components.map(component => {
						const label = component.label_zh || component.label_en || component.id;
						return {
							kind: "component",
							id: component.id,
							label,
							title: component.label_en ? `${label} / ${component.label_en}` : label
						};
					})
				: publicNowTaskItemTargets,
		[phase1Components, publicNowTaskItemTargets]
	);
	const participantNameById = useMemo(() => {
		const nextParticipantNameById = new Map<string, string>();
		participants.forEach(participant => {
			nextParticipantNameById.set(participant.id, formatParticipantDisplayName(participant.id, participant.display_name) ?? participant.id);
		});
		return nextParticipantNameById;
	}, [participants]);
	const participantRoleById = useMemo(() => {
		const nextParticipantRoleById = new Map<string, ParticipantRole>();
		participants.forEach(participant => {
			nextParticipantRoleById.set(participant.id, normalizeParticipantRole(participant.participant_role));
		});
		return nextParticipantRoleById;
	}, [participants]);
	const analysisParticipantCount = useMemo(() => participants.filter(participant => isParticipantAnalysisRole(participant.participant_role)).length, [participants]);
	const adminRankingParticipantCount = useMemo(() => participants.filter(participant => isAdminRankingRole(participant.participant_role)).length, [participants]);
	const transcriptionEnabledCount = useMemo(() => participants.filter(participant => participant.transcription_enabled).length, [participants]);
	const nonRankingParticipantCount = participants.length - adminRankingParticipantCount;
	const isAdminRankingParticipantId = useCallback(
		(participantId: string | number | null | undefined) => isAdminRankingRole(participantRoleById.get(String(participantId ?? ""))),
		[participantRoleById]
	);
	const getParticipantLabel = useCallback(
		(participantId: string | number | null | undefined) => {
			const normalizedParticipantId = participantId == null ? "" : String(participantId);
			return participantNameById.get(normalizedParticipantId) ?? formatParticipantDisplayName(normalizedParticipantId) ?? normalizedParticipantId;
		},
		[participantNameById]
	);
	const adminLayoutStyle = {
		"--admin-left-sidebar-width": `${leftSidebarWidth}px`,
		"--admin-right-sidebar-width": `${rightSidebarWidth}px`
	} as CSSProperties;

	const loadAdminApiData = useCallback(async () => {
		setIsApiLoading(true);
		setApiError(null);

		try {
			const [transcriptsResponse, ideaBlocksResponse, similaritiesResponse] = await Promise.all([
				fetch(buildSessionApiUrl(roomName, "/transcripts")),
				fetch(buildSessionApiUrl(roomName, "/idea-blocks")),
				fetch(buildSessionApiUrl(roomName, "/similarities"))
			]);

			if (!transcriptsResponse.ok) {
				throw new Error(`Failed to load transcripts (${transcriptsResponse.status})`);
			}
			if (!ideaBlocksResponse.ok) {
				throw new Error(`Failed to load idea blocks (${ideaBlocksResponse.status})`);
			}
			if (!similaritiesResponse.ok) {
				throw new Error(`Failed to load similarities (${similaritiesResponse.status})`);
			}

			const [nextTranscripts, nextIdeaBlocks, nextSimilarities] = (await Promise.all([transcriptsResponse.json(), ideaBlocksResponse.json(), similaritiesResponse.json()])) as [
				TranscriptRecord[],
				IdeaBlockRecord[],
				SimilarityRecord[]
			];
			setTranscripts(current => upsertById(current, nextTranscripts));
			setIdeaBlocks(current => upsertById(current, nextIdeaBlocks));
			setSimilarities(nextSimilarities);
			setLastApiLoadedAt(
				new Intl.DateTimeFormat("zh-TW", {
					hour: "2-digit",
					minute: "2-digit",
					second: "2-digit",
					hour12: false
				}).format(new Date())
			);
		} catch (error) {
			setApiError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsApiLoading(false);
		}
	}, [roomName]);

	const loadChatHistory = useCallback(async () => {
		try {
			const response = await fetch(buildSessionApiUrl(roomName, "/chat-messages"));
			if (!response.ok) return;
			const chatMessagesFromDb = ((await response.json()) as ChatMessageResponse[]).map(item => chatMessageResponseToMessage(item, adminClientId));
			setPublicChatMessages(prev => mergePublicChatMessages(chatMessagesFromDb, prev));
		} catch (error) {
			console.warn("[admin] failed to load chat history", error);
		}
	}, [adminClientId, roomName]);

	useEffect(() => {
		publicChatMessagesRef.current = publicChatMessages;
	}, [publicChatMessages]);

	useEffect(() => {
		const timer = window.setInterval(() => setClockNowMs(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, []);

	const recordEvent = (message: RealtimeMessage) => {
		const receivedAtMs = Date.now();
		const receivedAt = new Intl.DateTimeFormat("zh-TW", {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false
		}).format(new Date(receivedAtMs));

		const nextPhase = normalizeSessionPhase(message.phase) ?? normalizeSessionPhase(message.current_phase);
		if (nextPhase) {
			setCurrentPhase(nextPhase);
		}
		if (typeof message.end_time_ms === "number") {
			setTimerEndTime(message.end_time_ms);
		} else if (typeof message.timer_end_time_ms === "number") {
			setTimerEndTime(message.timer_end_time_ms);
		}
		const nextCueCondition = normalizeCueCondition(message.cue_condition) ?? normalizeCueCondition(message.condition);
		if (nextCueCondition) {
			setCueCondition(nextCueCondition);
		}
		if (isPublicContextComponentStateMessage(message)) {
			const stateUpdatedAtMs = normalizeOptionalNumberValue(message.stateUpdatedAtMs ?? message.state_updated_at_ms ?? message.timestamp_ms);
			const eventTimestampMs = normalizeOptionalNumberValue(message.eventTimestampMs ?? message.event_timestamp_ms);
			const adminBroadcastAtMs = normalizeOptionalNumberValue(message.adminBroadcastAtMs ?? message.admin_broadcast_at_ms);
			const eventToAdminBroadcastMs = normalizeOptionalNumberValue(message.eventToAdminBroadcastMs ?? message.event_to_admin_broadcast_ms);
			setPublicNowComponentIds(normalizeStringList(message.componentIds ?? message.component_ids));
			setPublicNowTaskItemIds(normalizeNumberList(message.taskItemIds ?? message.task_item_ids));
			setPublicNowSource(typeof message.source === "string" ? message.source : null);
			setPublicNowMatchCount(normalizeNumberValue(message.matchCount ?? message.match_count, 0));
			setPublicNowDeliveredCount(normalizeNumberValue(message.deliveredCount ?? message.delivered_count, 0));
			setPublicNowDiagnostics({
				stateUpdatedAtMs,
				adminBroadcastAtMs,
				receivedAtMs,
				eventTimestampMs,
				eventToAdminBroadcastMs,
				eventToStateMs: normalizeOptionalNumberValue(message.eventToStateMs ?? message.event_to_state_ms),
				displayLatencyMs: eventToAdminBroadcastMs ?? (eventTimestampMs === null ? null : Math.max(0, receivedAtMs - eventTimestampMs)),
				matchingDurationMs: normalizeOptionalNumberValue(message.matchingDurationMs ?? message.matching_duration_ms),
				queueDelayMs: normalizeOptionalNumberValue(message.queueDelayMs ?? message.queue_delay_ms),
				debounceMs: normalizeOptionalNumberValue(message.debounceMs ?? message.debounce_ms),
				textChars: normalizeOptionalNumberValue(message.textChars ?? message.text_chars),
				contextChars: normalizeOptionalNumberValue(message.contextChars ?? message.context_chars),
				targetParticipantCount: normalizeOptionalNumberValue(message.targetParticipantCount ?? message.target_participant_count),
				boardConnectionCount: normalizeOptionalNumberValue(message.boardConnectionCount ?? message.board_connection_count),
				adminConnectionCount: normalizeOptionalNumberValue(message.adminConnectionCount ?? message.admin_connection_count),
				transcriptSegmentId: normalizeOptionalStringValue(message.transcriptSegmentId ?? message.transcript_segment_id)
			});
			setIsSettingPublicNow(false);
			setPublicNowError(null);
		}
		if (message.type === "public_context_component_error") {
			setIsSettingPublicNow(false);
			setPublicNowError(typeof message.reason === "string" ? message.reason : "NOW component update failed");
		}

		if (isBoardStateMessage(message)) {
			setBoardState(message);
			if (isTaskConfigItemList(message.ranking_items)) {
				setTaskItems(message.ranking_items);
			}
		}

		const nestedAdminRankingState = readNestedAdminRankingState(message);
		if (nestedAdminRankingState) {
			setAdminRankingState(nestedAdminRankingState);
			if (isTaskConfigItemList(nestedAdminRankingState.ranking_items)) {
				setTaskItems(nestedAdminRankingState.ranking_items);
			}
		}

		if (isAdminRankingStateMessage(message)) {
			setAdminRankingState(message);
			if (isTaskConfigItemList(message.ranking_items)) {
				setTaskItems(message.ranking_items);
			}
		}

		if (message.type === "ranking_state") {
			const scope = message.scope === "private" ? "private" : "public";
			const updatedBy = typeof message.updatedBy === "string" && !isAdminParticipantId(message.updatedBy) ? message.updatedBy : null;
			const nextSnapshot = {
				revision: typeof message.revision === "number" ? message.revision : 0,
				items: Array.isArray(message.items) ? (message.items as string[]) : []
			};

			setBoardState(current => ({
				type: "board_state",
				revision: typeof message.revision === "number" ? message.revision : current?.revision || 0,
				ranking: { items: scope === "public" ? nextSnapshot.items : current?.ranking?.items || [] },
				public_ranking: scope === "public" ? nextSnapshot : current?.public_ranking,
				private_rankings:
					scope === "private" && updatedBy
						? {
								...(current?.private_rankings ?? {}),
								[updatedBy]: nextSnapshot
							}
						: current?.private_rankings,
				session_name: roomName
			}));
		}

		if (isParticipantTranscriptMessage(message)) {
			const transcriptText = message.text ?? "";
			const transcriptId = message.transcript_segment_id ?? message.timestamp_ms ?? `${message.participant_id}-${receivedAt}`;
			const timeStamp = typeof message.timestamp_ms === "number" ? new Date(message.timestamp_ms).toISOString() : new Date().toISOString();
			const scope = typeof message.scope === "string" ? message.scope : "unknown";
			const transcriptRecord: TranscriptRecord = {
				id: transcriptId,
				user_id: participantIdToNumber(message.participant_id),
				session_name: typeof message.session_name === "string" ? message.session_name : roomName,
				time_stamp: timeStamp,
				transcript: transcriptText.trim()
			};
			setTranscripts(current => upsertById(current, [transcriptRecord]));
			setLatestTranscripts(current => ({
				...current,
				[message.participant_id]: {
					scope,
					text: transcriptText.trim(),
					isFinal: message.is_final === true,
					persisted: message.persisted === true,
					receivedAt,
					transcriptSegmentId: normalizeOptionalStringValue(message.transcript_segment_id ?? transcriptId),
					ideaBlockStatus: getInitialLatestTranscriptIdeaBlockStatus({
						scope,
						persisted: message.persisted === true
					})
				}
			}));
		}

		if (isPresenceStateMessage(message)) {
			setParticipants(normalizePresenceParticipants(message));
		}

		if (isIdeaBlocksUpdateMessage(message)) {
			const ideaBlockItems = Array.isArray(message.idea_blocks) ? message.idea_blocks : [];
			const participantId = normalizeOptionalStringValue(message.participant_id);
			const nextBlocks = ideaBlockItems.map(item => normalizeWsIdeaBlock(item, participantId ?? undefined)).filter((item): item is IdeaBlockRecord => item !== null);
			setIdeaBlocks(current => upsertById(current, nextBlocks));
			if (participantId && message.generation_complete === true) {
				const completionTranscriptSegmentIds = [normalizeOptionalStringValue(message.transcript_segment_id), ...normalizeOptionalStringValues(message.transcript_segment_ids)].filter(
					(id): id is string => !!id
				);
				setLatestTranscripts(current => {
					const latestTranscript = current[participantId];
					if (!latestTranscript) {
						return current;
					}
					const ideaBlockStatus = getLatestTranscriptIdeaBlockStatusAfterUpdate(latestTranscript, {
						generationComplete: message.generation_complete === true,
						ideaBlockCount: ideaBlockItems.length,
						transcriptSegmentIds: completionTranscriptSegmentIds
					});
					if (ideaBlockStatus === latestTranscript.ideaBlockStatus) {
						return current;
					}
					return {
						...current,
						[participantId]: {
							...latestTranscript,
							ideaBlockStatus
						}
					};
				});
			}
		}

		if (isAudioTerminalErrorMessage(message)) {
			const participantId = normalizeOptionalStringValue(message.participant_id ?? message.user_id ?? message.userId);
			if (participantId) {
				const errorTranscriptSegmentIds = [normalizeOptionalStringValue(message.transcript_segment_id), ...normalizeOptionalStringValues(message.transcript_segment_ids)].filter(
					(id): id is string => !!id
				);
				setLatestTranscripts(current => {
					const latestTranscript = current[participantId];
					if (!latestTranscript) {
						return current;
					}
					if (!latestTranscriptMatchesSegmentIds(latestTranscript, errorTranscriptSegmentIds)) {
						return current;
					}
					if (latestTranscript.ideaBlockStatus === "failed") {
						return current;
					}
					return {
						...current,
						[participantId]: {
							...latestTranscript,
							ideaBlockStatus: "failed"
						}
					};
				});
			}
		}

		if (message.type === "public_chat_message") {
			const chatPayload = message.payload as PublicChatMessagePayload;
			setPublicChatMessages(prev => {
				const nextMessages = mergePublicChatMessages(prev, [publicChatPayloadToMessage(chatPayload, adminClientId)]);
				setIsSendingPublicChat(nextMessages.some(item => item.isOwn && item.isPending));
				return nextMessages;
			});
		}

		if (message.type === "public_chat_error") {
			const failedClientMessageId = typeof message.clientMessageId === "string" ? message.clientMessageId : null;
			const failedPendingMessage = failedClientMessageId
				? publicChatMessagesRef.current.find(item => item.clientMessageId === failedClientMessageId && item.isPending)
				: publicChatMessagesRef.current.find(item => item.isOwn && item.isPending);
			if (failedPendingMessage?.clientMessageId) {
				setPublicChatMessages(prev => {
					const nextMessages = removePendingPublicChatMessage(prev, failedPendingMessage.clientMessageId || "");
					setIsSendingPublicChat(nextMessages.some(item => item.isOwn && item.isPending));
					return nextMessages;
				});
				setPublicChatText(current => current || failedPendingMessage.message);
			} else {
				setIsSendingPublicChat(publicChatMessagesRef.current.some(item => item.isOwn && item.isPending));
			}
			setPublicChatError((message.reason as string) || "公開訊息傳送失敗");
		}
	};

	useEffect(() => {
		const initialTimer = window.setTimeout(() => {
			void loadAdminApiData();
			void loadChatHistory();
		}, 0);
		const timer = window.setInterval(() => {
			void loadAdminApiData();
		}, API_REFRESH_INTERVAL_MS);

		return () => {
			window.clearTimeout(initialTimer);
			window.clearInterval(timer);
		};
	}, [loadAdminApiData, loadChatHistory]);

	useEffect(() => {
		const abortController = new AbortController();

		const loadTaskConfig = async () => {
			try {
				const taskConfig = await fetchTaskConfig({ sessionName: roomName, signal: abortController.signal });
				setTaskItems(taskConfig.items);
				setPhase1Components(taskConfig.phase1_builder?.components ?? []);
				const nextTaskPhases = normalizeSessionPhaseOptions(taskConfig.phases);
				setTaskPhases(nextTaskPhases);
				setCurrentPhase(current => (nextTaskPhases.some(phase => phase.id === current) ? current : (nextTaskPhases[0]?.id ?? DEFAULT_SESSION_PHASE)));
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") {
					return;
				}
				console.error("Failed to load task config", error);
			}
		};

		void loadTaskConfig();

		return () => abortController.abort();
	}, [roomName]);

	useEffect(() => {
		const handleResize = () => {
			setLeftSidebarWidth(currentLeft => {
				const nextLeft = clampAdminLeftSidebarWidth(currentLeft, rightSidebarWidth);
				setRightSidebarWidth(currentRight => clampAdminRightSidebarWidth(currentRight, nextLeft));
				return nextLeft;
			});
		};

		handleResize();
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, [rightSidebarWidth]);

	useEffect(() => {
		window.localStorage.setItem(ADMIN_LEFT_SIDEBAR_WIDTH_STORAGE_KEY, String(leftSidebarWidth));
	}, [leftSidebarWidth]);

	useEffect(() => {
		window.localStorage.setItem(ADMIN_RIGHT_SIDEBAR_WIDTH_STORAGE_KEY, String(rightSidebarWidth));
	}, [rightSidebarWidth]);

	const { isConnected: adminConnected, lastMessage: adminLastMessage, sendMessage: sendAdminMessage } = useAdminRealtimeSocket("admin", roomName, adminClientId, (_, msg) => recordEvent(msg));
	const { isConnected: boardConnected, lastMessage: boardLastMessage } = useAdminRealtimeSocket("board", roomName, adminClientId, (_, msg) => recordEvent(msg));
	const { isConnected: presenceConnected } = useAdminPresenceSocket(roomName, adminClientId, (_, msg) => recordEvent(msg));

	const joinRejectedMessage = (isJoinRejectedMessage(adminLastMessage) ? adminLastMessage.message : null) || (isJoinRejectedMessage(boardLastMessage) ? boardLastMessage.message : null);
	const handleLeftSidebarResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
		const resizeHandle = event.currentTarget;
		resizeHandle.setPointerCapture(event.pointerId);
		const startX = event.clientX;
		const startWidth = leftSidebarWidth;

		const handlePointerMove = (moveEvent: PointerEvent) => {
			setLeftSidebarWidth(clampAdminLeftSidebarWidth(startWidth + (moveEvent.clientX - startX), rightSidebarWidth));
		};

		const handlePointerUp = () => {
			if (resizeHandle.hasPointerCapture(event.pointerId)) {
				resizeHandle.releasePointerCapture(event.pointerId);
			}
			setResizeCursor(null);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			window.removeEventListener("pointercancel", handlePointerUp);
		};

		setResizeCursor("col-resize");
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
		window.addEventListener("pointercancel", handlePointerUp);
	};
	const handleRightSidebarResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
		const resizeHandle = event.currentTarget;
		resizeHandle.setPointerCapture(event.pointerId);
		const startX = event.clientX;
		const startWidth = rightSidebarWidth;

		const handlePointerMove = (moveEvent: PointerEvent) => {
			setRightSidebarWidth(clampAdminRightSidebarWidth(startWidth - (moveEvent.clientX - startX), leftSidebarWidth));
		};

		const handlePointerUp = () => {
			if (resizeHandle.hasPointerCapture(event.pointerId)) {
				resizeHandle.releasePointerCapture(event.pointerId);
			}
			setResizeCursor(null);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			window.removeEventListener("pointercancel", handlePointerUp);
		};

		setResizeCursor("col-resize");
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
		window.addEventListener("pointercancel", handlePointerUp);
	};
	const handleLeftSidebarResizeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
			return;
		}

		event.preventDefault();
		const direction = event.key === "ArrowRight" ? 1 : -1;
		setLeftSidebarWidth(current => clampAdminLeftSidebarWidth(current + direction * 24, rightSidebarWidth));
	};
	const handleRightSidebarResizeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
			return;
		}

		event.preventDefault();
		const direction = event.key === "ArrowLeft" ? 1 : -1;
		setRightSidebarWidth(current => clampAdminRightSidebarWidth(current + direction * 24, leftSidebarWidth));
	};
	const switchPhase = (phase: SessionPhase) => {
		sendAdminMessage({ type: "switch_phase", phase });
	};
	const startCountdown = (minutesValue: string) => {
		sendAdminMessage({ type: "set_countdown", duration_s: durationSecondsFromMinutes(minutesValue) });
	};
	const clearCountdown = () => {
		sendAdminMessage({ type: "set_countdown", duration_s: 0 });
	};
	const setSessionCueCondition = (condition: CueCondition) => {
		sendAdminMessage({ type: "set_cue_condition", condition });
		setCueCondition(condition);
	};
	const setPublicNowTargets = ({ componentIds = [], taskItemIds = [] }: { componentIds?: string[]; taskItemIds?: number[] }) => {
		if (isSettingPublicNow) {
			return;
		}
		setIsSettingPublicNow(true);
		setPublicNowError(null);
		sendAdminMessage({
			type: "set_public_context_components",
			componentIds,
			taskItemIds,
			clear: componentIds.length === 0 && taskItemIds.length === 0
		});
		window.setTimeout(() => {
			setIsSettingPublicNow(false);
		}, 5000);
	};
	const selectPublicNowTarget = (target: PublicNowTarget) => {
		if (target.kind === "component") {
			setPublicNowTargets({ componentIds: [target.id] });
			return;
		}
		setPublicNowTargets({ taskItemIds: [target.taskItemId] });
	};
	const clearPublicNowTargets = () => {
		if (publicNowComponentIds.length === 0 && publicNowTaskItemIds.length === 0) {
			return;
		}
		setPublicNowTargets({});
	};
	const toggleCueBlockSelection = (blockId: number) => {
		setManualCueError(null);
		setSelectedCueBlockIds(current => {
			if (current.includes(blockId)) {
				return current.filter(id => id !== blockId);
			}
			return [...current, blockId];
		});
	};
	const publicRankingSnapshot =
		adminRankingState?.public_ranking ?? boardState?.public_ranking ?? (boardState?.ranking?.items ? { revision: boardState.revision, items: boardState.ranking.items } : null);
	const publicRankingItems = publicRankingSnapshot ? getAdminRankingDisplayItemIds(publicRankingSnapshot, defaultRankingItemIds) : [];
	const privateRankingMap: Record<string, RankingSnapshot> = adminRankingState?.private_rankings ?? boardState?.private_rankings ?? {};
	const privateRankingEntries = Object.entries(privateRankingMap)
		.filter(([participantId]) => !isAdminParticipantId(participantId) && isAdminRankingParticipantId(participantId))
		.sort(([a], [b]) => Number(a) - Number(b));
	const privateRankingColumns = privateRankingEntries.map(([participantId, ranking]) => {
		const items = getAdminRankingDisplayItemIds(ranking, defaultRankingItemIds);
		return {
			key: `private-${participantId}`,
			label: getParticipantLabel(participantId),
			revision: ranking.revision,
			rankIndexById: new Map(items.map((item, index) => [item, index + 1]))
		};
	});

	const generateRankingsExport = () => {
		const privateOrderedItemsByUser = privateRankingEntries.map(([, ranking]) => getAdminRankingDisplayItemIds(ranking, defaultRankingItemIds));
		const maxLength = Math.max(publicRankingItems.length, ...privateOrderedItemsByUser.map(items => items.length));
		if (maxLength === 0) return null;

		const headers = ["排名", "公共排序", ...privateRankingEntries.map(([participantId]) => getParticipantLabel(participantId))];

		const rows = Array.from({ length: maxLength }, (_, index) => {
			const rank = String(index + 1);
			const publicItemId = publicRankingItems[index];
			const publicLabel = publicItemId ? (rankingLabels[publicItemId] ?? publicItemId) : "-";
			const privateLabels = privateOrderedItemsByUser.map(items => {
				const itemId = items[index];
				return itemId ? (rankingLabels[itemId] ?? itemId) : "-";
			});
			return [rank, publicLabel, ...privateLabels];
		});

		return [headers, ...rows].map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
	};

	const copyRankings = async () => {
		const text = generateRankingsExport();
		if (!text) return;
		await navigator.clipboard.writeText(text);
		setRankingsCopied(true);
		window.setTimeout(() => setRankingsCopied(false), 2000);
	};

	const downloadRankings = () => {
		const text = generateRankingsExport();
		if (!text) return;
		const blob = new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `${roomName}-rankings-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
		document.body.appendChild(anchor);
		anchor.click();
		document.body.removeChild(anchor);
		URL.revokeObjectURL(url);
	};

	const downloadTaskPackage = async () => {
		if (isExportingTaskPackage) {
			return;
		}

		setIsExportingTaskPackage(true);
		setTaskPackageError(null);
		try {
			const params = new URLSearchParams({ cue_condition: cueCondition });
			const response = await fetch(buildSessionApiUrl(roomName, `/task-package.zip?${params.toString()}`));
			if (!response.ok) {
				const detail = await response.text();
				throw new Error(detail || `Task package export failed (${response.status})`);
			}
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = getDownloadFilename(response, `${roomName}-task-package.zip`);
			document.body.appendChild(anchor);
			anchor.click();
			document.body.removeChild(anchor);
			URL.revokeObjectURL(url);
			setLastTaskPackageDownloadedAt(formatApiTime(Date.now()));
		} catch (error) {
			setTaskPackageError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsExportingTaskPackage(false);
		}
	};

	const setParticipantRole = async (participant: ParticipantPresence, nextRole: ParticipantRole) => {
		if (roleUpdatingParticipantId !== null || normalizeParticipantRole(participant.participant_role) === nextRole) {
			return;
		}

		setRoleUpdatingParticipantId(participant.id);
		setParticipantRoleError(null);
		try {
			const response = await fetch(buildSessionApiUrl(roomName, `/participants/${encodeURIComponent(participant.id)}/role`), {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ role: nextRole })
			});
			if (!response.ok) {
				const detail = await response.text();
				throw new Error(detail || `Failed to update participant role (${response.status})`);
			}
			const payload = (await response.json()) as { participant_role?: unknown };
			const confirmedRole = normalizeParticipantRole(payload.participant_role ?? nextRole);
			setParticipants(current =>
				current.map(item => (item.id === participant.id ? { ...item, participant_role: confirmedRole, transcription_enabled: isAudioTranscriptionRole(confirmedRole) } : item))
			);
		} catch (error) {
			setParticipantRoleError(error instanceof Error ? error.message : String(error));
		} finally {
			setRoleUpdatingParticipantId(null);
		}
	};

	const isExperimentalCondition = cueCondition === "experimental";
	const isSimilarityCueActive = isExperimentalCondition && isSimilarityCueDisplayPhase(currentPhase);
	const activePublicNowComponents = publicNowComponentIds.map(componentId => phase1ComponentById.get(componentId)).filter((component): component is Phase1BuilderOption => !!component);
	const activePublicNowTaskItems = publicNowTaskItemIds
		.map(taskItemId => publicNowTaskItemTargetById.get(taskItemId))
		.filter((target): target is Extract<PublicNowTarget, { kind: "task_item" }> => !!target);
	const activePublicNowLabels = [...activePublicNowComponents.map(component => component.label_zh || component.label_en || component.id), ...activePublicNowTaskItems.map(target => target.label)];
	const publicNowTargetCount = publicNowComponentIds.length + publicNowTaskItemIds.length;
	const publicNowLabel = buildPublicNowLabel({
		activeLabels: activePublicNowLabels,
		componentIds: publicNowComponentIds,
		taskItemIds: publicNowTaskItemIds,
		targetCount: publicNowTargetCount
	});
	const publicNowSourceLabel = publicNowSource === "manual" ? "manual" : publicNowSource === "auto" ? "auto" : publicNowSource === "manual_clear" ? "cleared" : "idle";
	const publicNowAgeMs = computePublicNowAgeMs({
		stateUpdatedAtMs: publicNowDiagnostics.stateUpdatedAtMs,
		adminBroadcastAtMs: publicNowDiagnostics.adminBroadcastAtMs,
		receivedAtMs: publicNowDiagnostics.receivedAtMs,
		nowMs: clockNowMs
	});
	const isPublicNowStateStale = isPublicNowStale({
		targetCount: publicNowTargetCount,
		ageMs: publicNowAgeMs,
		staleBudgetMs: PUBLIC_NOW_STALE_BUDGET_MS
	});
	const publicNowStatusLabel = publicNowTargetCount === 0 ? "none" : isPublicNowStateStale ? "STALE" : "fresh";
	const publicNowLatencyParts = [
		`age ${formatPublicNowLatency(publicNowAgeMs)}`,
		publicNowDiagnostics.displayLatencyMs !== null ? `display ${formatPublicNowLatency(publicNowDiagnostics.displayLatencyMs)}` : null,
		publicNowDiagnostics.eventToStateMs !== null ? `backend ${formatPublicNowLatency(publicNowDiagnostics.eventToStateMs)}` : null,
		publicNowDiagnostics.matchingDurationMs !== null ? `match ${formatPublicNowLatency(publicNowDiagnostics.matchingDurationMs)}` : null
	].filter(Boolean);
	const publicNowScaleParts =
		publicNowDiagnostics.eventTimestampMs === null
			? []
			: [
					publicNowDiagnostics.targetParticipantCount !== null ? `${publicNowDiagnostics.targetParticipantCount} participant targets` : null,
					publicNowDiagnostics.textChars !== null ? `${publicNowDiagnostics.textChars} chars` : null,
					publicNowDiagnostics.contextChars !== null ? `${publicNowDiagnostics.contextChars} context chars` : null
				].filter(Boolean);
	const rankingRowIndexes = Array.from({ length: publicRankingItems.length }, (_, index) => index);
	const normalizedQuery = query.trim().toLowerCase();
	const participantFilterOptions = useMemo(() => {
		const ids = new Set<number>();
		participants.forEach(participant => {
			const userId = Number(participant.id);
			if (Number.isInteger(userId)) {
				ids.add(userId);
			}
		});
		transcripts.forEach(item => ids.add(item.user_id));
		ideaBlocks.forEach(item => ids.add(item.user_id));
		return [...ids].sort((a, b) => a - b);
	}, [ideaBlocks, participants, transcripts]);
	const ideaBlockById = useMemo(() => new Map(ideaBlocks.map(block => [block.id, block])), [ideaBlocks]);
	const similarityLinksByBlockId = useMemo(() => {
		const linksByBlockId = new Map<number, SimilarityLink[]>();
		const addLink = (blockId: number, link: SimilarityLink) => {
			const nextLinks = linksByBlockId.get(blockId) ?? [];
			nextLinks.push(link);
			linksByBlockId.set(blockId, nextLinks);
		};

		similarities.forEach(similarity => {
			const firstBlock = ideaBlockById.get(similarity.idea_block_id_1);
			const secondBlock = ideaBlockById.get(similarity.idea_block_id_2);
			if (!firstBlock || !secondBlock) {
				return;
			}

			addLink(similarity.idea_block_id_1, {
				id: similarity.id,
				relatedBlockId: similarity.idea_block_id_2,
				relatedSummary: getSimilarityPeerSummary(similarity, similarity.idea_block_id_1),
				isSameReason: similarity.is_same_reason,
				reason: similarity.reason
			});
			addLink(similarity.idea_block_id_2, {
				id: similarity.id,
				relatedBlockId: similarity.idea_block_id_1,
				relatedSummary: getSimilarityPeerSummary(similarity, similarity.idea_block_id_2),
				isSameReason: similarity.is_same_reason,
				reason: similarity.reason
			});
		});

		linksByBlockId.forEach(links => {
			links.sort((a, b) => b.id - a.id || b.relatedBlockId - a.relatedBlockId);
		});
		return linksByBlockId;
	}, [ideaBlockById, similarities]);
	const filteredTranscripts = transcripts
		.filter(item => selectedUserId === "all" || item.user_id === selectedUserId)
		.filter(item => matchesQuery(item.transcript, normalizedQuery))
		.sort((a, b) => new Date(b.time_stamp).getTime() - new Date(a.time_stamp).getTime());
	const filteredIdeaBlocks = ideaBlocks
		.filter(item => selectedUserId === "all" || item.user_id === selectedUserId)
		.filter(item => matchesQuery(`${item.title || ""}\n${item.summary || ""}\n${item.transcript || ""}`, normalizedQuery))
		.sort((a, b) => b.id - a.id);
	const selectedCueBlocks = selectedCueBlockIds.map(blockId => ideaBlocks.find(block => block.id === blockId)).filter((block): block is IdeaBlockRecord => !!block);
	const selectedCueSourceBlock = selectedCueBlocks[0] ?? null;
	const selectedCueTargetBlocks = selectedCueBlocks.slice(1);
	const manualCuePairCount = getManualCuePairCount(selectedCueBlocks.length);
	const manualCueHistory = similarities
		.filter(similarity => similarity.reason.includes(MANUAL_CUE_REASON_PREFIX))
		.sort((a, b) => b.id - a.id)
		.slice(0, 6);
	const registerIdeaBlockRef = useCallback((blockId: number, node: HTMLElement | null) => {
		if (node) {
			ideaBlockRefs.current.set(blockId, node);
		} else {
			ideaBlockRefs.current.delete(blockId);
		}
	}, []);
	const jumpToIdeaBlocks = useCallback(
		(blockIds: number[]) => {
			const uniqueBlockIds = getValidIdeaBlockJumpTargetIds(ideaBlocks, blockIds);
			if (uniqueBlockIds.length === 0) {
				return;
			}

			setSelectedUserId("all");
			setQuery("");
			setHighlightedIdeaBlockIds(uniqueBlockIds);
			setPendingJumpBlockIds(uniqueBlockIds);
			if (jumpHighlightTimerRef.current !== null) {
				window.clearTimeout(jumpHighlightTimerRef.current);
			}
			jumpHighlightTimerRef.current = window.setTimeout(() => {
				setHighlightedIdeaBlockIds([]);
				jumpHighlightTimerRef.current = null;
			}, 4500);
		},
		[ideaBlocks]
	);

	useEffect(() => {
		return () => {
			if (jumpHighlightTimerRef.current !== null) {
				window.clearTimeout(jumpHighlightTimerRef.current);
			}
		};
	}, []);

	useEffect(() => {
		if (pendingJumpBlockIds.length === 0) {
			return;
		}

		const frame = window.requestAnimationFrame(() => {
			const target = pendingJumpBlockIds.map(blockId => ideaBlockRefs.current.get(blockId)).find((node): node is HTMLElement => !!node);
			target?.scrollIntoView({ block: "center", behavior: "smooth" });
			setPendingJumpBlockIds([]);
		});

		return () => window.cancelAnimationFrame(frame);
	}, [filteredIdeaBlocks, pendingJumpBlockIds]);
	const createManualCue = async () => {
		if (!selectedCueSourceBlock || selectedCueTargetBlocks.length === 0 || isCreatingManualCue || !isExperimentalCondition) {
			return;
		}

		setIsCreatingManualCue(true);
		setManualCueError(null);
		try {
			const isSameReason = manualCueReasonType === "same";
			const batchBlockIds = selectedCueBlocks.map(block => block.id);
			const cueRequests = selectedCueTargetBlocks.map(async targetBlock => {
				const response = await fetch(buildSessionApiUrl(roomName, "/similarities"), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						idea_block_id_1: selectedCueSourceBlock.id,
						idea_block_id_2: targetBlock.id,
						reason: [
							`${MANUAL_CUE_REASON_PREFIX} ${MANUAL_CUE_REASON_LABELS[manualCueReasonType].toLowerCase()} source idea block #${selectedCueSourceBlock.id} and related idea block #${targetBlock.id}`,
							batchBlockIds.length > 2 ? `batch ${batchBlockIds.map(id => `#${id}`).join(", ")}` : null
						]
							.filter(Boolean)
							.join("; "),
						is_same_reason: isSameReason
					})
				});

				if (!response.ok) {
					throw new Error(`Failed to create manual cue #${selectedCueSourceBlock.id} ↔ #${targetBlock.id} (${response.status})`);
				}

				return (await response.json()) as SimilarityRecord;
			});
			const results = await Promise.allSettled(cueRequests);
			const createdSimilarities = results.flatMap(result => (result.status === "fulfilled" ? [result.value] : []));
			const failedResults = results.filter(result => result.status === "rejected");
			if (createdSimilarities.length > 0) {
				setSimilarities(current => upsertById(current, createdSimilarities));
			}
			if (failedResults.length > 0) {
				const firstFailure = failedResults[0];
				const detail = firstFailure.status === "rejected" && firstFailure.reason instanceof Error ? firstFailure.reason.message : "Unknown error";
				setManualCueError(`Created ${createdSimilarities.length}/${cueRequests.length} cues. ${detail}`);
			} else {
				setSelectedCueBlockIds([]);
			}
			void loadAdminApiData();
		} catch (error) {
			setManualCueError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsCreatingManualCue(false);
		}
	};
	const sendPublicChatMessage = () => {
		const normalizedMessage = publicChatText.trim();
		if (!normalizedMessage) {
			return;
		}

		const clientMessageId = createClientMessageId("admin-public-chat");
		const timestampMs = Date.now();
		setIsSendingPublicChat(true);
		setPublicChatError(null);
		setPublicChatMessages(prev =>
			mergePublicChatMessages(prev, [
				{
					id: clientMessageId,
					sessionName: roomName,
					userId: "0",
					displayName: "Admin",
					message: normalizedMessage,
					time: formatApiTime(timestampMs),
					timestampMs,
					isOwn: true,
					isPending: true,
					clientMessageId
				}
			])
		);
		sendAdminMessage({
			type: "public_chat_send",
			message: normalizedMessage,
			displayName: "Admin",
			clientMessageId
		});
		setPublicChatText("");
		window.setTimeout(() => {
			const stillPending = publicChatMessagesRef.current.some(message => message.clientMessageId === clientMessageId && message.isPending);
			if (!stillPending) {
				return;
			}
			setIsSendingPublicChat(publicChatMessagesRef.current.some(message => message.isOwn && message.isPending && message.clientMessageId !== clientMessageId));
		}, PUBLIC_CHAT_SEND_ACK_TIMEOUT_MS);
	};

	const undoManualCue = async (similarity: SimilarityRecord) => {
		if (undoingManualCueId !== null) {
			return;
		}

		setUndoingManualCueId(similarity.id);
		setManualCueError(null);
		try {
			const response = await fetch(buildSessionApiUrl(roomName, `/similarities/${encodeURIComponent(String(similarity.id))}`), {
				method: "DELETE"
			});
			if (!response.ok) {
				throw new Error(`Failed to undo manual cue (${response.status})`);
			}

			setSimilarities(current => current.filter(item => item.id !== similarity.id));
			setIdeaBlocks(current =>
				current.map(block =>
					block.id === similarity.idea_block_id_1 || block.id === similarity.idea_block_id_2
						? {
								...block,
								similarity_id: null
							}
						: block
				)
			);
			// Removed recordEvent call for local state since events are not tracked anymore
			void loadAdminApiData();
		} catch (error) {
			setManualCueError(error instanceof Error ? error.message : String(error));
		} finally {
			setUndoingManualCueId(null);
		}
	};

	if (joinRejectedMessage) {
		return (
			<main className="grid min-h-screen place-items-center bg-muted/40 p-4 text-foreground">
				<section className="grid max-w-md gap-4 rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
					<div className="flex items-center gap-3">
						<AlertCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
						<h1 className="text-lg font-semibold">不能進入這個 session</h1>
					</div>
					<p className="text-sm leading-6 text-muted-foreground">{joinRejectedMessage}</p>
					<Button type="button" onClick={() => window.location.assign("/")}>
						回到首頁
					</Button>
				</section>
			</main>
		);
	}

	return (
		<main
			className="grid min-h-screen grid-cols-1 gap-4 bg-muted/40 p-4 text-foreground xl:h-screen xl:grid-cols-[var(--admin-left-sidebar-width)_minmax(0,1fr)_var(--admin-right-sidebar-width)] xl:overflow-hidden"
			style={adminLayoutStyle}
		>
			{resizeCursor && <div className="fixed inset-0 z-50 touch-none select-none" style={{ cursor: resizeCursor }} />}
			<aside className="relative min-h-0 min-w-[var(--admin-left-sidebar-width)] xl:h-full">
				<button
					type="button"
					className="absolute -right-3 top-1/2 z-10 hidden h-24 w-2 -translate-y-1/2 cursor-col-resize rounded-full bg-border transition-colors hover:bg-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:block"
					aria-label="調整左側 Admin 欄寬"
					aria-orientation="vertical"
					aria-valuemin={MIN_ADMIN_LEFT_SIDEBAR_WIDTH}
					aria-valuenow={leftSidebarWidth}
					role="separator"
					onPointerDown={handleLeftSidebarResizeStart}
					onKeyDown={handleLeftSidebarResizeKeyDown}
				/>
				<div className="flex h-full flex-col gap-4 overflow-y-auto xl:pr-1">
					<section className="shrink-0 rounded-lg border bg-card p-4 text-card-foreground">
						<div className="mb-4 flex items-start justify-between gap-3">
							<div className="min-w-0">
								<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Admin monitor</p>
								<h1 className="truncate text-xl font-semibold">{roomName}</h1>
							</div>
							<Badge variant="outline">live</Badge>
						</div>
						<div className="grid gap-3 text-sm">
							<div className="flex items-center justify-between gap-3">
								<span className="text-muted-foreground">Board WS</span>
								<ConnectionBadge connected={boardConnected} />
							</div>
							<div className="flex items-center justify-between gap-3">
								<span className="text-muted-foreground">Admin WS</span>
								<ConnectionBadge connected={adminConnected} />
							</div>
							<div className="flex items-center justify-between gap-3">
								<span className="text-muted-foreground">Presence WS</span>
								<ConnectionBadge connected={presenceConnected} />
							</div>
							<div className="flex items-center justify-between gap-3">
								<span className="text-muted-foreground">Participants</span>
								<span className="font-medium">{analysisParticipantCount}</span>
							</div>
							<div className="flex items-center justify-between gap-3">
								<span className="text-muted-foreground">Ranking roles</span>
								<span className="font-medium">{adminRankingParticipantCount}</span>
							</div>
							<div className="flex items-center justify-between gap-3">
								<span className="text-muted-foreground">ASR-enabled roles</span>
								<span className="font-medium">{transcriptionEnabledCount}</span>
							</div>
							<div className="flex items-center justify-between gap-3">
								<span className="text-muted-foreground">Non-ranking roles</span>
								<span className="font-medium">{nonRankingParticipantCount}</span>
							</div>
							<div className="flex items-center justify-between gap-3">
								<span className="text-muted-foreground">Admin participant</span>
								<span className="min-w-0 truncate font-medium" title={adminClientId}>
									{ADMIN_PARTICIPANT_ID}
								</span>
							</div>
						</div>
					</section>

					<section className="rounded-lg border bg-card p-4 text-card-foreground">
						<header className="mb-3 flex items-center gap-2">
							<Radio className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
							<h2 className="text-sm font-semibold">Phase Controls</h2>
						</header>
						<div className="grid gap-3">
							<div className="flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm">
								<div className="min-w-0">
									<div className="break-words font-medium leading-5">{getSessionPhaseLabel(currentPhase, taskPhases)}</div>
									<div className="text-xs text-muted-foreground">Current phase</div>
								</div>
								<Badge variant={isGroupPhase(currentPhase) ? "secondary" : "outline"} className="max-w-32 shrink-0 truncate" title={currentPhase}>
									{currentPhase}
								</Badge>
							</div>
							<div className="flex min-w-0 flex-wrap gap-2">
								{taskPhases.map(phase => (
									<Button
										key={phase.id}
										type="button"
										variant={currentPhase === phase.id ? "default" : "outline"}
										className="h-auto min-h-9 min-w-0 flex-1 basis-32 whitespace-normal px-3 py-2 text-center leading-5"
										title={phase.label}
										aria-pressed={currentPhase === phase.id}
										onClick={() => switchPhase(phase.id)}
									>
										{phase.label}
									</Button>
								))}
							</div>
						</div>
					</section>

					<section className="rounded-lg border bg-card p-4 text-card-foreground">
						<header className="mb-3 flex items-center justify-between gap-3">
							<div className="flex items-center gap-2">
								<Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
								<h2 className="text-sm font-semibold">Countdown</h2>
							</div>
							{timerEndTime > 0 ? <AdminPhaseTimer endTimeMs={timerEndTime} /> : <span className="font-mono text-sm font-semibold text-muted-foreground">--:--</span>}
						</header>
						<div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
							<label className="sr-only" htmlFor="countdown-duration">
								Countdown duration (minutes)
							</label>
							<input
								id="countdown-duration"
								aria-label="Countdown duration in minutes"
								className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
								inputMode="decimal"
								type="text"
								value={countdownDurationMinutes}
								onChange={event => setCountdownDurationMinutes(event.target.value)}
							/>
							<Button onClick={() => startCountdown(countdownDurationMinutes)}>Start {formatDurationLabel(countdownDurationMinutes)}</Button>
							<Button variant="secondary" onClick={clearCountdown}>
								Clear
							</Button>
						</div>
					</section>

					<section className="rounded-lg border bg-card p-4 text-card-foreground">
						<header className="mb-3 flex items-center gap-2">
							<Lightbulb className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
							<h2 className="text-sm font-semibold">Cue Condition</h2>
						</header>
						<div className="grid gap-3">
							<div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm">
								<div className="min-w-0">
									<div className="font-medium">{isExperimentalCondition ? "實驗組" : "對照組"}</div>
									<div className="text-xs text-muted-foreground">{isSimilarityCueActive ? "Similarity cue on" : "Similarity cue off"}</div>
								</div>
								<Badge variant={isExperimentalCondition ? "secondary" : "outline"}>{isExperimentalCondition ? "cue on" : "cue off"}</Badge>
							</div>
							<div className="grid grid-cols-2 gap-2">
								<Button type="button" variant={isExperimentalCondition ? "default" : "outline"} onClick={() => setSessionCueCondition("experimental")}>
									實驗組
								</Button>
								<Button type="button" variant={!isExperimentalCondition ? "default" : "outline"} onClick={() => setSessionCueCondition("control")}>
									對照組
								</Button>
							</div>
						</div>
					</section>

					<section className="rounded-lg border bg-card p-4 text-card-foreground">
						<header className="mb-3 flex items-center gap-2">
							<Radio className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
							<h2 className="text-sm font-semibold">Public NOW</h2>
						</header>
						<div className="grid gap-3">
							<div className="flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm">
								<div className="min-w-0">
									<div className="whitespace-normal break-words font-medium leading-5">{publicNowLabel}</div>
									<div className="text-xs leading-5 text-muted-foreground">
										{publicNowSourceLabel} · {publicNowMatchCount} blocks · {publicNowDeliveredCount} boards
									</div>
									<div className={cn("text-xs leading-5", isPublicNowStateStale ? "text-amber-700" : "text-muted-foreground")}>
										{publicNowLatencyParts.join(" · ")}
										{publicNowScaleParts.length > 0 && <> · {publicNowScaleParts.join(" · ")}</>}
									</div>
								</div>
								<Badge
									variant={publicNowTargetCount > 0 ? "secondary" : "outline"}
									className={cn("shrink-0", isPublicNowStateStale ? "border-amber-300 bg-amber-50 text-amber-900" : undefined)}
									title={`Stale after ${formatPublicNowLatency(PUBLIC_NOW_STALE_BUDGET_MS)}`}
								>
									{publicNowStatusLabel}
								</Badge>
							</div>
							{publicNowTargets.length > 0 ? (
								<div className="flex flex-wrap gap-2">
									{publicNowTargets.map(target => {
										const isSelected = target.kind === "component" ? publicNowComponentIds.includes(target.id) : publicNowTaskItemIds.includes(target.taskItemId);
										return (
											<Button
												key={`${target.kind}-${target.id}`}
												type="button"
												size="sm"
												variant={isSelected ? "default" : "outline"}
												className="h-auto min-h-8 max-w-full justify-start whitespace-normal break-words px-2 py-1 text-left text-xs leading-5"
												onClick={() => selectPublicNowTarget(target)}
												disabled={isSettingPublicNow || !adminConnected}
												title={target.title}
											>
												<span className="whitespace-normal break-words text-left">{target.label}</span>
											</Button>
										);
									})}
								</div>
							) : (
								<p className="rounded-md border border-dashed bg-background p-3 text-xs leading-5 text-muted-foreground">這個 task 沒有可手動指定的 NOW target。</p>
							)}
							<div className="flex items-center justify-between gap-2">
								<Button type="button" size="sm" variant="secondary" onClick={clearPublicNowTargets} disabled={isSettingPublicNow || !adminConnected || publicNowTargetCount === 0}>
									Clear NOW
								</Button>
								{isSettingPublicNow && <span className="text-xs text-muted-foreground">Updating...</span>}
							</div>
							{publicNowError && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs leading-5 text-destructive">{publicNowError}</p>}
						</div>
					</section>

					<section className="rounded-lg border bg-card p-4 text-card-foreground">
						<header className="mb-3 flex items-center gap-2">
							<Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
							<h2 className="text-sm font-semibold">Presence</h2>
						</header>
						{participantRoleError && <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs leading-5 text-destructive">{participantRoleError}</p>}
						{participants.length > 0 ? (
							<div className="grid min-w-[296px] gap-2">
								{participants.map(participant => (
									<div key={participant.id} className="grid min-w-[296px] gap-1 rounded-lg border bg-background px-3 py-2 text-sm" title={`Participant ID ${participant.id}`}>
										{(() => {
											const latestTranscript = latestTranscripts[participant.id];
											const participantRole = normalizeParticipantRole(participant.participant_role);
											const isNonExperimentRole = participantRole === "facilitator" || participantRole === "test";
											const isTranscriptionEnabled = participant.transcription_enabled;
											return (
												<>
													<div className="flex items-start justify-between gap-3">
														<div className="min-w-0">
															<div className="truncate font-medium">{getParticipantLabel(participant.id)}</div>
															<div className="mt-0.5 text-xs text-muted-foreground">ID {participant.id}</div>
														</div>
														<div className="flex shrink-0 flex-col items-end gap-1">
															<Badge
																variant="outline"
																className={cn("px-1.5 py-0 text-[10px]", isTranscriptionEnabled ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-slate-50 text-slate-700")}
															>
																{isTranscriptionEnabled ? "ASR on" : "ASR off"}
															</Badge>
															{isNonExperimentRole && (
																<Badge variant="outline" className="bg-amber-50 px-1.5 py-0 text-[10px] text-amber-900">
																	Non-experiment
																</Badge>
															)}
															<div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
																<span className={cn("h-2 w-2 rounded-full", participant.audio_connected ? "bg-emerald-500" : "bg-muted-foreground")} />
																<span>{participant.audio_connected ? participant.mic_mode : "mic off"}</span>
															</div>
														</div>
													</div>
													<div className="mt-2 grid min-w-[264px] grid-cols-2 gap-1 rounded-md border bg-muted p-1" role="radiogroup" aria-label={`Role for ${getParticipantLabel(participant.id)}`}>
														{PARTICIPANT_ROLE_OPTIONS.map(role => {
															const isSelected = participantRole === role;
															return (
																<button
																	key={role}
																	type="button"
																	role="radio"
																	aria-checked={isSelected}
																	aria-label={`Mark ${role} ${getParticipantLabel(participant.id)}`}
																	className={cn(
																		"inline-flex h-8 min-w-[126px] items-center justify-center gap-1.5 rounded px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
																		isSelected ? PARTICIPANT_ROLE_SEGMENT_CLASSES[role] : "text-muted-foreground hover:bg-background hover:text-foreground",
																		roleUpdatingParticipantId === participant.id && "opacity-60"
																	)}
																	onClick={() => void setParticipantRole(participant, role)}
																	disabled={roleUpdatingParticipantId !== null || isSelected}
																>
																	{role === "participant" ? (
																		<UserCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
																	) : role === "confederate" ? (
																		<Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
																	) : role === "facilitator" ? (
																		<Radio className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
																	) : role === "test" ? (
																		<AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
																	) : (
																		<Eye className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
																	)}
																	<span className="truncate">{PARTICIPANT_ROLE_LABELS[role]}</span>
																</button>
															);
														})}
													</div>
													{latestTranscript && (
														<div className="mt-1 rounded-md bg-muted px-2 py-1.5 text-xs leading-5">
															<div className="mb-1 flex items-center justify-between gap-2 text-muted-foreground">
																<div className="flex min-w-0 items-center gap-1.5">
																	<span className="shrink-0">{latestTranscript.scope}</span>
																	<Badge variant="outline" className={cn("px-1.5 py-0 text-[10px]", LATEST_TRANSCRIPT_STATUS_CLASSES[latestTranscript.ideaBlockStatus])}>
																		{LATEST_TRANSCRIPT_STATUS_LABELS[latestTranscript.ideaBlockStatus]}
																	</Badge>
																</div>
																<span className="shrink-0">{latestTranscript.receivedAt}</span>
															</div>
															<p className="line-clamp-3 whitespace-pre-wrap break-words text-foreground">{latestTranscript.text}</p>
														</div>
													)}
												</>
											);
										})()}
									</div>
								))}
							</div>
						) : (
							<EmptyState title="尚未收到 presence" detail="Presence WebSocket 會即時同步目前連到同一個 room 的 participant id 與 mic 狀態。" />
						)}
					</section>

					<section className="rounded-lg border bg-card p-4 text-card-foreground">
						<header className="mb-3 flex items-center gap-2">
							<RefreshCw className={cn("h-4 w-4 text-muted-foreground", isApiLoading && "animate-spin")} aria-hidden="true" />
							<h2 className="text-sm font-semibold">Live data</h2>
						</header>
						<div className="grid gap-3 text-sm">
							<div className="flex items-center justify-between gap-3">
								<span className="text-muted-foreground">Participants</span>
								<span className="font-medium">{analysisParticipantCount}</span>
							</div>
							<div className="flex items-center justify-between gap-3">
								<span className="text-muted-foreground">Ranking roles</span>
								<span className="font-medium">{adminRankingParticipantCount}</span>
							</div>
							<div className="flex items-center justify-between gap-3">
								<span className="text-muted-foreground">ASR-enabled roles</span>
								<span className="font-medium">{transcriptionEnabledCount}</span>
							</div>
							<div className="flex items-center justify-between gap-3">
								<span className="text-muted-foreground">Non-ranking roles</span>
								<span className="font-medium">{nonRankingParticipantCount}</span>
							</div>
							<div className="flex items-center justify-between gap-3">
								<span className="text-muted-foreground">Transcripts</span>
								<span className="font-medium">{transcripts.length}</span>
							</div>
							<div className="flex items-center justify-between gap-3">
								<span className="text-muted-foreground">Idea blocks</span>
								<span className="font-medium">{ideaBlocks.length}</span>
							</div>
							<div className="flex items-center justify-between gap-3">
								<span className="text-muted-foreground">Similarity sync</span>
								<span className="font-medium">{lastApiLoadedAt || "-"}</span>
							</div>
							<Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void loadAdminApiData()} disabled={isApiLoading}>
								<RefreshCw className={cn("h-3.5 w-3.5", isApiLoading && "animate-spin")} aria-hidden="true" />
								Refresh similarities
							</Button>
							{apiError && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs leading-5 text-destructive">{apiError}</p>}
						</div>
					</section>

					<section className="rounded-lg border bg-card p-4 text-card-foreground">
						<header className="mb-3 flex items-center gap-2">
							<Download className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
							<h2 className="text-sm font-semibold">Task package</h2>
						</header>
						<div className="grid gap-3 text-sm">
							<div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
								<div className="min-w-0">
									<div className="truncate font-medium">{isExperimentalCondition ? "with_cue" : "no_cue"}</div>
									<div className="text-xs text-muted-foreground">{getSessionPhaseLabel(currentPhase, taskPhases)}</div>
								</div>
								<Badge variant={isExperimentalCondition ? "secondary" : "outline"}>{isExperimentalCondition ? "cue on" : "cue off"}</Badge>
							</div>
							<Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void downloadTaskPackage()} disabled={isExportingTaskPackage}>
								<Download className="h-3.5 w-3.5" aria-hidden="true" />
								{isExportingTaskPackage ? "Exporting" : "Export this task"}
							</Button>
							{lastTaskPackageDownloadedAt && (
								<div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
									<span>Last export</span>
									<span className="font-medium">{lastTaskPackageDownloadedAt}</span>
								</div>
							)}
							{taskPackageError && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs leading-5 text-destructive">{taskPackageError}</p>}
						</div>
					</section>
				</div>
			</aside>

			<section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card text-card-foreground xl:h-full">
				<header className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
					<div>
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Lightbulb className="h-4 w-4" aria-hidden="true" />
							<span>WebSocket</span>
						</div>
						<h2 className="mt-1 text-lg font-semibold">Idea blocks</h2>
					</div>
					<Badge variant="secondary">{filteredIdeaBlocks.length} blocks</Badge>
				</header>
				<div className="grid gap-3 border-b p-4">
					<div className="relative">
						<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
						<input
							value={query}
							onChange={event => setQuery(event.target.value)}
							placeholder="Search transcripts and idea blocks"
							className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none transition-colors focus:border-ring"
						/>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button type="button" size="sm" variant={selectedUserId === "all" ? "secondary" : "outline"} onClick={() => setSelectedUserId("all")}>
							All users
						</Button>
						{participantFilterOptions.map(userId => (
							<Button key={userId} type="button" size="sm" variant={selectedUserId === userId ? "secondary" : "outline"} onClick={() => setSelectedUserId(userId)}>
								{getParticipantLabel(userId)}
							</Button>
						))}
					</div>
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
						<div className="min-w-0 text-sm">
							<div className="flex items-center gap-2 font-medium">
								<Link2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
								<span>Manual cue</span>
							</div>
							<p className="mt-1 truncate text-xs text-muted-foreground">
								{!isExperimentalCondition
									? "Control condition: similarity cues are disabled"
									: selectedCueBlocks.length > 0
										? `${selectedCueSourceBlock ? `Source #${selectedCueSourceBlock.id} ${getParticipantLabel(selectedCueSourceBlock.user_id)}` : ""}${selectedCueTargetBlocks.length > 0 ? ` → ${selectedCueTargetBlocks.map(block => `#${block.id} ${getParticipantLabel(block.user_id)}`).join(" + ")}` : " → select related blocks"}`
										: "Select a source block, then one or more related blocks"}
							</p>
						</div>
						<div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
							<div role="radiogroup" aria-label="Manual cue reason type" className="inline-flex rounded-md border bg-muted p-0.5">
								{(["same", "different"] as const).map(reasonType => {
									const isSelected = manualCueReasonType === reasonType;
									return (
										<button
											key={reasonType}
											type="button"
											role="radio"
											aria-checked={isSelected}
											className={cn(
												"h-7 whitespace-nowrap rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
												isSelected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
											)}
											onClick={() => setManualCueReasonType(reasonType)}
											disabled={isCreatingManualCue}
										>
											{MANUAL_CUE_REASON_LABELS[reasonType]}
										</button>
									);
								})}
							</div>
							{selectedCueBlocks.length > 0 && (
								<Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => setSelectedCueBlockIds([])} disabled={isCreatingManualCue}>
									<X className="h-3.5 w-3.5" aria-hidden="true" />
									Clear
								</Button>
							)}
							<Button type="button" size="sm" className="gap-2" onClick={() => void createManualCue()} disabled={manualCuePairCount === 0 || isCreatingManualCue || !isExperimentalCondition}>
								<Link2 className="h-3.5 w-3.5" aria-hidden="true" />
								{isCreatingManualCue ? "Sending" : manualCuePairCount > 1 ? `Send ${manualCuePairCount} cues` : "Send cue"}
							</Button>
						</div>
						{manualCueError && <p className="basis-full text-xs text-destructive">{manualCueError}</p>}
					</div>
					{manualCueHistory.length > 0 && (
						<div className="grid min-w-0 gap-2 overflow-hidden rounded-md border bg-background px-3 py-2">
							<div className="flex items-center justify-between gap-2">
								<div className="flex items-center gap-2 text-sm font-medium">
									<Undo2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
									<span>Manual cue history</span>
								</div>
								<Badge variant="outline">{manualCueHistory.length}</Badge>
							</div>
							<div className="grid min-w-0 gap-1.5 overflow-hidden">
								{manualCueHistory.map(similarity => (
									<div key={similarity.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 overflow-hidden rounded-md bg-muted/70 px-2 py-1.5 text-xs">
										<div className="min-w-0 overflow-hidden">
											<div className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden font-medium">
												<span className="min-w-0 truncate">
													#{similarity.idea_block_id_1} ↔ #{similarity.idea_block_id_2}
												</span>
												<Badge variant="outline" className={cn("shrink-0 px-1.5 py-0 text-[10px]", SIMILARITY_REASON_TAG_CLASSES[similarity.is_same_reason ? "same" : "different"])}>
													{SIMILARITY_REASON_LABELS[similarity.is_same_reason ? "same" : "different"]}
												</Badge>
											</div>
											<div
												className="block max-w-full truncate text-muted-foreground"
												title={`${similarity.idea_block_1.summary || "Idea block"} / ${similarity.idea_block_2.summary || "Idea block"}`}
											>
												{similarity.idea_block_1.summary || "Idea block"} / {similarity.idea_block_2.summary || "Idea block"}
											</div>
										</div>
										<Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={() => void undoManualCue(similarity)} disabled={undoingManualCueId !== null}>
											<Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
											{undoingManualCueId === similarity.id ? "Undoing" : "Undo"}
										</Button>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
				<ScrollArea className="min-h-0 flex-1 p-4" viewportProps={{ className: "overflow-x-hidden" }}>
					{filteredIdeaBlocks.length > 0 ? (
						<div className="grid gap-3">
							{filteredIdeaBlocks.map(block => {
								const isSelectedForCue = selectedCueBlockIds.includes(block.id);
								const cueSelectionIndex = selectedCueBlockIds.indexOf(block.id);
								const isCueSourceBlock = cueSelectionIndex === 0;
								const similarityLinks = similarityLinksByBlockId.get(block.id) ?? [];
								const sameReasonLinks = similarityLinks.filter(link => link.isSameReason);
								const differentReasonLinks = similarityLinks.filter(link => !link.isSameReason);
								const similarityReasonKind = getSimilarityReasonKind(sameReasonLinks.length > 0, differentReasonLinks.length > 0);
								const relatedBlockIds = similarityLinks.map(link => link.relatedBlockId);
								const validRelatedBlockIds = getValidIdeaBlockJumpTargetIds(ideaBlocks, relatedBlockIds);
								const isHighlightedAsJumpTarget = highlightedIdeaBlockIds.includes(block.id);
								return (
									<article
										key={block.id}
										ref={node => registerIdeaBlockRef(block.id, node)}
										className={cn(
											"scroll-mt-4 rounded-lg border bg-background p-3 transition-colors transition-shadow",
											isSelectedForCue && "border-primary bg-primary/5",
											isHighlightedAsJumpTarget && "ring-2 ring-lime-500 ring-offset-2 ring-offset-background"
										)}
									>
										<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
											<div className="flex min-w-0 items-center gap-2">
												<Badge variant="outline" title={`Participant ID ${block.user_id}`}>
													{getParticipantLabel(block.user_id)}
												</Badge>
												<span className="truncate text-sm font-medium">idea block #{block.id}</span>
											</div>
											<div className="flex items-center gap-2">
												{similarityReasonKind ? (
													<button
														type="button"
														className={cn(
															"inline-flex h-7 max-w-full shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
															SIMILARITY_REASON_TAG_CLASSES[similarityReasonKind]
														)}
														title={
															validRelatedBlockIds.length > 0
																? `Jump to ${validRelatedBlockIds.length} related idea block${validRelatedBlockIds.length > 1 ? "s" : ""}`
																: "No available related idea block to jump to"
														}
														onClick={() => jumpToIdeaBlocks(validRelatedBlockIds)}
														disabled={validRelatedBlockIds.length === 0}
													>
														<Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
														<span className="truncate">{getSimilarityReasonTagLabel(similarityReasonKind, similarityLinks.length)}</span>
													</button>
												) : (
													block.similarity_id && <Badge variant="secondary">similarity</Badge>
												)}
												<Button
													type="button"
													size="sm"
													variant={isCueSourceBlock ? "default" : isSelectedForCue ? "secondary" : "outline"}
													className="gap-1"
													onClick={() => toggleCueBlockSelection(block.id)}
													disabled={isCreatingManualCue || !isExperimentalCondition}
												>
													{isSelectedForCue && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
													{isCueSourceBlock ? "Source" : isSelectedForCue ? "Selected" : "Select"}
												</Button>
											</div>
										</div>
										<p className="text-sm font-semibold leading-6">{block.title || block.summary || "-"}</p>
										{block.summary && block.summary !== block.title && <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{block.summary}</p>}
										{similarityLinks.length > 0 && (
											<div className="mt-3 flex flex-wrap gap-1.5" aria-label={`Similarity cue links for idea block ${block.id}`}>
												{similarityLinks.map(link => {
													const linkKind: SimilarityReasonKind = link.isSameReason ? "same" : "different";
													const relatedBlock = ideaBlockById.get(link.relatedBlockId);
													const canJumpToRelatedBlock = isValidIdeaBlockJumpTarget(relatedBlock, link.relatedBlockId);
													const relatedParticipantLabel = relatedBlock ? getParticipantLabel(relatedBlock.user_id) : "Unknown participant";
													return (
														<button
															key={link.id}
															type="button"
															className={cn(
																"inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
																SIMILARITY_REASON_TAG_CLASSES[linkKind]
															)}
															title={
																canJumpToRelatedBlock
																	? `${SIMILARITY_REASON_LABELS[linkKind]} cue to idea block #${link.relatedBlockId}: ${link.relatedSummary}`
																	: `${SIMILARITY_REASON_LABELS[linkKind]} cue target #${link.relatedBlockId} is not available`
															}
															onClick={() => canJumpToRelatedBlock && jumpToIdeaBlocks([link.relatedBlockId])}
															disabled={!canJumpToRelatedBlock}
														>
															<span className="shrink-0">{SIMILARITY_REASON_LABELS[linkKind]}</span>
															<ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
															<span className="shrink-0 font-mono">#{link.relatedBlockId}</span>
															<span className="min-w-0 max-w-36 truncate font-medium">{relatedParticipantLabel}</span>
														</button>
													);
												})}
											</div>
										)}
										{block.transcript && <p className="mt-3 whitespace-pre-wrap border-t pt-3 text-xs leading-5 text-muted-foreground">{block.transcript}</p>}
									</article>
								);
							})}
						</div>
					) : (
						<EmptyState title="尚無 idea blocks" detail="Idea blocks 會由 WebSocket 即時同步；產生或更新後會直接出現在這裡。" />
					)}
				</ScrollArea>
			</section>

			<aside className="relative min-h-0 min-w-[var(--admin-right-sidebar-width)] xl:h-full">
				<button
					type="button"
					className="absolute -left-3 top-1/2 z-10 hidden h-24 w-2 -translate-y-1/2 cursor-col-resize rounded-full bg-border transition-colors hover:bg-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:block"
					aria-label="調整右側 Admin 欄寬"
					aria-orientation="vertical"
					aria-valuemin={MIN_ADMIN_RIGHT_SIDEBAR_WIDTH}
					aria-valuenow={rightSidebarWidth}
					role="separator"
					onPointerDown={handleRightSidebarResizeStart}
					onKeyDown={handleRightSidebarResizeKeyDown}
				/>
				<div className="flex h-full flex-col overflow-hidden rounded-lg border bg-card text-card-foreground">
					<header className="flex items-center justify-between gap-3 border-b p-3">
						<div className="flex rounded-lg bg-muted p-1">
							<Button
								aria-pressed={activeTab === "ranking"}
								className={cn("transition-all active:translate-y-px active:scale-[0.98]", activeTab === "ranking" && "bg-primary text-primary-foreground shadow-inner")}
								variant={activeTab === "ranking" ? "default" : "ghost"}
								onClick={() => setActiveTab("ranking")}
							>
								Ranking
							</Button>
							<Button
								aria-pressed={activeTab === "transcript"}
								className={cn("transition-all active:translate-y-px active:scale-[0.98]", activeTab === "transcript" && "bg-primary text-primary-foreground shadow-inner")}
								variant={activeTab === "transcript" ? "default" : "ghost"}
								onClick={() => setActiveTab("transcript")}
							>
								逐字稿
							</Button>
							<Button
								aria-pressed={activeTab === "chat"}
								className={cn("transition-all active:translate-y-px active:scale-[0.98]", activeTab === "chat" && "bg-primary text-primary-foreground shadow-inner")}
								variant={activeTab === "chat" ? "default" : "ghost"}
								onClick={() => setActiveTab("chat")}
							>
								聊天室
							</Button>
						</div>
					</header>

					<ScrollArea className="min-h-0 flex-1 p-3" viewportProps={{ className: "overflow-x-hidden" }}>
						{activeTab === "ranking" && (
							<div className="grid gap-4">
								<header className="flex items-center justify-between gap-3">
									<div className="flex items-center gap-2">
										<ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
										<h2 className="text-sm font-semibold">Ranking state</h2>
									</div>
									{publicRankingSnapshot && (
										<div className="flex shrink-0 items-center gap-1.5">
											<Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => void copyRankings()} aria-label="複製排序到剪貼簿">
												{rankingsCopied ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
												{rankingsCopied ? "已複製" : "複製"}
											</Button>
											<Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={downloadRankings} aria-label="下載排序 CSV 檔">
												<Download className="h-3.5 w-3.5" aria-hidden="true" />
												下載
											</Button>
										</div>
									)}
								</header>
								{publicRankingSnapshot ? (
									<div className="overflow-x-auto rounded-lg border bg-background">
										<table className="w-full min-w-[280px] border-collapse text-left text-xs">
											<thead>
												<tr className="border-b bg-muted/60">
													<th className="sticky left-0 z-10 w-10 bg-muted/95 px-2 py-2 font-semibold text-muted-foreground">#</th>
													<th className="min-w-32 px-2 py-2 font-semibold">
														<div className="flex min-w-0 items-center justify-between gap-2">
															<span className="truncate">Public</span>
															<span className="shrink-0 rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">r{publicRankingSnapshot.revision}</span>
														</div>
													</th>
													{privateRankingColumns.map(column => (
														<th key={column.key} className="w-14 px-2 py-2 text-center font-semibold">
															<div className="flex min-w-0 items-center justify-between gap-2">
																<span className="truncate">{column.label}</span>
																<span className="shrink-0 rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">r{column.revision}</span>
															</div>
														</th>
													))}
												</tr>
											</thead>
											<tbody>
												{rankingRowIndexes.map(rowIndex => (
													<tr key={rowIndex} className="border-b last:border-b-0">
														<td className="sticky left-0 z-10 bg-background px-2 py-2 font-semibold text-muted-foreground">{rowIndex + 1}</td>
														<td className="max-w-40 px-2 py-2 align-top">
															<span className="block truncate rounded-md bg-muted px-2 py-1 font-medium">{rankingLabels[publicRankingItems[rowIndex]] || publicRankingItems[rowIndex] || "-"}</span>
														</td>
														{privateRankingColumns.map(column => {
															const conflict = getRankConflict(publicRankingItems[rowIndex], rowIndex + 1, column.rankIndexById);
															return (
																<td key={column.key} className="px-2 py-2 text-center align-middle">
																	<span
																		className={cn(
																			"inline-flex min-h-6 min-w-8 items-center justify-center rounded-md px-1.5 py-1 font-medium text-muted-foreground",
																			!conflict?.isConflict && "bg-muted/60",
																			conflict?.isConflict && "ring-1 ring-muted-foreground/30"
																		)}
																		title={conflict ? `與 Public 排序差 ${conflict.amount} 位` : undefined}
																	>
																		{conflict && conflict.amount > 0 ? (
																			<span
																				className={cn(
																					"inline-flex shrink-0 items-center gap-0.5 text-[10px] font-semibold",
																					conflict.isConflict && conflict.direction === "up" && "text-emerald-700",
																					conflict.isConflict && conflict.direction === "down" && "text-rose-700",
																					!conflict.isConflict && "text-muted-foreground/60"
																				)}
																				aria-label={`與 Public 排序差 ${conflict.amount} 位，Private 排序${conflict.direction === "up" ? "較前" : "較後"}`}
																			>
																				<span
																					className={cn(
																						"h-0 w-0 border-x-[4px] border-x-transparent",
																						conflict.direction === "up" && conflict.isConflict && "border-b-[7px] border-b-emerald-600",
																						conflict.direction === "down" && conflict.isConflict && "border-t-[7px] border-t-rose-600",
																						conflict.direction === "up" && !conflict.isConflict && "border-b-[7px] border-b-muted-foreground/40",
																						conflict.direction === "down" && !conflict.isConflict && "border-t-[7px] border-t-muted-foreground/40"
																					)}
																					aria-hidden="true"
																				/>
																				{conflict.amount}
																			</span>
																		) : (
																			<span className="text-muted-foreground/60" aria-hidden="true">
																				-
																			</span>
																		)}
																	</span>
																</td>
															);
														})}
													</tr>
												))}
											</tbody>
										</table>
									</div>
								) : (
									<EmptyState title="尚未收到 ranking state" detail="admin WebSocket join 後會回傳 public 與每位 participant 的 private ranking；有排序更新時會即時刷新。" />
								)}
							</div>
						)}

						{activeTab === "transcript" && (
							<div className="grid gap-4">
								<header className="flex items-center justify-between gap-3">
									<div className="flex items-center gap-2">
										<FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
										<h2 className="text-sm font-semibold">Transcripts</h2>
									</div>
									<Badge variant="outline">{filteredTranscripts.length}</Badge>
								</header>
								{filteredTranscripts.length > 0 ? (
									<div className="grid gap-3">
										{filteredTranscripts.map(item => (
											<article key={item.id} className="rounded-lg border bg-background p-3 text-sm">
												<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
													<div className="flex items-center gap-2">
														<Badge variant="outline" title={`Participant ID ${item.user_id}`}>
															{getParticipantLabel(item.user_id)}
														</Badge>
														<span className="font-medium">#{item.id}</span>
													</div>
													<span className="text-xs text-muted-foreground">{formatApiTime(item.time_stamp)}</span>
												</div>
												<p className="line-clamp-5 whitespace-pre-wrap break-words leading-5">{item.transcript}</p>
											</article>
										))}
									</div>
								) : (
									<EmptyState title="尚無 transcripts" detail="Transcripts 會由 WebSocket 即時同步；participant 開始說話後會直接出現在這裡。" />
								)}
							</div>
						)}

						{activeTab === "chat" && (
							<div className="grid gap-4">
								<header className="flex items-center justify-between gap-3">
									<div className="flex items-center gap-2">
										<MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
										<h2 className="text-sm font-semibold">聊天室</h2>
									</div>
									<Badge variant="outline">{publicChatMessages.length}</Badge>
								</header>
								<PublicChatMessages messages={publicChatMessages} />
							</div>
						)}
					</ScrollArea>

					{activeTab === "chat" && (
						<footer className="border-t bg-card p-3">
							<PublicChatComposer
								messageText={publicChatText}
								error={publicChatError}
								isConnected={adminConnected}
								isSending={isSendingPublicChat}
								onMessageTextChange={value => {
									setPublicChatText(value);
									setPublicChatError(null);
								}}
								onSend={sendPublicChatMessage}
							/>
						</footer>
					)}
				</div>
			</aside>
		</main>
	);
}
