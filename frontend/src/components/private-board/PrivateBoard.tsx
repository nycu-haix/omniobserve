import type { UIEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { ENABLE_PRIVATE_BOARD_MOCK_DATA, MOCK_IDEA_BLOCKS, MOCK_SIMILARITY_CUES, MOCK_TRANSCRIPT_LINES } from "../../mock/privateBoard";
import { apiUrl } from "../../services/api";
import type { BoardTab, IdeaBlock, SimilarityCueData, TranscriptLine as TranscriptLineType } from "../../types";
import { Button } from "../ui/Button";
import { ScrollArea } from "../ui/ScrollArea";
import { IdeaBlockItem } from "./IdeaBlockItem";
import { SimilarityCue } from "./SimilarityCue";
import { TranscriptLine } from "./TranscriptLine";

interface PrivateBoardProps {
	sessionId: string;
	participantId: string;
	lastMessage: object | null;
	lastAudioMessage: object | null;
	isConnected: boolean;
}

type BoardMessage =
	| { type: "new_idea_block"; payload: IdeaBlock }
	| { type: "update_idea_block"; payload: Partial<IdeaBlock> & { id: string } }
	| { type: "new_transcript_line"; payload: TranscriptLineType }
	| { type: "similarity_cue"; payload: SimilarityCueData };

interface TranscriptResponse {
	id: number;
	user_id: number;
	session_name: string;
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
	is_deleted?: boolean;
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

function isNearScrollBottom(element: HTMLElement): boolean {
	return element.scrollHeight - element.scrollTop - element.clientHeight <= AUTO_SCROLL_BOTTOM_THRESHOLD;
}

function isBoardMessage(message: object | null): message is BoardMessage {
	if (!message || !("type" in message) || !("payload" in message)) {
		return false;
	}

	return message.type === "new_idea_block" || message.type === "update_idea_block" || message.type === "new_transcript_line" || message.type === "similarity_cue";
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
	status: "ready"
});

function getTranscriptUserId(participantId: string): number {
	const userId = Number(participantId);
	return Number.isInteger(userId) ? userId : 0;
}

function buildTranscriptUrl(sessionId: string): string {
	const encodedSessionId = encodeURIComponent(sessionId);
	return apiUrl(`/api/sessions/${encodedSessionId}/transcripts?visibility=public`);
}

function buildIdeaBlocksUrl(sessionId: string, participantId: string): string {
	const encodedSessionId = encodeURIComponent(sessionId);
	const userId = getTranscriptUserId(participantId);
	return apiUrl(`/api/sessions/${encodedSessionId}/users/${encodeURIComponent(String(userId))}/idea-blocks`);
}

function buildIdeaBlockDetailUrl(sessionId: string, participantId: string, ideaBlockId: string): string {
	return `${buildIdeaBlocksUrl(sessionId, participantId)}/${encodeURIComponent(ideaBlockId)}`;
}

function isOwnTranscriptUser(userId: string | number | null | undefined, participantId: string): boolean {
	if (userId == null) {
		return false;
	}

	const userIdText = String(userId);
	return userIdText === participantId || Number(userIdText) === getTranscriptUserId(participantId);
}

function transcriptResponseToLine(item: TranscriptResponse, participantId: string): TranscriptLineType {
	return {
		id: String(item.id),
		source: "public",
		origin: "history",
		userId: String(item.user_id),
		isOwn: isOwnTranscriptUser(item.user_id, participantId),
		time: formatTranscriptTime(item.time_stamp),
		text: item.transcript
	};
}

function ideaBlockResponseToBlock(item: IdeaBlockResponse): IdeaBlock {
	const transcriptLineId = item.transcript_id == null ? undefined : String(item.transcript_id);

	return {
		id: String(item.id),
		summary: item.title || item.summary,
		aiSummary: item.summary,
		transcript: item.transcript ?? undefined,
		transcriptLineId,
		sourceTranscriptIds: transcriptLineId ? [transcriptLineId] : undefined,
		hasCue: !!item.similarity_id,
		isDeleted: item.is_deleted ?? false,
		status: "ready"
	};
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
	return undefined;
}

function audioTranscriptMessageToLine(message: AudioTranscriptMessage): TranscriptLineType {
	const segmentId = message.type === "transcript_update" ? message.transcript_segment_id : message.segment_id;
	const userId = message.participant_id ?? message.userId ?? message.user_id;
	const source = transcriptSourceFromAudioMessage(message);
	return {
		id: segmentId == null ? `audio-${Date.now()}` : String(segmentId),
		source,
		origin: "live",
		userId: userId == null ? undefined : String(userId),
		time: formatTranscriptTime(message.timestamp_ms),
		text: message.text?.trim() ?? ""
	};
}

function shouldAppendAudioTranscriptToTranscriptTab(_message: AudioTranscriptMessage): boolean {
	return false;
}

function audioTranscriptDisplaySignature(message: AudioTranscriptMessage, line: TranscriptLineType): string {
	return [message.type, line.source ?? "", message.reason ?? "", line.text.trim()].join("|");
}

function appendTranscriptLine(lines: TranscriptLineType[], line: TranscriptLineType): TranscriptLineType[] {
	const normalizedText = line.text.trim();
	if (!normalizedText) {
		return lines;
	}

	const existingLine = lines.find(item => item.id === line.id);
	if (!existingLine) {
		return [...lines, { ...line, text: normalizedText }];
	}
	if (existingLine.text.trim() === normalizedText && existingLine.time === line.time && existingLine.linkedBlockId === line.linkedBlockId) {
		return lines;
	}
	return lines.map(item =>
		item.id === line.id
			? {
					...item,
					...line,
					text: normalizedText,
					linkedBlockId: line.linkedBlockId ?? item.linkedBlockId
				}
			: item
	);
}

function mergeTranscriptLines(baseLines: TranscriptLineType[], nextLines: TranscriptLineType[]): TranscriptLineType[] {
	return nextLines.reduce((lines, line) => appendTranscriptLine(lines, line), baseLines);
}

function mergeIdeaBlocks(baseBlocks: IdeaBlock[], nextBlocks: IdeaBlock[]): IdeaBlock[] {
	return sortIdeaBlocks(nextBlocks.reduce((blocks, nextBlock) => {
		const existingBlock = blocks.find(block => block.id === nextBlock.id);
		if (!existingBlock) {
			return [...blocks, nextBlock];
		}

		return blocks.map(block =>
			block.id === nextBlock.id
				? {
						...block,
						...nextBlock,
						expanded: block.expanded,
						cueText: block.cueText,
						hasCue: block.hasCue || nextBlock.hasCue
					}
				: block
		);
	}, baseBlocks));
}

function sortIdeaBlocks(blocks: IdeaBlock[]): IdeaBlock[] {
	return [...blocks].sort((left, right) => {
		if (!!left.isDeleted !== !!right.isDeleted) {
			return left.isDeleted ? -1 : 1;
		}
		if (!!left.isDraft !== !!right.isDraft) {
			return left.isDraft ? 1 : -1;
		}
		return 0;
	});
}

function linkTranscriptLinesToBlocks(lines: TranscriptLineType[], blocks: IdeaBlock[]): TranscriptLineType[] {
	const transcriptBlockIds = new Map<string, string>();

	blocks.forEach(block => {
		const transcriptIds = [block.transcriptLineId, ...(block.sourceTranscriptIds ?? [])].filter((id): id is string => !!id);
		transcriptIds.forEach(transcriptId => {
			if (!transcriptBlockIds.has(transcriptId)) {
				transcriptBlockIds.set(transcriptId, block.id);
			}
		});
	});

	let didChange = false;
	const linkedLines = lines.map(line => {
		const linkedBlockId = transcriptBlockIds.get(line.id);
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

function renderTranscriptLines(lines: TranscriptLineType[], emptyText: string, onJumpToBlock: (blockId: string) => void) {
	const firstLiveLineIndex = lines.findIndex(line => line.origin === "live");
	const shouldShowLiveDivider = firstLiveLineIndex > 0 && lines.some((line, index) => index < firstLiveLineIndex && line.origin === "history");

	return (
		<div className="grid gap-1">
			{lines.length === 0 && <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-muted-foreground">{emptyText}</div>}
			{lines.map((line, index) => (
				<div key={line.id} className="contents">
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

export function PrivateBoard({ sessionId, participantId, lastMessage, lastAudioMessage, isConnected }: PrivateBoardProps) {
	const [activeTab, setActiveTab] = useState<BoardTab>("ideablock");
	const [ideaBlocks, setIdeaBlocks] = useState<IdeaBlock[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_IDEA_BLOCKS : []);
	const [transcriptLines, setTranscriptLines] = useState<TranscriptLineType[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_TRANSCRIPT_LINES : []);
	const [transcriptRefreshKey, setTranscriptRefreshKey] = useState(0);
	const [ideaBlockRefreshKey, setIdeaBlockRefreshKey] = useState(0);
	const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
	const [manualIdeaText, setManualIdeaText] = useState("");
	const [manualIdeaError, setManualIdeaError] = useState<string | null>(null);
	const [isSavingManualIdea, setIsSavingManualIdea] = useState(false);
	const [cues, setCues] = useState<SimilarityCueData[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_SIMILARITY_CUES : []);
	const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
	const scrollViewportRef = useRef<HTMLDivElement | null>(null);
	const lastProcessedAudioMessageRef = useRef<object | null>(null);
	const lastDisplayedAudioTranscriptRef = useRef<{ signature: string; displayedAt: number } | null>(null);
	const shouldAutoScrollRef = useRef<Record<BoardTab, boolean>>({
		transcript: true,
		ideablock: true
	});

	useEffect(() => {
		if (ENABLE_PRIVATE_BOARD_MOCK_DATA) {
			return;
		}

		const controller = new AbortController();

		async function loadTranscripts() {
			try {
				const transcriptUrl = buildTranscriptUrl(sessionId);
				const response = await fetch(transcriptUrl, { signal: controller.signal });
				if (!response.ok) {
					throw new Error("Failed to load transcripts");
				}

				const transcriptLinesFromDb = ((await response.json()) as TranscriptResponse[]).map(item => transcriptResponseToLine(item, participantId));
				setTranscriptLines(prev => mergeTranscriptLines(transcriptLinesFromDb, prev));
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") {
					return;
				}
				console.warn("[private-board] failed to load transcripts", error);
			}
		}

		void loadTranscripts();

		return () => controller.abort();
	}, [participantId, sessionId, transcriptRefreshKey]);

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

				const ideaBlocksFromDb = ((await response.json()) as IdeaBlockResponse[]).map(ideaBlockResponseToBlock);
				setIdeaBlocks(prev => mergeIdeaBlocks(prev, ideaBlocksFromDb));
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") {
					return;
				}
				console.warn("[private-board] failed to load idea blocks", error);
			}
		}

		void loadIdeaBlocks();

		return () => controller.abort();
	}, [ideaBlockRefreshKey, participantId, sessionId]);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			setTranscriptLines(prev => linkTranscriptLinesToBlocks(prev, ideaBlocks));
		}, 0);

		return () => window.clearTimeout(timer);
	}, [ideaBlocks]);

	useEffect(() => {
		if (!isBoardMessage(lastMessage)) {
			return;
		}

		const timer = window.setTimeout(() => {
			if (lastMessage.type === "new_idea_block") {
				setIdeaBlockRefreshKey(current => current + 1);
			}

			if (lastMessage.type === "update_idea_block") {
				setIdeaBlockRefreshKey(current => current + 1);
			}

			if (lastMessage.type === "new_transcript_line") {
				setTranscriptLines(prev =>
					appendTranscriptLine(prev, {
						...lastMessage.payload,
						origin: "live",
						isOwn: isOwnTranscriptUser(lastMessage.payload.userId, participantId)
					})
				);
			}

			if (lastMessage.type === "similarity_cue") {
				setCues(prev => (prev.some(cue => cue.id === lastMessage.payload.id) ? prev : [...prev, lastMessage.payload]));
				setIdeaBlocks(prev => prev.map(block => (block.id === lastMessage.payload.blockId ? { ...block, hasCue: true, cueText: lastMessage.payload.blockSummary } : block)));
			}
		}, 0);

		return () => window.clearTimeout(timer);
	}, [lastMessage]);

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
			if (shouldAppendAudioTranscriptToTranscriptTab(lastAudioMessage)) {
				const signature = audioTranscriptDisplaySignature(lastAudioMessage, transcriptLine);
				const displayed = lastDisplayedAudioTranscriptRef.current;
				const now = Date.now();
				if (displayed && displayed.signature === signature && now - displayed.displayedAt < 2000) {
					return;
				}
				lastDisplayedAudioTranscriptRef.current = { signature, displayedAt: now };
				setTranscriptLines(prev => appendTranscriptLine(prev, transcriptLine));
			}
		}, 0);

		return () => window.clearTimeout(timer);
	}, [lastAudioMessage]);

	useEffect(() => {
		if (!isAudioIdeaBlocksUpdateMessage(lastAudioMessage)) {
			return;
		}

		const timer = window.setTimeout(() => {
			if (Array.isArray(lastAudioMessage.idea_blocks) && lastAudioMessage.idea_blocks.length > 0) {
				const updatedBlocks = lastAudioMessage.idea_blocks.map(ideaBlockResponseToBlock);
				setIdeaBlocks(prev => mergeIdeaBlocks(prev, updatedBlocks));
				setTranscriptLines(prev => linkTranscriptLinesToBlocks(prev, updatedBlocks));
			}

			setIdeaBlockRefreshKey(current => current + 1);
		}, 0);

		return () => window.clearTimeout(timer);
	}, [lastAudioMessage]);

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

	const jumpToBlock = (blockId: string) => {
		setActiveTab("ideablock");
		setHighlightedBlockId(blockId);
	};

	const handleBoardScroll = (event: UIEvent<HTMLDivElement>) => {
		shouldAutoScrollRef.current[activeTab] = isNearScrollBottom(event.currentTarget);
	};

	useLayoutEffect(() => {
		const viewport = scrollViewportRef.current;
		if (!viewport || !shouldAutoScrollRef.current[activeTab]) {
			return;
		}

		viewport.scrollTop = viewport.scrollHeight;
	}, [activeTab, ideaBlocks, transcriptLines]);

	const toggleBlock = (id: string) => {
		setIdeaBlocks(prev => prev.map(block => (block.id === id ? { ...block, expanded: !block.expanded } : block)));
	};

	const saveIdeaBlock = async (id: string, values: { summary: string; aiSummary: string; transcript: string; updateTitle?: boolean }) => {
		const normalizedContent = values.aiSummary.trim();
		const currentBlock = ideaBlocks.find(block => block.id === id);
		const isDraft = currentBlock ? !!currentBlock.isDraft : id.startsWith("draft-");
		const derivedTitle = isDraft ? normalizedContent.slice(0, 10) || values.summary.trim() || "Idea" : values.updateTitle ? values.summary.trim() || currentBlock?.summary || "Idea" : currentBlock?.summary || values.summary.trim() || "Idea";

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
			throw new Error("Failed to save idea block");
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
							isDraft: false
						}
					: block
			);
			return sortIdeaBlocks(nextBlocks);
		});
		setTranscriptRefreshKey(current => current + 1);
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
		if (!normalizedContent || isSavingManualIdea) {
			return;
		}

		const derivedTitle = normalizedContent.slice(0, 10) || "Idea";
		const localBlockId = `manual-${Date.now()}`;

		setIsSavingManualIdea(true);
		setManualIdeaError(null);
		try {
			if (ENABLE_PRIVATE_BOARD_MOCK_DATA) {
				const newBlock: IdeaBlock = {
					...createDraftIdeaBlock(),
					id: localBlockId,
					summary: derivedTitle,
					aiSummary: normalizedContent,
					transcript: "",
					expanded: false,
					isDraft: false
				};
				setIdeaBlocks(prev => sortIdeaBlocks([newBlock, ...prev]));
				setHighlightedBlockId(newBlock.id);
				setManualIdeaText("");
				return;
			}

			const response = await fetch(buildIdeaBlocksUrl(sessionId, participantId), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: derivedTitle,
					summary: normalizedContent
				})
			});

			if (!response.ok) {
				throw new Error("Failed to save idea block");
			}

			const savedBlock = ideaBlockResponseToBlock((await response.json()) as IdeaBlockResponse);
			setIdeaBlocks(prev => sortIdeaBlocks([savedBlock, ...prev.filter(block => block.id !== savedBlock.id)]));
			setHighlightedBlockId(savedBlock.id);
			setTranscriptRefreshKey(current => current + 1);
			setIdeaBlockRefreshKey(current => current + 1);
			setManualIdeaText("");
		} catch (error) {
			setManualIdeaError(error instanceof Error ? error.message : "Failed to save idea block");
		} finally {
			setIsSavingManualIdea(false);
		}
	};

	return (
		<>
			<section className="flex h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-lg border bg-card text-card-foreground">
				<header className="flex items-center justify-between gap-3 border-b p-3">
					<div className="flex rounded-lg bg-muted p-1">
						<Button
							aria-pressed={activeTab === "transcript"}
							className={cn(
								"transition-all active:translate-y-px active:scale-[0.98]",
								activeTab === "transcript" && "translate-y-px bg-primary text-primary-foreground shadow-inner ring-2 ring-primary/20 hover:bg-primary/90"
							)}
							variant={activeTab === "transcript" ? "default" : "ghost"}
							onClick={() => setActiveTab("transcript")}
						>
							逐字稿
						</Button>
						<Button
							aria-pressed={activeTab === "ideablock"}
							className={cn(
								"transition-all active:translate-y-px active:scale-[0.98]",
								activeTab === "ideablock" && "translate-y-px bg-primary text-primary-foreground shadow-inner ring-2 ring-primary/20 hover:bg-primary/90"
							)}
							variant={activeTab === "ideablock" ? "default" : "ghost"}
							onClick={() => setActiveTab("ideablock")}
						>
							Idea Block
						</Button>
					</div>
					<div className="flex items-center gap-2">
						<span className={`hidden h-2 w-2 rounded-full ${isConnected ? "bg-primary" : "bg-muted-foreground"}`} />
					</div>
				</header>

				<ScrollArea className="min-h-0 flex-1 p-3" viewportRef={scrollViewportRef} viewportProps={{ onScroll: handleBoardScroll }}>
					{activeTab === "ideablock" ? (
						<div className="grid gap-2 pb-3">
							{ideaBlocks.length === 0 && <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-muted-foreground">尚無想法</div>}
							{ideaBlocks.map(block => (
								<div
									key={block.id}
									ref={node => {
										blockRefs.current[block.id] = node;
									}}
								>
									<IdeaBlockItem block={block} isHighlighted={highlightedBlockId === block.id} onToggle={toggleBlock} onSave={saveIdeaBlock} onDelete={deleteIdeaBlock} />
								</div>
							))}
						</div>
					) : (
						renderTranscriptLines(transcriptLines, "尚無逐字稿", jumpToBlock)
					)}
				</ScrollArea>

				{activeTab === "ideablock" && (
					<footer className="border-t bg-card p-3">
						<div className="grid gap-2">
							<div className="flex items-end gap-2">
								<textarea
									aria-label="Manual idea block input"
									className="max-h-28 min-h-11 flex-1 resize-y rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
									placeholder="手動輸入 idea block"
									value={manualIdeaText}
									onChange={event => {
										setManualIdeaText(event.target.value);
										setManualIdeaError(null);
									}}
									onKeyDown={event => {
										if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
											event.preventDefault();
											void addManualIdeaBlock();
										}
									}}
									disabled={isSavingManualIdea}
								/>
								<Button className="h-11 shrink-0 px-4" onClick={() => void addManualIdeaBlock()} disabled={!manualIdeaText.trim() || isSavingManualIdea}>
									{isSavingManualIdea ? "儲存中" : "新增"}
								</Button>
							</div>
							{manualIdeaError && <p className="text-xs text-destructive">{manualIdeaError}</p>}
						</div>
					</footer>
				)}
			</section>

			<SimilarityCue cues={cues} onJump={jumpToBlock} onDismiss={cueId => setCues(prev => prev.filter(cue => cue.id !== cueId))} />
		</>
	);
}
