chrome.runtime.onInstalled.addListener(() => {
  // DSA timer defaults
  chrome.storage.local.set({
    dsa_isRunning: false, dsa_currentPhaseId: -1, dsa_endTime: 0
  });
  // Pomodoro timer defaults
  chrome.storage.local.set({
    pomo_isRunning: false, pomo_mode: "work", pomo_endTime: 0, pomo_completedPomodoros: 0
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "dsaPhaseTimer") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      title: "⏳ DSA Phase Complete!",
      message: "Time is up! Open the extension to start the next phase.",
      priority: 2,
      requireInteraction: true
    });
    chrome.storage.local.set({ dsa_isRunning: false, dsa_endTime: 0 });
  }

  if (alarm.name === "pomoTimer") {
    chrome.storage.local.get(["pomo_mode", "pomo_completedPomodoros"], (data) => {
      const mode = data.pomo_mode || "work";
      const count = data.pomo_completedPomodoros || 0;
      const isWork = mode === "work";

      chrome.notifications.create({
        type: "basic",
        iconUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        title: isWork ? "🍅 Pomodoro Complete!" : "☕ Break Over!",
        message: isWork ? "Great work! Time for a break." : "Break is over. Ready to focus?",
        priority: 2,
        requireInteraction: true
      });

      if (isWork) {
        const newCount = count + 1;
        const nextMode = newCount % 4 === 0 ? "longBreak" : "shortBreak";
        chrome.storage.local.set({
          pomo_isRunning: false, pomo_endTime: 0,
          pomo_mode: nextMode, pomo_completedPomodoros: newCount
        });
      } else {
        chrome.storage.local.set({
          pomo_isRunning: false, pomo_endTime: 0, pomo_mode: "work"
        });
      }
    });
  }
});