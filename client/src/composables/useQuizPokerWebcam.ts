import { onUnmounted, ref, watch, type Ref } from 'vue'
import type { QuizPokerState, RoomSnapshot } from '../../../shared/protocol'
import { isQuizPokerState } from '../../../shared/protocol'
import { getSocket } from '../socket'

type Peer = {
  pc: RTCPeerConnection
}

export function useQuizPokerWebcam(snapshot: Ref<RoomSnapshot | null>, playerId: Ref<string>) {
  const localStream = ref<MediaStream | null>(null)
  const webcamOn = ref(false)
  const remoteStreams = ref<Map<string, MediaStream>>(new Map())
  const peers = new Map<string, Peer>()
  const seatVideos = new Map<string, HTMLVideoElement>()

  const socket = getSocket()

  function pokerState(): QuizPokerState | null {
    const snap = snapshot.value
    if (!snap || !isQuizPokerState(snap.type, snap.state)) return null
    return snap.state
  }

  function attachStreamToSeat(id: string, stream: MediaStream | null) {
    const el = seatVideos.get(id)
    if (el) el.srcObject = stream
  }

  function registerSeatVideo(id: string, el: HTMLVideoElement | null) {
    if (!el) {
      seatVideos.delete(id)
      return
    }
    seatVideos.set(id, el)
    if (id === playerId.value && localStream.value) {
      el.srcObject = localStream.value
    } else {
      const remote = remoteStreams.value.get(id)
      if (remote) el.srcObject = remote
    }
  }

  function iceServers(): RTCIceServer[] {
    const raw = import.meta.env.VITE_ICE_SERVERS as string | undefined
    if (raw) {
      try {
        return JSON.parse(raw) as RTCIceServer[]
      } catch {
        /* ignore */
      }
    }
    return [{ urls: 'stun:stun.l.google.com:19302' }]
  }

  function createPc(remoteId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: iceServers() })
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        socket.emit('quiz_poker:webrtc_signal', {
          toPlayerId: remoteId,
          signal: ev.candidate.toJSON(),
        })
      }
    }
    pc.ontrack = (ev) => {
      const stream = ev.streams[0]
      if (!stream) return
      remoteStreams.value.set(remoteId, stream)
      remoteStreams.value = new Map(remoteStreams.value)
      attachStreamToSeat(remoteId, stream)
    }
    // Allow receiving remote camera even before local camera is enabled.
    pc.addTransceiver('video', { direction: 'recvonly' })
    peers.set(remoteId, { pc })
    return pc
  }

  async function ensureLocalStream() {
    if (localStream.value) return localStream.value
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    localStream.value = stream
    attachStreamToSeat(playerId.value, stream)
    return stream
  }

  async function stopLocal() {
    localStream.value?.getTracks().forEach((t) => t.stop())
    localStream.value = null
    attachStreamToSeat(playerId.value, null)
    webcamOn.value = false
    socket.emit('quiz_poker:webcam', { enabled: false })
    for (const [, peer] of peers) peer.pc.close()
    peers.clear()
    remoteStreams.value.clear()
  }

  async function connectToPeers() {
    const snap = snapshot.value
    const st = pokerState()
    if (!snap) return

    for (const p of snap.players) {
      if (p.id === playerId.value) continue
      if (peers.has(p.id)) continue
      const ps = p.isHost ? null : st?.players[p.id]
      const remoteCameraOn = p.isHost ? false : Boolean(ps?.webcamEnabled)
      // Create mesh peers when either side has camera enabled so streams can propagate to everyone.
      if (!webcamOn.value && !remoteCameraOn) continue

      const pc = createPc(p.id)
      const stream = localStream.value
      if (stream) {
        stream.getTracks().forEach((t) => pc.addTrack(t, stream))
      }
      if (webcamOn.value || playerId.value < p.id) {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        socket.emit('quiz_poker:webrtc_signal', { toPlayerId: p.id, signal: offer })
      }
    }
  }

  async function toggleWebcam() {
    if (webcamOn.value) {
      await stopLocal()
      return
    }
    await ensureLocalStream()
    webcamOn.value = true
    socket.emit('quiz_poker:webcam', { enabled: true })
    await connectToPeers()
  }

  async function onSignal(fromPlayerId: string, signal: RTCSessionDescriptionInit | RTCIceCandidateInit) {
    let peer = peers.get(fromPlayerId)
    if (!peer) {
      createPc(fromPlayerId)
      peer = peers.get(fromPlayerId)!
      const stream = localStream.value
      if (stream) stream.getTracks().forEach((t) => peer!.pc.addTrack(t, stream))
    }
    const { pc } = peer

    if ('type' in signal && (signal.type === 'offer' || signal.type === 'answer')) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal))
      if (signal.type === 'offer') {
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        socket.emit('quiz_poker:webrtc_signal', { toPlayerId: fromPlayerId, signal: answer })
      }
    } else if ('candidate' in signal) {
      await pc.addIceCandidate(new RTCIceCandidate(signal))
    }
  }

  function onWebRtcSignal(payload: { fromPlayerId: string; signal: unknown }) {
    void onSignal(payload.fromPlayerId, payload.signal as RTCSessionDescriptionInit)
  }

  function hasVideo(id: string): boolean {
    if (id === playerId.value) return webcamOn.value
    return remoteStreams.value.has(id)
  }

  socket.on('quiz_poker:webrtc_signal', onWebRtcSignal)

  watch(
    () => snapshot.value?.version,
    () => {
      void connectToPeers()
    },
  )

  watch(remoteStreams, () => {
    for (const [id, stream] of remoteStreams.value) {
      attachStreamToSeat(id, stream)
    }
  })

  onUnmounted(() => {
    socket.off('quiz_poker:webrtc_signal', onWebRtcSignal)
    void stopLocal()
  })

  return {
    webcamOn,
    toggleWebcam,
    registerSeatVideo,
    hasVideo,
  }
}
