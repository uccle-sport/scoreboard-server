import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import QRCode from "react-qr-code";
import { cn } from "@/lib/utils";
import type { AccessState } from "@/hooks/use-access";

interface SettingsScreenProps {
  homeTeam: string;
  awayTeam: string;
  onHomeTeamChange: (name: string) => void;
  onAwayTeamChange: (name: string) => void;
  power: "on" | "off";
  onPowerChange: (on: boolean) => void;
  canEdit: boolean;
  bannerVisible: boolean;
  access: AccessState;
  onExtend: () => Promise<{ status: number }>;
  onRelease: () => Promise<{ status: number }>;
}

// Rebuilt from an allowlist rather than trimming `window.location.href`, so a
// param nobody thought about (a debug flag, a socket override) can never ride
// along into something that gets photographed.
function buildUrl(extra?: Record<string, string>): string {
  const current = new URL(window.location.href);
  const params = new URLSearchParams();
  for (const key of ["uuid", "secret", "socket-io-url"]) {
    const value = current.searchParams.get(key);
    if (value) params.set(key, value);
  }
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
  return `${current.origin}${current.pathname}?${params}`;
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}h ${String(m).padStart(2, "0")}m`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function useCountdown(expiresAt?: number): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return null;
  return formatRemaining(expiresAt - Date.now());
}

const SettingsScreen = ({
  homeTeam,
  awayTeam,
  onHomeTeamChange,
  onAwayTeamChange,
  power,
  onPowerChange,
  canEdit,
  bannerVisible,
  access,
  onExtend,
  onRelease,
}: SettingsScreenProps) => {
  // Carries the app URL only. Anyone who scans it gets the scoreboard
  // read-only; the secret in it authorises observation, never mutation, which
  // is what makes this safe to leave on screen.
  const shareUrl = buildUrl();
  // The control QR is a credential and is rendered only for holders.
  const controlUrl = access.pin ? buildUrl({ pin: access.pin }) : null;
  const countdown = useCountdown(access.expiresAt);

  return (
    <div className={cn("min-h-screen p-4", bannerVisible ? "pb-44" : "pb-24")}>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Control — only ever rendered for a phone that holds it */}
        {access.owner && access.pin && (
          <Card className="p-6 bg-card border-accent glow-accent">
            <h2 className="text-xl font-bold mb-1 text-center text-accent">
              You control the scoreboard
            </h2>
            <p className="text-center text-sm text-muted-foreground mb-4">
              Share this code so another phone can help.
            </p>
            <p
              data-testid="control-pin"
              className="text-center text-3xl font-mono font-bold tracking-widest text-foreground"
            >
              {access.pin}
            </p>
            <div
              data-testid="control-pin-qr"
              className="bg-white p-4 rounded-lg mx-auto w-fit mt-4"
            >
              {controlUrl && <QRCode value={controlUrl} size={160} />}
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span data-testid="control-countdown">
                {countdown ? `Releases in ${countdown}` : ""}
              </span>
              <span>
                {access.ownerCount === 1
                  ? "1 phone in control"
                  : `${access.ownerCount ?? 1} phones in control`}
              </span>
            </div>
            <div className="mt-4 flex gap-3">
              <Button
                data-testid="extend-control"
                variant="outline"
                className="flex-1 border-accent text-accent hover:bg-accent hover:text-accent-foreground"
                onClick={() => void onExtend()}
              >
                Extend
              </Button>
              <Button
                data-testid="release-control"
                variant="outline"
                className="flex-1 border-border"
                onClick={() => void onRelease()}
              >
                Release control
              </Button>
            </div>
          </Card>
        )}

        {/* A grant from a match or master code: no PIN to share, nothing to release */}
        {access.canEdit && !access.owner && (
          <Card className="p-6 bg-card border-border">
            <p className="text-center text-sm text-muted-foreground">
              {countdown
                ? `You can edit the scoreboard for another ${countdown}.`
                : "You can edit the scoreboard."}
            </p>
          </Card>
        )}

        {/* Share — the app URL, deliberately without any PIN */}
        <Card className="p-6 bg-card border-primary glow-primary">
          <h2 className="text-xl font-bold mb-1 text-center text-primary">Share Scoreboard</h2>
          <p className="text-center text-sm text-muted-foreground mb-4">
            Opens the scoreboard read-only. A code is still needed to change it.
          </p>
          <div className="bg-white p-4 rounded-lg mx-auto w-fit">
            <QRCode value={shareUrl} size={200} />
          </div>
          <p
            data-testid="share-url"
            className="text-center mt-4 text-sm text-muted-foreground break-all"
          >
            {shareUrl}
          </p>
        </Card>

        {/* Power Control */}
        <Card className={cn("p-6 bg-card border-border", !canEdit && "opacity-60")}>
          <div className="space-y-4">
            <div>
              <Label className="text-lg font-bold text-primary">Screen selection</Label>
            </div>
            <div className="flex gap-3">
              <Button
                disabled={!canEdit}
                variant={power === "on" ? "default" : "outline"}
                className={`flex-1 ${power === "on" ? "bg-primary text-primary-foreground" : "border-border"}`}
                onClick={() => onPowerChange(true)}
              >
                Score
              </Button>
              <Button
                disabled={!canEdit}
                variant={power === "off" ? "default" : "outline"}
                className={`flex-1 ${power === "off" ? "bg-primary text-primary-foreground" : "border-border"}`}
                onClick={() => onPowerChange(false)}
              >
                Off
              </Button>
            </div>
          </div>
        </Card>

        {/* Team Names */}
        <Card className={cn("p-6 bg-card border-border space-y-6", !canEdit && "opacity-60")}>
          <h2 className="text-xl font-bold text-primary">Team Names</h2>

          <div className="space-y-2">
            <Label htmlFor="home-team" className="text-foreground">
              Home Team
            </Label>
            <Input
              id="home-team"
              data-testid="home-team-input"
              disabled={!canEdit}
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
              data-testid="away-team-input"
              disabled={!canEdit}
              value={awayTeam}
              onChange={(e) => onAwayTeamChange(e.target.value)}
              className="bg-input border-border text-lg font-semibold"
              placeholder="Enter away team name"
            />
          </div>
        </Card>

        {/* Reset Scoreboard */}
        <Card className={cn("p-6 bg-card border-border", !canEdit && "opacity-60")}>
          <h2 className="text-xl font-bold text-primary mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <Button
              variant="outline"
              disabled={!canEdit}
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
