import {useState, useEffect, useRef, useCallback} from "react";
import ScoreboardScreen from "@/components/ScoreboardScreen";
import SettingsScreen from "@/components/SettingsScreen";
import BottomNav from "@/components/BottomNav";
import useSocket from "@/hooks/use-socket.tsx";
import { useInterval } from "react-use";

interface Message {
    rev: string;
    home: number;
    away: number;
    remaining?: number;
    paused: boolean;
    period?: string;
    homeTeam?: string;
    awayTeam?: string;
    mode?: "score" | "off" | "signage";
}

const params = new URLSearchParams(window.location.href.split('?')[1]);

const Index = () => {
    const [activeTab, setActiveTab] = useState<"scoreboard" | "settings">("scoreboard");
    const [homeTeam, setHomeTeam] = useState("Uccle Sport");
    const [awayTeam, setAwayTeam] = useState("Visiteurs");
    const [homeScore, setHomeScore] = useState(0);
    const [awayScore, setAwayScore] = useState(0);
    const [latestRev, setLatestRev] = useState("");
    const [paused, setPaused] = useState(true);
    const [remaining, setRemaining] = useState(35 * 60);
    const [endDate, setEndDate] = useState<Date>(new Date(+new Date() + remaining * 1000));
    const [period, setPeriod] = useState("1st Quarter");
    const [activeMode, setActiveMode] = useState<"score" | "off" | "signage">("off");

    // Track when a change originates locally (from UI) so we can emit to the server
    const localChangeRef = useRef(false);

    const socket = useSocket();

    const update = useCallback((ioSocket: typeof socket, homeTeam: string, awayTeam: string, homeScore: number, awayScore: number, remaining: number, paused: boolean, period: string, latestRev: string) => {
        const payload: Message = {
            rev: latestRev,
            home: homeScore,
            away: awayScore,
            remaining,
            paused,
            period,
            homeTeam,
            awayTeam,
        };

        ioSocket.emit('update', payload,
            (resp) => {
                if (resp && resp.status === 409) {
                    // refresh state
                    ioSocket.emit(
                        'sync',
                        ({status, resp}) => {
                            if (status === 200 && resp.remaining != undefined) {
                                setLatestRev(resp.rev);
                                setHomeScore(resp.home);
                                setAwayScore(resp.away);
                                setPaused(resp.paused);
                                if (resp.homeTeam) setHomeTeam(resp.homeTeam);
                                if (resp.awayTeam) setAwayTeam(resp.awayTeam);
                                setRemaining(resp.remaining);
                                setEndDate(new Date(Date.now() + resp.remaining * 1000));
                            }
                        }
                    );
                }
            });
    }, []);

    useInterval(() => {
            if (paused) {
                setEndDate(new Date(+new Date() + remaining * 1000))
            } else {
                setRemaining(Math.max(0, Math.floor((+endDate - +new Date()) / 1000)))
                if (remaining < 0 && !paused) {
                    setPaused(true)
                    update(socket, homeTeam, awayTeam, homeScore, awayScore, 0, true, period, latestRev);
                }
            }
    }, 1000);

    const onUpdate = (msg: Message) => {
        setLatestRev(msg.rev);
        setHomeScore(msg.home);
        setAwayScore(msg.away);
        setPaused(msg.paused);
        setPeriod(msg.period || "1st Quarter");
        if (msg.homeTeam) setHomeTeam(msg.homeTeam);
        if (msg.awayTeam) setAwayTeam(msg.awayTeam);
        if (msg.remaining !== undefined) {
            setRemaining(Math.max(0, msg.remaining));
            setEndDate(new Date(Date.now() + Math.max(0, msg.remaining) * 1000));
        }
        if (msg.mode) setActiveMode(msg.mode);
    };

    const onPing = () => {
        // noop for now
    };


    useEffect(() => {
        socket.on('update', onUpdate);
        socket.on('ping', onPing);

        socket.emit(
            'sync',
            {token: params.get('secret'), uuid: params.get('uuid')},
            ({status, resp}) => {
                if (status === 200) {
                    if (resp.remaining != undefined) {
                        onUpdate(resp);
                    }
                } else {
                    console.warn('Cannot sync', status, resp);
                }
            }
        );
    }, [socket]);

    // --- Wrapped setters to mark local/user-driven changes ---
    const handleHomeScoreChange = (val: number) => {
        localChangeRef.current = true;
        setHomeScore(val);
    };
    const handleAwayScoreChange = (val: number) => {
        localChangeRef.current = true;
        setAwayScore(val);
    };
    const handleTimeChange = (val: number) => {
        localChangeRef.current = true;
        setRemaining(val);
        setEndDate(new Date(Date.now() + Math.max(0, val) * 1000));
    };
    const handlePeriodChange = (val: string) => {
        localChangeRef.current = true;
        setPeriod(val);
    };

    const handleHomeTeamChange = (val: string) => {
        localChangeRef.current = true;
        setHomeTeam(val);
    };
    const handleAwayTeamChange = (val: string) => {
        localChangeRef.current = true;
        setAwayTeam(val);
    };
    const handleActiveChange = (val: "score" | "signage" | "off") => {
        setActiveMode(val);
        socket.emit('power', {turnOn: val !== "off", turnOff: val === "off", mode: val});
    };
    const handlePausedChange = (val: boolean) => {
        localChangeRef.current = true;
        setPaused(val);
    }

    useEffect(() => {
        if (!localChangeRef.current) return;
        update(socket, homeTeam, awayTeam, homeScore, awayScore, remaining, paused, period, latestRev);
        localChangeRef.current = false;
    }, [socket, homeTeam, awayTeam, homeScore, awayScore, remaining, paused, period, latestRev, update]);

    return (
        <div className="min-h-screen bg-background">
            {activeTab === "scoreboard" ? (
                <ScoreboardScreen
                    homeTeam={homeTeam}
                    awayTeam={awayTeam}
                    homeScore={homeScore}
                    awayScore={awayScore}
                    time={Math.max(remaining, 0)}
                    period={period}
                    paused={paused}
                    onHomeScoreChange={handleHomeScoreChange}
                    onAwayScoreChange={handleAwayScoreChange}
                    onTimeChange={handleTimeChange}
                    onPeriodChange={handlePeriodChange}
                    onPausedChange={handlePausedChange}
                />
            ) : (
                <SettingsScreen
                    homeTeam={homeTeam}
                    awayTeam={awayTeam}
                    onHomeTeamChange={handleHomeTeamChange}
                    onAwayTeamChange={handleAwayTeamChange}
                    onActiveChange={handleActiveChange}
                    activeMode={activeMode}
                />
            )}
            <BottomNav activeTab={activeTab} onTabChange={setActiveTab}/>
        </div>
    );
};

export default Index;
