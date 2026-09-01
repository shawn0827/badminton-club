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
    settings: "badminton_tools_settings_v1",
    roster: "badminton_tools_roster_v1",
    rotation: "badminton_tools_rotation_v1",
    calc: "badminton_tools_calc_v1",
    tab: "badminton_tools_tab_v1"
  };

  const defaultSettings = {
    baseCost: 2700,
    activeCost: 1700,
    emptyCost: 1000,
    walkInPrice: 350,
    shortPrice: 250,
    funPrice: 350
  };

  let settings = loadJSON(KEYS.settings, defaultSettings);
  let roster = loadJSON(KEYS.roster, []);
  let calcState = loadJSON(KEYS.calc, {
    walkInCount: 0,
    familyFullCount: 0,
    familyShortCount: 0,
    funOutsideCount: 0,
    useRosterCount: true
  });

  let rotation = loadJSON(KEYS.rotation, {
    active: false,
    court: [],
    queue: [],
    games: {},
    streak: {},
    round: 1,
    history: []
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
  }

  function normalizeLoadedState() {
    roster = Array.isArray(roster) ? roster.filter(x => typeof x === "string" && x.trim()).slice(0, 24) : [];
    const rosterSet = new Set(roster);

    if (!rotation || typeof rotation !== "object") {
      rotation = { active:false, court:[], queue:[], games:{}, streak:{}, round:1, history:[] };
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
      rotation.streak = {};
      rotation.round = 1;
      rotation.history = [];
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

  $("familyFullCount").value = calcState.familyFullCount || 0;
  $("familyShortCount").value = calcState.familyShortCount || 0;
  $("funOutsideCount").value = calcState.funOutsideCount || 0;
  $("useRosterCount").checked = calcState.useRosterCount !== false;

  function syncWalkInField() {
    const useRoster = $("useRosterCount").checked;
    $("walkInCount").readOnly = useRoster;
    if (useRoster) {
      $("walkInCount").value = roster.length;
      calcState.walkInCount = roster.length;
      $("rosterCountHint").textContent = `目前輪轉名單 ${roster.length} 人，已自動同步`;
    } else {
      $("walkInCount").value = calcState.walkInCount || 0;
      $("rosterCountHint").textContent = "目前使用手動輸入";
    }
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

    calcState.walkInCount = walkInCount;
    calcState.familyFullCount = familyFullCount;
    calcState.familyShortCount = familyShortCount;
    calcState.funOutsideCount = funOutsideCount;
    calcState.useRosterCount = $("useRosterCount").checked;
    saveAll();
  }

  calcIds.forEach(id => {
    $(id).addEventListener("input", () => {
      if (id === "walkInCount" && $("useRosterCount").checked) return;
      calc();
    });
  });

  $("useRosterCount").addEventListener("change", () => {
    calcState.useRosterCount = $("useRosterCount").checked;
    syncWalkInField();
    calc();
  });

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
    calcState.familyFullCount = 0;
    calcState.familyShortCount = 0;
    calcState.funOutsideCount = 0;
    if (!$("useRosterCount").checked) calcState.walkInCount = 0;
    $("familyFullCount").value = 0;
    $("familyShortCount").value = 0;
    $("funOutsideCount").value = 0;
    syncWalkInField();
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
    if ($("useRosterCount").checked) {
      calcState.walkInCount = roster.length;
      syncWalkInField();
      calc();
    }
    saveAll();
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
      if (Object.prototype.hasOwnProperty.call(rotation.streak, oldName)) {
        rotation.streak[newName] = rotation.streak[oldName];
        delete rotation.streak[oldName];
      }

      rotation.history = rotation.history.map(entry => ({
        ...entry,
        court: entry.court.map(x => x === oldName ? newName : x),
        stayers: entry.stayers.map(x => x === oldName ? newName : x),
        incoming: entry.incoming.map(x => x === oldName ? newName : x),
        outgoing: entry.outgoing.map(x => x === oldName ? newName : x)
      }));
    }

    updateRosterDerivedState();
    renderRoster();
    renderRotation();
    return { ok:true };
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

  $("demo6Btn").addEventListener("click", () => makeDemo(6));
  $("demo8Btn").addEventListener("click", () => makeDemo(8));
  $("demo10Btn").addEventListener("click", () => makeDemo(10));

  // ---------- Rotation ----------
  function requestedOffCount(total) {
    if (total >= 9) return 4;
    if (total >= 7) return 3;
    return 2; // 6 人以下的目標規則；候補不足時會自動降低
  }

  function actualOffCount() {
    if (!rotation.active || rotation.court.length !== 4) return 0;
    return Math.min(requestedOffCount(roster.length), rotation.queue.length, 4);
  }

  function ruleText(total) {
    if (total >= 9) return "9 人以上：上 4 下 4";
    if (total >= 7) return "7–8 人：上 4 下 3";
    return "6 人以下：上 4 下 2";
  }

  function updateRuleBadge() {
    $("ruleBadge").textContent = roster.length >= 4 ? ruleText(roster.length) : "至少需要 4 人";
  }

  function chooseStayers(stayCount) {
    if (stayCount <= 0) return [];
    return [...rotation.court]
      .sort((a,b) =>
        (rotation.streak[a] || 0) - (rotation.streak[b] || 0) ||
        (rotation.games[a] || 0) - (rotation.games[b] || 0) ||
        roster.indexOf(a) - roster.indexOf(b)
      )
      .slice(0, stayCount);
  }

  function predictNext() {
    if (!rotation.active || rotation.court.length !== 4) {
      return { next:[], stayers:[], incoming:[], outgoing:[], requested:0, actual:0 };
    }

    const requested = requestedOffCount(roster.length);
    const actual = actualOffCount();
    const stayCount = 4 - actual;
    const stayers = chooseStayers(stayCount);
    const incoming = rotation.queue.slice(0, actual);
    const outgoing = rotation.court.filter(name => !stayers.includes(name));
    const next = [...stayers, ...incoming];

    return { next, stayers, incoming, outgoing, requested, actual };
  }

  function startRotation() {
    if (roster.length < 4) {
      setRosterMessage("至少需要 4 人才能開始排場");
      return;
    }

    rotation = {
      active: true,
      court: roster.slice(0,4),
      queue: roster.slice(4),
      games: Object.fromEntries(roster.map(name => [name,0])),
      streak: Object.fromEntries(roster.map(name => [name,0])),
      round: 1,
      history: []
    };

    saveAll();
    setRosterMessage("排場已開始。若名字打錯，可直接修改姓名。", false);
    renderRoster();
    renderRotation();
  }

  $("startBtn").addEventListener("click", startRotation);

  function finishRound() {
    if (!rotation.active || rotation.court.length !== 4) return;

    const oldCourt = [...rotation.court];
    oldCourt.forEach(name => {
      rotation.games[name] = (rotation.games[name] || 0) + 1;
    });

    const prediction = predictNext();
    const usedIncoming = rotation.queue.splice(0, prediction.actual);
    const stayers = prediction.stayers;
    const outgoing = oldCourt.filter(name => !stayers.includes(name));

    rotation.queue.push(...outgoing);
    rotation.court = [...stayers, ...usedIncoming];

    roster.forEach(name => {
      if (stayers.includes(name)) {
        rotation.streak[name] = (rotation.streak[name] || 0) + 1;
      } else {
        rotation.streak[name] = 0;
      }
    });

    rotation.history.unshift({
      round: rotation.round,
      court: oldCourt,
      stayers: [...stayers],
      incoming: [...usedIncoming],
      outgoing: [...outgoing],
      requested: prediction.requested,
      actual: prediction.actual
    });

    rotation.round += 1;
    saveAll();
    renderRotation();
  }

  $("finishBtn").addEventListener("click", finishRound);

  $("endSessionBtn").addEventListener("click", () => {
    rotation.active = false;
    rotation.court = [];
    rotation.queue = [];
    rotation.games = {};
    rotation.streak = {};
    rotation.round = 1;
    rotation.history = [];
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

    $("roundBadge").textContent = `第 ${rotation.round} 場`;
    $("ruleBadge").textContent = ruleText(roster.length);

    for (let i=0;i<4;i++) {
      $(`court${i}`).textContent = rotation.court[i] || "—";
    }

    const prediction = predictNext();
    const nextGrid = $("nextGrid");
    nextGrid.innerHTML = "";
    prediction.next.forEach(name => {
      const box = document.createElement("div");
      box.className = "nextPerson" + (prediction.stayers.includes(name) ? " stay" : "");
      box.textContent = prediction.stayers.includes(name) ? `⭐ ${name}｜留場` : `⬆️ ${name}｜上場`;
      nextGrid.appendChild(box);
    });

    let nextRule = ruleText(roster.length);
    if (prediction.actual < prediction.requested) {
      nextRule += `；候補只有 ${rotation.queue.length} 人，所以本輪實際下 ${prediction.actual} 人`;
    } else {
      nextRule += `；本輪下 ${prediction.actual} 人`;
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
      rotation.queue.forEach((name,index) => {
        const chip = document.createElement("span");
        chip.className = "queueChip";
        chip.textContent = `${index+1}. ${name}`;
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
        const stayText = entry.stayers.length ? `留：${entry.stayers.join("、")}` : "無留場";
        const offText = entry.outgoing.length ? `下：${entry.outgoing.join("、")}` : "無下場";
        detail.textContent = `${stayText}｜${offText}`;

        item.append(title,detail);
        history.appendChild(item);
      });
    }

    saveAll();
  }

  // ---------- Init ----------
  syncWalkInField();
  calc();
  renderRoster();
  renderRotation();
  updateRosterDerivedState();
})();
