import './style.css';
import { Socket } from 'socket.io-client';
export declare class ScoreBoardAdmin {
    params: URLSearchParams;
    socket: Socket;
    endDate: Date;
    home: number;
    away: number;
    remaining: number;
    paused: boolean;
    homeTeam: string;
    awayTeam: string;
    private editingTime;
    private latestRev;
    private elements?;
    init(): void;
    private updateState;
    private updateElements;
    update(full?: boolean): void;
    private sync;
    showSettings(): void;
    hideSettings(): void;
}
export declare const scoreBoardAdmin: ScoreBoardAdmin;
