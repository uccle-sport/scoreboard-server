import './style.css';
import { Socket } from 'socket.io-client';
export declare class ScoreBoard {
    params: URLSearchParams;
    socket: Socket;
    endDate: Date;
    home: number;
    away: number;
    remaining: number;
    paused: boolean;
    homeTeam: string;
    awayTeam: string;
    init(): void;
    private syncState;
    private updateState;
    private updateScore;
}
export declare const scoreBoard: ScoreBoard;
