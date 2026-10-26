(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const clampCount = (value) => Math.max(0, Math.min(99, Math.floor(Number(value) || 0)));
  const money = (value) => new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0
  }).format(Math.round(Number(value) || 0));

  const MAX_PLAYERS = 60;
  const MAX_COURTS = 3;
  const LEGACY_ROTATION_KEY = "badminton_tools_rotation_v9_team_colors_random_first";

  const KEYS = {
    settings: "badminton_tools_settings_v12",
    roster: "badminton_tools_roster_v3",
    rotation: "badminton_tools_rotation_v10_multi_court_pairs",
    calc: "badminton_tools_calc_v12",
    memory: "badminton_tools_people_memory_v1",
    payment: "badminton_tools_payment_v1",
    tab: "badminton_tools_tab_v12"
  };

  const defaultSettings = {
    baseCost: 2000,
    courtCost: 1000,
    walkInPrice: 250,
    shortPrice: 250,
    funPrice: 350,
    ballPrice: 700
  };

  let settings = loadJSON(KEYS.settings, defaultSettings);
  let roster = loadJSON(KEYS.roster, []);
  let calcState = loadJSON(KEYS.calc, {
    walkInCount: "",
    familyFullCount: "",
    familyShortCount: "",
    ballprice: 700,
    funOutsideCount: ""
  });

  let peopleMemory = loadJSON(KEYS.memory, []);
  let paymentList = loadJSON(KEYS.payment, []);

  const defaultRotation = {
    active: false, courtCount: 2, courts: [], pairs: [], games: {}, history: [],
    mode: "shared", assignments: {}, sharedPreviewCourtId: 1
  };
  // Read the old session once if the upgraded key has not been saved yet.
  let rotation = localStorage.getItem(KEYS.rotation)
    ? loadJSON(KEYS.rotation, defaultRotation)
    : loadJSON(LEGACY_ROTATION_KEY, defaultRotation);

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
    localStorage.setItem(KEYS.payment, JSON.stringify(paymentList));
  }

  function makeCourt(id) {
    return { id, court: [], round: 1, nextPlan: null };
  }

  function normalizeLoadedState() {
    roster = Array.isArray(roster)
      ? [...new Set(roster.filter(x => typeof x === "string" && x.trim()))].slice(0, MAX_PLAYERS)
      : [];
    peopleMemory = Array.isArray(peopleMemory)
      ? [...new Set(peopleMemory.filter(x => typeof x === "string" && x.trim()))].slice(0, 60)
      : [];
    paymentList = Array.isArray(paymentList)
      ? paymentList.filter(item => item && typeof item.name === "string" && item.name.trim())
        .map((item, index) => ({
          id: String(item.id || `p_${index}_${Date.now()}`),
          name: item.name.trim().slice(0,20),
          amount: Math.max(0, Number(item.amount) || 250),
          paid: Boolean(item.paid)
        })).slice(0, 60)
      : [];

    if (!rotation || typeof rotation !== "object") rotation = structuredCloneSafe(defaultRotation);
    // Backwards-compatible migration of the original single-court rotation.
    if (!Array.isArray(rotation.courts) && Array.isArray(rotation.court)) {
      const old = rotation;
      rotation = {
        ...structuredCloneSafe(defaultRotation),
        active: Boolean(old.active),
        courtCount: 2,
        courts: [
          { id: 1, court: Array.isArray(old.court) ? old.court : [],
            round: Math.max(1, Number(old.round) || 1), nextPlan: null },
          makeCourt(2)
        ],
        games: old.games && typeof old.games === "object" ? old.games : {},
        history: Array.isArray(old.history)
          ? old.history.map(h => ({ ...h, courtId: 1 })) : [],
        pairs: []
      };
    }
    rotation.mode = rotation.mode === "split" ? "split" : "shared";
    rotation.assignments = rotation.assignments && typeof rotation.assignments === "object" ? rotation.assignments : {};
    rotation.courtCount = Math.max(1, Math.min(MAX_COURTS,
      Math.floor(Number(rotation.courtCount) || 2)));
    // Only one preview is displayed in shared mode. Remember which physical
    // court the user is viewing, while retaining all existing court plans.
    rotation.sharedPreviewCourtId = Math.max(1, Math.min(rotation.courtCount,
      Math.floor(Number(rotation.sharedPreviewCourtId) || 1)));
    const rosterSet = new Set(roster);
    rotation.assignments = Object.fromEntries(roster.filter(name => Number.isInteger(Number(rotation.assignments[name])) && Number(rotation.assignments[name]) >= 1 && Number(rotation.assignments[name]) <= rotation.courtCount).map(name => [name, Number(rotation.assignments[name])]));
    const taken = new Set();
    const usedPairs = new Set();
    rotation.pairs = (Array.isArray(rotation.pairs) ? rotation.pairs : [])
      .filter(pair => {
        if (!Array.isArray(pair) || pair.length !== 2 || pair[0] === pair[1] ||
            !rosterSet.has(pair[0]) || !rosterSet.has(pair[1]) ||
            usedPairs.has(pair[0]) || usedPairs.has(pair[1])) return false;
        usedPairs.add(pair[0]); usedPairs.add(pair[1]);
        return true;
      });
    const storedCourts = Array.isArray(rotation.courts) ? rotation.courts : [];
    rotation.courts = Array.from({length:rotation.courtCount}, (_,i) => {
      const existing = storedCourts[i];
      const slots = existing && Array.isArray(existing.court) ? existing.court : [];
      const valid = slots.length === 4 && slots.every(name => rosterSet.has(name) && !taken.has(name))
        && new Set(slots).size === 4;
      if (valid) slots.forEach(name => taken.add(name));
      return { id:i+1, court:valid ? [...slots] : [],
        round:Math.max(1, Math.floor(Number(existing?.round) || 1)),
        // Keep each court's already displayed next-round recommendation on refresh.
        // Validate below, after the complete multi-court state has been restored.
        nextPlan:Array.isArray(existing?.nextPlan) ? [...existing.nextPlan] : null };
    });
    // Invalid legacy assignments must not violate pair rules or duplicate players.
    rotation.courts.forEach(c => {
      if (!c.court.length) return;
      if (rotation.mode === "split" && c.court.some(name => rotation.assignments[name] !== c.id)) { c.court=[]; return; }
      if (rotation.pairs.some(([x,y]) => {
        const a=c.court.indexOf(x), b=c.court.indexOf(y);
        return (a===-1)!==(b===-1) || (a!==-1 && a%2!==b%2);
      })) c.court=[];
    });
    rotation.games = rotation.games && typeof rotation.games === "object" ? rotation.games : {};
    rotation.games = Object.fromEntries(roster.map(name =>
      [name, Math.max(0, Math.floor(Number(rotation.games[name]) || 0))]));
    rotation.history = Array.isArray(rotation.history) ? rotation.history.slice(0, 300) : [];
    rotation.active = Boolean(rotation.active) && roster.length >= 4;
    if (!rotation.active) rotation.courts.forEach(c => {c.court=[]; c.nextPlan=null; c.round=1;});
    else rotation.courts.forEach(c => {
      // A stored recommendation belongs to the current ongoing match only.
      if (c.court.length !== 4 || !c.nextPlan || !validateLineup(c.nextPlan, c.id).ok) {
        c.nextPlan = null;
      }
    });
  }

  normalizeLoadedState();

  // ---------- Tabs ----------
  const tabs = document.querySelectorAll(".tab");
  const pages = {
    calc: $("calcPage"),
    rotation: $("rotationPage"),
    payment: $("paymentPage")
  };

  function openTab(name) {
    const target = pages[name] ? name : "calc";
    tabs.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === target));
    Object.entries(pages).forEach(([key, page]) => page.classList.toggle("active", key === target));
    localStorage.setItem(KEYS.tab, target);
    requestAnimationFrame(fitReadyNames);
  }

  tabs.forEach(btn => btn.addEventListener("click", () => openTab(btn.dataset.tab)));
  openTab(localStorage.getItem(KEYS.tab) || "calc");

  // ---------- Calculator ----------
  const calcIds = ["walkInCount","familyFullCount","familyShortCount","ballprice","funOutsideCount"];
  const settingMap = {
    baseCost: "baseCost",
    walkInCourtCost: "courtCost",
    walkInPrice: "walkInPrice",
    shortPrice: "shortPrice",
    funPrice: "funPrice",
    defaultBallPrice: "ballPrice"
  };

  $("baseCost").value = settings.baseCost;
  $("walkInCourtCost").value = settings.courtCost;
  $("walkInPrice").value = settings.walkInPrice;
  $("shortPrice").value = settings.shortPrice;
  $("funPrice").value = settings.funPrice;
  $("defaultBallPrice").value = settings.ballPrice;

  $("walkInCount").value = calcState.walkInCount ?? "";
  $("familyFullCount").value = calcState.familyFullCount ?? "";
  $("familyShortCount").value = calcState.familyShortCount ?? "";
  $("ballprice").value = calcState.ballprice ?? settings.ballPrice;
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
    const requiredCalcIds = [
      "walkInCount","familyFullCount","familyShortCount","ballprice","funOutsideCount",
      "walkInCourtCostResult","walkInIncome","walkInProfit","shortIncome","funIncome",
      "ballCostResult","familyTotal","perPerson","familyInfo"
    ];
    const missingCalcIds = requiredCalcIds.filter(id => !$(id));
    if (missingCalcIds.length) {
      console.error("Calculator UI missing:", missingCalcIds);
      return;
    }

    const walkInCount = clampCount($("walkInCount").value);
    const familyFullCount = clampCount($("familyFullCount").value);
    const familyShortCount = clampCount($("familyShortCount").value);
    const ballCost = Math.max(0, Number($("ballprice").value) || 0);
    const funOutsideCount = clampCount($("funOutsideCount").value);

    const currentCourtCost = Number(settings.courtCost);
    const walkInIncome = walkInCount * Number(settings.walkInPrice);
    const walkInProfit = walkInIncome - currentCourtCost;
    const shortIncome = familyShortCount * Number(settings.shortPrice);
    const funIncome = funOutsideCount * Number(settings.funPrice);
    const familyTotal = Number(settings.baseCost) + ballCost - walkInProfit - shortIncome - funIncome;

    $("walkInCourtCostResult").textContent = money(currentCourtCost);
    $("walkInIncome").textContent = money(walkInIncome);
    $("walkInProfit").textContent = (walkInProfit > 0 ? "+" : "") + money(walkInProfit);
    $("shortIncome").textContent = money(shortIncome);
    $("funIncome").textContent = money(funIncome);
    $("ballCostResult").textContent = money(ballCost);
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
    calcState.ballprice = $("ballprice").value;
    calcState.funOutsideCount = $("funOutsideCount").value;
    saveAll();
  }

  calcIds.forEach(id => {
    const element = $(id);
    element.addEventListener("input", calc);
    element.addEventListener("change", calc);
  });

  $("syncRosterCountBtn").addEventListener("click", useRosterCountOnce);

  Object.entries(settingMap).forEach(([elementId, key]) => {
    const element = $(elementId);

    const applySetting = () => {
      const previous = Number(settings[key]) || 0;
      const next = Math.max(0, Number(element.value) || 0);
      settings[key] = next;

      if (key === "ballPrice") {
        const currentBall = Number($("ballprice").value);
        if (!$("ballprice").value || currentBall === previous) {
          $("ballprice").value = next;
          calcState.ballprice = next;
        }
      }

      saveAll();
      calc();
    };

    element.addEventListener("input", applySetting);
    element.addEventListener("change", applySetting);
  });

  $("resetPriceBtn").addEventListener("click", () => {
    settings = structuredCloneSafe(defaultSettings);
    $("baseCost").value = settings.baseCost;
    $("walkInCourtCost").value = settings.courtCost;
    $("walkInPrice").value = settings.walkInPrice;
    $("shortPrice").value = settings.shortPrice;
    $("funPrice").value = settings.funPrice;
    $("defaultBallPrice").value = settings.ballPrice;
    $("ballprice").value = settings.ballPrice;
    calcState.ballprice = settings.ballPrice;
    saveAll();
    calc();
  });

  $("clearTodayBtn").addEventListener("click", () => {
    calcState.walkInCount = "";
    calcState.familyFullCount = "";
    calcState.familyShortCount = "";
    calcState.ballprice = settings.ballPrice;
    calcState.funOutsideCount = "";
    $("walkInCount").value = "";
    $("familyFullCount").value = "";
    $("familyShortCount").value = "";
    $("ballprice").value = settings.ballPrice;
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
    refreshPairSelectors();
    renderAssignments();
  }

  function renamePlayer(oldName, newName) {
    newName = cleanName(newName);
    if (!newName) return { ok:false, message:"名字不能空白" };
    if (newName !== oldName && roster.includes(newName)) {
      return { ok:false, message:"這個名字已經存在" };
    }
    if (newName === oldName) return { ok:true };

    roster = roster.map(name => name === oldName ? newName : name);

    if (rotation.assignments[oldName]) { rotation.assignments[newName] = rotation.assignments[oldName]; delete rotation.assignments[oldName]; }
    rotation.pairs = rotation.pairs.map(pair => pair.map(name => name === oldName ? newName : name));
    rotation.courts.forEach(c => {
      c.court = c.court.map(name => name === oldName ? newName : name);
      c.nextPlan = null;
    });
    if (Object.prototype.hasOwnProperty.call(rotation.games, oldName)) {
      rotation.games[newName] = rotation.games[oldName];
      delete rotation.games[oldName];
    }
    rotation.history = rotation.history.map(entry => ({
      ...entry,
      court: Array.isArray(entry.court) ? entry.court.map(n => n === oldName ? newName : n) : [],
      next: Array.isArray(entry.next) ? entry.next.map(n => n === oldName ? newName : n) : []
    }));

    if (peopleMemory.includes(oldName)) {
      peopleMemory = peopleMemory.map(name => name === oldName ? newName : name);
      peopleMemory = [...new Set(peopleMemory)];
    }

    paymentList = paymentList.map(item =>
      item.name === oldName ? {...item, name:newName} : item
    );

    updateRosterDerivedState();
    renderRoster();
    renderRotation();
    renderPeopleMemory();
    renderPayments();
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
      const wrap = document.createElement("span");
      wrap.className = "memoryPersonWrap" + (roster.includes(name) ? " inRoster" : "");

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "memoryPerson";
      addBtn.textContent = roster.includes(name) ? `✓ ${name}` : `＋ ${name}`;
      addBtn.disabled = rotation.active && !roster.includes(name);
      addBtn.addEventListener("click", () => {
        if (roster.includes(name)) return;
        if (rotation.active) {
          setRosterMessage("排場中不能新增人員，請先結束排場");
          return;
        }
        if (roster.length >= MAX_PLAYERS) {
          setRosterMessage(`本場名單最多 ${MAX_PLAYERS} 人`);
          return;
        }
        roster.push(name);
        updateRosterDerivedState();
        renderRoster();
        setRosterMessage(`${name} 已加入本場`, false);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "memoryDelete";
      deleteBtn.textContent = "×";
      deleteBtn.title = `刪除常用球友 ${name}`;
      deleteBtn.setAttribute("aria-label", `刪除常用球友 ${name}`);
      deleteBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        peopleMemory = peopleMemory.filter(person => person !== name);
        saveAll();
        renderPeopleMemory();
        setRosterMessage(`${name} 已從常用球友刪除；本場名單不受影響`, false);
      });

      wrap.append(addBtn, deleteBtn);
      list.appendChild(wrap);
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
    const slots = Math.max(0, MAX_PLAYERS - roster.length);
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
    rotation.assignments = {};
    rotation.pairs = [];
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
        delete rotation.assignments[name];
        rotation.pairs = rotation.pairs.filter(pair => !pair.includes(name));
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
    refreshPairSelectors();

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
    if (roster.length >= MAX_PLAYERS) {
      setRosterMessage(`最多支援 ${MAX_PLAYERS} 人`);
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
    rotation.pairs = [];
    rotation.assignments = {};
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


  // ---------- Payment list ----------
  function paymentId() {
    return `pay_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  }

  function setPaymentMessage(text, isError = false) {
    const el = $("paymentMessage");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isError ? "#b91c1c" : "#166534";
  }

  function ensurePlayerInRoster(name) {
    name = cleanName(name);
    if (!name) return {ok:false, message:"姓名不能空白"};
    if (roster.includes(name)) return {ok:true, added:false};
    if (roster.length >= MAX_PLAYERS) return {ok:false, message:`臨打名單最多 ${MAX_PLAYERS} 人`};

    roster.push(name);
    if (rotation.active) {
      rotation.games[name] = 0;
      invalidatePlans();
    }

    updateRosterDerivedState();
    renderRoster();
    renderRotation();
    return {ok:true, added:true};
  }

  function addPaymentPerson(name, amount) {
    name = cleanName(name);
    amount = Math.max(0, Number(amount) || Number(settings.walkInPrice) || 250);

    if (!name) {
      setPaymentMessage("請輸入姓名", true);
      return false;
    }
    if (paymentList.some(item => item.name === name)) {
      setPaymentMessage(`${name} 已經在收費名單`, true);
      return false;
    }

    const rosterResult = ensurePlayerInRoster(name);
    if (!rosterResult.ok) {
      setPaymentMessage(rosterResult.message, true);
      return false;
    }

    paymentList.push({id:paymentId(), name, amount, paid:false});
    saveAll();
    renderPayments();
    setPaymentMessage(`${name} 已加入收費名單，也已加入臨打名單`);
    return true;
  }

  function updatePaymentSummary() {
    const paidItems = paymentList.filter(item => item.paid);
    const paidAmount = paidItems.reduce((sum,item) => sum + (Number(item.amount)||0), 0);
    const unpaidAmount = paymentList
      .filter(item => !item.paid)
      .reduce((sum,item) => sum + (Number(item.amount)||0), 0);

    $("paymentTotalCount").textContent = String(paymentList.length);
    $("paymentPaidCount").textContent = String(paidItems.length);
    $("paymentPaidAmount").textContent = money(paidAmount);
    $("paymentUnpaidAmount").textContent = money(unpaidAmount);
  }

  function renderPayments() {
    const list = $("paymentList");
    if (!list) return;
    list.innerHTML = "";

    if (!paymentList.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "今天尚未加入收費人員";
      list.appendChild(empty);
    }

    paymentList.forEach(item => {
      const row = document.createElement("div");
      row.className = "paymentRow" + (item.paid ? " paid" : "");

      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "paymentCheck";
      check.checked = item.paid;
      check.setAttribute("aria-label", `${item.name} 已收費`);
      check.addEventListener("change", () => {
        item.paid = check.checked;
        saveAll();
        renderPayments();
      });

      const nameInput = document.createElement("input");
      nameInput.className = "paymentNameInput";
      nameInput.value = item.name;
      nameInput.maxLength = 20;
      nameInput.addEventListener("change", () => {
        const oldName = item.name;
        const newName = cleanName(nameInput.value);

        if (!newName) {
          nameInput.value = oldName;
          setPaymentMessage("姓名不能空白", true);
          return;
        }
        if (newName !== oldName && paymentList.some(other => other.id !== item.id && other.name === newName)) {
          nameInput.value = oldName;
          setPaymentMessage("收費名單已有相同姓名", true);
          return;
        }

        if (roster.includes(oldName)) {
          const result = renamePlayer(oldName, newName);
          if (!result.ok) {
            nameInput.value = oldName;
            setPaymentMessage(result.message, true);
            return;
          }
        } else {
          const rosterResult = ensurePlayerInRoster(newName);
          if (!rosterResult.ok) {
            nameInput.value = oldName;
            setPaymentMessage(rosterResult.message, true);
            return;
          }
          item.name = newName;
        }

        item.name = newName;
        saveAll();
        renderPayments();
        setPaymentMessage("姓名已更新，臨打名單同步完成");
      });

      const amountInput = document.createElement("input");
      amountInput.type = "number";
      amountInput.inputMode = "numeric";
      amountInput.min = "0";
      amountInput.className = "paymentMoneyInput";
      amountInput.value = String(item.amount);
      amountInput.addEventListener("input", () => {
        item.amount = Math.max(0, Number(amountInput.value) || 0);
        saveAll();
        updatePaymentSummary();
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "paymentDelete";
      del.textContent = "✕";
      del.title = "刪除收費紀錄";
      del.addEventListener("click", () => {
        paymentList = paymentList.filter(x => x.id !== item.id);
        saveAll();
        renderPayments();
        setPaymentMessage(`${item.name} 的收費紀錄已刪除；臨打名單仍保留`);
      });

      const status = document.createElement("div");
      status.className = "paymentStatusText";
      status.textContent = item.paid ? `✅ 已收 ${money(item.amount)}` : `⏳ 尚未收 ${money(item.amount)}`;

      row.append(check, nameInput, amountInput, del, status);
      list.appendChild(row);
    });

    updatePaymentSummary();
  }

  $("paymentAddForm").addEventListener("submit", event => {
    event.preventDefault();
    if (addPaymentPerson($("paymentNameInput").value, $("paymentAmountInput").value)) {
      $("paymentNameInput").value = "";
      $("paymentNameInput").focus();
    }
  });

  $("importRosterToPaymentsBtn").addEventListener("click", () => {
    let added = 0;
    roster.forEach(name => {
      if (!paymentList.some(item => item.name === name)) {
        paymentList.push({
          id:paymentId(),
          name,
          amount:Number(settings.walkInPrice) || 250,
          paid:false
        });
        added++;
      }
    });
    saveAll();
    renderPayments();
    setPaymentMessage(added ? `已從臨打名單補入 ${added} 人` : "臨打名單都已在收費名單");
  });

  $("syncPaymentsToRosterBtn").addEventListener("click", () => {
    let added = 0;
    let failed = 0;
    paymentList.forEach(item => {
      if (!roster.includes(item.name)) {
        const result = ensurePlayerInRoster(item.name);
        if (result.ok && result.added) added++;
        if (!result.ok) failed++;
      }
    });
    setPaymentMessage(
      failed ? `已加入 ${added} 人；另有 ${failed} 人無法加入` : `已同步，新增 ${added} 人到臨打名單`,
      failed > 0
    );
  });

  $("syncPaymentsCountToCalcBtn").addEventListener("click", () => {
    $("walkInCount").value = paymentList.length ? String(paymentList.length) : "";
    calcState.walkInCount = $("walkInCount").value;
    calc();
    setPaymentMessage(`已把 ${paymentList.length} 人帶入「分攤」的臨打人數`);
  });

  $("clearPaymentsBtn").addEventListener("click", () => {
    if (!paymentList.length) return;
    if (!window.confirm("確定清空今天的收費名單？臨打名單不會刪除。")) return;
    paymentList = [];
    saveAll();
    renderPayments();
    setPaymentMessage("今日收費名單已清空");
  });

  // ---------- Independent multi-court rotation ----------
  function shuffle(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      let j;
      if (window.crypto && window.crypto.getRandomValues) {
        const random = new Uint32Array(1);
        window.crypto.getRandomValues(random);
        j = random[0] % (i+1);
      } else j = Math.floor(Math.random() * (i+1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function activeNames(exceptCourtId = null) {
    return new Set(rotation.courts
      .filter(c => c.id !== exceptCourtId)
      .flatMap(c => c.court));
  }

  function partnerOf(name) {
    const pair = rotation.pairs.find(p => p.includes(name));
    return pair ? pair.find(p => p !== name) : null;
  }

  // A court's next-round preview is its own saved recommendation.
  // Updating one court must NOT redraw another court's preview. This is
  // particularly important in split mode, where player pools never overlap.
  // In shared mode getPlan() can still invalidate a preview if another court
  // actually takes a player shown in it (preventing duplicate bookings).
  function invalidatePlans(changedCourtId = null) {
    rotation.courts.forEach(c => {
      if (changedCourtId === null || c.id === changedCourtId) c.nextPlan = null;
    });
  }

  function eligibleForCourt(name, courtId) {
    return rotation.mode === "shared" || rotation.assignments[name] === courtId;
  }

  function validateLineup(slots, courtId) {
    if (!Array.isArray(slots) || slots.length !== 4 || slots.some(name => !name))
      return {ok:false, message:"A 隊與 B 隊都要選滿 2 人"};
    if (new Set(slots).size !== 4)
      return {ok:false, message:"同一位球友不能佔兩個位置"};
    if (slots.some(name => !roster.includes(name)))
      return {ok:false, message:"場上球友必須在臨打名單中"};
    if (slots.some(name => !eligibleForCourt(name,courtId)))
      return {ok:false, message:"分組排場只能選擇分配到本場地的球友"};
    const busy = activeNames(courtId);
    if (slots.some(name => busy.has(name)))
      return {ok:false, message:"選到已在其他場地上場的球友"};
    for (const [a,b] of rotation.pairs) {
      const ia=slots.indexOf(a), ib=slots.indexOf(b);
      if ((ia===-1)!==(ib===-1))
        return {ok:false, message:`${a} 和 ${b} 是固定搭檔，必須一起上場`};
      // Slots: A1,B1,A2,B2. Same team => same parity.
      if (ia>=0 && ia%2!==ib%2)
        return {ok:false, message:`${a} 和 ${b} 必須在同一隊`};
    }
    return {ok:true};
  }

  function availableGroups(court) {
    const busy=activeNames(court.id);
    const available=new Set(roster.filter(name=>!busy.has(name) && eligibleForCourt(name,court.id)));
    const alreadyPaired=new Set();
    const groups=[];
    for (const [a,b] of rotation.pairs) {
      alreadyPaired.add(a); alreadyPaired.add(b);
      if (available.has(a) && available.has(b)) groups.push([a,b]);
    }
    for (const name of roster) {
      if (available.has(name) && !alreadyPaired.has(name)) groups.push([name]);
    }
    return groups;
  }

  // The single shared standby area is a GLOBAL waiting pool, not a future
  // lineup for either physical court. A name here must not be on ANY court.
  // Keep pairs together when selecting up to four people for the display.
  function sharedStandby() {
    if (rotation.mode !== "shared") return [];
    const busy=activeNames(); // No exceptCourtId: includes ALL active courts.
    const available=new Set(roster.filter(name=>!busy.has(name)));
    const grouped=[];
    const paired=new Set();
    for (const [a,b] of rotation.pairs) {
      paired.add(a);paired.add(b);
      if (available.has(a) && available.has(b)) grouped.push([a,b]);
    }
    for (const name of roster) {
      if (available.has(name) && !paired.has(name)) grouped.push([name]);
    }
    // Find the fullest group-safe four-person standby, breaking ties with
    // fewer games played. No paired player is shown without their partner.
    const best=Array(5).fill(null);
    best[0]={cost:0, names:[]};
    for (const group of grouped) {
      const len=group.length;
      const cost=group.reduce((sum,name)=>sum+(rotation.games[name]||0),0);
      for (let n=4-len;n>=0;n--) {
        if (!best[n]) continue;
        const proposal={cost:best[n].cost+cost,names:[...best[n].names,...group]};
        if (!best[n+len] || proposal.cost < best[n+len].cost) best[n+len]=proposal;
      }
    }
    for (let n=4;n>=1;n--) if (best[n]) return best[n].names;
    return [];
  }

  // Court-local fair rotation. A fixed pair is one indivisible unit, NOT a
  // fixed opponent. When there are >= 7 available players, aim to replace
  // three of the four after each game, falling back to 1/2/4 when pairs or
  // player availability make three impossible. For 5/6 players aim for 1/2.
  function autoLineup(court, options = {}) {
    const groups = availableGroups(court);
    const availableCount = groups.reduce((sum, group) => sum + group.length, 0);
    if (availableCount < 4) return null;
    const prior = Array.isArray(options.previous) ? options.previous : court.court;
    const priorSet = new Set(prior);
    const standbyPriority = rotation.mode === "shared" ? new Set(sharedStandby()) : null;
    const isPlaying = court.court.length === 4;
    // A current match is not counted in games yet, but will finish before
    // the next suggested match is played.
    const projected = (name) => (rotation.games[name] || 0) +
      (isPlaying && court.court.includes(name) ? 1 : 0);
    const targetChanges = prior.length === 4
      ? Math.min(availableCount <= 6 ? 2 : 3, availableCount - 4)
      : null;
    const recent = rotation.history
      .filter(entry => (entry.courtId || 1) === court.id && Array.isArray(entry.court) && entry.court.length === 4)
      .slice(0, 10);

    // Retain low-game candidates AND all current players so a one-person
    // stayer is always considered when there is a large 60-person roster.
    const groupPriority = (group) => group.reduce((sum, name) => sum + projected(name), 0) / group.length;
    const sorted = shuffle(groups).sort((a,b) =>
      groupPriority(a) - groupPriority(b));
    const candidates = sorted.length <= 24 ? sorted : [
      ...sorted.filter(group => group.some(name => priorSet.has(name))),
      ...sorted.filter(group => !group.some(name => priorSet.has(name))).slice(0, 20)
    ];

    function canonicalTeam(team) { return [...team].sort().join('\u0001'); }
    function teamsOf(slots) { return [[slots[0], slots[2]], [slots[1], slots[3]]]; }
    function sameFour(a, b) {
      return a.length === 4 && b.length === 4 && a.every(name => b.includes(name));
    }
    function teamScore(teams, chosen) {
      let score = 0;
      const teamKeys = teams.map(canonicalTeam);
      for (let index = 0; index < recent.length; index++) {
        const old = recent[index].court;
        const oldTeams = teamsOf(old).map(canonicalTeam);
        const weight = 1 / (1 + index * .8);
        if (sameFour(chosen, old)) score += 330 * weight;
        // Discourage identical two-team matchups even if A/B are reversed.
        if (teamKeys.every(key => oldTeams.includes(key))) score += 240 * weight;
        for (const team of teams) {
          const locked = partnerOf(team[0]) === team[1];
          if (!locked && oldTeams.includes(canonicalTeam(team))) score += 28 * weight;
        }
      }
      // Also avoid keeping the exact current two-team matchup.
      if (prior.length === 4) {
        const oldTeams = teamsOf(prior).map(canonicalTeam);
        if (teamKeys.every(key => oldTeams.includes(key))) score += 290;
      }
      return score;
    }

    let bestSlots = null;
    let bestScore = Infinity;
    function assess(selected) {
      const chosen = selected.flat();
      const newcomers = chosen.filter(name => !priorSet.has(name)).length;
      // Turnover is the main rule; game fairness decides between similarly
      // sized turnovers. All chosen sets have 4 people, so no group-size bias.
      let score = chosen.reduce((sum, name) => sum + projected(name) * 54, 0);
      // In shared mode, favour the names currently shown in the global
      // standby area when other fairness/turnover constraints are comparable.
      // A player already on this same court is a potential stayer, not standby.
      if (standbyPriority) {
        score += chosen.filter(name=>!priorSet.has(name) && !standbyPriority.has(name)).length * 40;
      }
      if (targetChanges !== null) score += Math.abs(newcomers - targetChanges) * 480;
      // Older rounds are only a tie-breaker; avoid making any four a permanent
      // block, especially two fixed pairs facing each other forever.
      const arrangements = [
        [[chosen[0],chosen[1]],[chosen[2],chosen[3]]],
        [[chosen[0],chosen[2]],[chosen[1],chosen[3]]],
        [[chosen[0],chosen[3]],[chosen[1],chosen[2]]]
      ];
      for (const teams of arrangements) {
        if (teams.some(team => team.some(name => {
          const partner = partnerOf(name);
          return partner && !team.includes(partner);
        }))) continue;
        const total = score + teamScore(teams, chosen) + Math.random() * 5;
        if (total < bestScore) {
          bestScore = total;
          // A1, B1, A2, B2; randomly switch A/B for visual variety.
          const a = Math.random() < .5 ? teams : [teams[1], teams[0]];
          bestSlots = [a[0][0], a[1][0], a[0][1], a[1][1]];
        }
      }
    }
    function search(offset, selected, count) {
      if (count === 4) { assess(selected); return; }
      for (let i = offset; i < candidates.length; i++) {
        const group = candidates[i];
        if (count + group.length > 4) continue;
        selected.push(group);
        search(i + 1, selected, count + group.length);
        selected.pop();
      }
    }
    search(0, [], 0);
    return bestSlots;
  }

  function getPlan(court) {
    if (!court.nextPlan || !validateLineup(court.nextPlan,court.id).ok)
      court.nextPlan=autoLineup(court);
    return court.nextPlan;
  }

  function rerollPlan(courtId) {
    if (rotation.mode === "shared") rotation.sharedPreviewCourtId = courtId;
    const court=rotation.courts.find(c=>c.id===courtId);
    if(!court || court.court.length!==4) return;
    court.nextPlan=autoLineup(court);
    saveAll();renderRotation();
  }

  function assignCourt(court, slots) {
    const result=validateLineup(slots, court.id);
    if (result.ok && rotation.mode === "shared") rotation.sharedPreviewCourtId = court.id;
    if (!result.ok) return result;
    court.court=[...slots];
    invalidatePlans(court.id);
    saveAll();
    renderRotation();
    return {ok:true};
  }

  function makeAutoCourt(courtId) {
    const court=rotation.courts.find(c=>c.id===courtId);
    if (!court) return;
    if (court.court.length) {
      setRosterMessage(`第 ${courtId} 場已有比賽，請先結束本局或手動修改`, true);
      return;
    }
    const plan=getPlan(court);
    if (!plan) {
      setRosterMessage(`第 ${courtId} 場候補不足或固定搭檔無法湊成四人，請稍後再安排`);
      renderRotation();
      return;
    }
    assignCourt(court, plan);
    setRosterMessage(`第 ${courtId} 場已自動安排`, false);
  }

  function completeCourt(courtId, continueAuto) {
    if (rotation.mode === "shared") rotation.sharedPreviewCourtId = courtId;
    const court=rotation.courts.find(c=>c.id===courtId);
    if (!court || court.court.length!==4) return;
    const old=[...court.court];
    const proposed=continueAuto ? getPlan(court) : null;
    old.forEach(name => { rotation.games[name]=(rotation.games[name] || 0)+1; });
    rotation.history.unshift({ courtId, round:court.round, court:old, at:Date.now() });
    rotation.history=rotation.history.slice(0,300);
    court.round+=1;
    court.court=[];
    invalidatePlans(court.id);
    // Use the previously displayed recommendation unless another court has since
    // taken a player; recompute whenever that recommendation is no longer valid.
    if (continueAuto) {
      const next=proposed && validateLineup(proposed,courtId).ok
        ? proposed : autoLineup(court);
      if (next) court.court=[...next];
      else setRosterMessage(`第 ${courtId} 場已記錄這一局，候補不足，目前先空場`,false);
    }
    invalidatePlans(court.id);
    saveAll();
    renderRotation();
  }

  function cancelCourt(courtId) {
    const court=rotation.courts.find(c=>c.id===courtId);
    if (!court || !court.court.length) return;
    if (!window.confirm(`清空第 ${courtId} 場目前人員？本局不會計入局數。`)) return;
    court.court=[];
    invalidatePlans(court.id);
    saveAll();
    renderRotation();
  }

  function refreshPairSelectors() {
    for (const id of ["pairPersonA","pairPersonB"]) {
      const select=$(id);
      if(!select) continue;
      const old=select.value;
      select.innerHTML="";
      const blank=document.createElement("option");
      blank.value=""; blank.textContent=id==="pairPersonA" ? "第一人" : "第二人";
      select.appendChild(blank);
      for (const name of roster) {
        const option=document.createElement("option");
        option.value=name; option.textContent=name;
        select.appendChild(option);
      }
      select.value=roster.includes(old) ? old : "";
    }
    renderPairList();
  }

  function renderPairList() {
    const list=$("pairList");
    list.innerHTML="";
    if (!rotation.pairs.length) {
      const empty=document.createElement("small");
      empty.textContent="目前沒有固定搭檔";
      list.appendChild(empty);
    }
    rotation.pairs.forEach(([a,b])=>{
      const chip=document.createElement("span");
      chip.className="pairChip";
      const text=document.createElement("span");
      text.textContent=`🔗 ${a} ＋ ${b}`;
      const remove=document.createElement("button");
      remove.type="button"; remove.textContent="解除";
      remove.setAttribute("aria-label",`解除 ${a} 和 ${b} 的搭檔`);
      remove.addEventListener("click",()=>{
        const busy=activeNames();
        if(busy.has(a)||busy.has(b)) {
          $("pairMessage").textContent="搭檔正在上場，請等該局結束或先清空場地";
          return;
        }
        rotation.pairs=rotation.pairs.filter(p=>!(p.includes(a)&&p.includes(b)));
        invalidatePlans();
        $("pairMessage").textContent="已解除搭檔";
        saveAll();renderPairList();renderRotation();
      });
      chip.append(text,remove);list.appendChild(chip);
    });
  }

  $("addPairBtn").addEventListener("click",()=>{
    const a=$("pairPersonA").value, b=$("pairPersonB").value;
    const msg=$("pairMessage");
    if(!a||!b||a===b) {msg.textContent="請選兩位不同球友";return;}
    if(partnerOf(a)||partnerOf(b)) {msg.textContent="其中一人已經有搭檔，請先解除綁定";return;}
    if(rotation.mode === "split" && rotation.assignments[a] !== rotation.assignments[b]) {msg.textContent="分組模式下，請先將兩人分到同一場地再綁定";return;}
    const busy=activeNames();
    if(busy.has(a)||busy.has(b)) {msg.textContent="請等兩人都下場後再綁定";return;}
    rotation.pairs.push([a,b]);
    msg.textContent=`已綁定 ${a}＋${b}（同隊同進退）`;
    invalidatePlans();saveAll();renderPairList();renderRotation();
    $("pairPersonA").value="";$("pairPersonB").value="";
  });

  for(let n=1;n<=MAX_COURTS;n++) {
    const option=document.createElement("option");
    option.value=String(n); option.textContent=`${n} 場`;
    $("courtCountSelect").appendChild(option);
  }
  $("courtCountSelect").value=String(rotation.courtCount);
  $("courtCountSelect").addEventListener("change",()=>{
    const count=Number($("courtCountSelect").value);
    if(count<rotation.courtCount && rotation.courts.slice(count).some(c=>c.court.length)) {
      setRosterMessage("請先結束或清空要移除場地的比賽");
      $("courtCountSelect").value=String(rotation.courtCount);
      return;
    }
    const existing=rotation.courts;
    rotation.courtCount=count;
    rotation.courts=Array.from({length:count},(_,i)=>existing[i] || makeCourt(i+1));
    rotation.assignments = Object.fromEntries(Object.entries(rotation.assignments).filter(([,id])=>id<=count));
    invalidatePlans();saveAll();renderAssignments();renderRotation();updateRuleBadge();
  });

  function renderAssignments() {
    $("rotationModeSelect").value=rotation.mode;
    const split=rotation.mode==="split";
    $("splitAssignments").hidden=!split;
    const list=$("courtAssignments");list.innerHTML="";
    if(!split) return;
    for (const name of roster) {
      const line=document.createElement("label");line.className="assignmentRow";
      const nameText=document.createElement("span");
      const partner=partnerOf(name);
      nameText.textContent=name+(partner ? ` 🔗 ${partner}` : "");
      const select=document.createElement("select");select.className="lineupSelect assignmentSelect";
      const blank=document.createElement("option");blank.value="";blank.textContent="尚未分配";select.appendChild(blank);
      for(let id=1;id<=rotation.courtCount;id++) {
        const option=document.createElement("option");option.value=String(id);option.textContent=`第 ${id} 場`;
        select.appendChild(option);
      }
      select.value=String(rotation.assignments[name] || "");
      select.disabled=activeNames().has(name);
      select.addEventListener("change",()=>{
        const next=Number(select.value)||0;
        const connected=partnerOf(name);
        if (rotation.active && connected && activeNames().has(connected)) {
          select.value=String(rotation.assignments[name]||"");
          setRosterMessage("搭檔正在上場，請先完成或清空該局");return;
        }
        for(const person of [name,connected].filter(Boolean)) {
          if(next) rotation.assignments[person]=next;
          else delete rotation.assignments[person];
        }
        invalidatePlans();saveAll();renderAssignments();renderRotation();
      });
      line.append(nameText,select);list.appendChild(line);
    }
    const counts=Array.from({length:rotation.courtCount},(_,i)=>roster.filter(name=>rotation.assignments[name]===i+1).length);
    $("assignmentSummary").textContent=counts.map((n,i)=>`第 ${i+1} 場 ${n} 人`).join("｜") + `｜未分配 ${roster.length-counts.reduce((a,b)=>a+b,0)} 人`;
  }

  $("rotationModeSelect").addEventListener("change",()=>{
    const newMode=$("rotationModeSelect").value;
    if(rotation.active && rotation.courts.some(c=>c.court.length)) {
      $("rotationModeSelect").value=rotation.mode;
      setRosterMessage("請先完成或清空所有正在進行的場地，再切換排場模式");return;
    }
    rotation.mode=newMode;
    invalidatePlans();saveAll();renderAssignments();renderRotation();updateRuleBadge();
  });
  $("autoSplitBtn").addEventListener("click",()=>{
    if(rotation.active && rotation.courts.some(c=>c.court.length)) {
      setRosterMessage("自動分組前請先清空場上球友");return;
    }
    const units=[];const visited=new Set();
    for(const [a,b] of rotation.pairs) { units.push([a,b]);visited.add(a);visited.add(b); }
    for(const name of roster) if(!visited.has(name)) units.push([name]);
    // Balance the number of players while keeping pairs intact.
    const sizes=Array(rotation.courtCount).fill(0);rotation.assignments={};
    units.sort((a,b)=>b.length-a.length).forEach(unit=>{
      const target=sizes.indexOf(Math.min(...sizes));
      unit.forEach(name=>{rotation.assignments[name]=target+1;});
      sizes[target]+=unit.length;
    });
    invalidatePlans();saveAll();renderAssignments();renderRotation();
    setRosterMessage("已平均分組；每場至少需要 4 人才能自動排場，可手動調整",false);
  });

  function updateRuleBadge() {
    $("ruleBadge").textContent = rotation.active
      ? `${rotation.courtCount} 場｜${rotation.mode==="split" ? "分組獨立" : "共用名單"}`
      : roster.length >= 4 ? `可選 ${rotation.courtCount} 場` : "至少需要 4 人";
  }

  function startRotation() {
    if (rotation.active) return;
    if (roster.length < 4) {setRosterMessage("至少需要 4 人才能開始排場");return;}
    rotation.active=true;
    rotation.courts=Array.from({length:rotation.courtCount},(_,i)=>makeCourt(i+1));
    rotation.games=Object.fromEntries(roster.map(name=>[name,0]));
    rotation.history=[];
    saveAll();
    renderRoster();renderAssignments();renderRotation();
    setRosterMessage("排場已開始：請到下方各場地按「自動排人」或「手動排人」", false);
  }
  $("startBtn").addEventListener("click",startRotation);

  $("endSessionBtn").addEventListener("click",()=>{
    if(!window.confirm("確定結束排場？本次局數與輪轉紀錄會清空，固定搭檔與名單會保留。")) return;
    rotation.active=false;
    rotation.courts=Array.from({length:rotation.courtCount},(_,i)=>makeCourt(i+1));
    rotation.games={};rotation.history=[];
    invalidatePlans();saveAll();
    setRosterMessage("已結束排場；固定搭檔設定仍保留",false);
    renderRoster();renderRotation();
  });

  function makeButton(label, klass, action) {
    const btn=document.createElement("button");
    btn.type="button";btn.className=klass;btn.textContent=label;
    btn.addEventListener("click",action);
    return btn;
  }

  function renderCourtEditor(court, parent) {
    const editor=document.createElement("div");
    editor.className="courtEdit";
    const tip=document.createElement("small");
    tip.textContent="A 隊與 B 隊各選 2 人；其他場地上場中的人不能選。";
    editor.appendChild(tip);
    const grid=document.createElement("div");
    grid.className="teamSelectGrid";
    const picks=[];
    // Keep data layout exactly as original: A1 B1 A2 B2.
    [["A隊","teamABox",[0,2]],["B隊","teamBBox",[1,3]]].forEach(([title,boxClass,indices])=>{
      const box=document.createElement("div");
      box.className=`teamSelectCard ${boxClass}`;
      const heading=document.createElement("div");
      heading.className="teamSelectTitle";heading.textContent=title;
      box.appendChild(heading);
      indices.forEach((slot,j)=>{
        const label=document.createElement("label");
        label.textContent=`${title[0]}${j+1}`;
        const select=document.createElement("select");
        select.className="lineupSelect";
        const blank=document.createElement("option");blank.value="";blank.textContent="請選擇";
        select.appendChild(blank);
        const busy=activeNames(court.id);
        roster.filter(name=>!busy.has(name) && eligibleForCourt(name,court.id)).forEach(name=>{
          const option=document.createElement("option");
          option.value=name;option.textContent=name;select.appendChild(option);
        });
        select.value=court.court[slot] || "";
        picks[slot]=select;
        label.appendChild(select);box.appendChild(label);
      });
      grid.appendChild(box);
    });
    editor.appendChild(grid);
    const message=document.createElement("div");message.className="courtMessage";
    const actions=document.createElement("div");actions.className="courtActions";
    actions.appendChild(makeButton("儲存這場名單","secondary",()=>{
      const slots=picks.map(el=>el.value);
      const result=validateLineup(slots,court.id);
      if(!result.ok) {message.textContent=result.message;return;}
      editingCourtId=null;
      assignCourt(court, slots);
      setRosterMessage(`第 ${court.id} 場已更新`,false);
    }));
    actions.appendChild(makeButton("取消","ghost",()=>{editingCourtId=null;renderRotation();}));
    editor.append(actions,message);
    parent.appendChild(editor);
  }

  // Split mode keeps the original court-by-court next-lineup preview.
  // Shared mode instead shows one global pool of players NOT currently on any court.
  function createNextPreview(court) {
        const plan=getPlan(court);
        const preview=document.createElement("section");preview.className="courtNext";
        preview.setAttribute("aria-label",`第 ${court.id} 場下一局預備`);
        const heading=document.createElement("div");heading.className="nextHeading";
        const strong=document.createElement("strong");strong.textContent="📣 下一局預備名單";
        const status=document.createElement("span");status.className="nextStatus";
        const incoming=plan ? plan.filter(name=>!court.court.includes(name)) : [];
        status.textContent=plan ? (incoming.length ? `換 ${incoming.length} 人` : "沒有可換候補") : "無可用陣容";
        heading.append(strong,status);preview.appendChild(heading);
        if(plan) {
          // Shared mode: four distinct player cards in a balanced 2×2 layout,
          // without displaying the upcoming A/B teams.
          // Split mode retains its team previews.
          const sharedPreview = rotation.mode === "shared";
          const readyList=document.createElement("div");
          readyList.className=sharedPreview ? "nextReadyList" : "nextTeams";
          const addPlayer=(name,parent)=>{
            const player=document.createElement("div");player.className="nextReadyPlayer";
            const who=document.createElement("b");who.textContent=`${partnerOf(name)?"🔗 ":""}${name}`;
            const tag=document.createElement("small");
            const isIncoming=!court.court.includes(name);
            tag.className=isIncoming ? "nextFreshTag" : "nextStayTag";
            tag.textContent=isIncoming ? "準備上場" : "繼續上場";
            player.append(who,tag);parent.appendChild(player);
          };
          if (sharedPreview) {
            // Keep A/B pairing internally; only simplify the visual presentation.
            plan.forEach(name=>addPlayer(name,readyList));
          } else {
            [["A 隊",[plan[0],plan[2]],"teamABox"],["B 隊",[plan[1],plan[3]],"teamBBox"]].forEach(([title,names,klass])=>{
              const card=document.createElement("div");card.className=`nextTeam ${klass}`;
              const label=document.createElement("div");label.className="nextTeamLabel";label.textContent=title;
              card.appendChild(label);
              names.forEach(name=>addPlayer(name,card));
              readyList.appendChild(card);
            });
          }
          preview.appendChild(readyList);
          // Do not list who's resting: the visible four ready cards are enough.
          // Only show actionable advice if a next-round lineup cannot rotate.
          if(!incoming.length) {
            const otherBusy=activeNames(court.id);
            const waitingEligible=roster.filter(name=>!court.court.includes(name) && !otherBusy.has(name) && eligibleForCourt(name,court.id));
            const note=document.createElement("div");note.className="nextRest";
            if(waitingEligible.length) note.textContent=`⚠️ 候補 ${waitingEligible.join("、")} 暫時無法組成合法替補：固定搭檔必須兩人同隊、一起上下場。請調整綁定／分組或增加可輪換球友。`;
            else note.textContent="此場目前沒有空閒候補；其他場地正在打的人不會被抽走。可等候補出現，或使用「手動修改場上」。";
            preview.appendChild(note);
          }
        } else {
          const note=document.createElement("div");note.className="nextRest";
          note.textContent="目前無法安排完整四人，請檢查該場分組人數、固定搭檔及其他場地上場名單。";
          preview.appendChild(note);
        }
        const reroll=makeButton("🎲 重抽下一局","ghost nextReroll",()=>rerollPlan(court.id));
        preview.appendChild(reroll);
        return preview;
  }

  function createSharedStandbyPreview() {
    const preview=document.createElement("section");
    preview.className="courtNext sharedStandbyPreview";
    preview.setAttribute("aria-label","全場共用候補：不含目前正在比賽的人");
    const waiting=roster.filter(name=>!activeNames().has(name));
    const standby=sharedStandby();
    const heading=document.createElement("div");heading.className="nextHeading";
    const title=document.createElement("strong");title.textContent="📣 共用預備名單";
    const status=document.createElement("span");status.className="nextStatus";
    status.textContent=`待上場 ${waiting.length} 人｜顯示 ${standby.length} 人`;
    heading.append(title,status);preview.appendChild(heading);
    const grid=document.createElement("div");grid.className="nextReadyList";
    for (let i=0;i<4;i++) {
      const name=standby[i];
      const card=document.createElement("div");card.className="nextReadyPlayer"+(name?"":" standbyEmpty");
      const label=document.createElement("b");label.textContent=name ? `${partnerOf(name)?"🔗 ":""}${name}` : "—";
      const tag=document.createElement("small");
      tag.className=name?"nextFreshTag":"nextStayTag";
      tag.textContent=name?"候補中":"暫無候補";
      card.append(label,tag);grid.appendChild(card);
    }
    preview.appendChild(grid);
    const note=document.createElement("p");note.className="sharedStandbyNote";
    note.textContent="只列沒有在任何場地比賽的人。任一場完成後，系統才會依留場、換人、局數及固定搭檔規則安排該場下一局；其他場地的人不會被抽走。";
    preview.appendChild(note);
    return preview;
  }

  let editingCourtId=null;
  function renderRotation() {
    $("gameArea").hidden=!rotation.active;
    $("startBtn").hidden=rotation.active;
    $("courtCountSelect").value=String(rotation.courtCount);
    renderAssignments();
    if (!rotation.active) {updateRuleBadge();saveAll();return;}
    $("activeCourtInfo").textContent=`${rotation.courts.filter(c=>c.court.length).length} / ${rotation.courtCount} 場進行中`;
    updateRuleBadge();
    const grid=$("courtsGrid");grid.innerHTML="";
    grid.dataset.count = String(rotation.courtCount);
    const labels=["A1","B1","A2","B2"];
    for(const court of rotation.courts) {
      const unit=document.createElement("div");unit.className="courtUnit";
      const header=document.createElement("div");header.className="courtUnitHeader";
      const title=document.createElement("h3");title.textContent=`第 ${court.id} 場｜第 ${court.round} 局${rotation.mode==="split" ? `（專屬 ${roster.filter(name=>rotation.assignments[name]===court.id).length} 人）` : ""}`;
      const status=document.createElement("span");
      status.className="courtStatus"+(court.court.length ? "" : " idle");
      status.textContent=court.court.length ? "進行中" : "空場等待";
      header.append(title,status);unit.appendChild(header);
      if(court.court.length) {
        const legend=document.createElement("div");legend.className="teamLegend";
        ["A隊","B隊"].forEach((label,i)=>{
          const el=document.createElement("span");el.className=i===0?"teamALabel":"teamBLabel";
          el.textContent=label;legend.appendChild(el);
        });
        unit.appendChild(legend);
        const field=document.createElement("div");field.className="court";
        field.setAttribute("aria-label",`第 ${court.id} 場球友`);
        for(const cls of ["centerV","centerH"]) {
          const line=document.createElement("div");line.className=`courtLine ${cls}`;field.appendChild(line);
        }
        court.court.forEach((name,i)=>{
          const spot=document.createElement("div");spot.className=`courtPlayer cp${i}`;
          const tag=document.createElement("span");tag.className="courtSlotTag";tag.textContent=labels[i];
          const who=document.createElement("span");who.className="courtPersonName";
          who.textContent=partnerOf(name) ? `🔗 ${name}` : name;
          spot.append(tag,who);field.appendChild(spot);
        });unit.appendChild(field);
      } else {
        const empty=document.createElement("div");empty.className="courtEmpty";
        empty.textContent="尚未安排人員，請按下方按鈕排場";unit.appendChild(empty);
      }
      const actions=document.createElement("div");actions.className="courtActions";
      if(court.court.length) {
        actions.appendChild(makeButton("✅ 完成 → 下一局","primary",()=>completeCourt(court.id,true)));
        actions.appendChild(makeButton("完成並空場","secondary",()=>completeCourt(court.id,false)));
        actions.appendChild(makeButton("✏️ 修改場上","ghost",()=>{editingCourtId=court.id;renderRotation();}));
        actions.appendChild(makeButton("清空不計局","ghost",()=>cancelCourt(court.id)));
      } else {
        actions.appendChild(makeButton("🎲 自動排人","primary",()=>makeAutoCourt(court.id)));
        actions.appendChild(makeButton("✏️ 手動排人","secondary",()=>{editingCourtId=court.id;renderRotation();}));
      }
      unit.appendChild(actions);
      if(editingCourtId===court.id) renderCourtEditor(court,unit);
      if (rotation.mode === "split" && court.court.length && editingCourtId!==court.id) {
        unit.appendChild(createNextPreview(court));
      }
      grid.appendChild(unit);
    }

    const sharedArea=$("sharedNextArea");
    const sharedContent=$("sharedPreviewContent");
    sharedContent.replaceChildren();
    sharedArea.hidden=rotation.mode!=="shared";
    if (rotation.mode==="shared") {
      sharedContent.appendChild(createSharedStandbyPreview());
    }

    // Shared mode's big four cards already show the first four waiting names.
    // List only the others below, so there isn't a second duplicate preview.
    const allWaiting=roster.filter(name=>!activeNames().has(name));
    const shownStandby=rotation.mode==="shared" ? new Set(sharedStandby()) : new Set();
    const waiting=allWaiting.filter(name=>!shownStandby.has(name));
    const queueArea=$("queueArea");
    queueArea.hidden=rotation.mode==="shared" && waiting.length===0;
    $("queueHeading").textContent=rotation.mode==="shared" ? "其他候補" : "目前候補";
    const queue=$("queueList");queue.innerHTML="";
    if(!waiting.length) {const empty=document.createElement("span");empty.className="muted";empty.textContent="目前沒有候補";queue.appendChild(empty);}
    else waiting.sort((a,b)=>(rotation.games[a]||0)-(rotation.games[b]||0)).forEach(name=>{
      const chip=document.createElement("span");chip.className="queueChip";
      chip.textContent=`${partnerOf(name)?"🔗 ":""}${name}${rotation.mode==="split" ? `（${rotation.assignments[name] ? `第${rotation.assignments[name]}場` : "未分配"}）` : ""}｜${rotation.games[name]||0}局`;
      queue.appendChild(chip);
    });

    const counts=roster.map(name=>rotation.games[name]||0);
    $("fairnessGap").textContent=counts.length ? `目前局數差：${Math.max(...counts)-Math.min(...counts)} 局` : "目前局數差：0";
    const stats=$("gamesStats");stats.innerHTML="";
    [...roster].sort((a,b)=>(rotation.games[a]||0)-(rotation.games[b]||0))
      .forEach(name=>{
        const item=document.createElement("div");item.className="statChip";
        const label=document.createElement("span");label.textContent=(partnerOf(name)?"🔗 ":"")+name;
        const count=document.createElement("strong");count.textContent=`${rotation.games[name]||0} 局`;
        item.append(label,count);stats.appendChild(item);
      });
    $("historyCount").textContent=`（${rotation.history.length} 局）`;
    const history=$("historyList");history.innerHTML="";
    if(!rotation.history.length) {const empty=document.createElement("span");empty.className="muted";empty.textContent="尚未完成任何一局";history.appendChild(empty);}
    else rotation.history.forEach(entry=>{
      const item=document.createElement("div");item.className="historyItem";
      const title=document.createElement("strong");
      title.textContent=`第 ${entry.courtId||1} 場｜第 ${entry.round} 局`;
      const detail=document.createElement("div");
      detail.textContent=Array.isArray(entry.court)
        ? `A隊 ${entry.court[0]||"—"}＋${entry.court[2]||"—"} ｜ B隊 ${entry.court[1]||"—"}＋${entry.court[3]||"—"}` : "";
      item.append(title,detail);history.appendChild(item);
    });
    saveAll();
    requestAnimationFrame(fitReadyNames);
  }

  // Adjust ready-card names to their actual available width, including on resize.
  // Most names keep the larger default text; longer names shrink, then wrap if needed.
  function fitReadyNames() {
    document.querySelectorAll(".courtNext .nextReadyPlayer b").forEach(label=>{
      label.style.fontSize="";
      label.style.whiteSpace="nowrap";
      label.style.overflowWrap="normal";
      label.style.wordBreak="normal";
      if(label.clientWidth < 20) return; // Inactive tab; measure on opening it.
      let size=parseFloat(getComputedStyle(label).fontSize) || 20;
      while(size > 12 && label.scrollWidth > label.clientWidth + 1) {
        size-=1;
        label.style.fontSize=`${size}px`;
      }
      if(label.scrollWidth > label.clientWidth + 1) {
        label.style.whiteSpace="normal";
        label.style.overflowWrap="anywhere";
        label.style.wordBreak="break-word";
      }
    });
  }
  window.addEventListener("resize",()=>requestAnimationFrame(fitReadyNames));

  // ---------- Pull to refresh ----------
  (() => {
    const indicator = $("pullRefresh");
    const icon = $("pullRefreshIcon");
    const text = $("pullRefreshText");
    if (!indicator || !icon || !text) return;

    const threshold = 78;
    const maxPull = 120;
    let startY = 0;
    let distance = 0;
    let tracking = false;
    let refreshing = false;

    function atPageTop() {
      return window.scrollY <= 0 &&
        document.documentElement.scrollTop <= 0 &&
        document.body.scrollTop <= 0;
    }

    function resetIndicator() {
      distance = 0;
      tracking = false;
      indicator.classList.remove("ready");
      indicator.style.height = "0px";
      icon.textContent = "↓";
      text.textContent = "下拉重新整理";
    }

    async function doRefresh() {
      if (refreshing) return;
      refreshing = true;
      indicator.classList.remove("ready");
      indicator.classList.add("refreshing");
      indicator.style.height = "58px";
      icon.textContent = "↻";
      text.textContent = "正在更新…";

      try {
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration) {
            await registration.update();
          }
        }
      } catch (_) {
        // Even if SW update fails, page reload still works.
      }

      window.setTimeout(() => {
        window.location.reload();
      }, 180);
    }

    window.addEventListener("touchstart", (event) => {
      if (refreshing || !atPageTop() || event.touches.length !== 1) return;
      startY = event.touches[0].clientY;
      distance = 0;
      tracking = true;
    }, {passive:true});

    window.addEventListener("touchmove", (event) => {
      if (!tracking || refreshing || event.touches.length !== 1) return;

      const currentY = event.touches[0].clientY;
      const raw = currentY - startY;

      if (raw <= 0) {
        resetIndicator();
        return;
      }

      // Add resistance so the pull feels natural.
      distance = Math.min(maxPull, raw * 0.58);
      indicator.style.height = `${Math.max(0, distance)}px`;

      if (distance >= threshold) {
        indicator.classList.add("ready");
        icon.textContent = "↻";
        text.textContent = "放開更新";
      } else {
        indicator.classList.remove("ready");
        icon.textContent = "↓";
        text.textContent = "下拉重新整理";
      }
    }, {passive:true});

    window.addEventListener("touchend", () => {
      if (!tracking || refreshing) return;
      const shouldRefresh = distance >= threshold;
      tracking = false;

      if (shouldRefresh) {
        doRefresh();
      } else {
        resetIndicator();
      }
    }, {passive:true});

    window.addEventListener("touchcancel", () => {
      if (!refreshing) resetIndicator();
    }, {passive:true});
  })();

  // ---------- Init ----------
  window.addEventListener("pageshow", () => {
    calc();
  });

  calc();
  renderPeopleMemory();
  renderPayments();
  renderRoster();
  refreshPairSelectors();
  renderRotation();
  updateRosterDerivedState();
})();
