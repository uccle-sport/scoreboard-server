import {useEffect, useMemo} from 'react';
import {io, Socket} from 'socket.io-client';

// Default socket URL can be overridden with VITE_SOCKET_URL in your .env
const params = new URLSearchParams(window.location.href.split("?")[1])

let socket: Socket | null = null;


function getSocket() {
    if (!socket) {
        const socketIoUrl = params.get('socket-io-url');
        socket = !socketIoUrl ? io({
            query: {
                token: params?.get('secret') ?? "",
                uuid: params?.get('uuid') ?? ""
            }
        }) : io(params.get('socket-io-url'), {
            query: {
                token: params?.get('secret') ?? "",
                uuid: params?.get('uuid') ?? ""
            }
        })
    }
    return socket;
}

// A React hook that ensures the socket is initialized and connected while at least
// one component is using the hook. It returns a small API for subscribing/emitting.
export default function useSocket() {
    useEffect(() => {
        const s = getSocket();
        if (!s.connected) s.connect();

        // keep socket alive until page unload
        const onBeforeUnload = () => s.disconnect();
        window.addEventListener('beforeunload', onBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', onBeforeUnload);
            // do not disconnect on every unmount to allow reuse across components
            // the socket will be disconnected on page unload
        };
    }, []);

    const socket = getSocket();

    return useMemo(() => ({
        on: (event: string, cb: (...args: unknown[]) => void) => {
            const s = socket;
            // socket.io `on` expects a callback typed with `any[]` in its typings; we avoid
            // explicit `any` in our public API by using `unknown[]` and do a very small
            // cast only for the internal call.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            s.on(event, cb as (...args: any[]) => void);
            return () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                s.off(event, cb as (...args: any[]) => void);
            };
        },
        emit: (event: string, ...args: unknown[]) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            socket.emit(event, ...(args as any[]));
        },
        socket: socket,
    }), [socket]);
}
