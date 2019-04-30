import * as sinon from 'sinon';
import * as chai from 'chai';
import * as sinonChai from 'sinon-chai';
import Hls from '../../../src/hls';

import BufferOperationQueue from '../../../src/controller/buffer-operation-queue';
import BufferController from '../../../src/controller/buffer-controller';
import { BufferOperation, SourceBufferName } from '../../../src/types/buffer';
import { Segment } from '../../../src/types/segment';
import Events from '../../../src/events';
import { ErrorDetails, ErrorTypes } from '../../../src/errors';
import Fragment, { ElementaryStreamTypes } from '../../../src/loader/fragment';

chai.use(sinonChai);
const expect = chai.expect;
const sandbox = sinon.createSandbox();

class MockMediaSource {
  addSourceBuffer () : MockSourceBuffer {
    return new MockSourceBuffer();
  }
}

class MockSourceBuffer extends EventTarget {
  public updating: boolean = false;
  public appendBuffer = sandbox.stub();
  public remove = sandbox.stub();


  public buffered =  {
    start() {
      return this._start;
    },
    end() {
      return this._end;
    },
    length: 1,
    _start: 0,
    _end: 0
  };

  setBuffered(start, end) {
    this.buffered._start = start;
    this.buffered._end = end;
  }
}
const queueNames: Array<SourceBufferName> = ['audio', 'video'];

describe.only('BufferController SourceBuffer operation queueing', function () {
  let hls;
  let bufferController;
  let operationQueue;
  let triggerSpy;
  let shiftAndExecuteNextSpy;
  beforeEach(function () {
    hls = new Hls({});

    bufferController = new BufferController(hls);
    bufferController.mediaSource = new MockMediaSource();
    bufferController.createSourceBuffers({
      audio: {},
      video: {}
    });

    operationQueue = new BufferOperationQueue(bufferController.sourceBuffer);
    bufferController.operationQueue = operationQueue;
    triggerSpy = sandbox.spy(hls, 'trigger');
    shiftAndExecuteNextSpy = sandbox.spy(operationQueue, 'shiftAndExecuteNext');
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('cycles the queue on updateend', function () {
    const currentOnComplete = sandbox.spy();
    const currentOperation: BufferOperation = {
      execute: () => {},
      onComplete: currentOnComplete,
      onError: () => {}
    };

    const nextExecute = sandbox.spy();
    const nextOperation: BufferOperation = {
      execute: nextExecute,
      onComplete: () => {},
      onError: () => {}
    };

    queueNames.forEach((name, i) => {
      const currentQueue = operationQueue.queues[name];
      currentQueue.push(currentOperation, nextOperation);
      bufferController.sourceBuffer[name].dispatchEvent(new Event('updateend'));
      expect(currentOnComplete, 'onComplete should have been called on the current operation').to.have.callCount(i + 1);
      expect(shiftAndExecuteNextSpy, `The queue should have been cycled`).to.have.callCount(i + 1);
    });
  });

  it('does not cycle the queue on error', function () {
    const onError = sandbox.spy();
    const operation: BufferOperation = {
      execute: () => {},
      onComplete: () => {},
      onError
    };
    queueNames.forEach((name, i) => {
      const currentQueue = operationQueue.queues[name];
      currentQueue.push(operation);
      const errorEvent = new Event('error');
      bufferController.sourceBuffer[name].dispatchEvent(errorEvent);

      expect(onError, 'onError should have been called on the current operation').to.have.callCount(i + 1);
      expect(onError, 'onError should be called with the error event').to.have.been.calledWith(errorEvent);
      expect(triggerSpy, 'ERROR should have been triggered in response to the SourceBuffer error')
        .to.have.been.calledWith(Events.ERROR, { type: ErrorTypes.MEDIA_ERROR, details: ErrorDetails.BUFFER_APPENDING_ERROR, fatal: false });
      expect(shiftAndExecuteNextSpy, `The queue should not have been cycled`).to.have.not.been.called;
    });
  });

  describe('onBufferAppending', function () {
    it('should enqueue and execute an append operation', function () {
      const queueAppendSpy = sandbox.spy(operationQueue, 'append');
      const buffers = bufferController.sourceBuffer;
      queueNames.forEach((name, i) => {
        const buffer = buffers[name];
        const segmentData = new Uint8Array();
        const data: Segment = {
          type: name,
          data: segmentData,
          parent: 'main',
          content: 'data'
        };

        bufferController.onBufferAppending(data);
        expect(queueAppendSpy, `The append operation should have been enqueued`).to.have.callCount(i + 1);

        buffer.dispatchEvent(new Event('updateend'));
        expect(buffer.ended, `The ${name} buffer should not be marked as true if an append occurred`).to.be.false;
        expect(buffer.appendBuffer, `appendBuffer should have been called with the remuxed data`).to.have.been.calledWith(segmentData);
        expect(triggerSpy, `BUFFER_APPENDED should be triggered upon completion of the operation`)
          .to.have.been.calledWith(Events.BUFFER_APPENDED, { parent: 'main', timeRanges: { audio: buffers['audio'].buffered, video: buffers['video'].buffered } });
        expect(shiftAndExecuteNextSpy, `The queue should have been cycled`).to.have.callCount(i + 1);
      });
    });

    it('should cycle the queue if the sourceBuffer does not exist while appending', function () {
      const queueAppendSpy = sandbox.spy(operationQueue, 'append');
      queueNames.forEach((name, i) => {
        bufferController.sourceBuffer = {};
        bufferController.onBufferAppending({
          type: name,
          data: new Uint8Array(),
          parent: 'main',
          content: 'data'
        });

        expect(queueAppendSpy, `The append operation should have been enqueued`).to.have.callCount(i + 1);
        expect(shiftAndExecuteNextSpy, `The queue should have been cycled`).to.have.callCount(i + 1);
      });
      expect(triggerSpy, `No event should have been triggered`).to.have.not.been.called;
    });
  });

  describe('onFragParsed', function () {
    it('should trigger FRAG_BUFFERED when all audio/video data has been buffered', function () {
      const queueAppendBlockerSpy = sandbox.spy(operationQueue, 'appendBlocker');
      const frag = new Fragment();
      frag.addElementaryStream(ElementaryStreamTypes.AUDIO);
      frag.addElementaryStream(ElementaryStreamTypes.VIDEO);

      bufferController.onFragParsed({ frag });
      expect(queueAppendBlockerSpy).to.have.been.calledTwice;
      return new Promise((resolve, reject) => {
        hls.on(Events.FRAG_BUFFERED, (event, data) => {
          try {
            expect(data.frag, 'The frag emitted in FRAG_BUFFERED should be the frag passed in onFragParsed').to.equal(frag);
            expect(data.id, 'The id of the event should be equal to the frag type').to.equal(frag.type);
            // TODO: remove stats from event & place onto frag
            // expect(data.stats).to.equal({});
          } catch (e) {
            reject(e);
          }
          resolve();
        });
      })
      .then(() => {
        expect(shiftAndExecuteNextSpy, `The queues should have been cycled`).to.have.been.calledTwice;
      });
    });
  });

  describe('onBufferFlushing', function () {
    let queueAppendSpy;
    beforeEach(function () {
    queueAppendSpy = sandbox.spy(operationQueue, 'append');
      queueNames.forEach(name => {
        const sb = bufferController.sourceBuffer[name];
        sb.setBuffered(0, 10);
      });
    });

    it('flushes audio and video buffers if no type arg is specified', function () {
      bufferController.onBufferFlushing({
        startOffset: 0,
        endOffset: Infinity
      });

      expect(queueAppendSpy, `A remove operation should have been appended to each queue`).to.have.been.calledTwice;
      queueNames.forEach((name, i) => {
        const buffer = bufferController.sourceBuffer[name];
        expect(buffer.remove, `Remove should have been called once on the ${name} SourceBuffer`).to.have.been.calledOnce;
        expect(buffer.remove, `Remove should have been called with the expected range`).to.have.been.calledWith(0, 10);

        buffer.dispatchEvent(new Event('updateend'));
        expect(triggerSpy, `The BUFFER_FLUSHED event should be called once per buffer`).to.have.callCount(i + 1);
        expect(triggerSpy, `BUFFER_FLUSHED should be the only event fired`).to.have.been.calledWith(Events.BUFFER_FLUSHED);
        expect(shiftAndExecuteNextSpy, `The queue should have been cycled`).to.have.callCount(i + 1);
      });
    });

    it('dequeues the remove operation if the SourceBuffer does not exist during the operation', function () {
      bufferController.sourceBuffer = {};
      bufferController.onBufferFlushing({
        startOffset: 0,
        endOffset: Infinity
      });

      expect(queueAppendSpy, `Two remove operations should have been appended`).to.have.been.calledTwice;
      expect(shiftAndExecuteNextSpy, `The queues should have been cycled`).to.have.callCount(2);
    });

    it('dequeues the remove operation if the requested remove range is not valid', function () {
      // Does not flush if out of buffered range
      bufferController.onBufferFlushing({
        startOffset: 9000,
        endOffset: 9001
      });

      // Does not flush if the range length is less than 0.5s
      bufferController.onBufferFlushing({
        startOffset: 9,
        endOffset: 9.1
      });

      expect(queueAppendSpy, `Four remove operations should have been appended`).to.have.callCount(4);
      expect(shiftAndExecuteNextSpy, `The queues should have been cycled`).to.have.callCount(4);
      queueNames.forEach(name => {
        const buffer = bufferController.sourceBuffer[name];
        expect(buffer.remove, `Remove should not have been called on the ${name} buffer`).to.have.not.been.called;
      });
      expect(triggerSpy, `No event should have been triggered`).to.have.not.been.called;
    });
  });
});

