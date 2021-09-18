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
    init(): void;
    private updateElements;
    update(full?: boolean): void;
    showSettings(): void;
    hideSettings(): void;
}
export declare const scoreBoardAdmin: ScoreBoardAdmin;
