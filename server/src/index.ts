import cors from 'cors'
import express from 'express'
import { createServer } from 'node:http'
import path from 'node:path'
import { Server } from 'socket.io'
import { RoomManager } from './RoomManager.js'

const PORT = Number(process.env.PORT ?? 3000)
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'
const STATIC_DIR = process.env.STATIC_DIR

const app = express()
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

if (STATIC_DIR) {
  const absStatic = path.resolve(STATIC_DIR)
  app.use(express.static(absStatic))
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/socket.io')) return next()
    res.sendFile(path.join(absStatic, 'index.html'), (err) => {
      if (err) next()
    })
  })
}

const httpServer = createServer(app)

const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
})

const rooms = new RoomManager(io)

io.on('connection', (socket) => {
  rooms.attachSocket(socket)
})

httpServer.listen(PORT, () => {
  console.log(`server listening on http://localhost:${PORT}`)
})
