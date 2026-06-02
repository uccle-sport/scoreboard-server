import { Megaphone, Settings, Trophy, Tv, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export type NavTab = "scoreboard" | "tv" | "signage" | "settings";

interface BottomNavProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
}

const TABS: { id: NavTab; label: string; Icon: LucideIcon; testId?: string }[] = [
  { id: "scoreboard", label: "Scoreboard", Icon: Trophy },
  { id: "tv", label: "TV", Icon: Tv },
  { id: "signage", label: "Signage", Icon: Megaphone },
  { id: "settings", label: "Settings", Icon: Settings, testId: "nav-settings" },
];

const BottomNav = ({ activeTab, onTabChange }: BottomNavProps) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-primary backdrop-blur-lg bg-opacity-95 glow-primary">
      <div className="max-w-2xl mx-auto grid grid-cols-4 gap-1 p-2">
        {TABS.map(({ id, label, Icon, testId }) => (
          <Button
            key={id}
            data-testid={testId}
            variant={activeTab === id ? "default" : "ghost"}
            className={
              activeTab === id
                ? "flex flex-col gap-1 h-16 bg-primary text-primary-foreground hover:bg-primary/90"
                : "flex flex-col gap-1 h-16 text-muted-foreground hover:text-foreground hover:bg-secondary"
            }
            onClick={() => onTabChange(id)}
          >
            <Icon className="h-5 w-5" />
            <span className="text-xs font-semibold">{label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
};

export default BottomNav;
