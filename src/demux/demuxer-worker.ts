/* demuxer web worker.
 *  - listen to worker message, and trigger DemuxerInline upon reception of Fragments.
 *  - provides MP4 Boxes back to main thread using [transferable objects](https://developers.google.com/web/updates/2011/12/Transferable-Objects-Lightning-Fast) in order to minimize message passing overhead.
 */

import DemuxerInline from '../demux/demuxer-inline';
import Event from '../events';
import { enableLogs } from '../utils/logger';
import { EventEmitter } from 'eventemitter3';
import { RemuxerResult, RemuxedTrack } from '../types/remuxer';

let DemuxerWorker = function (self) {
  // observer setup
  let observer = new EventEmitter() as any;
  observer.trigger = function trigger (event, ...data) {
    observer.emit(event, event, ...data);
  };

  observer.off = function off (event, ...data) {
    observer.removeListener(event, ...data);
  };

  let forwardMessage = function (ev, data) {
    self.postMessage({ event: ev, data: data });
  };

  self.addEventListener('message', function (ev) {
    let data = ev.data;
    // console.log('demuxer cmd:' + data.cmd);
    switch (data.cmd) {
    case 'init': {
      const config = JSON.parse(data.config);
      self.demuxer = new DemuxerInline(observer, data.typeSupported, config, data.vendor);

      enableLogs(config.debug);

      // signal end of worker init
      forwardMessage('init', null);
      break;
    }
    case 'demux': {
      const start = performance.now();
      const remuxResult = self.demuxer.push(data.data,
        data.decryptdata,
        data.initSegment,
        data.audioCodec,
        data.videoCodec,
        data.timeOffset,
        data.discontinuity,
        data.trackSwitch,
        data.contiguous,
        data.duration,
        data.accurateTimeOffset,
        data.defaultInitPTS
      ) as Promise<RemuxerResult>;

      if (!remuxResult) {
        return;
      }
      if (remuxResult.then) {
        remuxResult.then(data => {
          emitTransmuxComplete(data, start, observer);
        });
      } else {
        emitTransmuxComplete(remuxResult as RemuxerResult, start, observer);
      }
      break;
    }
    default:
      break;
    }
  });

  function emitTransmuxComplete (remuxerResult : RemuxerResult, start, observer) {
    let transferable = [] as Array<ArrayBuffer>;
    console.log('>>>', performance.now() - start);
    const { audio, video } = remuxerResult;
    if (audio) {
      transferable = transferable.concat(convertToTransferable(audio));
    }
    if (video) {
      transferable = transferable.concat(convertToTransferable(video));
    }
    observer.trigger(Event.FRAG_PARSED);
    self.postMessage({ event: 'transmuxComplete', data: remuxerResult }, transferable);
  }

  // forward events to main thread
  observer.on(Event.FRAG_DECRYPTED, forwardMessage);
  observer.on(Event.ERROR, forwardMessage);
};

function convertToTransferable (track: RemuxedTrack): Array<ArrayBuffer> {
  const transferable = [] as Array<ArrayBuffer>;
  if (track.data1) {
    transferable.push(track.data1.buffer);
  }
  if (track.data2) {
    transferable.push(track.data2.buffer);
  }
  return transferable;
}

export default DemuxerWorker;
