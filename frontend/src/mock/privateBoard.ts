import type { IdeaBlock, SimilarityCueData, TranscriptLine } from "../types";

export const ENABLE_PRIVATE_BOARD_MOCK_DATA = true;

export const MOCK_IDEA_BLOCKS: IdeaBlock[] = [
	{
		id: "b1",
		summary: "先確認大家對海上求生目標的理解一致",
		aiSummary: "團隊目前同意先用海上求生優先順序來討論，不急著投票。共識是先釐清淡水、求救訊號、定位工具在不同情境下的重要性。",
		transcript: "我覺得我們先不要馬上排序，可以先確認大家是不是都把目標理解成等待救援，而不是自己航行到岸邊。",
		transcriptLineId: "t1",
		expanded: true,
		status: "ready"
	},
	{
		id: "b2",
		summary: "淡水容器應該排前面，因為直接影響生存時間",
		aiSummary: "淡水被視為最直接的生存限制。若無法保存飲用水，其他資源較難發揮作用，因此多數成員傾向把裝水容器放在高優先級。",
		transcript: "裝水容器一定要在前面吧，因為沒有淡水的話，就算我們有海圖或食物也撐不了太久。",
		transcriptLineId: "t2",
		expanded: false,
		status: "ready"
	},
	{
		id: "b3",
		summary: "海圖和 VHF 無線電的排序需要看能不能定位救援",
		aiSummary: "海圖能幫助判斷位置與洋流，VHF 無線電能提供求援或確認方向。兩者的排序取決於團隊假設：如果救援船距離不遠，通訊較重要；如果位置不明，海圖可能更需要一起討論。",
		transcript: "如果我們知道救援船大概在哪，VHF 無線電可能比海圖重要；但如果完全不知道方向，海圖也許可以先幫我們確認位置。",
		transcriptLineId: "t3",
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
		linkedBlockId: "b1"
	},
	{
		id: "t2",
		text: "裝水容器一定要在前面吧，因為沒有淡水的話，就算我們有海圖或食物也撐不了太久。",
		linkedBlockId: "b2"
	},
	{
		id: "t3",
		text: "如果我們知道救援船大概在哪，VHF 無線電可能比海圖重要；但如果完全不知道方向，海圖也許可以先幫我們確認位置。",
		linkedBlockId: "b3"
	},
	{
		id: "t4",
		text: "我剛剛想到水的消耗量可能跟路程時間有關，這段可以請 AI 幫我整理成新的想法。",
		linkedBlockId: "b4"
	},
	{
		id: "t5",
		text: "食物雖然重要，但短時間求生裡可能不是第一優先，應該排在淡水和求救工具後面。"
	}
];

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
