import {useState, useEffect, useCallback, useRef} from 'react';
import {useInterval} from 'react-use';

import clubEmblem from '@/assets/Blason-RUS-2025-white.svg';
import useSocket from '@/hooks/use-socket';

const params = new URLSearchParams(window.location.href.split("?")[1])

const Scoreboard = () => {
    const socket = useSocket();

    const [displayedTime, setDisplayedTime] = useState("--:--");
    // removed unused playTime state

    // Added state for scores and match status
    const [homeScore, setHomeScore] = useState<number>(0);
    const [awayScore, setAwayScore] = useState<number>(0);
    const [homeTeam, setHomeTeam] = useState<string>('Uccle Sport');
    const [awayTeam, setAwayTeam] = useState<string>('Visiteurs');
    const [paused, setPaused] = useState<boolean>(true);
    const [remaining, setRemaining] = useState<number>(35 * 60);
    const [endDate, setEndDate] = useState<Date>(new Date(+new Date() + remaining * 1000));
    const [period, setPeriod] = useState<string>('--');

    // Refs to avoid stale closures inside setInterval timer
    const pausedRef = useRef<boolean>(paused);
    const remainingRef = useRef<number>(remaining);
    const endDateRef = useRef<Date>(endDate);

    // Keep refs in sync with state
    useEffect(() => { pausedRef.current = paused; }, [paused]);
    useEffect(() => { remainingRef.current = remaining; }, [remaining]);
    useEffect(() => { endDateRef.current = endDate; }, [endDate]);

    function updateState(payload: {
        home?: number;
        away?: number;
        homeTeam?: string;
        awayTeam?: string;
        paused?: boolean;
        remaining?: number
        period?: string;
    }) {
        if (payload.home !== undefined) {
            setHomeScore(payload.home);
        }
        if (payload.away !== undefined) {
            setAwayScore(payload.away);
        }
        if (payload.homeTeam) {
            setHomeTeam(payload.homeTeam);
        }
        if (payload.awayTeam) {
            setAwayTeam(payload.awayTeam);
        }
        if (payload.paused !== undefined) {
            setPaused(payload.paused);
            // update ref immediately so timer reads the latest
            pausedRef.current = payload.paused;
        }
        if (payload.period) {
            setPeriod(payload.period);
        }

        if (payload.remaining !== undefined) {
            const rem = Math.floor(payload.remaining);
            setRemaining(Math.max(rem, 0))
            remainingRef.current = Math.max(rem, 0);
            const newEnd = new Date(+new Date() + rem * 1000)
            setEndDate(newEnd)
            endDateRef.current = newEnd;
        }
    }

    useInterval(() => {
        setDisplayedTime(formatTime(new Date()));
        if (pausedRef.current) {
            setEndDate(new Date(+new Date() + remainingRef.current * 1000))
        } else {
            setRemaining(Math.max(Math.floor(((+endDateRef.current) - (+new Date())) / 1000), 0))
        }
    }, 1000);

    useInterval(() => {
        syncState()
    }, 60000);


    const syncState = useCallback(() => {
        socket.emit('sync', {
                token: params?.get("secret"),
                uuid: params?.get("uuid"),
            }, ({status, resp}: {
                status: number, resp: {
                    home?: number;
                    away?: number;
                    homeTeam?: string;
                    awayTeam?: string;
                    paused?: boolean;
                    remaining?: number
                }
            }) => {
                if (status === 200) {
                    updateState(resp)
                } else {
                    console.log(JSON.stringify(resp, null, ' '));
                }
            }
        )
    }, [socket]);

    useEffect(() => {
        syncState()
    }, [syncState]);

    useEffect(() => {
        const unsub = socket.on('update', (payload: {
            home?: number,
            away?: number,
            homeTeam?: string,
            awayTeam?: string,
            paused?: boolean,
            remaining?: number
        }) => {
            updateState(payload);
        });

        return () => {
            // cleanup subscription
            unsub();
        };
    }, [socket]);

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString('fr', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    };

    const formatPlayTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div
            className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(var(--scoreboard-bg))] via-[hsl(220,20%,10%)] to-[hsl(var(--scoreboard-bg))] p-8">
            <div className="w-full">
                {/* Main Scoreboard */}
                <div
                    className="bg-[hsl(var(--scoreboard-panel))] rounded-2xl p-8 shadow-2xl border border-[hsl(var(--border))]">
                    {/* Top Row - Times */}
                    <div className="flex justify-between items-center">
                        <div className="text-left">
                            <div
                                className="text-small text-[hsl(var(--muted-foreground))] mb-1 uppercase tracking-wider">
                                Play Time
                            </div>
                            <div
                                className="text-large font-bold text-[hsl(var(--timer-text))] text-glow scoreboard-number">
                                {formatPlayTime(remaining)}
                            </div>
                        </div>

                        <div className="text-right">
                            <div
                                className="text-small text-[hsl(var(--muted-foreground))] mb-1 uppercase tracking-wider">
                                Current Time
                            </div>
                            <div
                                className="text-large font-bold text-[hsl(var(--timer-text))] text-glow scoreboard-number">
                                {displayedTime}
                            </div>
                        </div>
                    </div>

                    {/* Middle Row - Scores and Logo */}
                    <div className="flex items-center justify-between gap-8">
                        {/* Home Team */}
                        <div className="flex-1 text-center">
                            <div
                                className="text-extra-large font-black text-[hsl(var(--score-text))] mb-4 scoreboard-number leading-none">
                                {homeScore}
                            </div>
                            <div
                                className="text-middle font-semibold text-[hsl(var(--team-text))] uppercase tracking-wide">
                                {homeTeam}
                            </div>
                        </div>

                        {/* Club Emblem */}
                        <div className="flex-shrink-0 flex items-center justify-center">
                            <div className="w-100 h-100 shadow-lg">
                                <img
                                    src={clubEmblem}
                                    alt="Club Emblem"
                                    className="w-100 h-100 object-contain"
                                />
                            </div>
                        </div>

                        {/* Away Team */}
                        <div className="flex-1 text-center">
                            <div
                                className="text-extra-large font-black text-[hsl(var(--score-text))] mb-4 scoreboard-number leading-none">
                                {awayScore}
                            </div>
                            <div
                                className="text-middle font-semibold text-[hsl(var(--team-text))] uppercase tracking-wide">
                                {awayTeam}
                            </div>
                        </div>
                    </div>

                    {/* Match Status */}
                    <div className="text-center">
                        <div className="inline-flex items-center gap-2 bg-[hsl(var(--muted))] px-6 py-3 rounded-full">
                            <span
                                className="text-5xl font-semibold text-[hsl(var(--foreground))] uppercase tracking-wide">
                                {period}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Scoreboard;
