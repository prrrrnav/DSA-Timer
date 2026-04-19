chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "phaseTimer") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      title: "⏳ Phase Complete!",
      message: "Time is up! Open the extension to start the next phase.",
      priority: 2,
      requireInteraction: true
    });
    chrome.storage.local.set({ isRunning: false, timeLeft: 0 });
  }
});