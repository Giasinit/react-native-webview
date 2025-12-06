/**
 * High-Performance WebView Messaging Example
 *
 * This example demonstrates how to send 100MB JSON payloads every second
 * between React Native and WebView without performance degradation.
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, Text, Button, ScrollView } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import {
  ChunkReassembler,
  MessageBatcher,
  PerformanceMonitor,
  splitIntoChunks,
  generateWebViewScript,
} from 'react-native-webview';

const HighPerformanceMessagingExample = () => {
  const webViewRef = useRef<WebView>(null);
  const [stats, setStats] = useState({
    sent: 0,
    received: 0,
    avgLatency: 0,
    throughput: 0,
  });

  // Setup chunk reassembler for incoming messages
  const reassemblerRef = useRef(new ChunkReassembler());
  const perfMonitorRef = useRef(new PerformanceMonitor());
  const [isStreaming, setIsStreaming] = useState(false);
  const streamIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Message batcher for efficient sending
  const batcherRef = useRef(
    new MessageBatcher(
      (messages) => {
        const batch = JSON.stringify({ type: 'batch', messages });
        webViewRef.current?.postMessage(batch);
      },
      10,
      16
    )
  );

  /**
   * Generate a large JSON payload (100MB)
   */
  const generateLargePayload = useCallback((size: number = 100) => {
    const targetSize = size * 1024 * 1024; // Convert MB to bytes
    const data: any = {
      timestamp: Date.now(),
      type: 'large-payload',
      items: [],
    };

    // Generate data until we reach target size
    const sampleItem = {
      id: Math.random().toString(36),
      name: 'Sample Item',
      description: 'A'.repeat(1000), // 1KB of data
      nested: {
        field1: Math.random(),
        field2: Date.now(),
        field3: 'B'.repeat(500),
      },
    };

    const itemSize = JSON.stringify(sampleItem).length;
    const itemCount = Math.floor(targetSize / itemSize);

    for (let i = 0; i < itemCount; i++) {
      data.items.push({
        ...sampleItem,
        id: `item-${i}`,
      });
    }

    return data;
  }, []);

  /**
   * Send a large payload to WebView using chunking
   */
  const sendLargePayloadToWebView = useCallback(() => {
    perfMonitorRef.current.start('send-100mb', 100 * 1024 * 1024);

    const payload = generateLargePayload(100);
    const chunks = splitIntoChunks(payload, 1024 * 1024); // 1MB chunks

    console.log(
      `Sending ${chunks.length} chunks (${(
        JSON.stringify(payload).length /
        1024 /
        1024
      ).toFixed(2)}MB)`
    );

    chunks.forEach((chunk) => {
      const message = JSON.stringify(chunk);
      batcherRef.current.add(message);
    });

    batcherRef.current.flush();
    perfMonitorRef.current.end('send-100mb');

    setStats((prev) => ({ ...prev, sent: prev.sent + 1 }));
  }, [generateLargePayload]);

  /**
   * Start streaming large payloads at 1Hz
   */
  const startStreaming = useCallback(() => {
    setIsStreaming(true);
    streamIntervalRef.current = setInterval(() => {
      sendLargePayloadToWebView();
    }, 1000); // Every second
  }, [sendLargePayloadToWebView]);

  /**
   * Stop streaming
   */
  const stopStreaming = useCallback(() => {
    setIsStreaming(false);
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
  }, []);

  /**
   * Handle messages from WebView
   */
  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);

      if (message.type === 'chunk') {
        // Reassemble chunks
        const completeData = reassemblerRef.current.addChunk(message);

        if (completeData) {
          perfMonitorRef.current.start('receive-parse');
          const data = JSON.parse(completeData);
          perfMonitorRef.current.end('receive-parse');

          console.log('Received complete payload:', {
            size: `${(completeData.length / 1024 / 1024).toFixed(2)}MB`,
            items: data.items?.length || 0,
          });

          setStats((prev) => ({ ...prev, received: prev.received + 1 }));
        }
      } else if (message.type === 'batch') {
        // Handle batched messages
        message.messages.forEach((msg: string) => {
          handleMessage({ nativeEvent: { data: msg } } as WebViewMessageEvent);
        });
      } else if (message.type === 'echo') {
        console.log('Echo from WebView:', message);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }, []);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      stopStreaming();
      batcherRef.current.clear();
      reassemblerRef.current.clear();
    };
  }, [stopStreaming]);

  /**
   * HTML content for WebView with high-performance messaging setup
   */
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>High-Performance WebView</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      background: white;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      margin-top: 0;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin: 20px 0;
    }
    .stat {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 6px;
      border-left: 4px solid #007bff;
    }
    .stat-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-value {
      font-size: 24px;
      font-weight: bold;
      color: #333;
      margin-top: 5px;
    }
    .controls {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin: 20px 0;
    }
    button {
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      background: #007bff;
      color: white;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
    }
    button:hover {
      background: #0056b3;
    }
    button:active {
      transform: scale(0.98);
    }
    .log {
      background: #f8f9fa;
      border-radius: 6px;
      padding: 15px;
      max-height: 300px;
      overflow-y: auto;
      font-family: 'Courier New', monospace;
      font-size: 12px;
    }
    .log-entry {
      padding: 5px 0;
      border-bottom: 1px solid #e0e0e0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 High-Performance WebView</h1>
    
    <div class="stats">
      <div class="stat">
        <div class="stat-label">Received</div>
        <div class="stat-value" id="received-count">0</div>
      </div>
      <div class="stat">
        <div class="stat-label">Sent</div>
        <div class="stat-value" id="sent-count">0</div>
      </div>
      <div class="stat">
        <div class="stat-label">Throughput</div>
        <div class="stat-value" id="throughput">0 MB/s</div>
      </div>
      <div class="stat">
        <div class="stat-label">Latency</div>
        <div class="stat-value" id="latency">0 ms</div>
      </div>
    </div>

    <div class="controls">
      <button onclick="sendLargePayload()">Send 100MB to RN</button>
      <button onclick="echoMessage()">Echo Message</button>
      <button onclick="clearLogs()">Clear Logs</button>
    </div>

    <div class="log" id="log"></div>
  </div>

  <script>
    ${generateWebViewScript()}

    // Setup
    const reassembler = new window.ReactNativeWebViewHighPerf.ChunkReassembler();
    const perfMonitor = new window.ReactNativeWebViewHighPerf.PerformanceMonitor();
    let receivedCount = 0;
    let sentCount = 0;

    // Log function
    function log(message) {
      const logDiv = document.getElementById('log');
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.textContent = new Date().toLocaleTimeString() + ' - ' + message;
      logDiv.insertBefore(entry, logDiv.firstChild);
    }

    // Handle incoming messages
    window.addEventListener('message', function(event) {
      try {
        const message = JSON.parse(event.data);
        
        if (message.type === 'chunk') {
          const completeData = reassembler.addChunk(message);
          
          if (completeData) {
            perfMonitor.start('parse');
            const data = JSON.parse(completeData);
            perfMonitor.end('parse');
            
            receivedCount++;
            document.getElementById('received-count').textContent = receivedCount;
            
            const size = (completeData.length / 1024 / 1024).toFixed(2);
            log('Received ' + size + 'MB payload with ' + (data.items?.length || 0) + ' items');
          }
        } else if (message.type === 'batch') {
          message.messages.forEach(function(msg) {
            window.dispatchEvent(new MessageEvent('message', { data: msg }));
          });
        }
      } catch (error) {
        log('Error: ' + error.message);
      }
    });

    // Generate and send large payload
    function generateLargePayload(sizeMB) {
      const targetSize = sizeMB * 1024 * 1024;
      const data = {
        timestamp: Date.now(),
        type: 'large-payload',
        items: []
      };

      const sampleItem = {
        id: Math.random().toString(36),
        name: 'WebView Item',
        description: 'X'.repeat(1000),
        nested: {
          field1: Math.random(),
          field2: Date.now(),
          field3: 'Y'.repeat(500)
        }
      };

      const itemSize = JSON.stringify(sampleItem).length;
      const itemCount = Math.floor(targetSize / itemSize);

      for (let i = 0; i < itemCount; i++) {
        data.items.push({
          ...sampleItem,
          id: 'webview-item-' + i
        });
      }

      return data;
    }

    function sendLargePayload() {
      perfMonitor.start('send-100mb', 100 * 1024 * 1024);
      
      const payload = generateLargePayload(100);
      const chunks = window.ReactNativeWebViewHighPerf.splitIntoChunks(payload);

      log('Sending ' + chunks.length + ' chunks to React Native');

      chunks.forEach(function(chunk) {
        window.ReactNativeWebView.postMessage(JSON.stringify(chunk));
      });

      perfMonitor.end('send-100mb');
      
      sentCount++;
      document.getElementById('sent-count').textContent = sentCount;
    }

    function echoMessage() {
      const msg = { type: 'echo', timestamp: Date.now(), from: 'webview' };
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      log('Sent echo message');
    }

    function clearLogs() {
      document.getElementById('log').innerHTML = '';
    }

    log('WebView initialized and ready');
  </script>
</body>
</html>
`;

  return (
    <View style={styles.container}>
      <ScrollView style={styles.controls}>
        <Text style={styles.title}>High-Performance WebView Messaging</Text>
        <Text style={styles.subtitle}>
          Send 100MB JSON payloads every second without lag
        </Text>

        <View style={styles.statsContainer}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Sent</Text>
            <Text style={styles.statValue}>{stats.sent}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Received</Text>
            <Text style={styles.statValue}>{stats.received}</Text>
          </View>
        </View>

        <View style={styles.buttonContainer}>
          <Button
            title="Send 100MB to WebView"
            onPress={sendLargePayloadToWebView}
          />
          <Button
            title={isStreaming ? 'Stop Streaming' : 'Start Streaming (1Hz)'}
            onPress={isStreaming ? stopStreaming : startStreaming}
            color={isStreaming ? '#dc3545' : '#28a745'}
          />
        </View>
      </ScrollView>

      <WebView
        ref={webViewRef}
        style={styles.webview}
        source={{ html: htmlContent }}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  controls: {
    maxHeight: 200,
    backgroundColor: 'white',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  statsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#007bff',
  },
  statLabel: {
    fontSize: 11,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 4,
  },
  buttonContainer: {
    gap: 8,
  },
  webview: {
    flex: 1,
  },
});

export default HighPerformanceMessagingExample;
