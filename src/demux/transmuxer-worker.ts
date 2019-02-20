/* transmuxer web worker.
 *  - listen to worker message, and trigger DemuxerInline upon reception of Fragments.
 *  - provides MP4 Boxes back to main thread using [transferable objects](https://developers.google.com/web/updates/2011/12/Transferable-Objects-Lightning-Fast) in order to minimize message passing overhead.
 */

import Transmuxer from '../demux/transmuxer';
import Event from '../events';
import { enableLogs } from '../utils/logger';
import { EventEmitter } from 'eventemitter3';
import { RemuxerResult, RemuxedTrack } from '../types/remuxer';

export default function TransmuxerWorker (self) {
  // observer setup
  const observer = new EventEmitter() as any;
  observer.trigger = (event, data) => {
    observer.emit(event, event, ...data);
  };

  observer.off = (event, ...data) => {
    observer.removeListener(event, ...data);
  };

  const forwardMessage = (ev, data) => {
    self.postMessage({ event: ev, data: data });
  };

  // forward events to main thread
  observer.on(Event.FRAG_DECRYPTED, forwardMessage);
  observer.on(Event.ERROR, forwardMessage);

  self.addEventListener('message', (ev) => {
    const data = ev.data;
    // console.log('transmuxer cmd:' + data.cmd);
    switch (data.cmd) {
    case 'init': {
      const config = JSON.parse(data.config);
      self.transmuxer = new Transmuxer(observer, data.typeSupported, config, data.vendor);
      enableLogs(config.debug);
      forwardMessage('init', null);
      break;
    }
    case 'demux': {
      const remuxResult = self.transmuxer.push(data.data,
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
          emitTransmuxComplete(self, data);
        });
      } else {
        emitTransmuxComplete(self, remuxResult as RemuxerResult);
      }
      break;
    }
    default:
      break;
    }
  });
}

function emitTransmuxComplete (self: any, remuxerResult : RemuxerResult): void {
  let transferable = [] as Array<ArrayBuffer>;
  const { audio, video } = remuxerResult;
  if (audio) {
    transferable = transferable.concat(convertToTransferable(audio));
  }
  if (video) {
    transferable = transferable.concat(convertToTransferable(video));
  }
  self.postMessage({ event: 'transmuxComplete', data: remuxerResult }, transferable);
}

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
