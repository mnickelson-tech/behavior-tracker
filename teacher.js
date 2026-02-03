(() => {
  let students = Store.getStudents();
  let behaviors = Store.getBehaviors();
  let currentStudent = null;

  const els = {
    studentButtons: document.getElementById("studentButtons"),
    studentInput: document.getElementById("studentInput"),
    addStudentBtn: document.getElementById("addStudentBtn"),
    currentStudentBox: document.getElementById("currentStudentBox"),
    currentStudentName: document.getElementById("currentStudentName"),
    noStudentWarning: document.getElementById("noStudentWarning"),
    behaviorGrid: document.getElementById("behaviorGrid"),
    todayLog: document.getElementById("todayLog"),
    clearTodayBtn: document.getElementById("clearTodayBtn"),
  };

  function fmtTime(d) {
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
  }

  function computeCountsForToday() {
    const logs = Store.getTodayLogs();
    const counts = {};
    for (const b of behaviors) counts[b.name] = 0;
    for (const l of logs) {
      counts[l.behaviorName] = (counts[l.behaviorName] || 0) + 1;
    }
    return counts;
  }

  function renderStudents() {
    els.studentButtons.innerHTML = students.map(name => `
      <button class="student-btn ${currentStudent === name ? "active" : ""}" data-student="${encodeURIComponent(name)}">
        <span>${name}</span>
        <button class="small-x" data-del="${encodeURIComponent(name)}">✕</button>
      </button>
    `).join("");

    els.studentButtons.querySelectorAll(".student-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const del = e.target?.dataset?.del;
        if (del) return; // delete handled below
        const s = decodeURIComponent(btn.dataset.student);
        currentStudent = s;
        renderStudents();
        renderBehaviors();
        renderTodayLog();
        updateStudentState();
      });
    });

    els.studentButtons.querySelectorAll(".small-x").forEach(x => {
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        const s = decodeURIComponent(x.dataset.del);
        students = students.filter(n => n !== s);
        Store.setStudents(students);
        if (currentStudent === s) currentStudent = null;
        renderStudents();
        renderBehaviors();
        renderTodayLog();
        updateStudentState();
      });
    });
  }

  function updateStudentState() {
    if (currentStudent) {
      els.currentStudentBox.style.display = "block";
      els.noStudentWarning.style.display = "none";
      els.currentStudentName.textContent = currentStudent;
    } else {
      els.currentStudentBox.style.display = "none";
      els.noStudentWarning.style.display = "block";
    }
    // enable/disable behavior buttons
    els.behaviorGrid.querySelectorAll(".behavior-btn").forEach(btn => {
      btn.disabled = !currentStudent;
    });
  }

  function renderBehaviors() {
    // refresh behaviors in case SPED page changed them
    behaviors = Store.getBehaviors();

    const counts = computeCountsForToday();

    // group by category for nicer display
    const byCat = {};
    for (const b of behaviors) {
      if (!byCat[b.category]) byCat[b.category] = [];
      byCat[b.category].push(b);
    }

    const sections = Object.keys(byCat).sort().map(cat => {
      const items = byCat[cat].map(b => `
        <button class="behavior-btn" data-beh="${b.id}" ${!currentStudent ? "disabled" : ""}>
          <span>${b.name}</span>
          <span class="pill">${counts[b.name] || 0}</span>
        </button>
      `).join("");

      return `
        <div style="margin-bottom:12px;">
          <div class="muted" style="margin: 0 0 8px;">${cat}</div>
          <div class="behavior-grid">${items}</div>
        </div>
      `;
    }).join("");

    // NOTE: we reuse .behavior-grid inside sections, so behaviorGrid is a wrapper
    els.behaviorGrid.innerHTML = sections;

    // click handlers
    els.behaviorGrid.querySelectorAll(".behavior-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        if (!currentStudent) return;

        const behaviorId = btn.dataset.beh;
        const behavior = behaviors.find(b => b.id === behaviorId);
        if (!behavior) return;

        const now = new Date();
        const entry = {
          id: crypto.randomUUID(),
          dayKey: Store.getTodayKey(),
          studentName: currentStudent,
          behaviorId: behavior.id,
          behaviorName: behavior.name,
          category: behavior.category,
          timestampISO: now.toISOString(),
          timeLabel: fmtTime(now)
        };

        Store.addLog(entry);
        renderBehaviors();
        renderTodayLog();
      });
    });

    updateStudentState();
  }

  function renderTodayLog() {
    const logs = Store.getTodayLogs()
      .slice()
      .sort((a,b) => (a.timestampISO < b.timestampISO ? 1 : -1)); // newest first

    if (logs.length === 0) {
      els.todayLog.innerHTML = `<div class="log-item muted">No logs yet today.</div>`;
      return;
    }

    els.todayLog.innerHTML = logs.map(l => `
      <div class="log-item">
        <div><strong>${l.studentName}</strong> — ${l.behaviorName}</div>
        <div class="muted">${l.timeLabel}</div>
      </div>
    `).join("");
  }

  // Add student
  els.addStudentBtn.addEventListener("click", () => {
    const name = els.studentInput.value.trim();
    if (!name) return;
    if (!students.includes(name)) {
      students.push(name);
      Store.setStudents(students);
    }
    currentStudent = name;
    els.studentInput.value = "";
    renderStudents();
    renderBehaviors();
    renderTodayLog();
    updateStudentState();
  });

  els.studentInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") els.addStudentBtn.click();
  });

  // Clear today logs
  els.clearTodayBtn.addEventListener("click", () => {
    Store.clearTodayLogs();
    renderBehaviors();
    renderTodayLog();
  });

  // initial render
  renderStudents();
  renderBehaviors();
  renderTodayLog();
  updateStudentState();
})();
