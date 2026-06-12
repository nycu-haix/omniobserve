(async () => {
  const ideas = [
    "我會先把地圖和收音機想得比較前面，因為位置不明時，資訊和方向感可能很重要。",
    "六分儀看起來是航海工具，但我不確定我們有沒有足夠知識和資料能用好它。",
    "鏡子和燃料可能有用，但都好像比較吃使用時機。",
    "釣魚工具組對長時間漂流可能重要，因為現有食物總會吃完。",
    "繩子、塑膠布、蚊帳這種材料類物品，可能要看大家能想到多少用途。",
    "水一定重要，但如果只看長期生存，也要討論食物和工具怎麼搭配。",
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
  console.error("新增 Lost-at-Sea private thoughts 失敗：", error);
});
