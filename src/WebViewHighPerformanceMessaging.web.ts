/**
 * High-Performance Messaging Utilities for WebView (Browser Side)
 *
 * This module provides the browser-side implementation for optimized
 * data transfer between React Native and WebView.
 *
 * Usage in WebView:
 * <script>
 *   // Import the utilities
 *   const { ChunkReassembler, splitIntoChunks, MessageBatcher } = window.ReactNativeWebViewHighPerf;
 *
 *   // Setup chunk reassembler
 *   const reassembler = new ChunkReassembler();
 *
 *   // Handle incoming messages
 *   window.addEventListener('message', (event) => {
 *     const message = JSON.parse(event.data);
 *     if (message.type === 'chunk') {
 *       const completeData = reassembler.addChunk(message);
 *       if (completeData) {
 *         // Process complete data
 *         const data = JSON.parse(completeData);
 *         console.log('Received large payload:', data);
 *       }
 *     }
 *   });
 *
 *   // Send large data back to React Native
 *   const largeData = { ... }; // 100MB data
 *   const chunks = splitIntoChunks(largeData);
 *   chunks.forEach(chunk => {
 *     window.ReactNativeWebView.postMessage(JSON.stringify(chunk));
 *   });
 * </script>
 */

export interface ChunkedMessageMetadata {
  id: string;
  totalChunks: number;
  chunkIndex: number;
  chunkSize: number;
  originalSize: number;
  isCompressed?: boolean;
}

export interface ChunkedMessage {
  type: 'chunk';
  metadata: ChunkedMessageMetadata;
  data: string;
}

export interface CompleteMessage {
  type: 'complete';
  id: string;
  data: string;
}

export type HighPerformanceMessage = ChunkedMessage | CompleteMessage;

export const DEFAULT_CHUNK_SIZE = 1024 * 1024; // 1MB

/**
 * Browser-compatible chunk splitter
 */
export function splitIntoChunks(
  data: string | object,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  compress: boolean = false
): ChunkedMessage[] {
  const dataString = typeof data === 'string' ? data : JSON.stringify(data);
  const messageId = generateMessageId();
  const chunks: ChunkedMessage[] = [];
  const totalChunks = Math.ceil(dataString.length / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, dataString.length);
    const chunk = dataString.substring(start, end);

    chunks.push({
      type: 'chunk',
      metadata: {
        id: messageId,
        totalChunks,
        chunkIndex: i,
        chunkSize: chunk.length,
        originalSize: dataString.length,
        isCompressed: compress,
      },
      data: chunk,
    });
  }

  return chunks;
}

/**
 * Browser-compatible chunk reassembler
 */
export class ChunkReassembler {
  private chunks: Map<string, Map<number, string>> = new Map();
  private metadata: Map<string, ChunkedMessageMetadata> = new Map();

  addChunk(message: ChunkedMessage): string | null {
    const { id, chunkIndex, totalChunks } = message.metadata;

    if (!this.chunks.has(id)) {
      this.chunks.set(id, new Map());
      this.metadata.set(id, message.metadata);
    }

    const messageChunks = this.chunks.get(id)!;
    messageChunks.set(chunkIndex, message.data);

    if (messageChunks.size === totalChunks) {
      const parts: string[] = [];
      for (let i = 0; i < totalChunks; i++) {
        parts.push(messageChunks.get(i)!);
      }

      this.chunks.delete(id);
      this.metadata.delete(id);

      return parts.join('');
    }

    return null;
  }

  getProgress(messageId: string): number {
    const messageChunks = this.chunks.get(messageId);
    const meta = this.metadata.get(messageId);

    if (!messageChunks || !meta) {
      return 0;
    }

    return messageChunks.size / meta.totalChunks;
  }

  clear(messageId?: string): void {
    if (messageId) {
      this.chunks.delete(messageId);
      this.metadata.delete(messageId);
    } else {
      this.chunks.clear();
      this.metadata.clear();
    }
  }
}

/**
 * Browser-compatible message batcher
 */
export class MessageBatcher {
  private batch: string[] = [];
  private batchSize: number;
  private flushCallback: (messages: string[]) => void;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private flushDelay: number;

  constructor(
    flushCallback: (messages: string[]) => void,
    batchSize: number = 10,
    flushDelay: number = 16
  ) {
    this.flushCallback = flushCallback;
    this.batchSize = batchSize;
    this.flushDelay = flushDelay;
  }

  add(message: string): void {
    this.batch.push(message);

    if (this.batch.length >= this.batchSize) {
      this.flush();
      return;
    }

    if (this.timeoutId === null) {
      this.timeoutId = setTimeout(() => {
        this.flush();
      }, this.flushDelay) as any;
    }
  }

  flush(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId as any);
      this.timeoutId = null;
    }

    if (this.batch.length > 0) {
      this.flushCallback([...this.batch]);
      this.batch = [];
    }
  }

  clear(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId as any);
      this.timeoutId = null;
    }
    this.batch = [];
  }
}

function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Browser-compatible binary utilities
 */
export function binaryToBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = '';
  const chunkSize = 8192;

  // Process in chunks to avoid stack overflow
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }

  return binary; // Browser will use btoa when this is injected into WebView
}

export function base64ToBinary(base64: string): Uint8Array {
  const bytes = new Uint8Array(base64.length);
  for (let i = 0; i < base64.length; i++) {
    bytes[i] = base64.charCodeAt(i);
  }
  return bytes;
}

/**
 * Browser-compatible performance monitor
 */
export class PerformanceMonitor {
  private metrics: Map<string, { start: number; end?: number; size?: number }> =
    new Map();

  start(label: string, size?: number): void {
    this.metrics.set(label, { start: Date.now(), size });
  }

  end(label: string): number | null {
    const metric = this.metrics.get(label);
    if (!metric) {
      return null;
    }

    metric.end = Date.now();
    const duration = metric.end - metric.start;

    if (metric.size) {
      const throughput = metric.size / duration;
      console.log(
        `[PerformanceMonitor] ${label}: ${duration.toFixed(2)}ms, ` +
          `${(metric.size / 1024 / 1024).toFixed(2)}MB, ` +
          `${(throughput / 1024).toFixed(2)}MB/s`
      );
    } else {
      console.log(`[PerformanceMonitor] ${label}: ${duration.toFixed(2)}ms`);
    }

    return duration;
  }

  clear(): void {
    this.metrics.clear();
  }
}

// Expose utilities globally for use in WebView
declare const window: any;
if (typeof window !== 'undefined') {
  window.ReactNativeWebViewHighPerf = {
    ChunkReassembler,
    splitIntoChunks,
    MessageBatcher,
    binaryToBase64,
    base64ToBinary,
    PerformanceMonitor,
    DEFAULT_CHUNK_SIZE,
  };
}

/**
 * Generates the initialization script to inject into WebView
 */
export function generateWebViewScript(): string {
  // This will be the minified version of all the utilities
  // For now, we'll inline the code
  return `
(function() {
  'use strict';
  
  var DEFAULT_CHUNK_SIZE = 1048576; // 1MB
  
  function generateMessageId() {
    return Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }
  
  function splitIntoChunks(data, chunkSize, compress) {
    chunkSize = chunkSize || DEFAULT_CHUNK_SIZE;
    compress = compress || false;
    
    var dataString = typeof data === 'string' ? data : JSON.stringify(data);
    var messageId = generateMessageId();
    var chunks = [];
    var totalChunks = Math.ceil(dataString.length / chunkSize);
    
    for (var i = 0; i < totalChunks; i++) {
      var start = i * chunkSize;
      var end = Math.min(start + chunkSize, dataString.length);
      var chunk = dataString.substring(start, end);
      
      chunks.push({
        type: 'chunk',
        metadata: {
          id: messageId,
          totalChunks: totalChunks,
          chunkIndex: i,
          chunkSize: chunk.length,
          originalSize: dataString.length,
          isCompressed: compress
        },
        data: chunk
      });
    }
    
    return chunks;
  }
  
  function ChunkReassembler() {
    this.chunks = new Map();
    this.metadata = new Map();
  }
  
  ChunkReassembler.prototype.addChunk = function(message) {
    var id = message.metadata.id;
    var chunkIndex = message.metadata.chunkIndex;
    var totalChunks = message.metadata.totalChunks;
    
    if (!this.chunks.has(id)) {
      this.chunks.set(id, new Map());
      this.metadata.set(id, message.metadata);
    }
    
    var messageChunks = this.chunks.get(id);
    messageChunks.set(chunkIndex, message.data);
    
    if (messageChunks.size === totalChunks) {
      var parts = [];
      for (var i = 0; i < totalChunks; i++) {
        parts.push(messageChunks.get(i));
      }
      
      this.chunks.delete(id);
      this.metadata.delete(id);
      
      return parts.join('');
    }
    
    return null;
  };
  
  ChunkReassembler.prototype.getProgress = function(messageId) {
    var messageChunks = this.chunks.get(messageId);
    var meta = this.metadata.get(messageId);
    
    if (!messageChunks || !meta) {
      return 0;
    }
    
    return messageChunks.size / meta.totalChunks;
  };
  
  ChunkReassembler.prototype.clear = function(messageId) {
    if (messageId) {
      this.chunks.delete(messageId);
      this.metadata.delete(messageId);
    } else {
      this.chunks.clear();
      this.metadata.clear();
    }
  };
  
  function MessageBatcher(flushCallback, batchSize, flushDelay) {
    this.batch = [];
    this.flushCallback = flushCallback;
    this.batchSize = batchSize || 10;
    this.flushDelay = flushDelay || 16;
    this.timeoutId = null;
  }
  
  MessageBatcher.prototype.add = function(message) {
    this.batch.push(message);
    
    if (this.batch.length >= this.batchSize) {
      this.flush();
      return;
    }
    
    if (this.timeoutId === null) {
      var self = this;
      this.timeoutId = setTimeout(function() {
        self.flush();
      }, this.flushDelay);
    }
  };
  
  MessageBatcher.prototype.flush = function() {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    
    if (this.batch.length > 0) {
      this.flushCallback(this.batch.slice());
      this.batch = [];
    }
  };
  
  MessageBatcher.prototype.clear = function() {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.batch = [];
  };
  
  function binaryToBase64(data) {
    var bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    var binary = '';
    for (var i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  
  function base64ToBinary(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  
  function PerformanceMonitor() {
    this.metrics = new Map();
  }
  
  PerformanceMonitor.prototype.start = function(label, size) {
    this.metrics.set(label, { start: performance.now(), size: size });
  };
  
  PerformanceMonitor.prototype.end = function(label) {
    var metric = this.metrics.get(label);
    if (!metric) {
      return null;
    }
    
    metric.end = performance.now();
    var duration = metric.end - metric.start;
    
    if (metric.size) {
      var throughput = metric.size / duration;
      console.log(
        '[PerformanceMonitor] ' + label + ': ' + duration.toFixed(2) + 'ms, ' +
        (metric.size / 1024 / 1024).toFixed(2) + 'MB, ' +
        (throughput / 1024).toFixed(2) + 'MB/s'
      );
    } else {
      console.log('[PerformanceMonitor] ' + label + ': ' + duration.toFixed(2) + 'ms');
    }
    
    return duration;
  };
  
  PerformanceMonitor.prototype.clear = function() {
    this.metrics.clear();
  };
  
  // Expose utilities globally
  window.ReactNativeWebViewHighPerf = {
    ChunkReassembler: ChunkReassembler,
    splitIntoChunks: splitIntoChunks,
    MessageBatcher: MessageBatcher,
    binaryToBase64: binaryToBase64,
    base64ToBinary: base64ToBinary,
    PerformanceMonitor: PerformanceMonitor,
    DEFAULT_CHUNK_SIZE: DEFAULT_CHUNK_SIZE
  };
})();
`;
}
