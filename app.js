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
    settings: "badminton_tools_settings_v12",
    roster: "badminton_tools_roster_v3",
    rotation: "badminton_tools_rotation_v9_team_colors_random_first",
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
    localStorage.setItem(KEYS.payment, JSON.stringify(paymentList));
  }

  function normalizeLoadedState() {
    roster = Array.isArray(roster) ? roster.filter(x => typeof x === "string" && x.trim()).slice(0, 24) : [];
    peopleMemory = Array.isArray(peopleMemory)
      ? [...new Set(peopleMemory.filter(x => typeof x === "string" && x.trim()))].slice(0, 60)
      : [];
    paymentList = Array.isArray(paymentList)
      ? paymentList
          .filter(item => item && typeof item.name === "string" && item.name.trim())
          .map((item, index) => ({
            id: String(item.id || `p_${index}_${Date.now()}`),
            name: item.name.trim().slice(0,20),
            amount: Math.max(0, Number(item.amount) || 250),
            paid: Boolean(item.paid)
          }))
          .slice(0,60)
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
    rotation: $("rotationPage"),
    payment: $("paymentPage")
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
    refreshFirstLineupSelects();
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
        if (roster.length >= 24) {
          setRosterMessage("本場名單最多 24 人");
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
    if ($("randomFirstLineupBtn")) $("randomFirstLineupBtn").disabled = rotation.active;
    firstLineupIds.forEach(id => {
      if ($(id)) $(id).disabled = rotation.active;
    });
    refreshFirstLineupSelects();

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


  // ---------- Manual lineup ----------
  const firstLineupIds = ["firstA1","firstA2","firstB1","firstB2"];
  const editLineupIds = ["editA1","editA2","editB1","editB2"];

  function populatePlayerSelect(selectId, selected = "") {
    const select = $(selectId);
    if (!select) return;
    const oldValue = selected || select.value || "";
    select.innerHTML = "";

    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "請選擇";
    select.appendChild(blank);

    roster.forEach(name => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });

    if (roster.includes(oldValue)) select.value = oldValue;
  }

  function refreshFirstLineupSelects() {
    firstLineupIds.forEach(id => populatePlayerSelect(id));
  }

  function readLineup(ids) {
    const values = ids.map(id => $(id)?.value || "");
    return [values[0], values[2], values[1], values[3]]; // A1,B1,A2,B2
  }

  function validateLineup(court) {
    if (court.some(name => !name)) return {ok:false, message:"請把 A隊、B隊共 4 個位置都選好"};
    if (new Set(court).size !== 4) return {ok:false, message:"同一個人不能同時出現在兩個位置"};
    if (court.some(name => !roster.includes(name))) return {ok:false, message:"場上人員必須在臨打名單內"};
    return {ok:true};
  }

  function randomizeFirstLineup() {
    if (rotation.active) return;

    if (roster.length < 4) {
      setRosterMessage("至少需要 4 人才能隨機分配第一場");
      return;
    }

    const picked = shuffle(roster).slice(0,4);

    // select 顯示順序：A1、A2、B1、B2
    $("firstA1").value = picked[0];
    $("firstA2").value = picked[1];
    $("firstB1").value = picked[2];
    $("firstB2").value = picked[3];

    setRosterMessage(
      `已隨機第一場：A隊 ${picked[0]}、${picked[1]}｜B隊 ${picked[2]}、${picked[3]}`,
      false
    );
  }

  $("randomFirstLineupBtn").addEventListener("click", randomizeFirstLineup);

  function openCourtEditor() {
    if (!rotation.active || rotation.court.length !== 4) return;
    populatePlayerSelect("editA1", rotation.court[0]);
    populatePlayerSelect("editB1", rotation.court[1]);
    populatePlayerSelect("editA2", rotation.court[2]);
    populatePlayerSelect("editB2", rotation.court[3]);
    $("courtEditMessage").textContent = "";
    $("courtEditPanel").hidden = false;
  }

  function saveCourtEditor() {
    const newCourt = readLineup(editLineupIds);
    const validation = validateLineup(newCourt);
    if (!validation.ok) {
      $("courtEditMessage").textContent = validation.message;
      return;
    }

    rotation.court = [...newCourt];
    rotation.queue = shuffle(roster.filter(name => !newCourt.includes(name)));
    rotation.nextPlan = null;
    ensureNextPlan();
    saveAll();

    $("courtEditPanel").hidden = true;
    $("courtEditMessage").textContent = "";
    setRosterMessage("目前場上人員已更新", false);
    renderRotation();
  }

  $("editCourtBtn").addEventListener("click", openCourtEditor);
  $("saveCourtEditBtn").addEventListener("click", saveCourtEditor);
  $("cancelCourtEditBtn").addEventListener("click", () => {
    $("courtEditPanel").hidden = true;
    $("courtEditMessage").textContent = "";
  });

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
    if (roster.length >= 24) return {ok:false, message:"臨打名單最多 24 人"};

    roster.push(name);
    if (rotation.active) {
      rotation.queue.push(name);
      rotation.games[name] = rotation.games[name] || 0;
      rotation.nextPlan = null;
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
    if (total >= 9) return "9 人以上：最少局數優先，上 4 下 4";
    if (total >= 7) return "7–8 人：最少局數優先，上 4 下 3";
    return "6 人以下：最少局數優先，上 4 下 2";
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

  function pickLowestFirst(array, count, scoreFn) {
    if (count <= 0 || !array.length) return [];

    const groups = new Map();
    array.forEach(name => {
      const score = Number(scoreFn(name)) || 0;
      if (!groups.has(score)) groups.set(score, []);
      groups.get(score).push(name);
    });

    const scores = [...groups.keys()].sort((a,b) => a - b);
    const picked = [];

    for (const score of scores) {
      const sameScore = shuffle(groups.get(score));
      for (const name of sameScore) {
        if (picked.length >= count) return picked;
        picked.push(name);
      }
    }
    return picked;
  }

  function createRandomPlan() {
    if (!rotation.active || rotation.court.length !== 4) {
      return { next:[], stayers:[], incoming:[], outgoing:[], requested:0, actual:0 };
    }

    const requested = requestedOffCount(roster.length);
    const actual = actualOffCount();
    const stayCount = 4 - actual;

    // 下一場預覽時，先把目前正在進行的這一局算進場上四人的局數。
    const effectiveGames = {};
    roster.forEach(name => {
      effectiveGames[name] =
        (rotation.games[name] || 0) +
        (rotation.court.includes(name) ? 1 : 0);
    });

    // 候補：局數最少者優先；同局數才隨機。
    const incoming = pickLowestFirst(
      rotation.queue,
      actual,
      name => effectiveGames[name]
    );

    // 留場：場上局數較少者優先；同局數才隨機。
    const stayers = pickLowestFirst(
      rotation.court,
      stayCount,
      name => effectiveGames[name]
    );

    const outgoing = rotation.court.filter(name => !stayers.includes(name));

    // 人選決定後，四個場上位置／搭檔仍然隨機。
    const next = shuffle([...stayers, ...incoming]);

    return {
      next,
      stayers,
      incoming,
      outgoing,
      requested,
      actual
    };
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

    const manualCourt = readLineup(firstLineupIds);
    const validation = validateLineup(manualCourt);
    if (!validation.ok) {
      setRosterMessage(validation.message);
      return;
    }

    rotation = {
      active:true,
      court:[...manualCourt],
      queue:shuffle(roster.filter(name => !manualCourt.includes(name))),
      games:Object.fromEntries(roster.map(name => [name,0])),
      round:1,
      history:[],
      nextPlan:null
    };

    rotation.nextPlan = createRandomPlan();
    saveAll();
    setRosterMessage("第一場已依你手動指定的 A隊 / B隊開始；之後少局者優先。", false);
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

    const slotLabels = ["A1","B1","A2","B2"];
    for (let i=0;i<4;i++) {
      const el = $(`court${i}`);
      el.innerHTML = "";
      const tag = document.createElement("span");
      tag.className = "courtSlotTag";
      tag.textContent = slotLabels[i];
      const person = document.createElement("span");
      person.className = "courtPersonName";
      person.textContent = rotation.court[i] || "—";
      el.append(tag, person);
    }

    const prediction = rotation.nextPlan;
    const nextGrid = $("nextGrid");
    nextGrid.innerHTML = "";

    const nextSlots = ["A1","B1","A2","B2"];
    prediction.next.forEach((name, index) => {
      const box = document.createElement("div");
      const isStay = prediction.stayers.includes(name);
      box.className = "nextPerson" + (isStay ? " stay" : "");

      const teamTag = document.createElement("span");
      teamTag.className = "nextTeamTag";
      teamTag.textContent = nextSlots[index] || "";

      const personText = document.createElement("span");
      personText.textContent = isStay ? `⭐ ${name}｜留場` : `⬆️ ${name}｜上場`;

      box.append(teamTag, personText);
      nextGrid.appendChild(box);
    });

    let nextRule = ruleText(roster.length);
    if (prediction.actual < prediction.requested) {
      nextRule += `；候補只有 ${rotation.queue.length} 人，因此本輪實際下 ${prediction.actual} 人`;
    } else {
      nextRule += `；少局者優先進下一局，同局數才隨機`;
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
        const stayText = entry.stayers.length ? `留場：${entry.stayers.join("、")}` : "無留場";
        const offText = entry.outgoing.length ? `下場：${entry.outgoing.join("、")}` : "無下場";
        detail.textContent = `${stayText}｜${offText}`;

        item.append(title,detail);
        history.appendChild(item);
      });
    }

    saveAll();
  }


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
  refreshFirstLineupSelects();
  renderRotation();
  updateRosterDerivedState();
})();
