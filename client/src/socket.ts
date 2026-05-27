import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null

export function getSocket(): Socket {
  /** Same host in production (static + API on one service); override with VITE_SERVER_URL if split. */
  const url = import.meta.env.VITE_SERVER_URL
    ? import.meta.env.VITE_SERVER_URL
    : import.meta.env.DEV
      ? 'http://localhost:3000'
      : undefined
  if (!socket) {
    socket = io(url, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
    })
  }
  return socket
}
