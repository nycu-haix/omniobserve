import type { IdeaBlock, SimilarityCueData, TranscriptLine } from "../types";

export const ENABLE_PRIVATE_BOARD_MOCK_DATA = true;

export const MOCK_IDEA_BLOCKS: IdeaBlock[] = [
  {
    id: "b1",
    summary: "先確認大家對月球任務目標的理解一致",
    aiSummary:
      "團隊目前同意先用生存優先順序來討論，不急著投票。共識是先釐清氧氣、水、通訊設備在不同情境下的重要性。",
    transcript:
      "我覺得我們先不要馬上排序，可以先確認大家是不是都把目標理解成回到母船，而不是在原地等待救援。",
    transcriptLineId: "t1",
    expanded: true,
    status: "ready",
  },
  {
    id: "b2",
    summary: "氧氣筒應該排第一，因為直接影響生存時間",
    aiSummary:
      "氧氣被視為最直接的生存限制。若沒有氧氣，其他資源無法發揮作用，因此多數成員傾向把氧氣放在最高優先級。",
    transcript: "氧氣一定要在前面吧，因為沒有氧氣的話，就算我們有地圖或食物也沒有時間使用。",
    transcriptLineId: "t2",
    expanded: false,
    status: "ready",
  },
  {
    id: "b3",
    summary: "星圖和無線電的排序需要看能不能定位母船",
    aiSummary:
      "星圖能幫助路線規劃，無線電能提供求援或確認方向。兩者的排序取決於團隊假設：如果母船位置已知，星圖較重要；如果位置不確定，通訊可能更重要。",
    transcript:
      "如果我們知道母船大概在哪，星圖可能比無線電重要；但如果完全不知道方向，無線電也許可以先確認位置。",
    transcriptLineId: "t3",
    hasCue: true,
    cueText: "另一位成員也提到星圖和無線電要一起討論。",
    expanded: false,
    status: "ready",
  },
  {
    id: "b4",
    summary: "正在生成...",
    transcriptLineId: "t4",
    status: "generating",
  },
];

export const MOCK_TRANSCRIPT_LINES: TranscriptLine[] = [
  {
    id: "t1",
    text: "我覺得我們先不要馬上排序，可以先確認大家是不是都把目標理解成回到母船，而不是在原地等待救援。",
    linkedBlockId: "b1",
  },
  {
    id: "t2",
    text: "氧氣一定要在前面吧，因為沒有氧氣的話，就算我們有地圖或食物也沒有時間使用。",
    linkedBlockId: "b2",
  },
  {
    id: "t3",
    text: "如果我們知道母船大概在哪，星圖可能比無線電重要；但如果完全不知道方向，無線電也許可以先確認位置。",
    linkedBlockId: "b3",
  },
  {
    id: "t4",
    text: "我剛剛想到水的消耗量可能跟路程時間有關，這段可以請 AI 幫我整理成新的想法。",
    linkedBlockId: "b4",
  },
  {
    id: "t5",
    text: "食物雖然重要，但短時間任務裡可能不是第一優先，應該排在氧氣和導航工具後面。",
  },
];

export const MOCK_SIMILARITY_CUES: SimilarityCueData[] = [
  {
    id: "cue-1",
    blockId: "b3",
    blockSummary: "星圖和無線電的排序需要看能不能定位母船",
  },
  {
    id: "cue-2",
    blockId: "b2",
    blockSummary: "氧氣筒應該排第一",
  },
];
