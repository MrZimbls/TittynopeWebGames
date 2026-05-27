import 'socket.io'

declare module 'socket.io' {
  interface SocketData {
    roomCode?: string
    playerId?: string
  }
}
