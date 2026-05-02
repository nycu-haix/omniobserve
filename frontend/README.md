# OmniObserve Frontend

OmniObserve 是一個整合視訊會議與語音辨識（ASR）等輔助觀察功能的系統。本專案為 OmniObserve 的前端應用，負責提供使用者介面與各項互動功能。

## Tech Stack

- **框架**: React 19 + Vite 8
- **樣式**: Tailwind CSS
- **UI 元件庫**: Radix UI (配合 shadcn/ui 概念) + Lucide React (Icons)
- **視訊整合**: `@jitsi/react-sdk` (整合 Jitsi Meet 作為視訊會議底層)
- **狀態管理與互動**: `@dnd-kit` (用於拖曳功能)
- **開發語言**: TypeScript

## Folder Architecture

`src/` 目錄結構：

- `components/`: UI 元件，包含共用的按鈕、輸入框等與特定功能的組件。
- `hooks/`: 自定義 React Hooks (如：管理會議狀態、錄音狀態等)。
- `lib/`: 工具函式與共用庫 (例如 shadcn 用的 `utils.ts`)。
- `services/`: 與後端 API 溝通的介面 (API calls)。
- `types/`: TypeScript 型別定義檔。
- `mock/`: 模擬資料，用於前端獨立開發或測試。
- `assets/`: 靜態資源 (圖片、全域 CSS 等)。

## Meeting URL Parameters

首頁會產生帶 query string 的會議網址。根路徑沒有 query string 時會停在首頁設定頁；只要網址帶有 `room_name`、`id` 或 `name` 任一參數，就會進入會議頁。

目前正式使用的參數命名：

- `room_name`: 會議 room / session 名稱。前端會用它作為 Jitsi room name，也會用作後端 board websocket 的 session id。
- `id`: 參與者 ID。前端會用它連線到後端 board websocket 的 `participant_id`。
- `name`: 使用者在 Jitsi 會議中顯示的名稱。

範例：

```text
https://omni.elvismao.com/?room_name=lost-at-sea&id=1&name=User
```

## Getting Started

1.  安裝依賴 (使用 pnpm):
    ```bash
    pnpm install
    ```
2.  啟動開發伺服器:
    ```bash
    pnpm dev
    ```
3.  建置正式環境版本:
    ```bash
    pnpm build
    ```
