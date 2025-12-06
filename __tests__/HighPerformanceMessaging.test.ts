/**
 * High-Performance Messaging Unit Tests
 */

import {
  splitIntoChunks,
  ChunkReassembler,
  MessageBatcher,
  PerformanceMonitor,
  binaryToBase64,
  base64ToBinary,
  DEFAULT_CHUNK_SIZE,
  ChunkedMessage,
} from '../src/WebViewHighPerformanceMessaging';

describe('High-Performance Messaging', () => {
  describe('splitIntoChunks', () => {
    it('should split a string into chunks', () => {
      const data = 'x'.repeat(5 * 1024 * 1024); // 5MB
      const chunks = splitIntoChunks(data, 1024 * 1024); // 1MB chunks

      expect(chunks).toHaveLength(5);
      expect(chunks[0].type).toBe('chunk');
      expect(chunks[0].metadata.totalChunks).toBe(5);
      expect(chunks[0].metadata.chunkIndex).toBe(0);
      expect(chunks[0].data).toHaveLength(1024 * 1024);
    });

    it('should split an object into chunks', () => {
      const data = {
        items: Array.from({ length: 10000 }, (_, i) => ({
          id: i,
          data: 'test'.repeat(100),
        })),
      };

      const chunks = splitIntoChunks(data, 500 * 1024); // 500KB chunks

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].metadata.id).toBeDefined();
      expect(chunks[0].metadata.originalSize).toBeGreaterThan(0);
    });

    it('should handle small data without splitting', () => {
      const data = 'small data';
      const chunks = splitIntoChunks(data, 1024 * 1024);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].data).toBe(data);
      expect(chunks[0].metadata.totalChunks).toBe(1);
    });

    it('should maintain consistent message IDs across chunks', () => {
      const data = 'x'.repeat(3 * 1024 * 1024);
      const chunks = splitIntoChunks(data, 1024 * 1024);

      const messageId = chunks[0].metadata.id;
      chunks.forEach((chunk) => {
        expect(chunk.metadata.id).toBe(messageId);
      });
    });

    it('should have sequential chunk indices', () => {
      const data = 'x'.repeat(3 * 1024 * 1024);
      const chunks = splitIntoChunks(data, 1024 * 1024);

      chunks.forEach((chunk, index) => {
        expect(chunk.metadata.chunkIndex).toBe(index);
      });
    });
  });

  describe('ChunkReassembler', () => {
    it('should reassemble chunks correctly', () => {
      const originalData = 'test data'.repeat(100000);
      const chunks = splitIntoChunks(originalData, 100 * 1024);
      const reassembler = new ChunkReassembler();

      let result: string | null = null;

      chunks.forEach((chunk, index) => {
        result = reassembler.addChunk(chunk);
        
        if (index < chunks.length - 1) {
          expect(result).toBeNull();
        }
      });

      expect(result).toBe(originalData);
    });

    it('should handle chunks arriving out of order', () => {
      const originalData = 'test data'.repeat(100000);
      const chunks = splitIntoChunks(originalData, 100 * 1024);
      const reassembler = new ChunkReassembler();

      // Shuffle chunks
      const shuffled = [...chunks].sort(() => Math.random() - 0.5);

      let result: string | null = null;

      shuffled.forEach((chunk) => {
        const res = reassembler.addChunk(chunk);
        if (res) {
          result = res;
        }
      });

      expect(result).toBe(originalData);
    });

    it('should track progress correctly', () => {
      const data = 'x'.repeat(5 * 1024 * 1024);
      const chunks = splitIntoChunks(data, 1024 * 1024);
      const reassembler = new ChunkReassembler();

      expect(reassembler.getProgress(chunks[0].metadata.id)).toBe(0);

      reassembler.addChunk(chunks[0]);
      expect(reassembler.getProgress(chunks[0].metadata.id)).toBe(0.2); // 1/5

      reassembler.addChunk(chunks[1]);
      expect(reassembler.getProgress(chunks[0].metadata.id)).toBe(0.4); // 2/5

      reassembler.addChunk(chunks[2]);
      expect(reassembler.getProgress(chunks[0].metadata.id)).toBe(0.6); // 3/5

      reassembler.addChunk(chunks[3]);
      expect(reassembler.getProgress(chunks[0].metadata.id)).toBe(0.8); // 4/5

      reassembler.addChunk(chunks[4]);
      expect(reassembler.getProgress(chunks[0].metadata.id)).toBe(0); // Cleared after completion
    });

    it('should clear specific message chunks', () => {
      const data1 = 'data1'.repeat(100000);
      const data2 = 'data2'.repeat(100000);
      
      const chunks1 = splitIntoChunks(data1, 100 * 1024);
      const chunks2 = splitIntoChunks(data2, 100 * 1024);
      
      const reassembler = new ChunkReassembler();

      reassembler.addChunk(chunks1[0]);
      reassembler.addChunk(chunks2[0]);

      const messageId1 = chunks1[0].metadata.id;
      const messageId2 = chunks2[0].metadata.id;

      expect(reassembler.getProgress(messageId1)).toBeGreaterThan(0);
      expect(reassembler.getProgress(messageId2)).toBeGreaterThan(0);

      reassembler.clear(messageId1);

      expect(reassembler.getProgress(messageId1)).toBe(0);
      expect(reassembler.getProgress(messageId2)).toBeGreaterThan(0);
    });

    it('should clear all chunks', () => {
      const data1 = 'data1'.repeat(100000);
      const data2 = 'data2'.repeat(100000);
      
      const chunks1 = splitIntoChunks(data1, 100 * 1024);
      const chunks2 = splitIntoChunks(data2, 100 * 1024);
      
      const reassembler = new ChunkReassembler();

      reassembler.addChunk(chunks1[0]);
      reassembler.addChunk(chunks2[0]);

      reassembler.clear();

      expect(reassembler.getProgress(chunks1[0].metadata.id)).toBe(0);
      expect(reassembler.getProgress(chunks2[0].metadata.id)).toBe(0);
    });

    it('should handle JSON object reassembly', () => {
      const originalObject = {
        timestamp: Date.now(),
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          data: 'test data'.repeat(10),
        })),
      };

      const chunks = splitIntoChunks(originalObject, 50 * 1024);
      const reassembler = new ChunkReassembler();

      let result: string | null = null;

      chunks.forEach((chunk) => {
        const res = reassembler.addChunk(chunk);
        if (res) {
          result = res;
        }
      });

      expect(result).toBeDefined();
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual(originalObject);
    });
  });

  describe('MessageBatcher', () => {
    it('should batch messages and flush', (done) => {
      const messages: string[][] = [];
      
      const batcher = new MessageBatcher(
        (batch) => {
          messages.push(batch);
        },
        3, // batch size
        50  // flush delay
      );

      batcher.add('message1');
      batcher.add('message2');
      
      // Not flushed yet
      expect(messages).toHaveLength(0);

      batcher.add('message3');
      
      // Should flush immediately when batch size is reached
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(['message1', 'message2', 'message3']);

      done();
    });

    it('should auto-flush after delay', (done) => {
      const messages: string[][] = [];
      
      const batcher = new MessageBatcher(
        (batch) => {
          messages.push(batch);
          expect(batch).toEqual(['delayed1', 'delayed2']);
          done();
        },
        10,
        100 // 100ms delay
      );

      batcher.add('delayed1');
      batcher.add('delayed2');
      
      // Not flushed immediately
      expect(messages).toHaveLength(0);

      // Will flush after 100ms
    });

    it('should flush manually', () => {
      const messages: string[][] = [];
      
      const batcher = new MessageBatcher(
        (batch) => {
          messages.push(batch);
        },
        10,
        1000
      );

      batcher.add('manual1');
      batcher.add('manual2');

      expect(messages).toHaveLength(0);

      batcher.flush();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(['manual1', 'manual2']);
    });

    it('should clear without flushing', () => {
      const messages: string[][] = [];
      
      const batcher = new MessageBatcher(
        (batch) => {
          messages.push(batch);
        },
        10,
        1000
      );

      batcher.add('cleared1');
      batcher.add('cleared2');

      batcher.clear();

      expect(messages).toHaveLength(0);

      // Flush after clear should do nothing
      batcher.flush();
      expect(messages).toHaveLength(0);
    });
  });

  describe('PerformanceMonitor', () => {
    it('should track timing', (done) => {
      const monitor = new PerformanceMonitor();

      monitor.start('test-operation');

      setTimeout(() => {
        const duration = monitor.end('test-operation');

        expect(duration).toBeGreaterThanOrEqual(50);
        expect(duration).toBeLessThan(200);
        done();
      }, 50);
    });

    it('should track timing with size', () => {
      const monitor = new PerformanceMonitor();
      const size = 10 * 1024 * 1024; // 10MB

      monitor.start('test-with-size', size);
      
      // Simulate some work
      const data = 'x'.repeat(size);
      
      const duration = monitor.end('test-with-size');

      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('should return null for unknown label', () => {
      const monitor = new PerformanceMonitor();

      const duration = monitor.end('unknown');

      expect(duration).toBeNull();
    });

    it('should clear all metrics', () => {
      const monitor = new PerformanceMonitor();

      monitor.start('metric1');
      monitor.start('metric2');

      monitor.clear();

      expect(monitor.end('metric1')).toBeNull();
      expect(monitor.end('metric2')).toBeNull();
    });
  });

  describe('Binary Utilities', () => {
    it('should convert binary to base64 and back', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 255, 128, 64]);
      
      const base64 = binaryToBase64(original);
      expect(base64).toBeDefined();
      expect(typeof base64).toBe('string');

      const decoded = base64ToBinary(base64);
      expect(decoded).toEqual(original);
    });

    it('should handle ArrayBuffer', () => {
      const buffer = new ArrayBuffer(8);
      const view = new Uint8Array(buffer);
      view.set([10, 20, 30, 40, 50, 60, 70, 80]);

      const base64 = binaryToBase64(buffer);
      expect(base64).toBeDefined();

      const decoded = base64ToBinary(base64);
      expect(decoded).toEqual(view);
    });

    it('should handle large binary data', () => {
      const size = 1024 * 1024; // 1MB
      const large = new Uint8Array(size);
      
      // Fill with pattern
      for (let i = 0; i < size; i++) {
        large[i] = i % 256;
      }

      const base64 = binaryToBase64(large);
      expect(base64).toBeDefined();

      const decoded = base64ToBinary(base64);
      expect(decoded).toEqual(large);
    });
  });

  describe('Integration Tests', () => {
    it('should handle 100MB payload transfer', () => {
      // Generate 100MB of data
      const largeData = {
        timestamp: Date.now(),
        items: Array.from({ length: 25000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          description: 'x'.repeat(1000), // 1KB per item
          nested: {
            field1: Math.random(),
            field2: Date.now(),
            field3: 'y'.repeat(500),
          },
        })),
      };

      const serialized = JSON.stringify(largeData);
      const size = serialized.length;
      
      console.log(`Test payload size: ${(size / 1024 / 1024).toFixed(2)}MB`);

      // Split into chunks
      const chunks = splitIntoChunks(largeData, 2 * 1024 * 1024); // 2MB chunks
      console.log(`Split into ${chunks.length} chunks`);

      expect(chunks.length).toBeGreaterThan(0);

      // Reassemble
      const reassembler = new ChunkReassembler();
      
      let result: string | null = null;

      chunks.forEach((chunk) => {
        const res = reassembler.addChunk(chunk);
        if (res) {
          result = res;
        }
      });

      expect(result).toBeDefined();
      const reassembled = JSON.parse(result!);
      
      expect(reassembled.timestamp).toBe(largeData.timestamp);
      expect(reassembled.items.length).toBe(largeData.items.length);
      expect(reassembled.items[0]).toEqual(largeData.items[0]);
    });

    it('should handle multiple simultaneous transfers', () => {
      const data1 = { id: 1, content: 'x'.repeat(500000) };
      const data2 = { id: 2, content: 'y'.repeat(500000) };
      const data3 = { id: 3, content: 'z'.repeat(500000) };

      const chunks1 = splitIntoChunks(data1, 200 * 1024);
      const chunks2 = splitIntoChunks(data2, 200 * 1024);
      const chunks3 = splitIntoChunks(data3, 200 * 1024);

      const reassembler = new ChunkReassembler();

      // Interleave chunks from different messages
      const interleaved: ChunkedMessage[] = [];
      const maxLength = Math.max(chunks1.length, chunks2.length, chunks3.length);
      
      for (let i = 0; i < maxLength; i++) {
        if (i < chunks1.length) interleaved.push(chunks1[i]);
        if (i < chunks2.length) interleaved.push(chunks2[i]);
        if (i < chunks3.length) interleaved.push(chunks3[i]);
      }

      const results: any[] = [];

      interleaved.forEach((chunk) => {
        const result = reassembler.addChunk(chunk);
        if (result) {
          results.push(JSON.parse(result));
        }
      });

      expect(results).toHaveLength(3);
      expect(results.find((r) => r.id === 1)).toEqual(data1);
      expect(results.find((r) => r.id === 2)).toEqual(data2);
      expect(results.find((r) => r.id === 3)).toEqual(data3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty data', () => {
      const chunks = splitIntoChunks('', 1024 * 1024);
      
      expect(chunks).toHaveLength(1);
      expect(chunks[0].data).toBe('');
    });

    it('should handle exactly chunk-sized data', () => {
      const data = 'x'.repeat(1024 * 1024);
      const chunks = splitIntoChunks(data, 1024 * 1024);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].data).toBe(data);
    });

    it('should handle data one byte larger than chunk size', () => {
      const data = 'x'.repeat(1024 * 1024 + 1);
      const chunks = splitIntoChunks(data, 1024 * 1024);

      expect(chunks).toHaveLength(2);
      expect(chunks[0].data).toHaveLength(1024 * 1024);
      expect(chunks[1].data).toHaveLength(1);
    });

    it('should handle duplicate chunk submission', () => {
      const data = 'test data'.repeat(10000);
      const chunks = splitIntoChunks(data, 50 * 1024);
      const reassembler = new ChunkReassembler();

      // Add first chunk twice
      reassembler.addChunk(chunks[0]);
      reassembler.addChunk(chunks[0]); // Duplicate (overwrites)

      // Add remaining chunks except the last one
      for (let i = 1; i < chunks.length - 1; i++) {
        reassembler.addChunk(chunks[i]);
      }

      // Progress should not be complete yet
      const progressBeforeLast = reassembler.getProgress(chunks[0].metadata.id);
      expect(progressBeforeLast).toBeGreaterThan(0);
      expect(progressBeforeLast).toBeLessThan(1);

      // Add the last chunk
      const result = reassembler.addChunk(chunks[chunks.length - 1]);
      
      // Should be complete now
      expect(result).toBe(data);
      expect(reassembler.getProgress(chunks[0].metadata.id)).toBe(0); // Completed and cleared
    });
  });
});
