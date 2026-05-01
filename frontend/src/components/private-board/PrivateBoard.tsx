import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ENABLE_PRIVATE_BOARD_MOCK_DATA, MOCK_IDEA_BLOCKS, MOCK_SIMILARITY_CUES, MOCK_TRANSCRIPT_LINES } from "../../mock/privateBoard";
import type { BoardTab, IdeaBlock, SimilarityCueData, TranscriptLine as TranscriptLineType } from "../../types";
import { Button } from "../ui/Button";
import { ScrollArea } from "../ui/ScrollArea";
import { IdeaBlockItem } from "./IdeaBlockItem";
import { SimilarityCue } from "./SimilarityCue";
import { TranscriptLine } from "./TranscriptLine";

interface PrivateBoardProps {
	roomId: string;
	lastMessage: object | null;
	isConnected: boolean;
}

type BoardMessage =
	| { type: "new_idea_block"; payload: IdeaBlock }
	| { type: "update_idea_block"; payload: Partial<IdeaBlock> & { id: string } }
	| { type: "new_transcript_line"; payload: TranscriptLineType }
	| { type: "similarity_cue"; payload: SimilarityCueData };

function isBoardMessage(message: object | null): message is BoardMessage {
	if (!message || !("type" in message) || !("payload" in message)) {
		return false;
	}

	return message.type === "new_idea_block" || message.type === "update_idea_block" || message.type === "new_transcript_line" || message.type === "similarity_cue";
}

const fallbackBlock = (): IdeaBlock => ({
	id: `local-${Date.now()}`,
	summary: "正在生成...",
	status: "generating"
});

export function PrivateBoard({ roomId, lastMessage, isConnected }: PrivateBoardProps) {
	const [activeTab, setActiveTab] = useState<BoardTab>("ideablock");
	const [ideaBlocks, setIdeaBlocks] = useState<IdeaBlock[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_IDEA_BLOCKS : []);
	const [transcriptLines, setTranscriptLines] = useState<TranscriptLineType[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_TRANSCRIPT_LINES : []);
	const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
	const [cues, setCues] = useState<SimilarityCueData[]>(ENABLE_PRIVATE_BOARD_MOCK_DATA ? MOCK_SIMILARITY_CUES : []);
	const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
	useEffect(() => {
		if (!isBoardMessage(lastMessage)) {
			return;
		}

		const timer = window.setTimeout(() => {
			if (lastMessage.type === "new_idea_block") {
				setIdeaBlocks(prev => (prev.some(block => block.id === lastMessage.payload.id) ? prev : [...prev, lastMessage.payload]));
			}

			if (lastMessage.type === "update_idea_block") {
				setIdeaBlocks(prev =>
					prev.some(block => block.id === lastMessage.payload.id)
						? prev.map(block => (block.id === lastMessage.payload.id ? { ...block, ...lastMessage.payload, status: "ready" } : block))
						: [
								...prev,
								{
									id: lastMessage.payload.id,
									summary: lastMessage.payload.summary ?? "",
									aiSummary: lastMessage.payload.aiSummary,
									transcript: lastMessage.payload.transcript,
									status: "ready"
								}
							]
				);
			}

			if (lastMessage.type === "new_transcript_line") {
				setTranscriptLines(prev => (prev.some(line => line.id === lastMessage.payload.id) ? prev : [...prev, lastMessage.payload]));
			}

			if (lastMessage.type === "similarity_cue") {
				setCues(prev => (prev.some(cue => cue.id === lastMessage.payload.id) ? prev : [...prev, lastMessage.payload]));
				setIdeaBlocks(prev => prev.map(block => (block.id === lastMessage.payload.blockId ? { ...block, hasCue: true, cueText: lastMessage.payload.blockSummary } : block)));
			}
		}, 0);

		return () => window.clearTimeout(timer);
	}, [lastMessage]);

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

	const toggleBlock = (id: string) => {
		setIdeaBlocks(prev => prev.map(block => (block.id === id ? { ...block, expanded: !block.expanded } : block)));
	};

	const addBlock = async () => {
		if (ENABLE_PRIVATE_BOARD_MOCK_DATA) {
			const newBlock = fallbackBlock();
			setIdeaBlocks(prev => [...prev, newBlock]);
			setActiveTab("ideablock");
			setHighlightedBlockId(newBlock.id);
			return;
		}

		try {
			const response = await fetch("/api/board/block", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ roomId })
			});

			if (!response.ok) {
				throw new Error("Failed to create block");
			}
		} catch {
			setIdeaBlocks(prev => [...prev, fallbackBlock()]);
		}
	};

	return (
		<>
			<section className="flex h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-lg border bg-card text-card-foreground">
				<header className="flex items-center justify-between gap-3 border-b p-3">
					<div className="flex rounded-lg bg-muted p-1">
						<Button variant={activeTab === "transcript" ? "secondary" : "ghost"} onClick={() => setActiveTab("transcript")}>
							逐字稿
						</Button>
						<Button variant={activeTab === "ideablock" ? "secondary" : "ghost"} onClick={() => setActiveTab("ideablock")}>
							Idea Block
						</Button>
					</div>
					<div className="flex items-center gap-2">
						<span className={`h-2 w-2 rounded-full ${isConnected ? "bg-primary" : "bg-muted-foreground"}`} />
						<Button aria-label="Add idea block" size="icon" onClick={addBlock}>
							<Plus className="h-4 w-4" />
						</Button>
					</div>
				</header>

				<ScrollArea className="min-h-0 flex-1 p-3">
					{activeTab === "ideablock" ? (
						<div className="grid gap-2">
							{ideaBlocks.length === 0 && <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-muted-foreground">尚無想法</div>}
							{ideaBlocks.map(block => (
								<div
									key={block.id}
									ref={node => {
										blockRefs.current[block.id] = node;
									}}
								>
									<IdeaBlockItem block={block} isHighlighted={highlightedBlockId === block.id} onToggle={toggleBlock} />
								</div>
							))}
						</div>
					) : (
						<div className="grid gap-1">
							{transcriptLines.length === 0 && <div className="grid min-h-40 place-items-center rounded-lg border border-dashed text-muted-foreground">尚無逐字稿</div>}
							{transcriptLines.map(line => (
								<TranscriptLine key={line.id} line={line} onJumpToBlock={jumpToBlock} />
							))}
						</div>
					)}
				</ScrollArea>
			</section>

			<SimilarityCue cues={cues} onJump={jumpToBlock} onDismiss={cueId => setCues(prev => prev.filter(cue => cue.id !== cueId))} />
		</>
	);
}
