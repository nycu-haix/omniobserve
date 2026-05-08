import type { IdeaBlock, SimilarityCueData, TranscriptLine } from "../types";

export const ENABLE_PRIVATE_BOARD_MOCK_DATA = false;

export const MOCK_IDEA_BLOCKS: IdeaBlock[] = [
	{
		id: "b1",
		summary: "先確認大家對海上求生目標的理解一致",
		aiSummary: "團隊目前同意先用海上求生優先順序來討論，不急著投票。共識是先釐清淡水、求救訊號、定位工具在不同情境下的重要性。",
		transcript: "我覺得我們先不要馬上排序，可以先確認大家是不是都把目標理解成等待救援，而不是自己航行到岸邊。",
		transcriptLineId: "103",
		expanded: true,
		status: "ready"
	},
	{
		id: "b2",
		summary: "淡水容器應該排前面，因為直接影響生存時間",
		aiSummary: "淡水被視為最直接的生存限制。若無法保存飲用水，其他資源較難發揮作用，因此多數成員傾向把裝水容器放在高優先級。",
		transcript: "裝水容器一定要在前面吧，因為沒有淡水的話，就算我們有海圖或食物也撐不了太久。",
		transcriptLineId: "106",
		expanded: false,
		status: "ready"
	},
	{
		id: "b3",
		summary: "海圖和 VHF 無線電的排序需要看能不能定位救援",
		aiSummary: "海圖能幫助判斷位置與洋流，VHF 無線電能提供求援或確認方向。兩者的排序取決於團隊假設：如果救援船距離不遠，通訊較重要；如果位置不明，海圖可能更需要一起討論。",
		transcript: "如果我們知道救援船大概在哪，VHF 無線電可能比海圖重要；但如果完全不知道方向，海圖也許可以先幫我們確認位置。",
		transcriptLineId: "108",
		hasCue: true,
		cueText: "另一位成員也提到海圖和 VHF 無線電要一起討論。",
		expanded: false,
		status: "ready"
	},
	{
		id: "b4",
		summary: "正在生成...",
		transcriptLineId: "t4",
		status: "generating"
	}
];

export const MOCK_TRANSCRIPT_LINES: TranscriptLine[] = [
	{
		id: "t1",
		text: "我覺得我們先不要馬上排序，可以先確認大家是不是都把目標理解成等待救援，而不是自己航行到岸邊。",
		source: "public",
		userId: "1",
		displayName: "Otter",
		isOwn: true,
		time: "10:30",
		linkedBlockId: "b1"
	},
	{
		id: "t2",
		text: "裝水容器一定要在前面吧，因為沒有淡水的話，就算我們有海圖或食物也撐不了太久。",
		source: "public",
		userId: "2",
		displayName: "Fox",
		linkedBlockId: "b2"
	},
	{
		id: "t3",
		text: "如果我們知道救援船大概在哪，VHF 無線電可能比海圖重要；但如果完全不知道方向，海圖也許可以先幫我們確認位置。",
		source: "public",
		userId: "3",
		displayName: "Rabbit",
		time: "10:32",
		linkedBlockId: "b3"
	},
	{
		id: "t4",
		text: "我剛剛想到水的消耗量可能跟路程時間有關，這段可以請 AI 幫我整理成新的想法。",
		source: "private",
		userId: "1",
		displayName: "Otter",
		linkedBlockId: "b4"
	},
	{
		id: "t5",
		text: "食物雖然重要，但短時間求生裡可能不是第一優先，應該排在淡水和求救工具後面。",
		source: "public",
		userId: "4",
		displayName: "Penguin",
		time: "10:34"
	},
	{
		id: "t6",
		text: "個人想法：我認為釣魚竿在這個情境下比巧克力棒更重要，因為可以捕魚補充食物。",
		source: "private",
		userId: "1",
		displayName: "Otter",
		time: "10:35"
	},
	{
		id: "t7",
		text: "大家覺得六分儀和海圖哪個更關鍵？",
		source: "public",
		userId: "2",
		displayName: "Fox",
		time: "10:36"
	},
	{
		id: "t8",
		text: "私人筆記：驅鯊劑可能在某些海域很重要，但如果沒有鯊魚威脅就不需要。",
		source: "private",
		userId: "1",
		displayName: "Otter",
		time: "10:37"
	},
	{
		id: "t9",
		text: "我同意先把求救工具放前面，鏡子白天可用、VHF 則看距離和電力，兩個可能都要保留在高順位。",
		source: "public",
		userId: "3",
		displayName: "Rabbit",
		time: "10:38"
	},
	{
		id: "t10",
		text: "私人筆記：如果之後要回應，我想補充鏡子不需要電力這點。",
		source: "private",
		userId: "3",
		displayName: "Rabbit",
		time: "10:39"
	},
	{
		id: "t11",
		text: "我的想法是先排淡水，再排可被救援隊看到或聽到的工具，最後才是導航和長期食物。",
		source: "public",
		userId: "2",
		displayName: "Fox",
		time: "10:40"
	},
	{
		id: "t12",
		text: "私人筆記：等等可以問大家是否把任務假設成原地等待救援。",
		source: "private",
		userId: "2",
		displayName: "Fox",
		time: "10:41"
	}
];

MOCK_TRANSCRIPT_LINES.splice(
	0,
	MOCK_TRANSCRIPT_LINES.length,
	{
		id: "101",
		text: "我覺得水容器應該排在前面，因為脫水會比飢餓更快影響判斷。",
		source: "public",
		origin: "history",
		userId: "1",
		displayName: "You",
		isOwn: true,
		time: "10:30",
		timestampMs: 1715157000000,
		linkedBlockId: undefined
	},
	{
		id: "102",
		text: "我同意水很重要，但鏡子也要放很前面，因為它可能是最有效的求救工具。",
		source: "public",
		origin: "history",
		userId: "2",
		displayName: "Participant 2",
		isOwn: false,
		time: "10:31",
		timestampMs: 1715157060000,
		linkedBlockId: undefined
	},
	{
		id: "103",
		text: "悄悄話測試：VHF 可能太依賴距離，所以不一定比鏡子優先。",
		source: "private",
		origin: "history",
		userId: "1",
		displayName: "You",
		isOwn: true,
		time: "10:32",
		timestampMs: 1715157120000,
		linkedBlockId: "b1"
	},
	{
		id: "104",
		text: "如果天氣晴朗，鏡子的訊號距離很遠；但晚上就完全派不上用場。",
		source: "public",
		origin: "history",
		userId: "3",
		displayName: "Participant 3",
		isOwn: false,
		time: "10:33",
		timestampMs: 1715157180000,
		linkedBlockId: undefined
	},
	{
		id: "105",
		text: "我公開補充一下，燃油可以用來生火或做訊號，但危險性也比較高。",
		source: "public",
		origin: "history",
		userId: "1",
		displayName: "You",
		isOwn: true,
		time: "10:34",
		timestampMs: 1715157240000
	},
	{
		id: "106",
		text: "悄悄話測試：這句應該在右側灰色背景，重整後仍維持 private。",
		source: "private",
		origin: "history",
		userId: "1",
		displayName: "You",
		isOwn: true,
		time: "10:35",
		timestampMs: 1715157300000,
		linkedBlockId: "b2"
	},
	{
		id: "107",
		text: "我會把巧克力排在中間，因為它能快速補充能量，但不是最關鍵的求生工具。",
		source: "public",
		origin: "history",
		userId: "2",
		displayName: "Participant 2",
		isOwn: false,
		time: "10:36",
		timestampMs: 1715157360000
	},
	{
		id: "108",
		text: "即時訊息樣本：這筆 origin 是 live，會出現在 history 之後。",
		source: "private",
		origin: "live",
		userId: "1",
		displayName: "You",
		isOwn: true,
		time: "10:37",
		timestampMs: 1715157420000,
		linkedBlockId: "b3"
	}
);

export const MOCK_SIMILARITY_CUES: SimilarityCueData[] = [
	{
		id: "cue-1",
		blockId: "b3",
		blockSummary: "海圖和 VHF 無線電的排序需要看能不能定位救援"
	},
	{
		id: "cue-2",
		blockId: "b2",
		blockSummary: "淡水容器應該排前面"
	}
];
