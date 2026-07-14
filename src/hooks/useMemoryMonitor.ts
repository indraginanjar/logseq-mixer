import { useCallback, useEffect, useRef, useState } from 'react';

export interface MemoryStatus {
  /** JS heap used in bytes (from performance.memory) */
  heapUsed: number;
  /** JS heap total in bytes */
  heapTotal: number;
  /** JS heap limit in bytes */
  heapLimit: number;
  /** Usage as percentage of heap limit (0-100) */
  usagePercent: number;
  /** Number of DOM nodes in the document */
  domNodeCount: number;
  /** Number of chat messages currently rendered */
  messageCount: number;
  /** Pressure level: 'low' | 'moderate' | 'high' | 'critical' */
  pressure: 'low' | 'moderate' | 'high' | 'critical';
  /** Whether performance.memory API is available */
  isSupported: boolean;
}

export interface MemoryMonitorOptions {
  /** Polling interval in ms (default: 5000) */
  interval?: number;
  /** Message count for the current conversation */
  messageCount?: number;
  /** Callback when pressure level changes */
  onPressureChange?: (pressure: MemoryStatus['pressure'], status: MemoryStatus) => void;
}

/**
 * Thresholds for memory pressure levels.
 * Logseq plugins run in an iframe with a shared process — lower thresholds
 * than a standalone app to leave room for Logseq itself.
 */
const THRESHOLDS = {
  /** % of heap limit */
  moderate: 50,
  high: 70,
  critical: 85,
  /** DOM node counts */
  domModerate: 5000,
  domHigh: 10000,
  domCritical: 20000,
  /** Message count thresholds */
  messageModerate: 30,
  messageHigh: 60,
  messageCritical: 100,
};

function getPressure(usagePercent: number, domCount: number, msgCount: number): MemoryStatus['pressure'] {
  if (
    usagePercent >= THRESHOLDS.critical ||
    domCount >= THRESHOLDS.domCritical ||
    msgCount >= THRESHOLDS.messageCritical
  ) {
    return 'critical';
  }
  if (
    usagePercent >= THRESHOLDS.high ||
    domCount >= THRESHOLDS.domHigh ||
    msgCount >= THRESHOLDS.messageHigh
  ) {
    return 'high';
  }
  if (
    usagePercent >= THRESHOLDS.moderate ||
    domCount >= THRESHOLDS.domModerate ||
    msgCount >= THRESHOLDS.messageModerate
  ) {
    return 'moderate';
  }
  return 'low';
}

function getMemoryInfo(): { heapUsed: number; heapTotal: number; heapLimit: number; isSupported: boolean } {
  // performance.memory is a non-standard Chrome/Electron extension
  const perf = performance as any;
  if (perf.memory) {
    return {
      heapUsed: perf.memory.usedJSHeapSize,
      heapTotal: perf.memory.totalJSHeapSize,
      heapLimit: perf.memory.jsHeapSizeLimit,
      isSupported: true,
    };
  }
  return { heapUsed: 0, heapTotal: 0, heapLimit: 0, isSupported: false };
}

export function useMemoryMonitor(options: MemoryMonitorOptions = {}): MemoryStatus {
  const { interval = 5000, messageCount = 0, onPressureChange } = options;
  const prevPressureRef = useRef<MemoryStatus['pressure']>('low');
  const onPressureChangeRef = useRef(onPressureChange);
  onPressureChangeRef.current = onPressureChange;

  const [status, setStatus] = useState<MemoryStatus>(() => {
    const mem = getMemoryInfo();
    return {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      heapLimit: mem.heapLimit,
      usagePercent: mem.heapLimit > 0 ? (mem.heapUsed / mem.heapLimit) * 100 : 0,
      domNodeCount: document.querySelectorAll('*').length,
      messageCount,
      pressure: 'low',
      isSupported: mem.isSupported,
    };
  });

  const measure = useCallback(() => {
    const mem = getMemoryInfo();
    const domNodeCount = document.querySelectorAll('*').length;
    const usagePercent = mem.heapLimit > 0 ? (mem.heapUsed / mem.heapLimit) * 100 : 0;
    const pressure = getPressure(usagePercent, domNodeCount, messageCount);

    const newStatus: MemoryStatus = {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      heapLimit: mem.heapLimit,
      usagePercent,
      domNodeCount,
      messageCount,
      pressure,
      isSupported: mem.isSupported,
    };

    setStatus(newStatus);

    if (pressure !== prevPressureRef.current) {
      prevPressureRef.current = pressure;
      onPressureChangeRef.current?.(pressure, newStatus);
    }
  }, [messageCount]);

  useEffect(() => {
    measure(); // initial measurement
    const id = setInterval(measure, interval);
    return () => clearInterval(id);
  }, [measure, interval]);

  return status;
}
