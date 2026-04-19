import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Play, Square, ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";

const PHASES = [
  { id: 0, name: "1. Understand", minutes: 5 },
  { id: 1, name: "2. Brute Force", minutes: 5 },
  { id: 2, name: "3. Optimize", minutes: 20 },
  { id: 3, name: "4. Code", minutes: 10 },
  { id: 4, name: "5. Test & Review", minutes: 5 }
];

export default function App() {
  const [currentPhaseId, setCurrentPhaseId] = useState(-1);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(100);

  // Load state from Chrome Storage when popup opens
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get(["currentPhaseId", "endTime", "isRunning"], (data) => {
        if (data.currentPhaseId !== undefined) setCurrentPhaseId(data.currentPhaseId);

        if (data.isRunning && data.endTime > Date.now()) {
          setIsRunning(true);
          startUiRefresh(data.endTime, data.currentPhaseId);
        } else if (data.currentPhaseId !== -1 && data.currentPhaseId !== undefined) {
          handlePhaseComplete(data.currentPhaseId);
        }
      });
    }
  }, []);

  // Timer interval logic
  const startUiRefresh = (endTime, phaseId) => {
    const totalPhaseMs = PHASES[phaseId].minutes * 60000;

    const interval = setInterval(() => {
      const remainingMs = endTime - Date.now();
      if (remainingMs <= 0) {
        clearInterval(interval);
        handlePhaseComplete(phaseId);
      } else {
        setTimeLeft(remainingMs);
        setProgress((remainingMs / totalPhaseMs) * 100);
      }
    }, 1000);

    return () => clearInterval(interval);
  };

  const handlePhaseComplete = (phaseId) => {
    setIsRunning(false);
    setTimeLeft(0);
    setProgress(0);
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ isRunning: false });
    }
  };

  const triggerPhase = (id) => {
    const endTime = Date.now() + PHASES[id].minutes * 60000;
    setCurrentPhaseId(id);
    setIsRunning(true);
    setTimeLeft(endTime - Date.now());
    setProgress(100);

    // Sync with Chrome Background Service Worker
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ currentPhaseId: id, endTime, isRunning: true });
      chrome.alarms.create("phaseTimer", { delayInMinutes: PHASES[id].minutes });
    }

    startUiRefresh(endTime, id);
  };

  const endPhaseEarly = () => {
    if (typeof chrome !== "undefined" && chrome.alarms) {
      chrome.alarms.clear("phaseTimer");
      chrome.storage.local.set({ isRunning: false, endTime: 0 });
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
    <div className="w-[340px] p-4 bg-slate-50 min-h-[500px] text-slate-900 font-sans">
      <Card className="mb-4 shadow-sm border-slate-200">
        <CardContent className="pt-6 text-center">
          <Badge variant={isComplete ? "secondary" : "default"} className="mb-4 text-xs font-bold uppercase tracking-wider">
            {isComplete ? "Phase Complete" : activePhase ? "Focus Mode" : "Ready to Start"}
          </Badge>

          <h1 className="text-5xl font-mono font-extrabold tracking-tighter mb-4 text-slate-900">
            {formatTime(timeLeft)}
          </h1>

          <Progress value={progress} className="h-2 mb-4 bg-slate-100" />

          {currentPhaseId === 2 && isRunning && (
            <div className="flex items-start gap-2 p-3 mb-4 text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-md text-left">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <p>Stop and look at the solution if you are completely stuck!</p>
            </div>
          )}

          {isRunning ? (
            <Button variant="destructive" className="w-full font-bold shadow-sm" onClick={endPhaseEarly}>
              <Square className="w-4 h-4 mr-2 fill-current" /> End Phase Early
            </Button>
          ) : isComplete ? (
            currentPhaseId < PHASES.length - 1 ? (
              <Button className="w-full font-bold bg-indigo-600 hover:bg-indigo-700 shadow-sm" onClick={() => triggerPhase(currentPhaseId + 1)}>
                Start {PHASES[currentPhaseId + 1].name} <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button variant="outline" className="w-full font-bold border-emerald-500 text-emerald-700 hover:bg-emerald-50" onClick={() => setCurrentPhaseId(-1)}>
                <CheckCircle2 className="w-4 h-4 mr-2" /> Problem Solved!
              </Button>
            )
          ) : (
            <p className="text-sm text-slate-500 font-medium">Select a phase below to begin your session.</p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        {PHASES.map((phase) => (
          <div
            key={phase.id}
            className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
              currentPhaseId === phase.id
                ? "bg-indigo-50 border-indigo-200 shadow-sm"
                : "bg-white border-slate-200 hover:border-indigo-100"
            }`}
          >
            <div className="flex items-center gap-2">
              {currentPhaseId === phase.id && isRunning && (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-600"></span>
                </span>
              )}
              <span className={`text-sm ${currentPhaseId === phase.id ? "font-bold text-indigo-900" : "font-medium text-slate-700"}`}>
                {phase.name} <span className="text-slate-400 font-normal">({phase.minutes}m)</span>
              </span>
            </div>
            
            <Button 
              size="sm" 
              variant={currentPhaseId === phase.id ? "secondary" : "default"}
              className={currentPhaseId === phase.id ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200" : "bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm"}
              onClick={() => triggerPhase(phase.id)}
              disabled={isRunning && currentPhaseId !== phase.id}
            >
              <Play className="w-3 h-3 mr-1 fill-current" /> {currentPhaseId === phase.id && isRunning ? "Restart" : "Start"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}