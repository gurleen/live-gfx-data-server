import { useState, useEffect, useRef, useCallback } from 'react';

// Message types for WebSocket communication
interface SubscribeMessage {
  action: 'subscribe';
  key: string;
}

interface UnsubscribeMessage {
  action: 'unsubscribe';
  key: string;
}

interface SetMessage<T> {
  action: 'set';
  key: string;
  value: T;
}

interface GetMessage {
  action: 'get';
  key: string;
}

type ClientMessage<T> = SubscribeMessage | UnsubscribeMessage | SetMessage<T> | GetMessage;

interface ServerMessage<T> {
  key: string;
  value: T;
}

interface ErrorMessage {
  error: string;
}

// Hook options
interface UseObjectStoreOptions {
  autoReconnect?: boolean;
  reconnectInterval?: number;
}

// Hook return type
interface ObjectStoreData<T> {
  data: Record<string, T>;
  isConnected: boolean;
  subscribe: (key: string) => void;
  unsubscribe: (key: string) => void;
  set: (key: string, value: T) => void;
  get: (key: string) => void;
}

/**
 * React hook for connecting to the object store WebSocket server
 *
 * @param url - WebSocket URL (e.g., 'ws://localhost:3000/ws')
 * @param options - Configuration options
 * @returns Object store interface with data and methods
 *
 * @example
 * ```tsx
 * interface Position { x: number; y: number }
 *
 * const { data, isConnected, subscribe, set } = useObjectStore<Position>('ws://localhost:3000/ws')
 *
 * useEffect(() => {
 *   subscribe('player-position')
 * }, [subscribe])
 *
 * const position = data['player-position'] // Type: Position | undefined
 * ```
 */
export function useObjectStore<T = any>(
  url: string,
  options: UseObjectStoreOptions = {}
): ObjectStoreData<T> {
  const {
    autoReconnect = true,
    reconnectInterval = 3000,
  } = options;

  const [data, setData] = useState<Record<string, T>>({});
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const subscriptionsRef = useRef<Set<string>>(new Set());

  // Send a message to the WebSocket server
  const sendMessage = useCallback((message: ClientMessage<T>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Subscribe to a key
  const subscribe = useCallback((key: string) => {
    subscriptionsRef.current.add(key);
    sendMessage({ action: 'subscribe', key });
  }, [sendMessage]);

  // Unsubscribe from a key
  const unsubscribe = useCallback((key: string) => {
    subscriptionsRef.current.delete(key);
    sendMessage({ action: 'unsubscribe', key });
  }, [sendMessage]);

  // Set a value for a key
  const set = useCallback((key: string, value: T) => {
    sendMessage({ action: 'set', key, value });
  }, [sendMessage]);

  // Get the current value for a key
  const get = useCallback((key: string) => {
    sendMessage({ action: 'get', key });
  }, [sendMessage]);

  // Connect to WebSocket server
  const connect = useCallback(() => {
    // Clear any existing reconnect timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(url);

    ws.onopen = () => {
      setIsConnected(true);

      // Re-subscribe to all previously subscribed keys
      subscriptionsRef.current.forEach((key) => {
        ws.send(JSON.stringify({ action: 'subscribe', key }));
      });
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage<T> | ErrorMessage;

        if ('error' in message) {
          console.error('Object store error:', message.error);
        } else {
          setData((prev) => ({
            ...prev,
            [message.key]: message.value,
          }));
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      setIsConnected(false);
      wsRef.current = null;

      // Attempt to reconnect if enabled
      if (autoReconnect) {
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, reconnectInterval);
      }
    };

    wsRef.current = ws;
  }, [url, autoReconnect, reconnectInterval]);

  // Connect on mount and handle cleanup on unmount
  useEffect(() => {
    connect();

    return () => {
      // Clear reconnect timer
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }

      // Close WebSocket connection
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    data,
    isConnected,
    subscribe,
    unsubscribe,
    set,
    get,
  };
}
