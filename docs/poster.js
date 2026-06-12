(async () => {
  const ideas = [
    "我覺得可以先不要大改海洋背景，因為至少跟淨灘主題有關，先把資訊層級整理好可能比較重要。",
    "標題現在太大了，第一眼很有氣勢，但反而讓時間地點和報名資訊比較不容易被看到。",
    "我其實覺得副標題「南寮海岸淨灘行動」應該比 2026 NYCU 更重要，因為大家先要知道這是什麼活動。",
    "兩個場次的黃色和橘色看起來像不同設計硬湊在一起，可以統一成比較一致的資訊卡片。",
    "上午場和下午場的排版不太一致，掃讀的時候要重新理解一次，感覺可以整理成同一套格式。",
    "我會想先讓時間、地點、集合方式變成最清楚的資訊，不然這種活動海報如果看不懂時間就沒用了。",
    "QR Code 有點被丟在右下角，雖然看得到，但報名是主要行動，應該要更醒目一點。",
    "QR Code 說明的『報名連結』可以再大一點，不然它現在比較像附屬文字，不像主要 CTA。",
    "參與資訊跟 QR Code 應該靠近一點，因為看完對象、贈品、抽獎資格，下一步就是掃 QR Code 報名。",
    "底部主辦單位和 logo 覺得可以保留，但現在佔的視覺重量有點太重，應該退到比較次要的位置。",
    "兩張照片都能說明淨灘，但尺寸和位置有點亂，感覺可以至少對齊或做成同一種照片框。",
    "右上照片的圓角和左下照片的直角不一致，這種小地方會讓海報看起來比較像拼貼。",
    "我不確定兩張照片是不是都需要，也許留一張比較好的活動照，另一邊拿來放資訊會更乾淨。",
    "獎品資訊可以保留，因為它有吸引力，但不要讓它變成跟活動本身搶重點的東西。",
    "我覺得現在最大的問題不是醜，而是資訊太分散；眼睛不知道要先看標題、照片、色塊還是 QR Code。",
    "如果時間有限，我會先改標題大小、兩個場次資訊卡、QR Code 位置，這三個應該最有感。",
    "字型有點太手寫感，主題可以活潑，但活動資訊最好用更穩定、正式、易讀的字體。",
    "我覺得可以保留藍色海洋感，但黃色和橘色太跳，可以改成比較接近海岸、沙灘或救援背心的色系。",
    "海報下半部有點空跟擠同時存在，左下資訊很多、右下 QR 很孤立，中間又有一塊空間沒有被好好利用。",
    "我會比較支持保守整理，不一定要換成全新的插畫風，因為這張海報的活動辨識度其實已經有了。",
  ];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function setNativeValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const valueSetter = Object.getOwnPropertyDescriptor(
      prototype,
      "value",
    )?.set;

    if (!valueSetter) {
      element.value = value;
    } else {
      valueSetter.call(element, value);
    }

    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: value,
      }),
    );
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function getTextarea() {
    return document.querySelector(
      'textarea[aria-label="Manual idea block input"]',
    );
  }

  function getAddButton(textarea) {
    const container = textarea.closest("footer") ?? textarea.parentElement;
    return [...(container ?? document).querySelectorAll("button")].find(
      (btn) => btn.textContent.trim() === "新增",
    );
  }

  function isButtonDisabled(button) {
    return button.disabled || button.getAttribute("aria-disabled") === "true";
  }

  async function waitForEnabledAddButton(textarea, timeout = 5000) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const addButton = getAddButton(textarea);

      if (addButton && !isButtonDisabled(addButton)) {
        return addButton;
      }

      await sleep(100);
    }

    throw new Error(
      "找不到可點擊的 Private Board「新增」按鈕。請確認 Idea Blocks 分頁已開啟。",
    );
  }

  async function waitForTextareaClear(textarea, previousValue, timeout = 5000) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      if (textarea.value === "") {
        return;
      }

      await sleep(100);
    }

    console.warn("送出後 textarea 尚未清空，繼續下一筆：", previousValue);
  }

  async function addIdeas() {
    const textarea = getTextarea();

    if (!textarea) {
      throw new Error('找不到 textarea[aria-label="Manual idea block input"]');
    }

    console.log(`準備新增 ${ideas.length} 筆 idea block。`);

    for (let i = 0; i < ideas.length; i++) {
      const idea = ideas[i];

      textarea.focus();
      setNativeValue(textarea, idea);

      await sleep(150);

      const addButton = await waitForEnabledAddButton(textarea);
      addButton.click();

      console.log(`已新增 ${i + 1}/${ideas.length}：${idea}`);

      await waitForTextareaClear(textarea, idea);
      await sleep(300);
    }

    console.log(`完成，共新增 ${ideas.length} 筆 idea block。`);
  }

  await addIdeas();
})().catch((error) => {
  console.error("新增 poster private thoughts 失敗：", error);
});
