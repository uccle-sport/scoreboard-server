import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

interface Channel {
  id: string;
  label: string;
  imageUrl?: string;
}

interface DisplaySourceScreenProps {
  source: "tv" | "signage";
  channels: Channel[];
  channel?: string;
  volume: number;
  onChannelChange: (id: string) => void;
  onVolumeChange: (volume: number) => void;
}

const DisplaySourceScreen = ({
  source,
  channels,
  channel,
  volume,
  onChannelChange,
  onVolumeChange,
}: DisplaySourceScreenProps) => {
  // Track the slider position locally for smooth dragging; only emit on release
  // so we don't fire a device request on every tick.
  const [localVolume, setLocalVolume] = useState(volume);
  useEffect(() => {
    setLocalVolume(volume);
  }, [volume]);

  const title = source === "tv" ? "TV" : "Signage";

  return (
    <div className="min-h-screen p-4 pb-44">
      <div className="max-w-2xl mx-auto space-y-6">
        <h2 className="text-2xl font-bold text-primary">{title} Channels</h2>

        {channels.length === 0 ? (
          <p className="text-muted-foreground">No channels configured.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {channels.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => onChannelChange(ch.id)}
                className={`flex flex-col items-center gap-2 rounded-xl border p-3 transition-colors ${
                  channel === ch.id
                    ? "border-primary bg-primary/10 glow-primary"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {ch.imageUrl ? (
                  <img
                    src={ch.imageUrl}
                    alt={ch.label}
                    className="aspect-video w-full rounded-lg object-cover"
                  />
                ) : (
                  <div className="aspect-video w-full rounded-lg bg-muted" />
                )}
                <span className="text-center text-sm font-medium text-foreground">
                  {ch.label}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Volume bar fixed just above the bottom navigation */}
      <div className="fixed bottom-20 left-0 right-0 px-4">
        <div className="max-w-2xl mx-auto space-y-2 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm text-muted-foreground">Volume</Label>
            <span className="text-sm font-medium text-foreground">
              {localVolume}
            </span>
          </div>
          <Slider
            value={[localVolume]}
            min={0}
            max={100}
            step={1}
            onValueChange={(vals) => setLocalVolume(vals[0])}
            onValueCommit={(vals) => onVolumeChange(vals[0])}
          />
        </div>
      </div>
    </div>
  );
};

export default DisplaySourceScreen;
