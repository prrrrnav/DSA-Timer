import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, RotateCcw, SkipForward, Coffee, Brain } from "lucide-react";

const MODES = {
  work: { label: "Focus", minutes: 25, icon: Brain },
  shortBreak: { label: "Short Break", minutes: 5, icon: Coffee },
  longBreak: { label: "Long Break", minutes: 15, icon: Coffee },
};

export default function PomodoroTimer() {
  const [mode, setMode] = useState("work");          // "work" | "shortBreak" | "longBreak"
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(100);
  const [completedPomodoros, setCompletedPomodoros] = useState(0);
  const intervalRef = useRef(null);

  const currentMode = MODES[mode];
  const totalMs = currentMode.minutes * 60000;

  // Sync state with Chrome Storage and Alarms
  useEffect(() => {
    const syncState = async () => {
      if (typeof chrome === "undefined" || !chrome.storage) return;

      const data = await chrome.storage.local.get([
        "pomo_mode", "pomo_endTime", "pomo_isRunning", "pomo_completedPomodoros"
      ]);

      if (data.pomo_mode) setMode(data.pomo_mode);
      if (data.pomo_completedPomodoros !== undefined) setCompletedPomodoros(data.pomo_completedPomodoros);

      const alarm = await chrome.alarms.get("pomoTimer");

      if (data.pomo_isRunning && alarm) {
        setIsRunning(true);
        startUiRefresh(alarm.scheduledTime, data.pomo_mode || "work");
      } else if (data.pomo_isRunning && !alarm) {
        // Alarm already fired while popup was closed
        handleComplete(data.pomo_mode || "work", data.pomo_completedPomodoros || 0);
      }
    };

    syncState();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const startUiRefresh = (endTime, currentModeKey) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const totalModeMs = MODES[currentModeKey].minutes * 60000;

    const updateUi = () => {
      const remainingMs = endTime - Date.now();
      if (remainingMs <= 0) {
        handleComplete(currentModeKey, completedPomodoros);
        return true;
      } else {
        setTimeLeft(remainingMs);
        setProgress((remainingMs / totalModeMs) * 100);
        return false;
      }
    };

    if (updateUi()) return;
    intervalRef.current = setInterval(updateUi, 1000);
  };

  const handleComplete = (completedMode, currentCount) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setIsRunning(false);
    setTimeLeft(0);
    setProgress(0);

    if (completedMode === "work") {
      const newCount = currentCount + 1;
      setCompletedPomodoros(newCount);
      const nextMode = newCount % 4 === 0 ? "longBreak" : "shortBreak";
      setMode(nextMode);
      if (typeof chrome !== "undefined" && chrome.storage) {
        chrome.storage.local.set({
          pomo_isRunning: false, pomo_endTime: 0,
          pomo_mode: nextMode, pomo_completedPomodoros: newCount
        });
      }
    } else {
      setMode("work");
      if (typeof chrome !== "undefined" && chrome.storage) {
        chrome.storage.local.set({
          pomo_isRunning: false, pomo_endTime: 0, pomo_mode: "work"
        });
      }
    }
  };

  const startTimer = () => {
    const durationMinutes = MODES[mode].minutes;
    const endTime = Date.now() + durationMinutes * 60000;

    setIsRunning(true);
    setTimeLeft(endTime - Date.now());
    setProgress(100);

    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ pomo_mode: mode, pomo_endTime: endTime, pomo_isRunning: true });
      chrome.alarms.create("pomoTimer", { delayInMinutes: durationMinutes });
    }

    startUiRefresh(endTime, mode);
  };

  const stopTimer = () => {
    if (typeof chrome !== "undefined" && chrome.alarms) {
      chrome.alarms.clear("pomoTimer");
      chrome.storage.local.set({ pomo_isRunning: false, pomo_endTime: 0 });
    }
    if (intervalRef.current) clearInterval(intervalRef.current);
    setIsRunning(false);
    setTimeLeft(0);
    setProgress(0);
  };

  const skipToNext = () => {
    stopTimer();
    handleComplete(mode, completedPomodoros);
  };

  const resetAll = () => {
    stopTimer();
    setMode("work");
    setCompletedPomodoros(0);
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({
        pomo_mode: "work", pomo_completedPomodoros: 0,
        pomo_isRunning: false, pomo_endTime: 0
      });
    }
  };

  const formatTime = (ms) => {
    if (ms <= 0) {
      const defaultMins = MODES[mode].minutes.toString().padStart(2, "0");
      return `${defaultMins}:00`;
    }
    const mins = Math.floor(ms / 60000).toString().padStart(2, "0");
    const secs = Math.floor((ms % 60000) / 1000).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

  const isBreak = mode === "shortBreak" || mode === "longBreak";
  const isComplete = !isRunning && timeLeft === 0;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Mode Selector ── */}
      <div className="flex gap-1.5">
        {Object.entries(MODES).map(([key, m]) => (
          <Button
            key={key}
            size="sm"
            variant={mode === key ? "secondary" : "ghost"}
            disabled={isRunning}
            onClick={() => { setMode(key); setTimeLeft(0); setProgress(100); }}
            className={`flex-1 text-xs ${isRunning && mode !== key ? "opacity-30" : ""}`}
          >
            {m.label}
          </Button>
        ))}
      </div>

      {/* ── Timer Card ── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <Card className="relative overflow-hidden rounded-2xl ring-0 border border-border">
          {/* Top progress stripe */}
          <div className="absolute top-0 inset-x-0 h-0.5 bg-transparent">
            <motion.div
              className="h-full bg-muted-foreground/40"
              initial={false}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>

          <CardContent className="pt-6 pb-5 px-5 text-center flex flex-col items-center gap-3">
            {/* Status Badge */}
            <AnimatePresence mode="wait">
              <motion.div
                key={mode}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
              >
                <Badge
                  variant={isBreak ? "secondary" : isRunning ? "default" : "outline"}
                  className={isRunning ? "animate-pulse" : ""}
                >
                  {currentMode.label}
                </Badge>
              </motion.div>
            </AnimatePresence>

            {/* Timer */}
            <h1 className="text-5xl font-mono font-extrabold tabular-nums tracking-tighter text-foreground">
              {formatTime(timeLeft)}
            </h1>

            {/* Pomodoro dots */}
            <div className="flex items-center gap-1.5">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className={`h-2 w-2 rounded-full transition-colors ${
                    i < (completedPomodoros % 4) ? "bg-primary" : "bg-muted-foreground/20"
                  }`}
                />
              ))}
              <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                {completedPomodoros} done
              </span>
            </div>

            {/* Controls */}
            <div className="flex gap-2 w-full">
              {isRunning ? (
                <>
                  <Button variant="destructive" className="flex-1" onClick={stopTimer}>
                    <Pause className="w-3.5 h-3.5" />
                    Stop
                  </Button>
                  <Button variant="outline" size="icon" onClick={skipToNext} title="Skip to next">
                    <SkipForward className="w-3.5 h-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <Button className="flex-1" onClick={startTimer}>
                    <Play className="w-3.5 h-3.5" />
                    {timeLeft === 0 ? "Start" : "Resume"}
                  </Button>
                  {completedPomodoros > 0 && (
                    <Button variant="outline" size="icon" onClick={resetAll} title="Reset all">
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Session Info ── */}
      <Card className="rounded-2xl ring-0 border border-border">
        <CardContent className="py-3 px-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-lg font-bold tabular-nums text-foreground">{completedPomodoros}</div>
              <div className="text-[11px] text-muted-foreground">Pomodoros</div>
            </div>
            <div>
              <div className="text-lg font-bold tabular-nums text-foreground">{completedPomodoros * 25}</div>
              <div className="text-[11px] text-muted-foreground">Minutes</div>
            </div>
            <div>
              <div className="text-lg font-bold tabular-nums text-foreground">{4 - (completedPomodoros % 4)}</div>
              <div className="text-[11px] text-muted-foreground">Until Break</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
