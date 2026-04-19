import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Code2, Timer, GitFork, User as UserIcon } from "lucide-react";
import DsaTimer from "@/components/DsaTimer";
import PomodoroTimer from "@/components/PomodoroTimer";
import GithubSettings from "@/components/GithubSettings";
import UserProfile from "@/components/UserProfile";

export default function App() {
  const [activeTab, setActiveTab] = useState("dsa");

  // Persist active tab in Chrome storage
  useEffect(() => {
    const loadTab = async () => {
      if (typeof chrome === "undefined" || !chrome.storage) return;
      const data = await chrome.storage.local.get(["activeTab"]);
      if (data.activeTab) setActiveTab(data.activeTab);
    };
    loadTab();
  }, []);

  const handleTabChange = (value) => {
    setActiveTab(value);
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ activeTab: value });
    }
  };

  return (
    <div className="w-[360px] min-h-[520px] bg-background text-foreground font-sans antialiased">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <div className="px-4 pt-3">
          <TabsList className="w-full">
            <TabsTrigger value="dsa" className="flex-1 gap-1.5 text-xs">
              <Code2 className="w-3.5 h-3.5" />
              DSA
            </TabsTrigger>
            <TabsTrigger value="pomodoro" className="flex-1 gap-1.5 text-xs">
              <Timer className="w-3.5 h-3.5" />
              Timer
            </TabsTrigger>
            <TabsTrigger value="github" className="flex-1 gap-1.5 text-xs">
              <GitFork className="w-3.5 h-3.5" />
              GitHub
            </TabsTrigger>
            <TabsTrigger value="profile" className="flex-1 gap-1.5 text-xs">
              <UserIcon className="w-3.5 h-3.5" />
              Profile
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="p-4 pt-3">
          <TabsContent value="dsa" className="mt-0">
            <DsaTimer />
          </TabsContent>
          <TabsContent value="pomodoro" className="mt-0">
            <PomodoroTimer />
          </TabsContent>
          <TabsContent value="github" className="mt-0">
            <GithubSettings />
          </TabsContent>
          <TabsContent value="profile" className="mt-0">
            <UserProfile />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}