(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const clampCount = (value) => Math.max(0, Math.min(99, Math.floor(Number(value) || 0)));
  const money = (value) => new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0
  }).format(Math.round(Number(value) || 0));

  const KEYS = {
    settings: "badminton_tools_settings_v3",
    roster: "badminton_tools_roster_v3",
    rotation: "badminton_tools_rotation_v3",
    calc: "badminton_tools_calc_v3",
    memory: "badminton_tools_people_memory_v1",
    tab: "badminton_tools_tab_v3"
  };

  const defaultSettings = {
    baseCost: 2700,
    activeCost: 1700,
    emptyCost: 1000,
    walkInPrice: 250,
    shortPrice: 250,
    funPrice: 350
  };

  let settings = loadJSON(KEYS.settings, defaultSettings);
  let roster = loadJSON(KEYS.roster, []);
  let calcState = loadJSON(KEYS.calc, {
    walkInCount: "",
    familyFullCount: "",
    familyShortCount: "",
    funOutsideCount: ""
  });

  let peopleMemory = loadJSON(KEYS.memory, []);

  let rotation = loadJSON(KEYS.rotation, {
    active: false,
    court: [],
    queue: [],
    games: {},
    round: 1,
    history: [],
    nextPlan: null
  });

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : structuredCloneSafe(fallback);
    } catch {
      return structuredCloneSafe(fallback);
    }
  }

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function saveAll() {
    localStorage.setItem(KEYS.settings, JSON.stringify(settings));
    localStorage.setItem(KEYS.roster, JSON.stringify(roster));
    localStorage.setItem(KEYS.calc, JSON.stringify(calcState));
    localStorage.setItem(KEYS.rotation, JSON.stringify(rotation));
    localStorage.setItem(KEYS.memory, JSON.stringify(peopleMemory));
  }

  function normalizeLoadedState() {
    roster = Array.isArray(roster) ? roster.filter(x => typeof x === "string" && x.trim()).slice(0, 24) : [];
    peopleMemory = Array.isArray(peopleMemory)
      ? [...new Set(peopleMemory.filter(x => typeof x === "string" && x.trim()))].slice(0, 60)
      : [];
    const rosterSet = new Set(roster);

    if (!rotation || typeof rotation !== "object") {
      rotation = { active:false, court:[], queue:[], games:{}, round:1, history:[], nextPlan:null };
    }

    rotation.court = Array.isArray(rotation.court) ? rotation.court.filter(x => rosterSet.has(x)) : [];
    rotation.queue = Array.isArray(rotation.queue) ? rotation.queue.filter(x => rosterSet.has(x)) : [];

    const validActive = rotation.active &&
      rotation.court.length === 4 &&
      new Set([...rotation.court, ...rotation.queue]).size === roster.length;

    if (!validActive) {
      rotation.active = false;
      rotation.court = [];
      rotation.queue = [];
      rotation.games = {};
      rotation.round = 1;
      rotation.history = [];
      rotation.nextPlan = null;
    }
  }

  normalizeLoadedState();

  // ---------- Tabs ----------
  const tabs = document.querySelectorAll(".tab");
  const pages = {
    calc: $("calcPage"),
    rotation: $("rotationPage")
  };

  function openTab(name) {
    const target = pages[name] ? name : "calc";
    tabs.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === target));
    Object.entries(pages).forEach(([key, page]) => page.classList.toggle("active", key === target));
    localStorage.setItem(KEYS.tab, target);
  }

  tabs.forEach(btn => btn.addEventListener("click", () => openTab(btn.dataset.tab)));
  openTab(localStorage.getItem(KEYS.tab) || "calc");

  // ---------- Calculator ----------
  const calcIds = ["walkInCount","familyFullCount","familyShortCount","funOutsideCount"];
  const settingMap = {
    baseCost: "baseCost",
    walkInCourtCostActive: "activeCost",
    walkInCourtCostEmpty: "emptyCost",
    walkInPrice: "walkInPrice",
    shortPrice: "shortPrice",
    funPrice: "funPrice"
  };

  $("baseCost").value = settings.baseCost;
  $("walkInCourtCostActive").value = settings.activeCost;
  $("walkInCourtCostEmpty").value = settings.emptyCost;
  $("walkInPrice").value = settings.walkInPrice;
  $("shortPrice").value = settings.shortPrice;
  $("funPrice").value = settings.funPrice;

  $("walkInCount").value = calcState.walkInCount ?? "";
  $("familyFullCount").value = calcState.familyFullCount ?? "";
  $("familyShortCount").value = calcState.familyShortCount ?? "";
  $("funOutsideCount").value = calcState.funOutsideCount ?? "";
  $("rosterCountHint").textContent = "臨打每人 $250；目前採手動輸入";

  function useRosterCountOnce() {
    $("walkInCount").value = roster.length ? String(roster.length) : "";
    calcState.walkInCount = $("walkInCount").value;
    $("syncRosterCountStatus").textContent = roster.length
      ? `已帶入輪轉名單 ${roster.length} 人`
      : "輪轉名單目前沒有人";
    calc();
  }

  function calc() {
    const walkInCount = clampCount($("walkInCount").value);
    const familyFullCount = clampCount($("familyFullCount").value);
    const familyShortCount = clampCount($("familyShortCount").value);
    const funOutsideCount = clampCount($("funOutsideCount").value);

    const currentCourtCost = walkInCount > 0 ? Number(settings.activeCost) : Number(settings.emptyCost);
    const walkInIncome = walkInCount * Number(settings.walkInPrice);
    const walkInProfit = walkInIncome - currentCourtCost;
    const shortIncome = familyShortCount * Number(settings.shortPrice);
    const funIncome = funOutsideCount * Number(settings.funPrice);
    const familyTotal = Number(settings.baseCost) - walkInProfit - shortIncome - funIncome;

    $("activeWalkInCourtCost").textContent = money(currentCourtCost);
    $("walkInIncome").textContent = money(walkInIncome);
    $("walkInProfit").textContent = (walkInProfit > 0 ? "+" : "") + money(walkInProfit);
    $("shortIncome").textContent = money(shortIncome);
    $("funIncome").textContent = money(funIncome);
    $("familyTotal").textContent = money(familyTotal);

    if (familyFullCount > 0) {
      const per = familyTotal / familyFullCount;
      $("perPerson").textContent = money(per);
      $("familyInfo").textContent = `打滿 4 小時親友 ${familyFullCount} 人平均分攤`;
    } else {
      $("perPerson").textContent = "—";
      $("familyInfo").textContent = "請輸入打滿 4 小時親友人數";
    }

    calcState.walkInCount = $("walkInCount").value;
    calcState.familyFullCount = $("familyFullCount").value;
    calcState.familyShortCount = $("familyShortCount").value;
    calcState.funOutsideCount = $("funOutsideCount").value;
    saveAll();
  }

  calcIds.forEach(id => {
    $(id).addEventListener("input", calc);
  });

  $("syncRosterCountBtn").addEventListener("click", useRosterCountOnce);

  Object.entries(settingMap).forEach(([elementId, key]) => {
    $(elementId).addEventListener("input", () => {
      settings[key] = Math.max(0, Number($(elementId).value) || 0);
      saveAll();
      calc();
    });
  });

  $("resetPriceBtn").addEventListener("click", () => {
    settings = structuredCloneSafe(defaultSettings);
    $("baseCost").value = settings.baseCost;
    $("walkInCourtCostActive").value = settings.activeCost;
    $("walkInCourtCostEmpty").value = settings.emptyCost;
    $("walkInPrice").value = settings.walkInPrice;
    $("shortPrice").value = settings.shortPrice;
    $("funPrice").value = settings.funPrice;
    saveAll();
    calc();
  });

  $("clearTodayBtn").addEventListener("click", () => {
    calcState.walkInCount = "";
    calcState.familyFullCount = "";
    calcState.familyShortCount = "";
    calcState.funOutsideCount = "";
    $("walkInCount").value = "";
    $("familyFullCount").value = "";
    $("familyShortCount").value = "";
    $("funOutsideCount").value = "";
    $("syncRosterCountStatus").textContent = "目前採手動輸入；需要時再按上方按鈕";
    calc();
  });

  // ---------- Roster ----------
  function cleanName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 20);
  }

  function setRosterMessage(text, isError = true) {
    const el = $("rosterMessage");
    el.textContent = text || "";
    el.style.color = isError ? "#b91c1c" : "#166534";
  }

  function updateRosterDerivedState() {
    $("rosterSummary").textContent = `目前 ${roster.length} 人`;
    $("syncRosterCountStatus").textContent = roster.length
      ? `輪轉名單目前 ${roster.length} 人；需要時按「使用輪轉名單人數」`
      : "輪轉名單目前沒有人";
    saveAll();
    renderPeopleMemory();
  }

  function renamePlayer(oldName, newName) {
    newName = cleanName(newName);
    if (!newName) return { ok:false, message:"名字不能空白" };
    if (newName !== oldName && roster.includes(newName)) {
      return { ok:false, message:"這個名字已經存在" };
    }
    if (newName === oldName) return { ok:true };

    roster = roster.map(name => name === oldName ? newName : name);

    if (rotation.active) {
      rotation.court = rotation.court.map(name => name === oldName ? newName : name);
      rotation.queue = rotation.queue.map(name => name === oldName ? newName : name);

      if (Object.prototype.hasOwnProperty.call(rotation.games, oldName)) {
        rotation.games[newName] = rotation.games[oldName];
        delete rotation.games[oldName];
      }
      if (rotation.nextPlan) {
        rotation.nextPlan = {
          ...rotation.nextPlan,
          next: rotation.nextPlan.next.map(x => x === oldName ? newName : x),
          stayers: rotation.nextPlan.stayers.map(x => x === oldName ? newName : x),
          incoming: rotation.nextPlan.incoming.map(x => x === oldName ? newName : x),
          outgoing: rotation.nextPlan.outgoing.map(x => x === oldName ? newName : x)
        };
      }

      rotation.history = rotation.history.map(entry => ({
        ...entry,
        court: entry.court.map(x => x === oldName ? newName : x),
        stayers: entry.stayers.map(x => x === oldName ? newName : x),
        incoming: entry.incoming.map(x => x === oldName ? newName : x),
        outgoing: entry.outgoing.map(x => x === oldName ? newName : x)
      }));
    }

    if (peopleMemory.includes(oldName)) {
      peopleMemory = peopleMemory.map(name => name === oldName ? newName : name);
      peopleMemory = [...new Set(peopleMemory)];
    }

    updateRosterDerivedState();
    renderRoster();
    renderRotation();
    renderPeopleMemory();
    return { ok:true };
  }


  function renderPeopleMemory() {
    const list = $("memoryPeopleList");
    if (!list) return;
    list.innerHTML = "";

    if (!peopleMemory.length) {
      const empty = document.createElement("div");
      empty.className = "memoryEmpty";
      empty.textContent = "尚未記住常用球友";
      list.appendChild(empty);
      return;
    }

    peopleMemory.forEach(name => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "memoryPerson" + (roster.includes(name) ? " inRoster" : "");
      btn.textContent = roster.includes(name) ? `✓ ${name}` : `＋ ${name}`;
      btn.disabled = rotation.active && !roster.includes(name);
      btn.addEventListener("click", () => {
        if (roster.includes(name)) return;
        if (rotation.active) {
          setRosterMessage("排場中不能新增人員，請先結束排場");
          return;
        }
        if (roster.length >= 24) {
          setRosterMessage("本場名單最多 24 人");
          return;
        }
        roster.push(name);
        updateRosterDerivedState();
        renderRoster();
        setRosterMessage(`${name} 已加入本場`, false);
      });
      list.appendChild(btn);
    });
  }

  function rememberCurrentRoster() {
    if (!roster.length) {
      setRosterMessage("目前本場名單沒有人可以記住");
      return;
    }
    peopleMemory = [...new Set([...peopleMemory, ...roster])].slice(0, 60);
    saveAll();
    renderPeopleMemory();
    setRosterMessage(`已記住 ${roster.length} 位本場球友`, false);
  }

  function addAllMemoryToRoster() {
    if (rotation.active) {
      setRosterMessage("排場中不能新增人員，請先結束排場");
      return;
    }
    const available = peopleMemory.filter(name => !roster.includes(name));
    const slots = Math.max(0, 24 - roster.length);
    const toAdd = available.slice(0, slots);
    roster.push(...toAdd);
    updateRosterDerivedState();
    renderRoster();
    setRosterMessage(
      toAdd.length ? `已加入 ${toAdd.length} 位常用球友` : "常用球友都已在本場名單",
      false
    );
  }

  function clearCurrentRoster() {
    if (rotation.active) {
      setRosterMessage("請先結束排場再清空本場名單");
      return;
    }
    roster = [];
    updateRosterDerivedState();
    renderRoster();
    setRosterMessage("本場名單已清空；常用球友仍保留", false);
  }

  function clearPeopleMemory() {
    if (!peopleMemory.length) return;
    peopleMemory = [];
    saveAll();
    renderPeopleMemory();
    setRosterMessage("常用球友已清除", false);
  }

  function renderRoster() {
    const list = $("rosterList");
    list.innerHTML = "";

    if (roster.length === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "尚未加入球友";
      list.appendChild(empty);
    }

    roster.forEach((name, index) => {
      const row = document.createElement("div");
      row.className = "rosterRow";

      const num = document.createElement("div");
      num.className = "rosterIndex";
      num.textContent = String(index + 1);

      const input = document.createElement("input");
      input.className = "rosterName";
      input.value = name;
      input.maxLength = 20;
      input.setAttribute("aria-label", `第 ${index + 1} 位球友姓名`);
      input.addEventListener("change", () => {
        const result = renamePlayer(name, input.value);
        if (!result.ok) {
          input.value = name;
          setRosterMessage(result.message);
        } else {
          setRosterMessage("姓名已更新", false);
        }
      });

      const up = document.createElement("button");
      up.type = "button";
      up.className = "iconBtn";
      up.textContent = "↑";
      up.title = "往前";
      up.disabled = rotation.active || index === 0;
      up.addEventListener("click", () => moveRoster(index, -1));

      const down = document.createElement("button");
      down.type = "button";
      down.className = "iconBtn";
      down.textContent = "↓";
      down.title = "往後";
      down.disabled = rotation.active || index === roster.length - 1;
      down.addEventListener("click", () => moveRoster(index, 1));

      const del = document.createElement("button");
      del.type = "button";
      del.className = "iconBtn";
      del.textContent = "✕";
      del.title = "刪除";
      del.disabled = rotation.active;
      del.addEventListener("click", () => {
        roster.splice(index, 1);
        setRosterMessage("");
        updateRosterDerivedState();
        renderRoster();
        updateRuleBadge();
      });

      row.append(num, input, up, down, del);
      list.appendChild(row);
    });

    $("nameInput").disabled = rotation.active;
    $("addBtn").disabled = rotation.active;
    $("demo6Btn").disabled = rotation.active;
    $("demo8Btn").disabled = rotation.active;
    $("demo10Btn").disabled = rotation.active;
    $("startBtn").disabled = rotation.active;

    updateRuleBadge();
  }

  function moveRoster(index, delta) {
    if (rotation.active) return;
    const target = index + delta;
    if (target < 0 || target >= roster.length) return;
    [roster[index], roster[target]] = [roster[target], roster[index]];
    updateRosterDerivedState();
    renderRoster();
  }

  $("addForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (rotation.active) return;

    const name = cleanName($("nameInput").value);
    if (!name) {
      setRosterMessage("請輸入名字");
      return;
    }
    if (roster.includes(name)) {
      setRosterMessage("這個名字已經存在");
      return;
    }
    if (roster.length >= 24) {
      setRosterMessage("最多支援 24 人");
      return;
    }

    roster.push(name);
    $("nameInput").value = "";
    setRosterMessage("");
    updateRosterDerivedState();
    renderRoster();
    $("nameInput").focus();
  });

  function makeDemo(count) {
    if (rotation.active) return;
    roster = Array.from({length:count}, (_,i) => `球友${i+1}`);
    updateRosterDerivedState();
    renderRoster();
    setRosterMessage(`已建立 ${count} 人測試名單`, false);
  }

  $("rememberRosterBtn").addEventListener("click", rememberCurrentRoster);
  $("addAllMemoryBtn").addEventListener("click", addAllMemoryToRoster);
  $("clearRosterBtn").addEventListener("click", clearCurrentRoster);
  $("clearMemoryBtn").addEventListener("click", clearPeopleMemory);

  $("demo6Btn").addEventListener("click", () => makeDemo(6));
  $("demo8Btn").addEventListener("click", () => makeDemo(8));
  $("demo10Btn").addEventListener("click", () => makeDemo(10));

  // ---------- Rotation ----------
  // ---------- Rotation ----------
  function requestedOffCount(total) {
    if (total >= 9) return 4;
    if (total >= 7) return 3;
    return 2; // 6 人以下目標下 2；候補不足時自動降低
  }

  function actualOffCount() {
    if (!rotation.active || rotation.court.length !== 4) return 0;
    return Math.min(requestedOffCount(roster.length), rotation.queue.length, 4);
  }

  function ruleText(total) {
    if (total >= 9) return "9 人以上：隨機上 4 下 4";
    if (total >= 7) return "7–8 人：隨機上 4 下 3";
    return "6 人以下：隨機上 4 下 2";
  }

  function updateRuleBadge() {
    $("ruleBadge").textContent = roster.length >= 4 ? ruleText(roster.length) : "至少需要 4 人";
  }

  function shuffle(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      let j;
      if (window.crypto && window.crypto.getRandomValues) {
        const random = new Uint32Array(1);
        window.crypto.getRandomValues(random);
        j = random[0] % (i + 1);
      } else {
        j = Math.floor(Math.random() * (i + 1));
      }
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function randomPick(array, count) {
    return shuffle(array).slice(0, Math.max(0, Math.min(count, array.length)));
  }

  function createRandomPlan() {
    if (!rotation.active || rotation.court.length !== 4) {
      return { next:[], stayers:[], incoming:[], outgoing:[], requested:0, actual:0 };
    }

    const requested = requestedOffCount(roster.length);
    const actual = actualOffCount();

    // 每局重新隨機決定誰下場、誰從候補上場。
    const outgoing = randomPick(rotation.court, actual);
    const stayers = rotation.court.filter(name => !outgoing.includes(name));
    const incoming = randomPick(rotation.queue, actual);

    // 四位下一場球員再洗牌一次，連場上位置／搭檔也隨機。
    const next = shuffle([...stayers, ...incoming]);

    return { next, stayers, incoming, outgoing, requested, actual };
  }

  function ensureNextPlan() {
    if (!rotation.active) return;
    const plan = rotation.nextPlan;
    const allNames = new Set(roster);
    const valid = plan &&
      Array.isArray(plan.next) &&
      plan.next.length === 4 &&
      plan.next.every(name => allNames.has(name));

    if (!valid) {
      rotation.nextPlan = createRandomPlan();
      saveAll();
    }
  }

  function startRotation() {
    if (roster.length < 4) {
      setRosterMessage("至少需要 4 人才能開始排場");
      return;
    }

    // 第一場也隨機，不再固定使用名單前四位。
    const shuffledRoster = shuffle(roster);

    rotation = {
      active: true,
      court: shuffledRoster.slice(0,4),
      queue: shuffledRoster.slice(4),
      games: Object.fromEntries(roster.map(name => [name,0])),
      round: 1,
      history: [],
      nextPlan: null
    };

    rotation.nextPlan = createRandomPlan();

    saveAll();
    setRosterMessage("已隨機安排第一場；每局結束後都會重新隨機抽下一場。", false);
    renderRoster();
    renderRotation();
  }

  $("startBtn").addEventListener("click", startRotation);

  function finishRound() {
    if (!rotation.active || rotation.court.length !== 4) return;

    ensureNextPlan();
    const plan = rotation.nextPlan;
    const oldCourt = [...rotation.court];

    oldCourt.forEach(name => {
      rotation.games[name] = (rotation.games[name] || 0) + 1;
    });

    // 把本輪被抽中的候補移出候補區。
    const incomingSet = new Set(plan.incoming);
    rotation.queue = rotation.queue.filter(name => !incomingSet.has(name));

    // 本輪下場的人回到候補池，候補池順序也隨機。
    rotation.queue.push(...plan.outgoing);
    rotation.queue = shuffle(rotation.queue);

    rotation.court = [...plan.next];

    rotation.history.unshift({
      round: rotation.round,
      court: oldCourt,
      stayers: [...plan.stayers],
      incoming: [...plan.incoming],
      outgoing: [...plan.outgoing],
      requested: plan.requested,
      actual: plan.actual
    });

    rotation.round += 1;

    // 先更新狀態，再隨機產生下一輪，讓畫面上的「下一場」不會跳來跳去。
    rotation.nextPlan = null;
    rotation.nextPlan = createRandomPlan();

    saveAll();
    renderRotation();
  }

  $("finishBtn").addEventListener("click", finishRound);

  $("endSessionBtn").addEventListener("click", () => {
    rotation.active = false;
    rotation.court = [];
    rotation.queue = [];
    rotation.games = {};
    rotation.round = 1;
    rotation.history = [];
    rotation.nextPlan = null;
    saveAll();
    setRosterMessage("已結束排場，現在可以新增、刪除或調整名單順序。", false);
    renderRoster();
    renderRotation();
  });

  function renderRotation() {
    $("gameArea").hidden = !rotation.active;
    if (!rotation.active) {
      updateRuleBadge();
      return;
    }

    ensureNextPlan();

    $("roundBadge").textContent = `第 ${rotation.round} 場`;
    $("ruleBadge").textContent = ruleText(roster.length);

    for (let i=0;i<4;i++) {
      $(`court${i}`).textContent = rotation.court[i] || "—";
    }

    const prediction = rotation.nextPlan;
    const nextGrid = $("nextGrid");
    nextGrid.innerHTML = "";

    prediction.next.forEach(name => {
      const box = document.createElement("div");
      const isStay = prediction.stayers.includes(name);
      box.className = "nextPerson" + (isStay ? " stay" : "");
      box.textContent = isStay ? `⭐ ${name}｜隨機留場` : `🎲 ${name}｜隨機上場`;
      nextGrid.appendChild(box);
    });

    let nextRule = ruleText(roster.length);
    if (prediction.actual < prediction.requested) {
      nextRule += `；候補只有 ${rotation.queue.length} 人，因此本輪實際隨機下 ${prediction.actual} 人`;
    } else {
      nextRule += `；本輪隨機下 ${prediction.actual} 人`;
    }
    $("nextRuleText").textContent = nextRule;

    const queue = $("queueList");
    queue.innerHTML = "";
    if (rotation.queue.length === 0) {
      const empty = document.createElement("span");
      empty.className = "muted";
      empty.textContent = "目前沒有候補";
      queue.appendChild(empty);
    } else {
      rotation.queue.forEach(name => {
        const chip = document.createElement("span");
        chip.className = "queueChip";
        chip.textContent = name;
        queue.appendChild(chip);
      });
    }

    const stats = $("gamesStats");
    stats.innerHTML = "";
    [...roster]
      .sort((a,b) => (rotation.games[a] || 0) - (rotation.games[b] || 0) || roster.indexOf(a) - roster.indexOf(b))
      .forEach(name => {
        const item = document.createElement("div");
        item.className = "statChip";
        const label = document.createElement("span");
        label.textContent = name;
        const strong = document.createElement("strong");
        strong.textContent = `${rotation.games[name] || 0} 局`;
        item.append(label,strong);
        stats.appendChild(item);
      });

    const history = $("historyList");
    history.innerHTML = "";
    if (!rotation.history.length) {
      const empty = document.createElement("span");
      empty.className = "muted";
      empty.textContent = "尚未完成任何一局";
      history.appendChild(empty);
    } else {
      rotation.history.forEach(entry => {
        const item = document.createElement("div");
        item.className = "historyItem";

        const title = document.createElement("strong");
        title.textContent = `第 ${entry.round} 場｜${entry.court.join("、")}`;

        const detail = document.createElement("div");
        const stayText = entry.stayers.length ? `隨機留：${entry.stayers.join("、")}` : "無留場";
        const offText = entry.outgoing.length ? `隨機下：${entry.outgoing.join("、")}` : "無下場";
        detail.textContent = `${stayText}｜${offText}`;

        item.append(title,detail);
        history.appendChild(item);
      });
    }

    saveAll();
  }

  // ---------- Init ----------
  calc();
  renderPeopleMemory();
  renderRoster();
  renderRotation();
  updateRosterDerivedState();
})();
