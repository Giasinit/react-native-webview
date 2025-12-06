import WebView from './WebView';

export { WebView };
export default WebView;

// High-performance messaging utilities
export {
  ChunkReassembler,
  MessageBatcher,
  PerformanceMonitor,
  splitIntoChunks,
  binaryToBase64,
  base64ToBinary,
  DEFAULT_CHUNK_SIZE,
} from './WebViewHighPerformanceMessaging';

export type {
  ChunkedMessage,
  ChunkedMessageMetadata,
  CompleteMessage,
  HighPerformanceMessage,
} from './WebViewHighPerformanceMessaging';

// Web-side utilities for injection
export { generateWebViewScript } from './WebViewHighPerformanceMessaging.web';
