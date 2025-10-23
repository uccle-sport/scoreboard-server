const express = require('express');
const app = express();
const cors = require('cors');
const http = require('http').Server(app);
const fetch = require('node-fetch');
// Add a configurable CORS origin; default to '*' to preserve current permissive behavior
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const corsOptions = {
    origin: CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN.split(',').map(s => s.trim()),
    credentials: true
};
const io = require('socket.io')(http, {cors: {origin: corsOptions.origin, credentials: corsOptions.credentials}});
const PORT = process.env.PORT || 5000
const GDS_SECRET = process.env.GDS_SECRET || 'Secret'
const {v4: uuidv4} = require('uuid');

console.log(`Secret is set to ${GDS_SECRET}`)
const scoreBoards = {}
const state = {}

const validateToken = (token) => GDS_SECRET === token

app.use(cors(corsOptions))
app.use(express.static('public'))
app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'))

function forward(action, uuid, token, callback, msg) {
    if (validateToken(token)) {
        console.log(`Forwarding: ${uuid}, ${action}${msg ? ' < ' + JSON.stringify(msg) : ''}`);
        if (scoreBoards[uuid] && scoreBoards[uuid].length) {
            scoreBoards[uuid].forEach(s => {
                s.emit(action, {ts: +new Date(), rev: state[uuid].rev, ...(msg || {})}, (response) => {
                    callback({status: 200, rev: state[uuid].rev, response})
                });
            }) || callback({status: 404})
        }
    } else {
        callback({status: 401})
    }
}

function register(token, uuid, socket, uuids) {
    if (validateToken(token)) {
        console.log(`Registering: ${uuid}`);
        scoreBoards[uuid] = (scoreBoards[uuid] || []).concat([socket])
        if (!state[uuid]) {
            state[uuid] = {}
        }
        uuids.push(uuid)
        return true
    } else {
        console.log(`Registering: ${uuid} failed due to incorrect token`);
        return false
    }
}

io.on('connection', (socket) => {
    let uuids = []

    console.log('client connected');

    const uuid = socket.handshake.query.uuid
    const token = socket.handshake.query.token

    if (socket.handshake.query && socket.handshake.query.token) {
        if (!register(socket.handshake.query.token, socket.handshake.query.uuid, socket, uuids)) {
            socket.disconnect(true)
            return
        }
    }

    socket.on('update', ({rev, ...msg}, callback) => {
        if (!state[uuid]) {
            if (callback) {
                callback({status: 403})
            }
            return
        }
        if (!state[uuid].rev || rev === state[uuid].rev) {
            state[uuid] = {
                ...(state[uuid]),
                ...msg,
                ...(msg.remaining ? {
                    endDate: +new Date() + msg.remaining * 1000,
                    remaining: msg.remaining
                } : msg.paused && !state[uuid].paused && state[uuid].endDate ? {remaining: Math.floor((state[uuid].endDate - +new Date()) / 1000)} : {}),
                rev: uuidv4(),
            }
            console.log('states is ', state[uuid]);
            forward('update', uuid, token, callback, msg)
        } else {
            if (callback) {
                callback({status: 409})
            }
        }
    })

    socket.on('power', ({turnOn, turnOff}, callback) => {
        if (state[uuid]) {
            // handle turnOn and turnOff with support for bearer token in parsedCommand
            const doPowerRequest = (envVarKey) => {
                const command = process.env[envVarKey];
                if (!command) return Promise.resolve({status: 404});
                let parsedCommand;
                try {
                    parsedCommand = JSON.parse(command);
                } catch (e) {
                    console.error('Invalid JSON for', envVarKey, e);
                    return Promise.resolve({status: 400});
                }
                if (!parsedCommand || !parsedCommand.url) return Promise.resolve({status: 400});

                // merge headers and add Authorization if bearer token provided and not already set
                const headers = Object.assign({}, parsedCommand.headers || {'Content-Type': 'application/json'});
                const bearer = parsedCommand.bearer;
                if (bearer && !headers.Authorization && !headers.authorization) {
                    headers.Authorization = `Bearer ${bearer}`;
                }

                const fetchOptions = {
                    method: parsedCommand.method || 'GET',
                    headers,
                    body: parsedCommand.body !== undefined ? (typeof parsedCommand.body === 'string' ? parsedCommand.body : JSON.stringify(parsedCommand.body)) : undefined
                };

                return fetch(parsedCommand.url, fetchOptions)
                    .then(res => res.ok ? res.text().then((text) => {
                        console.log(`Power request to ${parsedCommand.url} succeeded with response:`, text);
                        return ({status: 200});
                    }) : Promise.reject(new Error(`HTTP ${res.status}`)))
                    .catch(err => { console.error(err); return {status: 400}; });
            };

            const promises = [];
            if (turnOn) promises.push(doPowerRequest(`POWER_ON_URL_${uuid.replace(/-/g, '_')}`));
            if (turnOff) promises.push(doPowerRequest(`POWER_OFF_URL_${uuid.replace(/-/g, '_')}`));

            Promise.all(promises).then(results => {
                // If any succeeded return 200, otherwise return first non-200 status
                if (!results.length) {
                    if (callback) callback({status: 404});
                    return;
                }
                const ok = results.some(r => r && r.status === 200);
                if (callback) callback({status: ok ? 200 : (results[0] && results[0].status) || 400});
            });
        }
        console.log('states is ', state[uuid]);
    })
    socket.on('ping', () => {
    })
    socket.on('sync', ({}, callback) => {
        if (validateToken(token) && state[uuid]) {
            callback({
                status: 200, resp: {
                    ...(state[uuid]),
                    remaining: state[uuid].paused && state[uuid].remaining ? state[uuid].remaining : (state[uuid].endDate ? Math.floor((state[uuid].endDate - +new Date()) / 1000) : undefined), //Always recompute remaining
                    endDate: undefined
                }
            })
        }
    });

    socket.on('disconnect', () => {
        console.log('client disconnected');
        uuids.forEach(it => {
            scoreBoards[it] = (scoreBoards[it] || []).filter(x => x !== socket)
        })
    });
});

http.listen(PORT, () => {
    console.log('listening on *:' + PORT);
});
