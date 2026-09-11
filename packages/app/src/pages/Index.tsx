import {useState, useEffect, useRef, useCallback} from "react";
import ScoreboardScreen from "@/components/ScoreboardScreen";
import SettingsScreen from "@/components/SettingsScreen";
import DisplaySourceScreen from "@/components/DisplaySourceScreen";
import BottomNav, { type NavTab } from "@/components/BottomNav";
import useSocket from "@/hooks/use-socket.tsx";
import useAccess from "@/hooks/use-access";
import AccessBanner, { type AccessNeed } from "@/components/AccessBanner";
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
    // `update` is memoised with no deps; the ref keeps its denial handling
    // current without re-creating the callback on every access change.
    const onDeniedRef = useRef<(resp: unknown) => boolean>(() => false);

    const socket = useSocket();
    const {access, claim, unlock, extend, release, onDenied} = useAccess(socket);
    onDeniedRef.current = onDenied as (resp: unknown) => boolean;

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
                if (onDeniedRef.current(resp)) return;
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
    // These three apply optimistically, so a server refusal has to put the local
    // value back — otherwise the UI claims a change the device never made.
    const handlePowerChange = (on: boolean) => {
        const previous = power;
        setPower(on ? "on" : "off");
        socket.emit('power', {on}, (resp) => {
            if (onDenied(resp)) setPower(previous);
        });
    };
    const handleDisplayChange = (display: DisplaySource, ch?: string) => {
        const previous = channel;
        setChannel(ch);
        // Carry the current volume so the selected channel starts at the set level.
        socket.emit('display', {display, channel: ch, volume}, (resp) => {
            if (onDenied(resp)) setChannel(previous);
        });
    };
    const handleVolumeChange = (val: number) => {
        const previous = volume;
        setVolume(val);
        socket.emit('volume', {volume: val}, (resp) => {
            if (onDenied(resp)) setVolume(previous);
        });
    };
    // Pick the channel to use when switching to a source: keep the current one if
    // it belongs to that source, otherwise fall back to the first available.
    const pickChannel = (source: "tv" | "signage") => {
        const list = source === "tv" ? channels.tv : channels.signage;
        if (channel && list.some((c) => c.id === channel)) return channel;
        return list[0]?.id;
    };
    // The bottom tab doubles as the display-source selector. Navigation always
    // happens — a locked phone must still be able to look at the channel list —
    // but the source only actually switches when this phone may switch it.
    const handleTabChange = (tab: NavTab) => {
        setActiveTab(tab);
        if (tab === "scoreboard") {
            if (access.canEdit || access.canTv || access.canSignage) handleDisplayChange("scoreboard");
        } else if (tab === "tv") {
            if (access.canTv) handleDisplayChange("tv", pickChannel("tv"));
        } else if (tab === "signage") {
            if (access.canSignage) handleDisplayChange("signage", pickChannel("signage"));
        }
    };
    const handlePausedChange = (val: boolean) => {
        localChangeRef.current = true;
        setPaused(val);
    }

    useEffect(() => {
        if (!localChangeRef.current) return;
        localChangeRef.current = false;
        if (!access.canEdit) return;
        update(socket, homeTeam, awayTeam, homeScore, awayScore, remaining, paused, period, latestRev);
    }, [socket, homeTeam, awayTeam, homeScore, awayScore, remaining, paused, period, latestRev, update, access.canEdit]);

    // Which capability the visible tab needs, and therefore what the banner asks
    // for. Settings edits team names, so it needs the same right as the score.
    const need: AccessNeed =
        activeTab === "tv" ? "tv" : activeTab === "signage" ? "signage" : "edit";
    const granted =
        need === "tv" ? access.canTv : need === "signage" ? access.canSignage : access.canEdit;
    const bannerVisible = !granted;

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
                    canEdit={access.canEdit}
                    bannerVisible={bannerVisible}
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
                    canSelect={activeTab === "tv" ? access.canTv : access.canSignage}
                    bannerVisible={bannerVisible}
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
                    canEdit={access.canEdit}
                    bannerVisible={bannerVisible}
                    access={access}
                    onExtend={extend}
                    onRelease={release}
                />
            )}
            {bannerVisible && (
                <AccessBanner
                    access={access}
                    need={need}
                    onClaim={claim}
                    onUnlock={unlock}
                />
            )}
            <BottomNav activeTab={activeTab} onTabChange={handleTabChange}/>
        </div>
    );
};

export default Index;
