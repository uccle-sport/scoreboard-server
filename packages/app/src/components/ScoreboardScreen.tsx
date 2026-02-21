import {useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Card} from "@/components/ui/card";
import {Plus, Minus} from "lucide-react";

interface ScoreboardScreenProps {
    homeTeam: string,
    awayTeam: string,
    homeScore: number,
    awayScore: number,
    time: number,
    period: string,
    onHomeScoreChange: (score: number) => void,
    onAwayScoreChange: (score: number) => void,
    onTimeChange: (time: number) => void,
    onPeriodChange: (period: string) => void,
    onPausedChange: (paused: boolean) => void,
    paused: boolean
}

const ScoreboardScreen = ({
                              homeTeam,
                              awayTeam,
                              homeScore,
                              awayScore,
                              time,
                              period,
                              onHomeScoreChange,
                              onAwayScoreChange,
                              onPausedChange,
                              onTimeChange,
                              onPeriodChange,
                              paused
                          }: ScoreboardScreenProps) => {
    const [customTime, setCustomTime] = useState("");

    const timeToSeconds = (timeStr: string) => {
        const [mins, secs] = timeStr.split(":").map(Number);
        return mins * 60 + secs;
    };

    const secondsToTime = (totalSeconds: number) => {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    };

    const presetTimes = ["35:00", "30:00", "17:30"];
    const quarterPeriods = ["1st Quarter", "2nd Quarter", "3rd Quarter", "4th Quarter"];
    const halfPeriods = ["1st Half", "2nd Half"];

    const handleCustomTime = () => {
        if (customTime.match(/^\d{1,2}:\d{2}$/)) {
            onTimeChange(timeToSeconds(customTime));
            setCustomTime("");
        }
    };

    return (
        <div className="min-h-screen p-4 pb-24">
            <div className="max-w-2xl mx-auto space-y-6">
                {/* Main Scoreboard */}
                <Card className="p-6 bg-card border-primary glow-primary">
                    <div className="grid grid-cols-3 gap-4 items-center">
                        {/* Home Team */}
                        <div className="text-center space-y-4">
                            <h2 className="text-lg font-bold uppercase tracking-wide text-primary min-h-14">
                                {homeTeam}
                            </h2>
                            <div className="text-6xl font-black text-glow">{homeScore}</div>
                            <div className="flex gap-2 justify-center">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-primary text-primary hover:bg-primary hover:text-primary-foreground glow-primary w-[30%]"
                                    onClick={() => onHomeScoreChange(homeScore - 1)}
                                >
                                    <Minus className="h-5 w-5"/>
                                </Button>
                                <Button
                                    size="sm"
                                    className="bg-primary text-primary-foreground hover:bg-primary/90 glow-primary w-[30%]"
                                    onClick={() => onHomeScoreChange(homeScore + 1)}
                                >
                                    <Plus className="h-5 w-5"/>
                                </Button>
                            </div>
                        </div>

                        {/* Center - Time & Period */}
                        <div className="flex flex-col justify-between items-center h-full">
                            <div className="text-lg font-semibold text-accent uppercase tracking-wider text-center">
                                {period}
                            </div>
                            <div className="text-5xl font-mono font-bold text-accent text-glow text-center">
                                {secondsToTime(time)}
                            </div>
                            <Button
                                size="lg"
                                variant={!paused ? "destructive" : "default"}
                                className={!paused ? "min-w-24" : "min-w-24 bg-accent text-accent-foreground hover:bg-accent/90 glow-accent"}
                                onClick={() => onPausedChange(!paused)}
                            >
                                {!paused ? "Pause" : "Start"}
                            </Button>
                        </div>

                        {/* Away Team */}
                        <div className="text-center space-y-4">
                            <h2 className="text-lg font-bold uppercase tracking-wide text-primary min-h-14">
                                {awayTeam}
                            </h2>
                            <div className="text-6xl font-black text-glow">{awayScore}</div>
                            <div className="flex gap-2 justify-center">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-primary text-primary hover:bg-primary hover:text-primary-foreground glow-primary w-[30%]"
                                    onClick={() => onAwayScoreChange(awayScore - 1)}
                                >
                                    <Minus className="h-5 w-5"/>
                                </Button>
                                <Button
                                    size="sm"
                                    className="bg-primary text-primary-foreground hover:bg-primary/90 glow-primary w-[30%]"
                                    onClick={() => onAwayScoreChange(awayScore + 1)}
                                >
                                    <Plus className="h-5 w-5"/>
                                </Button>
                            </div>
                        </div>
                    </div>
                </Card>

                {/* Time Controls */}
                <Card className="p-6 bg-card border-border space-y-4">
                    <h3 className="text-lg font-bold text-primary">Time Presets</h3>
                    <div className="grid grid-cols-3 gap-3">
                        {presetTimes.map((preset) => (
                            <Button
                                key={preset}
                                variant="secondary"
                                onClick={() => {
                                    onTimeChange(timeToSeconds(preset));
                                    onPausedChange(true);
                                }}
                                className="bg-secondary hover:bg-secondary/80"
                            >
                                {preset}
                            </Button>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <Input
                            type="text"
                            placeholder="MM:SS"
                            value={customTime}
                            onChange={(e) => setCustomTime(e.target.value)}
                            className="bg-input border-border"
                        />
                        <Button onClick={handleCustomTime}
                                className="bg-primary text-primary-foreground hover:bg-primary/90">
                            Set
                        </Button>
                    </div>
                </Card>

                {/* Period Controls */}
                <Card className="p-6 bg-card border-border space-y-4">
                    <h3 className="text-lg font-bold text-primary">Quarters</h3>
                    <div className="grid grid-cols-2 gap-3">
                        {quarterPeriods.map((p) => (
                            <Button
                                key={p}
                                variant={period === p ? "default" : "secondary"}
                                onClick={() => onPeriodChange(p)}
                                className={
                                    period === p
                                        ? "bg-primary text-primary-foreground hover:bg-primary/90 glow-primary"
                                        : "bg-secondary hover:bg-secondary/80"
                                }
                            >
                                {p}
                            </Button>
                        ))}
                    </div>
                    <h3 className="text-lg font-bold text-primary mt-4">Halves</h3>
                    <div className="grid grid-cols-2 gap-3">
                        {halfPeriods.map((p) => (
                            <Button
                                key={p}
                                variant={period === p ? "default" : "secondary"}
                                onClick={() => onPeriodChange(p)}
                                className={
                                    period === p
                                        ? "bg-primary text-primary-foreground hover:bg-primary/90 glow-primary"
                                        : "bg-secondary hover:bg-secondary/80"
                                }
                            >
                                {p}
                            </Button>
                        ))}
                    </div>
                </Card>
            </div>
        </div>
    );
};

export default ScoreboardScreen;
