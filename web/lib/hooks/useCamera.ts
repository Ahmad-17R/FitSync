'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'error';

export interface CameraError {
  status: 'denied' | 'error';
  /** What happened and what to do about it, in the interface's voice. */
  message: string;
  /** Whether asking again could plausibly succeed. */
  retryable: boolean;
}

/**
 * getUserMedia lifecycle for the live session.
 *
 * Failure messages are named rather than generic: "camera error, try again"
 * gives someone whose camera is held by another tab nothing to act on. Each
 * DOMException maps to the specific recovery that actually works.
 */
export function useCamera(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<CameraError | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
    setStatus('idle');
  }, [videoRef]);

  const start = useCallback(async () => {
    setError(null);
    setStatus('requesting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      // React strict mode double-mounts in development, firing two
      // getUserMedia calls. If a stream already landed, drop this duplicate
      // rather than overwriting srcObject and aborting the in-flight play().
      if (streamRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        if (mountedRef.current) setStatus('ready');
        return;
      }

      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch (playErr) {
          // play() rejects with AbortError when the element re-renders or the
          // stream is swapped mid-flight. The video still plays — not a real
          // camera failure.
          if ((playErr as Error).name !== 'AbortError') throw playErr;
        }
      }
      if (mountedRef.current) setStatus('ready');
    } catch (err) {
      const e = err as DOMException;
      if (!mountedRef.current) return;

      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
        setStatus('denied');
        setError({
          status: 'denied',
          message:
            'FitSync needs the camera to see your pose. Allow camera access from the icon in your browser’s address bar, then start the session again.',
          retryable: true,
        });
      } else if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') {
        setStatus('error');
        setError({
          status: 'error',
          message:
            'No camera found on this device. Connect one, or open FitSync on a phone or laptop with a built-in camera.',
          retryable: true,
        });
      } else if (e.name === 'NotReadableError') {
        setStatus('error');
        setError({
          status: 'error',
          message:
            'Another app or tab is using the camera. Close it, then start the session again.',
          retryable: true,
        });
      } else {
        setStatus('error');
        setError({
          status: 'error',
          message:
            'The camera could not start. Check that your browser is allowed to use it, then try again.',
          retryable: true,
        });
      }
    }
  }, [videoRef]);

  useEffect(() => stop, [stop]);

  return { status, error, start, stop, isReady: status === 'ready' };
}
