'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { config } from '@/lib/config';
import type { PoseLandmark, YogaFrame, YogaResponse } from '@/lib/contracts/yoga';

/**
 * `offline` is terminal: every reconnect attempt was spent. It is distinct
 * from `reconnecting` because the UI says different things — one asks the user
 * to wait, the other offers a button.
 */
export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline';

interface UseYogaWebSocketOptions {
  clientId?: string;
  enabled?: boolean;
  initialPose?: string;
  onMessage?: (response: YogaResponse) => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_QUEUED_FRAMES = 5;

/** The backend rejects a client_id that does not match this, closing with 1008. */
const CLIENT_ID_RE = /^[A-Za-z0-9_.:-]+$/;

function makeClientId(): string {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `fitsync_${raw}`.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80);
}

/**
 * WebSocket client for the yoga pipeline.
 *
 * Connects to /api/ws/yoga/{clientId} and tags every frame with the current
 * target pose. The guided-flow controller advances a sequence simply by
 * calling setPose — the backend starts a fresh hold whenever the label changes,
 * so there is no separate handshake.
 *
 * The pose lives in a ref, not state: it is read inside the detection loop at
 * 12fps, and putting it in state would re-create sendLandmarks on every pose
 * change and restart the loop.
 */
export function useYogaWebSocket({
  clientId: externalClientId,
  enabled = true,
  initialPose,
  onMessage,
}: UseYogaWebSocketOptions = {}) {
  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [lastResponse, setLastResponse] = useState<YogaResponse | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectingRef = useRef(false);
  const mountedRef = useRef(true);
  const enabledRef = useRef(enabled);
  const pendingRef = useRef<string[]>([]);
  const poseRef = useRef<string>(initialPose ?? '');
  const connectRef = useRef<() => void>(() => {});

  const [clientId] = useState(() => {
    const candidate = externalClientId ?? makeClientId();
    return CLIENT_ID_RE.test(candidate) ? candidate : makeClientId();
  });
  const clientIdRef = useRef(clientId);

  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  /** Set/switch the target pose. Covers manual selection and flow steps. */
  const setPose = useCallback((pose: string) => {
    poseRef.current = pose;
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    connectingRef.current = false;
    reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnection('idle');
  }, []);

  const connect = useCallback(() => {
    if (connectingRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    connectingRef.current = true;
    // A first attempt is "connecting"; anything after a drop is "reconnecting",
    // which the UI phrases differently.
    setConnection(reconnectAttemptsRef.current === 0 ? 'connecting' : 'reconnecting');

    try {
      const url = `${config.api.wsUrl}${config.api.endpoints.wsYoga}/${clientIdRef.current}`;
      const ws = new WebSocket(url);

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close();
          return;
        }
        connectingRef.current = false;
        reconnectAttemptsRef.current = 0;
        setConnection('connected');

        while (pendingRef.current.length > 0) {
          const msg = pendingRef.current.shift();
          if (msg) ws.send(msg);
        }
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const response = JSON.parse(event.data) as YogaResponse;
          setLastResponse(response);
          onMessageRef.current?.(response);
        } catch {
          // Malformed frame — ignore rather than tearing down the socket.
        }
      };

      ws.onerror = () => {
        // onclose always follows; reconnect logic lives there so it runs once.
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        connectingRef.current = false;
        wsRef.current = null;

        if (!enabledRef.current) {
          setConnection('idle');
          return;
        }

        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current += 1;
          setConnection('reconnecting');
          // Exponential backoff, capped. Render's free tier can take 30-60s to
          // wake, so the cap needs to be generous enough to outlast a cold start.
          const backoff = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 15000);
          reconnectTimerRef.current = setTimeout(() => {
            if (enabledRef.current && mountedRef.current) connectRef.current();
          }, backoff);
        } else {
          setConnection('offline');
        }
      };

      wsRef.current = ws;
    } catch {
      connectingRef.current = false;
      setConnection('offline');
    }
  }, []);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  /** Manual retry from the offline UI. Resets the attempt budget. */
  const retry = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    connect();
  }, [connect]);

  const sendLandmarks = useCallback((landmarks: PoseLandmark[], timestamp?: number) => {
    if (!landmarks.length || !poseRef.current) return;

    const frame: YogaFrame = {
      landmarks: landmarks.map((lm) => ({
        x: lm.x,
        y: lm.y,
        z: lm.z,
        visibility: lm.visibility,
      })),
      pose: poseRef.current,
      timestamp: timestamp ?? performance.now(),
    };

    const message = JSON.stringify(frame);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(message);
    } else {
      // Keep only the most recent frames. A stale pose from ten seconds ago is
      // worse than no frame at all — it would be evaluated as if it were now.
      pendingRef.current.push(message);
      if (pendingRef.current.length > MAX_QUEUED_FRAMES) pendingRef.current.shift();
    }
  }, []);

  /** Restart the hold on the backend without changing the selected pose. */
  const resetSession = useCallback(async () => {
    try {
      await fetch(
        `${config.api.baseUrl}${config.api.endpoints.resetYoga}/${clientIdRef.current}`,
        { method: 'POST' }
      );
      setLastResponse(null);
    } catch {
      // The socket is the source of truth; a failed reset is not worth
      // surfacing, the next frame reports real state anyway.
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      connectingRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }
  }, [enabled, connect, disconnect]);

  return {
    connection,
    isConnected: connection === 'connected',
    lastResponse,
    sendLandmarks,
    setPose,
    resetSession,
    retry,
    disconnect,
    clientId,
  };
}
