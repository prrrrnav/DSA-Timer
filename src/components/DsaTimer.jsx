import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Square, ArrowRight, AlertTriangle, CheckCircle2, Sparkles, RotateCcw } from "lucide-react";

const PHASES = [
  { id: 0, name: "1. Understand", minutes: 5 },
  { id: 1, name: "2. Brute Force", minutes: 5 },
  { id: 2, name: "3. Optimize", minutes: 20 },
  { id: 3, name: "4. Code", minutes: 10 },
  { id: 4, name: "5. Test & Review", minutes: 5 }
];

const listVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.15 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 500, damping: 30 } }
};

export default function DsaTimer() {
  const [currentPhaseId, setCurrentPhaseId] = useState(-1);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(100);
  const intervalRef = useRef(null);

  // Sync state with Chrome Storage and Alarms
  useEffect(() => {
    const syncState = async () => {
      if (typeof chrome === "undefined" || !chrome.storage) return;

      const data = await chrome.storage.local.get(["dsa_currentPhaseId", "dsa_endTime", "dsa_isRunning"]);
      
      if (data.dsa_currentPhaseId !== undefined) setCurrentPhaseId(data.dsa_currentPhaseId);

      const alarm = await chrome.alarms.get("dsaPhaseTimer");
      
      if (data.dsa_isRunning && alarm) {
        setIsRunning(true);
        startUiRefresh(alarm.scheduledTime, data.dsa_currentPhaseId);
      } else if (data.dsa_isRunning && !alarm) {
        handlePhaseComplete(data.dsa_currentPhaseId);
      } else if (data.dsa_currentPhaseId !== -1 && !data.dsa_isRunning) {
        setTimeLeft(0);
        setProgress(0);
      }
    };

    syncState();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const startUiRefresh = (endTime, phaseId) => {
    if (phaseId === -1) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    
    const totalPhaseMs = PHASES[phaseId].minutes * 60000;

    const updateUi = () => {
      const remainingMs = endTime - Date.now();
      if (remainingMs <= 0) {
        handlePhaseComplete(phaseId);
        return true;
      } else {
        setTimeLeft(remainingMs);
        setProgress((remainingMs / totalPhaseMs) * 100);
        return false;
      }
    };

    if (updateUi()) return;
    intervalRef.current = setInterval(updateUi, 1000);
  };

  const handlePhaseComplete = (phaseId) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setIsRunning(false);
    setTimeLeft(0);
    setProgress(0);
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ dsa_isRunning: false, dsa_endTime: 0 });
    }
  };

  const triggerPhase = (id) => {
    const durationMinutes = PHASES[id].minutes;
    const endTime = Date.now() + durationMinutes * 60000;
    
    setCurrentPhaseId(id);
    setIsRunning(true);
    setTimeLeft(endTime - Date.now());
    setProgress(100);

    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ dsa_currentPhaseId: id, dsa_endTime: endTime, dsa_isRunning: true });
      chrome.alarms.create("dsaPhaseTimer", { delayInMinutes: durationMinutes });
    }

    startUiRefresh(endTime, id);
  };

  const endPhaseEarly = () => {
    if (typeof chrome !== "undefined" && chrome.alarms) {
      chrome.alarms.clear("dsaPhaseTimer");
      chrome.storage.local.set({ dsa_isRunning: false, dsa_endTime: 0 });
    }
    handlePhaseComplete(currentPhaseId);
  };

  const formatTime = (ms) => {
    if (ms <= 0) return "00:00";
    const mins = Math.floor(ms / 60000).toString().padStart(2, "0");
    const secs = Math.floor((ms % 60000) / 1000).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

  const activePhase = PHASES.find(p => p.id === currentPhaseId);
  const isComplete = currentPhaseId !== -1 && !isRunning;

  return (
    <div className="flex flex-col gap-3">
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
                key={isComplete ? "done" : activePhase ? "focus" : "idle"}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
              >
                <Badge
                  variant={isComplete ? "secondary" : isRunning ? "default" : "outline"}
                  className={isRunning ? "animate-pulse" : ""}
                >
                  {isComplete ? "Phase Complete" : activePhase ? "Focus Mode" : "Ready to Start"}
                </Badge>
              </motion.div>
            </AnimatePresence>

            {/* Timer */}
            <h1 className="text-5xl font-mono font-extrabold tabular-nums tracking-tighter text-foreground">
              {formatTime(timeLeft)}
            </h1>

            {/* Optimize warning */}
            <AnimatePresence>
              {currentPhaseId === 2 && isRunning && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="w-full overflow-hidden"
                >
                  <div className="flex items-start gap-2 p-2.5 text-xs font-medium text-destructive bg-destructive/10 border border-destructive/20 rounded-lg text-left">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <p>Stop and look at the solution if you're stuck!</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Action Button */}
            <div className="w-full">
              {isRunning ? (
                <Button variant="destructive" className="w-full" onClick={endPhaseEarly}>
                  <Square className="w-3.5 h-3.5 fill-current" />
                  End Phase Early
                </Button>
              ) : isComplete ? (
                currentPhaseId < PHASES.length - 1 ? (
                  <Button className="w-full" onClick={() => triggerPhase(currentPhaseId + 1)}>
                    Next: {PHASES[currentPhaseId + 1].name}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                ) : (
                  <Button variant="outline" className="w-full" onClick={() => setCurrentPhaseId(-1)}>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Problem Solved!
                  </Button>
                )
              ) : (
                <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground py-1">
                  <Sparkles className="w-3 h-3" />
                  Select a phase to begin
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Phase List ── */}
      <motion.div
        variants={listVariants}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-1.5"
      >
        {PHASES.map((phase) => {
          const isActive = currentPhaseId === phase.id;

          return (
            <motion.div
              key={phase.id}
              variants={itemVariants}
              className="relative"
            >
              {isActive && (
                <motion.div
                  layoutId="phase-highlight"
                  className="absolute inset-0 rounded-2xl bg-card border border-border"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}

              <div
                className={`relative z-10 flex items-center justify-between px-3.5 py-2.5 rounded-2xl transition-colors duration-200 ${
                  isActive ? "" : "hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {isActive && isRunning ? (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                    </span>
                  ) : (
                    <span className={`h-2 w-2 rounded-full transition-colors ${
                      isActive ? "bg-primary" : "bg-muted-foreground/30"
                    }`} />
                  )}

                  <span className={`text-[13px] ${
                    isActive ? "font-semibold text-foreground" : "text-muted-foreground"
                  }`}>
                    {phase.name}
                    <span className="ml-1 opacity-50 font-normal">({phase.minutes}m)</span>
                  </span>
                </div>

                <Button
                  size="sm"
                  variant={isActive ? "secondary" : "ghost"}
                  disabled={isRunning && !isActive}
                  onClick={() => triggerPhase(phase.id)}
                  className={`gap-1 ${isRunning && !isActive ? "opacity-30" : ""}`}
                >
                  {isActive && isRunning ? (
                    <>
                      <RotateCcw className="w-3 h-3" />
                      Restart
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3" />
                      Start
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
