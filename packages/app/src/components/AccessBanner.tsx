import { useEffect, useState } from "react";
import { Lock, ShieldCheck, X } from "lucide-react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { cn } from "@/lib/utils";
import type { AccessState } from "@/hooks/use-access";

export type AccessNeed = "edit" | "tv" | "signage";

interface AccessBannerProps {
  access: AccessState;
  /** Which capability the tab currently on screen requires. */
  need: AccessNeed;
  onClaim: () => Promise<{ status: number }>;
  onUnlock: (pin: string) => Promise<{ status: number; retryAfter?: number }>;
}

// Copy depends on why the phone is locked out, because the way out differs: an
// unclaimed board can simply be taken, an owned one needs the holder's code, and
// during a protected slot only the match code will do.
function describe(access: AccessState, need: AccessNeed) {
  if (need === "tv" || need === "signage") {
    const label = need === "tv" ? "TV" : "Signage";
    return {
      title: `${label} is locked`,
      hint: `Enter the ${label.toLowerCase()} code to switch channels.`,
    };
  }
  if (access.mode === "protected") {
    return {
      title: "Match hours",
      hint: "Enter the match code to change the score.",
    };
  }
  if (access.mode === "temporary") {
    return {
      title: "Someone is controlling the scoreboard",
      hint: "Ask them for the control code to help out.",
    };
  }
  return {
    title: "Nobody is controlling the scoreboard",
    hint: "Take control to change the score.",
  };
}

const AccessBanner = ({ access, need, onClaim, onUnlock }: AccessBannerProps) => {
  const [entering, setEntering] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Collapse the keypad once the capability arrives, however it was granted —
  // including when another phone released the board.
  const granted =
    need === "edit"
      ? access.canEdit
      : need === "tv"
        ? access.canTv
        : access.canSignage;
  useEffect(() => {
    if (granted) {
      setEntering(false);
      setPin("");
      setError(null);
    }
  }, [granted]);

  if (granted) return null;

  const { title, hint } = describe(access, need);
  // Claiming only applies to score control, and only when the board is free.
  const canTakeControl = need === "edit" && access.claimable;

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    const ack = await onUnlock(value);
    setBusy(false);
    if (ack.status === 200) return;
    setPin("");
    setError(
      ack.status === 429
        ? `Too many attempts. Try again in ${ack.retryAfter ?? 60}s.`
        : "That code is not valid."
    );
  };

  const takeControl = async () => {
    setBusy(true);
    const ack = await onClaim();
    setBusy(false);
    // 409 means someone claimed it between the render and the tap.
    if (ack.status === 409) {
      setError("Someone just took control. Enter their code instead.");
      setEntering(true);
    }
  };

  return (
    <div
      data-testid="access-banner"
      className="fixed bottom-20 left-0 right-0 z-40 px-4"
    >
      <div className="max-w-2xl mx-auto rounded-xl border border-primary bg-card p-4 glow-primary">
        {!entering ? (
          <div className="flex items-center gap-3">
            <Lock className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground truncate">{title}</p>
              <p className="text-xs text-muted-foreground truncate">{hint}</p>
            </div>
            {canTakeControl && (
              <Button
                data-testid="access-claim"
                disabled={busy}
                onClick={takeControl}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Take control
              </Button>
            )}
            <Button
              data-testid="access-enter-code"
              variant={canTakeControl ? "ghost" : "default"}
              disabled={busy}
              onClick={() => setEntering(true)}
              className={cn(!canTakeControl && "bg-primary text-primary-foreground")}
            >
              {canTakeControl ? "I have a code" : "Enter code"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <p className="flex-1 text-sm font-semibold text-foreground">{hint}</p>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Cancel"
                onClick={() => {
                  setEntering(false);
                  setError(null);
                  setPin("");
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex justify-center">
              <InputOTP
                data-testid="access-pin"
                maxLength={8}
                value={pin}
                onChange={setPin}
                onComplete={submit}
                disabled={busy}
                pattern={REGEXP_ONLY_DIGITS}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3].map((i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  {[4, 5, 6, 7].map((i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            {error && (
              <p data-testid="access-error" className="text-center text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AccessBanner;
