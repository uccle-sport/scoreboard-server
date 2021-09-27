const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const PORT = process.env.PORT || 5000
const GDS_SECRET = process.env.GDS_SECRET || 'S3l3n1umSh@z@m'
const {v4: uuidv4} = require('uuid');

console.log(`Secret is set to ${GDS_SECRET}`)
const scoreBoards = {}
const state = {}

const validateToken = (token) => GDS_SECRET === token

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
    } else {
        console.log(`Registering: ${uuid} failed due to incorrect token`);
    }
}

io.on('connection', (socket) => {
    let uuids = []
    console.log('client connected');
    if (socket.handshake.query && socket.handshake.query.token) {
        register(socket.handshake.query.token, socket.handshake.query.uuid, socket, uuids)
    }
    socket.on('update', ({token, uuid, rev, ...msg}, callback) => {
        if (state[uuid] && (!state[uuid].rev || rev === state[uuid].rev)) {
            state[uuid] = {
                ...(state[uuid]),
                ...msg,
                endDate: (msg.remaining ? +new Date() + msg.remaining * 1000 : state[uuid].endDate),
                rev: uuidv4(),
                remaining: undefined
            }
            forward('update', uuid, token, callback, msg)
        } else {
            callback({status: 409})
        }
    })
    socket.on('ping', () => {
    })
    socket.on('sync', ({token, uuid}, callback) => {
        if (validateToken(token) && state[uuid]) {
            callback({
                status: 200, resp: {
                    ...(state[uuid]),
                    remaining: (state[uuid].endDate ? Math.floor((state[uuid].endDate - +new Date()) / 1000) : undefined), //Always recompute remaining
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
