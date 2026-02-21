import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import QRCode from "react-qr-code";

interface SettingsScreenProps {
  homeTeam: string;
  awayTeam: string;
  onHomeTeamChange: (name: string) => void;
  onAwayTeamChange: (name: string) => void;
  onActiveChange: (mode: "score" | "signage" | "off") => void;
}

const SettingsScreen = ({
  homeTeam,
  awayTeam,
  onHomeTeamChange,
  onAwayTeamChange,
  onActiveChange,
}: SettingsScreenProps) => {
  const [activeMode, setActiveMode] = useState<"score" | "signage" | "off">("off");
  const appUrl = window.location.href;

  const handleModeChange = (mode: "score" | "signage" | "off") => {
    setActiveMode(mode);
    onActiveChange(mode);
  };

  return (
    <div className="min-h-screen p-4 pb-24">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* QR Code */}
        <Card className="p-6 bg-card border-primary glow-primary">
          <h2 className="text-xl font-bold mb-4 text-center text-primary">Share Scoreboard</h2>
          <div className="bg-white p-4 rounded-lg mx-auto w-fit">
            <QRCode value={appUrl} size={200} />
          </div>
          <p className="text-center mt-4 text-sm text-muted-foreground break-all">{appUrl}</p>
        </Card>

        {/* Scoreboard Toggle */}
        <Card className="p-6 bg-card border-border">
          <div className="space-y-4">
            <div>
              <Label className="text-lg font-bold text-primary">
                Scoreboard Control
              </Label>
            </div>
            <div className="flex gap-3">
              <Button
                variant={activeMode === "score" ? "default" : "outline"}
                className={`flex-1 ${activeMode === "score" ? "bg-primary text-primary-foreground" : "border-border"}`}
                onClick={() => handleModeChange("score")}
              >
                Score
              </Button>
              <Button
                variant={activeMode === "signage" ? "default" : "outline"}
                className={`flex-1 ${activeMode === "signage" ? "bg-primary text-primary-foreground" : "border-border"}`}
                onClick={() => handleModeChange("signage")}
              >
                Signage
              </Button>
              <Button
                variant={activeMode === "off" ? "default" : "outline"}
                className={`flex-1 ${activeMode === "off" ? "bg-primary text-primary-foreground" : "border-border"}`}
                onClick={() => handleModeChange("off")}
              >
                Off
              </Button>
            </div>
          </div>
        </Card>

        {/* Team Names */}
        <Card className="p-6 bg-card border-border space-y-6">
          <h2 className="text-xl font-bold text-primary">Team Names</h2>

          <div className="space-y-2">
            <Label htmlFor="home-team" className="text-foreground">
              Home Team
            </Label>
            <Input
              id="home-team"
              value={homeTeam}
              onChange={(e) => onHomeTeamChange(e.target.value)}
              className="bg-input border-border text-lg font-semibold"
              placeholder="Enter home team name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="away-team" className="text-foreground">
              Away Team
            </Label>
            <Input
              id="away-team"
              value={awayTeam}
              onChange={(e) => onAwayTeamChange(e.target.value)}
              className="bg-input border-border text-lg font-semibold"
              placeholder="Enter away team name"
            />
          </div>
        </Card>

        {/* Reset Scoreboard */}
        <Card className="p-6 bg-card border-border">
          <h2 className="text-xl font-bold text-primary mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full border-primary text-primary hover:bg-primary hover:text-primary-foreground"
              onClick={() => {
                onHomeTeamChange("Uccle Sport");
                onAwayTeamChange("Visiteurs");
              }}
            >
              Reset Team Names
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default SettingsScreen;
