import { Settings, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BottomNavProps {
  activeTab: "scoreboard" | "settings";
  onTabChange: (tab: "scoreboard" | "settings") => void;
}

const BottomNav = ({ activeTab, onTabChange }: BottomNavProps) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-primary backdrop-blur-lg bg-opacity-95 glow-primary">
      <div className="max-w-2xl mx-auto grid grid-cols-2 gap-1 p-2">
        <Button
          variant={activeTab === "scoreboard" ? "default" : "ghost"}
          className={
            activeTab === "scoreboard"
              ? "flex flex-col gap-1 h-16 bg-primary text-primary-foreground hover:bg-primary/90"
              : "flex flex-col gap-1 h-16 text-muted-foreground hover:text-foreground hover:bg-secondary"
          }
          onClick={() => onTabChange("scoreboard")}
        >
          <Trophy className="h-5 w-5" />
          <span className="text-xs font-semibold">Scoreboard</span>
        </Button>
        <Button
          variant={activeTab === "settings" ? "default" : "ghost"}
          className={
            activeTab === "settings"
              ? "flex flex-col gap-1 h-16 bg-primary text-primary-foreground hover:bg-primary/90"
              : "flex flex-col gap-1 h-16 text-muted-foreground hover:text-foreground hover:bg-secondary"
          }
          onClick={() => onTabChange("settings")}
        >
          <Settings className="h-5 w-5" />
          <span className="text-xs font-semibold">Settings</span>
        </Button>
      </div>
    </div>
  );
};

export default BottomNav;
