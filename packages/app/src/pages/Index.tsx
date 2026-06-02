import {useState, useEffect, useRef, useCallback} from "react";
import ScoreboardScreen from "@/components/ScoreboardScreen";
import SettingsScreen from "@/components/SettingsScreen";
import DisplaySourceScreen from "@/components/DisplaySourceScreen";
import BottomNav, { type NavTab } from "@/components/BottomNav";
import useSocket from "@/hooks/use-socket.tsx";
import { useInterval } from "react-use";

type DisplaySource = "scoreboard" | "tv" | "signage";

interface Channel {
    id: string;
    label: string;
    imageUrl?: string;
}

interface Channels {
    tv: Channel[];
    signage: Channel[];
}

interface Message {
    rev: string;
    home: number;
    away: number;
    remaining?: number;
    paused: boolean;
    period?: string;
    homeTeam?: string;
    awayTeam?: string;
    power?: "on" | "off";
    display?: DisplaySource;
    channel?: string;
    volume?: number;
    channels?: Channels;
}

const params = new URLSearchParams(window.location.href.split('?')[1]);

const Index = () => {
    const [activeTab, setActiveTab] = useState<NavTab>("scoreboard");
    const [homeTeam, setHomeTeam] = useState("Uccle Sport");
    const [awayTeam, setAwayTeam] = useState("Visiteurs");
    const [homeScore, setHomeScore] = useState(0);
    const [awayScore, setAwayScore] = useState(0);
    const [latestRev, setLatestRev] = useState("");
    const [paused, setPaused] = useState(true);
    const [remaining, setRemaining] = useState(35 * 60);
    const [endDate, setEndDate] = useState<Date>(new Date(+new Date() + remaining * 1000));
    const [period, setPeriod] = useState("1st Quarter");
    const [power, setPower] = useState<"on" | "off">("off");
    const [channel, setChannel] = useState<string | undefined>(undefined);
    const [volume, setVolume] = useState<number>(50);
    const [channels, setChannels] = useState<Channels>({ tv: [], signage: [] });

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
                        {},
                        ({status, resp}) => {
                            if (status === 200 && resp.remaining != undefined) {
                                onUpdate(resp);
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
        if (msg.power) setPower(msg.power);
        if (msg.display) setActiveTab(msg.display);
        if (msg.channel !== undefined) setChannel(msg.channel);
        if (msg.volume !== undefined) setVolume(msg.volume);
        if (msg.channels) setChannels(msg.channels);
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
                    // Power/display/channel config arrive regardless of timer state.
                    if (resp.power) setPower(resp.power);
                    // Reflect the current display source as the active tab.
                    if (resp.display) setActiveTab(resp.display);
                    if (resp.channel !== undefined) setChannel(resp.channel);
                    if (resp.volume !== undefined) setVolume(resp.volume);
                    if (resp.channels) setChannels(resp.channels);
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
    const handlePowerChange = (on: boolean) => {
        setPower(on ? "on" : "off");
        socket.emit('power', {on});
    };
    const handleDisplayChange = (display: DisplaySource, ch?: string) => {
        setChannel(ch);
        // Carry the current volume so the selected channel starts at the set level.
        socket.emit('display', {display, channel: ch, volume});
    };
    const handleVolumeChange = (val: number) => {
        setVolume(val);
        socket.emit('volume', {volume: val});
    };
    // Pick the channel to use when switching to a source: keep the current one if
    // it belongs to that source, otherwise fall back to the first available.
    const pickChannel = (source: "tv" | "signage") => {
        const list = source === "tv" ? channels.tv : channels.signage;
        if (channel && list.some((c) => c.id === channel)) return channel;
        return list[0]?.id;
    };
    // The bottom tab doubles as the display-source selector for scoreboard/tv/signage.
    const handleTabChange = (tab: NavTab) => {
        setActiveTab(tab);
        if (tab === "scoreboard") handleDisplayChange("scoreboard");
        else if (tab === "tv") handleDisplayChange("tv", pickChannel("tv"));
        else if (tab === "signage") handleDisplayChange("signage", pickChannel("signage"));
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
            {activeTab === "scoreboard" && (
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
            )}
            {(activeTab === "tv" || activeTab === "signage") && (
                <DisplaySourceScreen
                    source={activeTab}
                    channels={activeTab === "tv" ? channels.tv : channels.signage}
                    channel={channel}
                    volume={volume}
                    onChannelChange={(id) => handleDisplayChange(activeTab, id)}
                    onVolumeChange={handleVolumeChange}
                />
            )}
            {activeTab === "settings" && (
                <SettingsScreen
                    homeTeam={homeTeam}
                    awayTeam={awayTeam}
                    onHomeTeamChange={handleHomeTeamChange}
                    onAwayTeamChange={handleAwayTeamChange}
                    power={power}
                    onPowerChange={handlePowerChange}
                />
            )}
            <BottomNav activeTab={activeTab} onTabChange={handleTabChange}/>
        </div>
    );
};

export default Index;
